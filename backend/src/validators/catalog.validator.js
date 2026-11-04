import { z } from 'zod';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const title = z.string().trim().min(1).max(160);

export function normalizeCatalogName(value) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
}

export function validateSubject(input) {
  const parsed = z.object({ name }).strict().parse(input);
  return {
    name: parsed.name.replace(/\s+/gu, ' '),
    normalized_name: normalizeCatalogName(parsed.name),
  };
}

export function validateUnit(input) {
  const parsed = z
    .object({
      title,
      description: z.string().trim().max(500).nullable().optional(),
    })
    .strict()
    .parse(input);
  return {
    title: parsed.title.replace(/\s+/gu, ' '),
    normalized_title: normalizeCatalogName(parsed.title),
    description: parsed.description || null,
  };
}

export function validateCatalogId(value) {
  return uuid.parse(value);
}

export function validateAssignment(input) {
  return z
    .object({
      subjectId: uuid.nullable(),
      unitId: uuid.nullable().default(null),
    })
    .strict()
    .refine((value) => value.subjectId !== null || value.unitId === null, {
      message: 'Uma unidade precisa estar vinculada a uma disciplina.',
      path: ['unitId'],
    })
    .parse(input);
}
