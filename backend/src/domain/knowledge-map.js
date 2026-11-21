import { z } from 'zod';
import { AppError } from './errors.js';
import { createEvidenceLocator } from './evidence-match.js';

// Milestone C — evidence checks for knowledge maps and integrated materials. A model's citation is
// kept only if its quote is found (tolerantly, see evidence-match.js) in the segment it points to,
// in the frozen segments_snapshot of that revision. The stored quote is the transcript's own
// wording. Unsupported items are dropped and counted, never silently kept.

const invalid = (detail) =>
  new AppError('LLM_INVALID_OUTPUT', 'O modelo não retornou o material no formato esperado.', 502, {
    retryable: true,
    details: detail ? { issue: String(detail).slice(0, 200) } : undefined,
  });

const wordsOf = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .match(/[\p{L}\p{N}]+/gu) || [];

/** Index of a revision's segments by position, with lazily built quote locators. */
export function createSegmentIndex(segments = []) {
  const byPosition = new Map();
  for (const segment of Array.isArray(segments) ? segments : [])
    if (Number.isInteger(segment?.position)) byPosition.set(segment.position, segment);
  const locators = new Map();
  const locator = (key, text) => {
    if (!locators.has(key)) locators.set(key, createEvidenceLocator(text));
    return locators.get(key);
  };
  /** Returns {position, quote, startMs, endMs} for a supported citation, or null. */
  function check(position, quote) {
    const segment = byPosition.get(position);
    if (!segment || typeof quote !== 'string' || !quote.trim()) return null;
    const text = String(segment.text || '');
    const found = locator(position, text)(quote, { maxLength: 400 });
    if (found) return reference(segment, found.text);
    // A quote that runs into the next segment.
    const next = byPosition.get(position + 1);
    if (next) {
      const joined = `${text} ${next.text || ''}`;
      const across = locator(`${position}+`, joined)(quote, { maxLength: 400 });
      if (across) return reference(segment, across.text);
    }
    // Short quotes (3-4 words) must appear word for word.
    const quoteWords = wordsOf(quote);
    if (quoteWords.length >= 3 && quoteWords.length < 5) {
      const haystack = ` ${wordsOf(text).join(' ')} `;
      if (haystack.includes(` ${quoteWords.join(' ')} `)) return reference(segment, quote.trim());
    }
    return null;
  }
  return { check, size: byPosition.size };
}
function reference(segment, quote) {
  return {
    position: segment.position,
    quote,
    startMs: Number.isFinite(segment.startMs) ? segment.startMs : null,
    endMs: Number.isFinite(segment.endMs) ? segment.endMs : null,
  };
}

const evidenceSchema = z.object({
  position: z.coerce.number().int().min(0).max(100000),
  quote: z.string().max(1000),
});
const mapSchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        definition: z.string().trim().max(600).optional().default(''),
        evidence: z.array(evidenceSchema).max(8).optional().default([]),
      }),
    )
    .max(80),
  relations: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(160),
        to: z.string().trim().min(1).max(160),
        type: z.string().trim().max(40).optional().default('relacionado'),
        evidence: z.array(evidenceSchema).max(8).optional().default([]),
      }),
    )
    .max(120)
    .optional()
    .default([]),
});
const RELATION_TYPES = new Set(['causa', 'parte_de', 'exemplo_de', 'contrasta_com', 'depende_de', 'relacionado']);

/**
 * Validates a knowledge map of one revision. Concepts and relations without a supported quote are
 * dropped. Returns the map (with literal evidence) and what was dropped.
 */
export function validateKnowledgeMap(raw, segments) {
  const parsed = mapSchema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
  const index = createSegmentIndex(segments);
  const dropped = { concepts: 0, relations: 0, evidence: 0 };
  const supported = (list) => {
    const kept = [];
    for (const item of list) {
      const ref = index.check(item.position, item.quote);
      if (ref) kept.push({ position: ref.position, quote: ref.quote });
      else dropped.evidence += 1;
    }
    return kept.slice(0, 3);
  };
  const concepts = [];
  const names = new Set();
  for (const concept of parsed.data.concepts) {
    const key = concept.name.toLocaleLowerCase('pt-BR');
    const evidence = supported(concept.evidence);
    if (!evidence.length || names.has(key)) {
      dropped.concepts += 1;
      continue;
    }
    names.add(key);
    concepts.push({ name: concept.name, definition: concept.definition.slice(0, 300), evidence });
  }
  const relations = [];
  for (const relation of parsed.data.relations) {
    const evidence = supported(relation.evidence);
    const known =
      names.has(relation.from.toLocaleLowerCase('pt-BR')) && names.has(relation.to.toLocaleLowerCase('pt-BR'));
    if (!evidence.length || !known) {
      dropped.relations += 1;
      continue;
    }
    relations.push({
      from: relation.from,
      to: relation.to,
      type: RELATION_TYPES.has(relation.type) ? relation.type : 'relacionado',
      evidence,
    });
  }
  return { map: { concepts, relations }, dropped };
}

const citationSchema = z.object({
  lesson: z.string().trim().min(1).max(10),
  position: z.coerce.number().int().min(0).max(100000),
  quote: z.string().max(1000),
});
const citations = z.array(citationSchema).max(10).optional().default([]);
const synthesisSchema = z.object({
  summary: z
    .object({
      sections: z
        .array(z.object({ heading: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(4000), citations }))
        .max(30),
    })
    .optional(),
  questions: z
    .array(
      z.object({
        statement: z.string().trim().min(8).max(1000),
        options: z.array(z.string().trim().min(1).max(500)).length(4),
        correctIndex: z.coerce.number().int().min(0).max(3),
        explanation: z.string().trim().max(2000).optional().default(''),
        citations,
      }),
    )
    .max(60)
    .optional(),
  flashcards: z
    .array(z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(1000), citations }))
    .max(80)
    .optional(),
});

/** Throws LLM_INVALID_OUTPUT (repairable) when the synthesis does not have the expected shape. */
export function parseSynthesis(raw, outputs) {
  const parsed = synthesisSchema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.path?.join('.') || 'formato');
  for (const output of outputs) {
    const value = output === 'summary' ? parsed.data.summary?.sections : parsed.data[output];
    if (!Array.isArray(value)) throw invalid(`${output} ausente`);
  }
  return parsed.data;
}

/**
 * Checks every citation against the lesson it names. Each kept citation points to a specific
 * material, revision and segment. Sections, questions and cards with no supported citation are
 * dropped; everything dropped is reported.
 * @param {object} data parsed synthesis
 * @param {{label:string, materialId:string, revisionId:string, revision:number, title:string,
 *   segments:object[]}[]} lessons
 */
export function validateSynthesis(data, lessons, outputs) {
  const byLabel = new Map(lessons.map((lesson) => [lesson.label, { lesson, index: createSegmentIndex(lesson.segments) }]));
  const report = { droppedSections: 0, droppedQuestions: 0, droppedFlashcards: 0, droppedCitations: 0 };
  const cite = (list) => {
    const kept = [];
    const seen = new Set();
    for (const citation of list) {
      const entry = byLabel.get(citation.lesson.toUpperCase());
      const ref = entry?.index.check(citation.position, citation.quote);
      if (!ref) {
        report.droppedCitations += 1;
        continue;
      }
      const key = `${entry.lesson.revisionId}:${ref.position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({
        materialId: entry.lesson.materialId,
        revisionId: entry.lesson.revisionId,
        revision: entry.lesson.revision,
        lessonTitle: entry.lesson.title,
        position: ref.position,
        quote: ref.quote,
        startMs: ref.startMs,
      });
    }
    return kept.slice(0, 5);
  };
  const result = {};
  if (outputs.includes('summary')) {
    result.summary = { sections: [] };
    for (const section of data.summary.sections) {
      const kept = cite(section.citations);
      if (!kept.length) report.droppedSections += 1;
      else result.summary.sections.push({ heading: section.heading, text: section.text, citations: kept });
    }
  }
  if (outputs.includes('questions')) {
    result.questions = [];
    for (const question of data.questions) {
      const kept = cite(question.citations);
      const distinct = new Set(question.options.map((option) => option.toLocaleLowerCase('pt-BR'))).size === 4;
      if (!kept.length || !distinct) report.droppedQuestions += 1;
      else
        result.questions.push({
          statement: question.statement,
          options: question.options,
          correctIndex: question.correctIndex,
          explanation: question.explanation,
          citations: kept,
        });
    }
  }
  if (outputs.includes('flashcards')) {
    result.flashcards = [];
    for (const card of data.flashcards) {
      const kept = cite(card.citations);
      if (!kept.length) report.droppedFlashcards += 1;
      else result.flashcards.push({ front: card.front, back: card.back, citations: kept });
    }
  }
  const usable =
    (result.summary?.sections.length || 0) + (result.questions?.length || 0) + (result.flashcards?.length || 0);
  return { result, report, usable };
}
