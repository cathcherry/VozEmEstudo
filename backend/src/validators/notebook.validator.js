import { z } from 'zod';
import { AppError } from '../domain/errors.js';

// Lesson notebook document (Notes 3.0). Plain text only: a string with an HTML tag opener is
// refused ("a < b" is fine). The database checks shape, size, types and references again.
export const NOTEBOOK_LIMITS = Object.freeze({ bytes: 160000, blocks: 300, items: 100 });
export const BLOCK_TYPES = Object.freeze([
  'heading',
  'paragraph',
  'bullet_list',
  'ordered_list',
  'checklist',
  'quote',
  'annotation_ref',
]);
const TAG = /<\/?[a-zA-Z!?]/;
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const text = (max) =>
  z
    .string()
    .max(max)
    .refine((value) => !TAG.test(value), 'html');
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const list = (type) =>
  z.object({ id, type: z.literal(type), items: z.array(text(1000)).max(NOTEBOOK_LIMITS.items) }).strict();
const block = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text: text(300) }).strict(),
  z.object({ id, type: z.literal('paragraph'), text: text(5000) }).strict(),
  list('bullet_list'),
  list('ordered_list'),
  z
    .object({
      id,
      type: z.literal('checklist'),
      items: z
        .array(z.object({ text: text(1000), checked: z.boolean() }).strict())
        .max(NOTEBOOK_LIMITS.items),
    })
    .strict(),
  z.object({ id, type: z.literal('quote'), text: text(2000) }).strict(),
  // Revision-aware reference: the annotation and the revision it was made in.
  z
    .object({
      id,
      type: z.literal('annotation_ref'),
      annotationId: uuid,
      sourceRevisionId: uuid,
      sourceRevision: z.number().int().min(1).optional(),
    })
    .strict(),
]);
const doc = z
  .object({
    type: z.literal('doc'),
    schemaVersion: z.literal(1),
    blocks: z.array(block).max(NOTEBOOK_LIMITS.blocks),
  })
  .strict()
  .refine((value) => new Set(value.blocks.map((item) => item.id)).size === value.blocks.length, 'ids');
const save = z
  .object({ version: z.number().int().min(0), requestId: uuid, title: text(160).default(''), doc })
  .strict();

export function validateNotebookSave(body) {
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(body?.doc ?? null));
  } catch {
    size = Infinity;
  }
  if (size > NOTEBOOK_LIMITS.bytes)
    throw new AppError(
      'NOTEBOOK_TOO_LARGE',
      'O caderno passou do limite de tamanho. Divida o conteúdo em menos blocos ou remova trechos.',
      413,
    );
  const result = save.safeParse(body);
  if (!result.success) {
    const html = result.error.issues.some((issue) => issue.message === 'html');
    throw new AppError(
      'NOTEBOOK_INVALID',
      html
        ? 'Use apenas texto no caderno: marcações HTML (como <b> ou <script>) não são aceitas.'
        : 'O caderno tem um bloco inválido. Recarregue a página e tente de novo.',
      400,
    );
  }
  return result.data;
}
