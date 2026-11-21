import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { createEvidenceLocator } from '../domain/evidence-match.js';
import { conceptKey, planCoverage, sourceCapacity } from '../domain/question-plan.js';
import { filterRedundant, normalizeText } from '../domain/question-redundancy.js';
import { buildConceptMessages, buildPlannedQuestionMessages } from '../prompts/questions.v2.js';

/** At most three model calls per list: analysis, generation and one replacement round. */
export const MAX_MODEL_CALLS = 3;
const MAX_CONCEPTS = 60;
const MIN_CONCEPTS = 8;

/** Enough concepts for a varied plan plus spares for rejections. */
export function conceptTarget(count) {
  return Math.min(MAX_CONCEPTS, Math.max(MIN_CONCEPTS, Math.ceil(count * 1.5)));
}

const conceptSchema = z.object({
  concepts: z.array(z.object({ label: z.string(), evidence: z.string() }).passthrough()).max(200),
});
const questionsSchema = z.object({ questions: z.array(z.unknown()).max(200) });
const itemSchema = z.object({
  slot: z.string().min(1).max(20),
  statement: z.string().trim().min(8).max(1000),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(2000),
  evidence: z.string().trim().min(15).max(400),
});

const invalidOutput = () =>
  new AppError(
    'LLM_INVALID_OUTPUT',
    'O modelo não retornou as questões no formato esperado.',
    502,
    {
      retryable: true,
    },
  );

/** Maps a literal quote to the transcript segments it came from (positions and times). */
export function sourceReferences(evidence, segments = []) {
  const quote = normalizeText(evidence);
  if (!quote) return [];
  const direct = segments.filter((segment) => normalizeText(segment.text).includes(quote));
  if (direct.length) return direct.slice(0, 3).map(reference);
  // Quotes that cross a segment boundary: match on the first and last words.
  const words = quote.split(' ');
  const head = words.slice(0, 4).join(' '),
    tail = words.slice(-4).join(' ');
  const start = segments.findIndex((segment) => normalizeText(segment.text).includes(head));
  const end = segments.findIndex(
    (segment, index) => index >= start && normalizeText(segment.text).includes(tail),
  );
  return start >= 0 && end >= start
    ? segments.slice(start, Math.min(end + 1, start + 3)).map(reference)
    : [];
}
function reference(segment) {
  return { position: segment.position, startMs: segment.startMs, endMs: segment.endMs };
}

export function buildQuestionGenerator({ complete }) {
  return async function generate({ source, count, config, previous = [] }) {
    const text = source.full_text || '';
    const normalizedSource = normalizeText(text);
    const locate = createEvidenceLocator(text);
    /** The transcript's own wording for a model quote, or null when the quote is not in it. */
    const evidenceFor = (quote) => {
      const value = normalizeText(quote);
      if (value.length < 10) return null;
      const found = locate(quote);
      if (found) return found.text;
      return normalizedSource.includes(value) ? String(quote).trim().slice(0, 400) : null;
    };
    const sourceWords = new Set(normalizedSource.split(' '));
    /** Most of the label's meaningful words occur in the transcript (stems of 5 letters). */
    const labelInSource = (label) => {
      const words = normalizeText(label)
        .split(' ')
        .filter((word) => word.length > 3);
      if (!words.length) return false;
      const stems = [...sourceWords].map((word) => word.slice(0, 5));
      const found = words.filter((word) => stems.includes(word.slice(0, 5))).length;
      return found / words.length >= 0.5;
    };
    let calls = 0;
    const call = async (stage, messages, maxTokens) => {
      if (calls >= MAX_MODEL_CALLS) throw new Error('Model call budget exceeded.');
      calls += 1;
      return complete({ stage, messages, maxTokens });
    };

    // 1. Distinct concepts of the confirmed revision, each backed by a literal quote.
    const analysis = conceptSchema.safeParse(
      await call(
        'concepts',
        buildConceptMessages(text, {
          topicFocus: config.topicFocus,
          maxConcepts: conceptTarget(count),
          minConcepts: Math.min(conceptTarget(count), Math.ceil(count / 2) + 2),
        }),
        Math.min(8000, 1200 + conceptTarget(count) * 160),
      ),
    );
    if (!analysis.success) throw invalidOutput();
    const concepts = [];
    const seen = new Set();
    let conceptsWithoutQuote = 0;
    for (const item of analysis.data.concepts) {
      const label = String(item.label).trim().slice(0, 120),
        key = conceptKey(label);
      if (!key || key.length < 3 || seen.has(key)) continue;
      // A paraphrased quote does not make the concept invalid: questions still need their own
      // literal evidence, checked below. Keep it, without a quote, after the quoted ones.
      const evidence = evidenceFor(item.evidence);
      if (!evidence && !labelInSource(label)) continue; // invented, not paraphrased
      seen.add(key);
      if (!evidence) conceptsWithoutQuote += 1;
      concepts.push({ key, label, evidence });
    }
    concepts.sort((a, b) => Number(!a.evidence) - Number(!b.evidence));
    if (!concepts.some((concept) => concept.evidence))
      throw new AppError(
        'INSUFFICIENT_SOURCE_CONTENT',
        'A transcrição confirmada não tem conteúdo suficiente para gerar questões fundamentadas.',
        422,
      );
    const words = text.split(/\s+/u).filter(Boolean).length;
    const capacity = sourceCapacity({ words, concepts: concepts.length });

    // 2. Coverage plan by concept, skill and difficulty, consulting earlier lists.
    const testedConcepts = previous.map((question) => question.concept).filter(Boolean);
    // A few spare slots absorb items rejected later, so one bad answer does not shorten the list.
    const slots = planCoverage({
      count,
      concepts,
      config,
      testedConcepts,
      words,
      spare: Math.min(6, Math.ceil(count / 4)),
    });
    const planned = slots.filter((slot) => !slot.spare).length;
    const bySlot = new Map(slots.map((slot) => [slot.id, slot]));
    const rejectedReasons = {};
    const reject = (reason) => {
      rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
    };
    const accepted = [];
    const filled = new Set();
    const avoidStatements =
      config.previousQuestions === 'review' ? [] : previous.map((q) => q.statement);

    async function round(stage, pending, avoid) {
      const parsed = questionsSchema.safeParse(
        await call(
          stage,
          buildPlannedQuestionMessages(text, {
            slots: pending,
            avoid,
            topicFocus: config.topicFocus,
          }),
          Math.min(16000, 1200 + pending.length * 600),
        ),
      );
      if (!parsed.success) {
        if (stage === 'questions') throw invalidOutput();
        reject('invalid');
        return;
      }
      const candidates = [];
      for (const raw of parsed.data.questions) {
        const item = itemSchema.safeParse(raw);
        const slot = item.success && bySlot.get(item.data.slot);
        if (!item.success || !slot || filled.has(slot.id) || !pending.includes(slot)) {
          reject('invalid');
          continue;
        }
        const options = item.data.options;
        if (new Set(options.map(normalizeText)).size !== 4) {
          reject('invalid');
          continue;
        }
        const evidence = evidenceFor(item.data.evidence);
        if (!evidence) {
          reject('unsupported');
          continue;
        }
        candidates.push({
          ...item.data,
          evidence,
          concept: slot.concept.label,
          skill: slot.skill,
          facet: slot.facet,
          difficulty: slot.difficulty,
          slotId: slot.id,
        });
      }
      const result = filterRedundant(candidates, {
        previous,
        policy: config.previousQuestions,
        accepted,
      });
      for (const { reason } of result.rejected) reject(reason);
      for (const item of result.accepted) {
        accepted.push(item);
        filled.add(item.slotId);
      }
    }

    await round('questions', slots, avoidStatements);
    // 3. One bounded replacement round when the list is still short: every slot left empty
    //    (spares included) is asked again, avoiding what was already accepted.
    const missing = slots.filter((slot) => !filled.has(slot.id));
    if (accepted.length < planned && missing.length && calls < MAX_MODEL_CALLS)
      await round('replacement', missing, [
        ...avoidStatements,
        ...accepted.map((q) => q.statement),
      ]);

    if (!accepted.length) throw invalidOutput();
    const order = new Map(slots.map((slot, index) => [slot.id, index]));
    accepted.sort((a, b) => order.get(a.slotId) - order.get(b.slotId));
    const toQuestion = (item) => ({
      statement: item.statement,
      options: item.options,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
      metadata: {
        difficulty: item.difficulty,
        skill: item.skill,
        facet: item.facet,
        concept: item.concept,
        evidence: item.evidence,
        sourceRefs: sourceReferences(item.evidence, source.segments_snapshot || []),
      },
    });
    const questions = accepted.slice(0, count).map(toQuestion);
    return {
      questions,
      coverage: {
        requested: count,
        generated: questions.length,
        planned,
        capacity,
        words,
        concepts: [...new Set(questions.map((q) => q.metadata.concept))],
        distinctConcepts: concepts.length,
        conceptsWithoutQuote,
        rejected: rejectedReasons,
        modelCalls: calls,
        shortfall: shortfallReason({
          generated: questions.length,
          count,
          planned,
          rejected: rejectedReasons,
        }),
      },
    };
  };
}

/**
 * Why a list is shorter than requested. Only a plan limited by the transcript's size is
 * "insufficient content"; otherwise the cause is named (answers without literal support,
 * malformed answers, repeats, or slots the model skipped) so the interface does not blame the
 * lesson for an algorithmic or provider problem.
 */
export function shortfallReason({ generated, count, planned, rejected = {} }) {
  if (generated >= count) return null;
  if (planned < count && generated >= planned) return 'insufficient_content';
  // Everything else the filter rejects (same answer, paraphrase, earlier list…) is a repeat.
  const repeats = Object.entries(rejected)
    .filter(([reason]) => reason !== 'unsupported' && reason !== 'invalid')
    .reduce((sum, [, n]) => sum + n, 0);
  const ranked = [
    ['unsupported', rejected.unsupported || 0],
    ['invalid', rejected.invalid || 0],
    ['redundancy', repeats],
  ].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'model_omitted';
}

/** Deterministic stand-in used with MOCK_EXTERNAL_SERVICES: questions quote the transcript. */
export async function mockQuestionCompletion({ stage, messages }) {
  const input = JSON.parse(messages[1].content);
  if (stage === 'concepts') {
    const sentences = (input.transcript.match(/[^.!?]+[.!?]?/g) || [])
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 15);
    return {
      concepts: sentences.slice(0, 40).map((sentence, index) => ({
        label: `Ideia ${index + 1}: ${sentence.split(' ').slice(0, 4).join(' ')}`,
        evidence: sentence.slice(0, 400),
      })),
    };
  }
  return {
    questions: input.plan.map((slot) => ({
      slot: slot.slot,
      statement: `[Demonstração · ${slot.skill} · ${slot.difficulty}] Qual trecho a aula apresenta sobre "${slot.concept}"?`,
      options: [
        slot.conceptEvidence,
        `Alternativa de demonstração não citada (${slot.slot}-b).`,
        `Alternativa de demonstração não citada (${slot.slot}-c).`,
        `Alternativa de demonstração não citada (${slot.slot}-d).`,
      ],
      correctIndex: 0,
      explanation: 'Conteúdo de demonstração gerado sem provedor real.',
      evidence: slot.conceptEvidence,
    })),
  };
}
