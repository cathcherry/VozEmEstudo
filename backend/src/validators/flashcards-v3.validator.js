import { z } from 'zod';
import { NOTE_TYPE_KEYS } from '../domain/flashcard-notes.js';

const uuid = z.string().uuid();
export const TEMPLATE_BASES = ['classic', 'notebook', 'sticky', 'window', 'polaroid'];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// Declarative appearance only: no CSS, HTML, URLs or scripts can be stored in a template.
const tokens = z
  .object({
    accent: hex.optional(),
    paper: hex.optional(),
    ink: hex.optional(),
    font: z.enum(['theme', 'serif', 'rounded', 'mono', 'handwritten']).optional(),
    radius: z.number().int().min(0).max(32).optional(),
    pattern: z.enum(['none', 'dots', 'grid', 'lines']).optional(),
    shadow: z.enum(['none', 'soft', 'lifted']).optional(),
  })
  .strict();
const variant = z.object({ layout: z.enum(['centered', 'left']).optional(), showType: z.boolean().optional() }).strict();
const variants = z.partialRecord(z.enum(NOTE_TYPE_KEYS), variant);

export const validateTemplateSave = (body) =>
  z
    .object({
      version: z.number().int().min(0),
      requestId: uuid,
      body: z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          base: z.enum(TEMPLATE_BASES).optional(),
          tokens: tokens.optional(),
          variants: variants.optional(),
          deleted: z.boolean().optional(),
        })
        .strict(),
    })
    .strict()
    .refine((v) => v.version > 0 || (v.body.name && v.body.base), 'Um modelo novo precisa de nome e base.')
    .parse(body);

export const validateSetTemplate = (body) =>
  z
    .object({ templateId: uuid.nullable().default(null), base: z.enum(TEMPLATE_BASES).nullable().default(null) })
    .strict()
    .refine((v) => !(v.templateId && v.base), 'Escolha um modelo ou uma base, não os dois.')
    .parse(body);

const note = z
  .object({
    noteType: z.enum(NOTE_TYPE_KEYS).default('basic'),
    fields: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(300)).max(12)])),
  })
  .strict();

const look = { templateId: uuid.nullable().optional(), templateBase: z.enum(TEMPLATE_BASES).nullable().optional() };

export const validateDeckCreate = (body) =>
  z
    .object({
      id: uuid,
      name: z.string().trim().min(1).max(160),
      origin: z.enum(['text_import', 'manual']).default('manual'),
      cards: z.array(note).min(1).max(500),
      ...look,
    })
    .strict()
    .parse(body);

export const validateAddNote = (body) => note.parse(body);

const source = z.object({ setId: uuid, classroomId: uuid.optional() }).strict();
export const validateMergePreview = (body) =>
  z.object({ sources: z.array(source).min(2).max(12) }).strict().parse(body);
export const validateMerge = (body) =>
  z
    .object({
      id: uuid,
      name: z.string().trim().min(1).max(160),
      sources: z.array(source).min(2).max(12),
      decisions: z.record(z.string().max(2000), z.string().regex(/^(combine|keep:[0-9a-f-]{36})$/)).default({}),
      ...look,
    })
    .strict()
    .parse(body);

export const validateApkgQuery = (query) =>
  z
    .object({
      mode: z.enum(['preview', 'create']).default('preview'),
      id: uuid.optional(),
      name: z.string().trim().min(1).max(160).optional(),
      templateBase: z.enum(TEMPLATE_BASES).optional(),
    })
    .strict()
    .refine((v) => v.mode === 'preview' || v.id, 'Informe o id do conjunto.')
    .parse(query);
