import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { conceptKey, planCoverage } from '../domain/question-plan.js';
import { filterRedundant, normalizeText } from '../domain/question-redundancy.js';
import { buildConceptMessages, buildPlannedQuestionMessages } from '../prompts/questions.v2.js';

/** At most three model calls per list: analysis, generation and one replacement round. */
export const MAX_MODEL_CALLS = 3;
const MAX_CONCEPTS = 60;

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
  new AppError('LLM_INVALID_OUTPUT', 'O modelo não retornou as questões no formato esperado.', 502, {
    retryable: true,
  });

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
  const end = segments.findIndex((segment, index) => index >= start && normalizeText(segment.text).includes(tail));
  return start >= 0 && end >= start ? segments.slice(start, Math.min(end + 1, start + 3)).map(reference) : [];
}
function reference(segment) {
  return { position: segment.position, startMs: segment.startMs, endMs: segment.endMs };
}

export function buildQuestionGenerator({ complete }) {
  return async function generate({ source, count, config, previous = [] }) {
    const text = source.full_text || '';
    const normalizedSource = normalizeText(text);
    const supported = (quote) => {
      const value = normalizeText(quote);
      return value.length >= 10 && normalizedSource.includes(value);
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
        buildConceptMessages(text, { topicFocus: config.topicFocus, maxConcepts: Math.min(MAX_CONCEPTS, count * 2) }),
        Math.min(6000, 800 + count * 120),
      ),
    );
    if (!analysis.success) throw invalidOutput();
    const concepts = [];
    const seen = new Set();
    for (const item of analysis.data.concepts) {
      const label = String(item.label).trim().slice(0, 120),
        key = conceptKey(label);
      if (!key || seen.has(key) || !supported(item.evidence)) continue;
      seen.add(key);
      concepts.push({ key, label, evidence: String(item.evidence).trim().slice(0, 400) });
    }
    if (!concepts.length)
      throw new AppError(
        'INSUFFICIENT_SOURCE_CONTENT',
        'A transcrição confirmada não tem conteúdo suficiente para gerar questões fundamentadas.',
        422,
      );

    // 2. Coverage plan by concept, skill and difficulty, consulting earlier lists.
    const testedConcepts = previous.map((question) => question.concept).filter(Boolean);
    const slots = planCoverage({ count, concepts, config, testedConcepts });
    const bySlot = new Map(slots.map((slot) => [slot.id, slot]));
    const rejectedReasons = {};
    const reject = (reason) => {
      rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
    };
    const accepted = [];
    const filled = new Set();
    const avoidStatements = config.previousQuestions === 'review' ? [] : previous.map((q) => q.statement);

    async function round(stage, pending, avoid) {
      const parsed = questionsSchema.safeParse(
        await call(
          stage,
          buildPlannedQuestionMessages(text, { slots: pending, avoid, topicFocus: config.topicFocus }),
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
        if (!supported(item.data.evidence)) {
          reject('unsupported');
          continue;
        }
        candidates.push({
          ...item.data,
          concept: slot.concept.label,
          skill: slot.skill,
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
    // 3. One bounded replacement round for slots left empty by invalid or redundant items.
    const missing = slots.filter((slot) => !filled.has(slot.id));
    if (missing.length && calls < MAX_MODEL_CALLS)
      await round('replacement', missing, [...avoidStatements, ...accepted.map((q) => q.statement)]);

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
        concept: item.concept,
        evidence: item.evidence,
        sourceRefs: sourceReferences(item.evidence, source.segments_snapshot || []),
      },
    });
    const questions = accepted.slice(0, count).map(toQuestion);
    const shortfall =
      questions.length >= count ? null : slots.length < count ? 'insufficient_content' : 'redundancy';
    return {
      questions,
      coverage: {
        requested: count,
        generated: questions.length,
        planned: slots.length,
        concepts: [...new Set(questions.map((q) => q.metadata.concept))],
        distinctConcepts: concepts.length,
        rejected: rejectedReasons,
        modelCalls: calls,
        shortfall,
      },
    };
  };
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
