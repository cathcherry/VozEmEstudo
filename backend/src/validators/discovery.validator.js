import { z } from 'zod';

// Milestone 6 (FEATURE_DISCOVERIES): investigations, discoveries and the collection. The database
// repeats every rule (ownership, confirmed revision, quote equal to the snapshot, limits); these
// schemas refuse malformed input before it reaches it.
const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
const text = (max) => z.string().max(max);
export const discoveryId = (value) => uuid.parse(value);

const investigationPatch = z
  .object({
    question: z.string().trim().min(3).max(300).optional(),
    questionOrigin: z.enum(['student', 'prompt']).optional(),
    explanation: text(5000).optional(),
    reflection: text(3000).optional(),
    explored: z.boolean().optional(),
  })
  .strict();
const investigationCreate = investigationPatch.extend({
  materialId: uuid,
  sourceRevisionId: uuid,
  question: z.string().trim().min(3).max(300),
});

/** version 0 creates (materialId, sourceRevisionId, question); later versions patch an open one. */
export const validateInvestigationSave = (body) =>
  z
    .object({ version: z.number().int().min(0), requestId: uuid, body: z.unknown() })
    .strict()
    .transform((v) => ({
      ...v,
      body:
        v.version === 0
          ? investigationCreate.parse(v.body)
          : investigationPatch.refine((p) => Object.keys(p).length > 0).parse(v.body),
    }))
    .parse(body);

/** A quote of the investigation's confirmed revision (same coordinates as Notes 3.0 anchors). */
export const validateEvidence = (body) =>
  z
    .object({
      id: uuid,
      segmentPosition: z.number().int().min(0),
      endSegmentPosition: z.number().int().min(0).optional(),
      startOffset: z.number().int().min(0).max(1000000),
      endOffset: z.number().int().positive().max(1000000),
      quote: z.string().min(1).max(1000),
      note: text(1000).optional(),
    })
    .strict()
    .refine((v) => {
      const end = v.endSegmentPosition ?? v.segmentPosition;
      return end >= v.segmentPosition && end - v.segmentPosition <= 49 && (end > v.segmentPosition || v.endOffset > v.startOffset);
    })
    .parse(body);

export const LINK_KINDS = ['question', 'flashcard', 'annotation', 'notebook'];
export const validateLink = (body) =>
  z.object({ id: uuid.optional(), kind: z.enum(LINK_KINDS), refId: uuid }).strict().parse(body);
export const validateLinkKind = (kind) => z.enum(LINK_KINDS).parse(kind);
export const validateComplete = (body) => z.object({ requestId: uuid }).strict().parse(body ?? {});

export const validateDiscoveryUpdate = (body) =>
  z
    .object({
      version: z.number().int().min(1),
      requestId: uuid,
      title: z.string().trim().min(3).max(300).optional(),
      explanation: z
        .string()
        .max(5000)
        .refine((v) => v.trim().length >= 20)
        .optional(),
    })
    .strict()
    .refine((v) => v.title !== undefined || v.explanation !== undefined)
    .parse(body);

export const validateReflection = (body) =>
  z
    .object({ id: uuid, text: z.string().max(3000).refine((v) => v.trim().length > 0) })
    .strict()
    .parse(body);

export const validateConnection = (body) =>
  z.object({ id: uuid, otherId: uuid, note: text(500).optional() }).strict().parse(body);

const SLOT = /^[a-z]+(-[a-z]+)*$/;
const OBJECT = /^object\.[a-z0-9]+(-[a-z0-9]+)*$/;
export const validateLayout = (body) =>
  z
    .object({
      version: z.number().int().min(0),
      requestId: uuid,
      items: z
        .array(z.object({ slot: z.string().regex(SLOT).max(40), objectId: z.string().regex(OBJECT).max(60) }).strict())
        .max(8),
    })
    .strict()
    .parse(body);
