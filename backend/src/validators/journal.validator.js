import { z } from 'zod';
import { AppError } from '../domain/errors.js';

// Diário de estudo (FEATURE_JOURNAL, 3.6 Milestone D). Plain text only: a string with an HTML tag
// opener is refused ("a < b" is fine). The database repeats every rule (ownership, limits, the
// decoration allowlist, unlocked stamps, own links, a quote keeps its source).
export const JOURNAL_LIMITS = Object.freeze({ decorations: 24, links: 6, contentBytes: 24000 });
export const PAPERS = Object.freeze(['ruled', 'grid', 'dot', 'kraft', 'linen', 'vellum', 'aged']);
export const TEMPLATES = Object.freeze(['ruled', 'collage', 'concept', 'timeline', 'free']);
export const DECORATION_ART = /^(sticker|tape|stamp|frame|divider|label)\.[a-z0-9]+(-[a-z0-9]+)*$/;
const COVER = /^cover\.[a-z0-9]+(-[a-z0-9]+)*$/;
const STICKER = /^sticker\.[a-z0-9]+(-[a-z0-9]+)*$/;
const FRAME = /^frame\.[a-z0-9]+(-[a-z0-9]+)*$/;
const TAG = /<\/?[a-zA-Z!?]/;

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
export const journalId = (value) => uuid.parse(value);
const text = (max) =>
  z
    .string()
    .max(max)
    .refine((value) => !TAG.test(value), 'html');
const link = z.object({ kind: z.enum(['lesson', 'discovery']), id: uuid }).strict();
const quote = z.object({ text: text(600), source: link.nullable() }).strict();

// Each template has its own fields; unknown fields are refused.
const CONTENT = {
  ruled: z.object({ body: text(6000).default(''), quote: quote.optional() }).strict(),
  free: z.object({ body: text(6000).default('') }).strict(),
  concept: z
    .object({
      term: text(120).default(''),
      definition: text(1500).default(''),
      example: text(1500).default(''),
      quote: quote.optional(),
    })
    .strict(),
  collage: z
    .object({
      photos: z
        .array(
          z
            .object({
              caption: text(140),
              art: z.string().regex(STICKER).nullable(),
              frame: z.string().regex(FRAME),
            })
            .strict(),
        )
        .max(3)
        .default([]),
      note: text(1200).default(''),
    })
    .strict(),
  timeline: z
    .object({ items: z.array(z.object({ when: text(40), what: text(300) }).strict()).max(8).default([]) })
    .strict(),
};
const decoration = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    art: z.string().max(60).regex(DECORATION_ART),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    rotation: z.number().min(-180).max(180),
    scale: z.number().min(0.4).max(2.5),
  })
  .strict();
const decorations = z
  .array(decoration)
  .max(JOURNAL_LIMITS.decorations)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'ids');
const links = z
  .array(link)
  .max(JOURNAL_LIMITS.links)
  .refine((items) => new Set(items.map((item) => `${item.kind}:${item.id}`)).size === items.length, 'links');

function fail(error) {
  const issues = error?.issues || [];
  if (issues.some((issue) => issue.message === 'html'))
    throw new AppError(
      'JOURNAL_INVALID',
      'Use apenas texto no diário: marcações HTML (como <b> ou <script>) não são aceitas.',
      400,
    );
  throw new AppError('JOURNAL_INVALID', 'A página do diário tem um campo inválido. Recarregue e tente de novo.', 400);
}

/** { version, requestId, body: { title?, cover?, paper?, deleted? } }; creation needs title and cover. */
export function validateJournalSave(input) {
  const schema = z
    .object({
      version: z.number().int().min(0),
      requestId: uuid,
      body: z
        .object({
          title: text(80)
            .transform((value) => value.trim())
            .refine((value) => value.length > 0)
            .optional(),
          cover: z.string().max(60).regex(COVER).optional(),
          paper: z.enum(PAPERS).optional(),
          deleted: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0),
    })
    .strict()
    .refine((value) => value.version > 0 || (value.body.title && value.body.cover && !value.body.deleted));
  const result = schema.safeParse(input);
  if (!result.success) fail(result.error);
  return result.data;
}

/**
 * { version, requestId, body: { template?, title?, paper?, content?, decorations?, links?, position?, deleted? } }.
 * Creation needs the template; content is checked against it. The template of an existing page is
 * passed by the caller only when the body carries content (the database refuses a change).
 */
export function validatePageSave(input) {
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(input?.body?.content ?? null));
  } catch {
    size = Infinity;
  }
  if (size > JOURNAL_LIMITS.contentBytes)
    throw new AppError('JOURNAL_TOO_LARGE', 'Esta página passou do limite de tamanho. Divida o texto em outra página.', 413);
  const schema = z
    .object({
      version: z.number().int().min(0),
      requestId: uuid,
      body: z
        .object({
          template: z.enum(TEMPLATES).optional(),
          title: text(120).optional(),
          paper: z.enum(PAPERS).optional(),
          content: z.record(z.string(), z.unknown()).optional(),
          decorations: decorations.optional(),
          links: links.optional(),
          position: z.number().int().min(0).max(9999).optional(),
          deleted: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0),
    })
    .strict()
    .refine((value) => value.version > 0 || value.body.template)
    .refine((value) => !value.body.content || value.body.template, 'template')
    .transform((value, context) => {
      if (!value.body.content) return value;
      const parsed = CONTENT[value.body.template].safeParse(value.body.content);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue(issue);
        return z.NEVER;
      }
      // A quote keeps its source: the source must be one of the page's links.
      const source = parsed.data.quote?.text?.trim() ? parsed.data.quote.source : null;
      if (parsed.data.quote?.text?.trim() && !source) {
        context.addIssue({ code: 'custom', message: 'quote-source' });
        return z.NEVER;
      }
      return { ...value, body: { ...value.body, content: parsed.data } };
    });
  const result = schema.safeParse(input);
  if (!result.success) {
    if (result.error.issues.some((issue) => issue.message === 'quote-source'))
      throw new AppError(
        'JOURNAL_QUOTE_SOURCE_REQUIRED',
        'Uma citação precisa da fonte: escolha a aula ou a descoberta de onde ela veio.',
        409,
      );
    fail(result.error);
  }
  return result.data;
}
