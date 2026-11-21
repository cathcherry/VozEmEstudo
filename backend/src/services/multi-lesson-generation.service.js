import { AppError } from '../domain/errors.js';
import {
  parseSynthesis,
  validateKnowledgeMap,
  validateSynthesis,
} from '../domain/knowledge-map.js';
import {
  buildKnowledgeMapMessages,
  buildRepairMessages,
  buildSynthesisMessages,
  KNOWLEDGE_MAP_PROMPT_VERSION,
  MULTI_LESSON_PROMPT_VERSION,
} from '../prompts/multi-lesson.v1.js';
import { logger } from '../utils/logger.js';

// Milestone C — the bounded generation pipeline. For N sources (N <= 12) it makes at most
// N knowledge-map calls (only for revisions without a cached map) + 1 synthesis call + 1 repair
// call. Nothing here touches the database directly: the cache is injected and optional (a cache
// failure or a missing cache table is a miss, never a failure of the generation).

export const MAX_SOURCES = 12;
export const maxModelCalls = (uncached) => uncached + 2;

const isInvalidOutput = (error) => error?.code === 'LLM_INVALID_OUTPUT' || error?.code === 'INVALID_GENERATION';

async function safely(task, fallback) {
  try {
    return await task();
  } catch (error) {
    logger.info('KNOWLEDGE_MAP_CACHE_SKIPPED', { code: error?.code || 'UNKNOWN' });
    return fallback;
  }
}

/**
 * @param {{complete:(args:{messages:object[], maxTokens:number})=>Promise<{data:any, model?:string}>,
 *   cache?: {get:(revisionIds:string[])=>Promise<Map<string,object>>, put:(revisionId:string, map:object, model:string)=>Promise<unknown>} | null}} deps
 */
export function buildMultiLessonGenerator({ complete, cache = null }) {
  return async function generate({ sources, outputs, settings = {} }) {
    if (!Array.isArray(sources) || !sources.length || sources.length > MAX_SOURCES)
      throw new AppError('MULTI_LESSON_TOO_MANY_SOURCES', 'Escolha de 1 a 12 aulas confirmadas.', 409);
    let calls = 0;
    let model = null;
    const call = async (messages, maxTokens) => {
      calls += 1;
      const completion = await complete({ messages, maxTokens });
      model = completion?.model || model;
      return completion?.data;
    };
    const cached = cache ? await safely(() => cache.get(sources.map((s) => s.revisionId)), new Map()) : new Map();
    const report = { cacheHits: 0, mapCalls: 0, lessonsWithoutKnowledge: [], droppedMapItems: 0 };
    const lessons = [];
    for (const source of sources) {
      let map = cached.get(source.revisionId);
      if (map) report.cacheHits += 1;
      else {
        report.mapCalls += 1;
        try {
          const raw = await call(buildKnowledgeMapMessages({ title: source.title, segments: source.segments }), 4000);
          const checked = validateKnowledgeMap(raw, source.segments);
          report.droppedMapItems += checked.dropped.concepts + checked.dropped.relations;
          map = checked.map;
          // Only maps with supported knowledge are worth reusing.
          if (cache && map.concepts.length) await safely(() => cache.put(source.revisionId, map, model), null);
        } catch (error) {
          // A malformed map is not repaired (one call per revision): the lesson is reported.
          if (!isInvalidOutput(error)) throw error;
          map = { concepts: [], relations: [] };
        }
      }
      if (!map.concepts?.length) {
        report.lessonsWithoutKnowledge.push({ materialId: source.materialId, title: source.title });
        continue;
      }
      lessons.push({ ...source, label: `A${lessons.length + 1}`, map });
    }
    if (!lessons.length)
      throw new AppError(
        'MULTI_LESSON_NO_KNOWLEDGE',
        'Não foi possível extrair conteúdo sustentado por trechos destas aulas.',
        422,
      );

    const messages = buildSynthesisMessages({
      lessons,
      outputs,
      questionCount: settings.questionCount,
      flashcardCount: settings.flashcardCount,
      focus: settings.focus,
    });
    const maxTokens = 6000;
    let data;
    let repaired = false;
    try {
      data = parseSynthesis(await call(messages, maxTokens), outputs);
    } catch (error) {
      if (!isInvalidOutput(error)) throw error;
      repaired = true;
      data = parseSynthesis(await call(buildRepairMessages(messages, error.details?.issue || error.message), maxTokens), outputs);
    }
    const checked = validateSynthesis(data, lessons, outputs);
    if (!checked.usable)
      throw new AppError(
        'MULTI_LESSON_UNSUPPORTED',
        'Nenhum item gerado tinha trecho das aulas que o sustentasse; nada foi salvo.',
        422,
      );
    return {
      model,
      calls,
      result: {
        ...checked.result,
        lessons: lessons.map(({ label, materialId, revisionId, revision, title, map }) => ({
          label,
          materialId,
          revisionId,
          revision,
          title,
          concepts: map.concepts.length,
        })),
        report: { ...report, ...checked.report, repaired, modelCalls: calls },
        promptVersions: { map: KNOWLEDGE_MAP_PROMPT_VERSION, synthesis: MULTI_LESSON_PROMPT_VERSION },
      },
    };
  };
}

// ---- Offline demo (MOCK_EXTERNAL_SERVICES): deterministic output built from the real segments,
// so the evidence checks pass exactly as they would with a provider. No request leaves the server.
const firstWords = (text, count = 12) => String(text).trim().split(/\s+/).slice(0, count).join(' ');

export function mockMultiLessonCompletion({ messages }) {
  const system = messages[0]?.content || '';
  const user = messages.at(-1)?.role === 'user' && messages.length > 2 ? messages[1].content : messages.at(-1)?.content || '';
  if (system.includes('mapa de conhecimento') && !system.includes('VÁRIAS')) {
    const segments = [...String(user).matchAll(/^\[(\d+)\] (.+)$/gm)].map((m) => ({ position: Number(m[1]), text: m[2] }));
    const concepts = segments.slice(0, 4).map((segment, i) => ({
      name: `Ideia ${i + 1}: ${firstWords(segment.text, 4)}`,
      definition: firstWords(segment.text, 20),
      evidence: [{ position: segment.position, quote: firstWords(segment.text) }],
    }));
    const relations =
      concepts.length > 1
        ? [{ from: concepts[0].name, to: concepts[1].name, type: 'relacionado', evidence: concepts[1].evidence }]
        : [];
    return { data: { concepts, relations }, model: 'mock' };
  }
  let lessons = [];
  try {
    lessons = JSON.parse(user);
  } catch {
    lessons = [];
  }
  const concepts = lessons.flatMap((lesson) => (lesson.map?.concepts || []).map((concept) => ({ lesson, concept })));
  const cite = ({ lesson, concept }) => concept.evidence.slice(0, 1).map((e) => ({ lesson: lesson.lesson, position: e.position, quote: e.quote }));
  const data = {
    summary: {
      sections: lessons.map((lesson) => ({
        heading: `O que ${lesson.title} acrescenta`,
        text: (lesson.map?.concepts || []).map((concept) => concept.definition).join(' '),
        citations: (lesson.map?.concepts || []).slice(0, 2).flatMap((concept) => cite({ lesson, concept })),
      })),
    },
    questions: concepts.slice(0, 8).map((item, i) => ({
      statement: `Segundo as aulas, qual afirmação descreve "${item.concept.name}"?`,
      options: [item.concept.definition, `Alternativa incorreta ${i + 1}A`, `Alternativa incorreta ${i + 1}B`, `Alternativa incorreta ${i + 1}C`],
      correctIndex: 0,
      explanation: `Veja o trecho citado de ${item.lesson.title}.`,
      citations: cite(item),
    })),
    flashcards: concepts.slice(0, 10).map((item) => ({ front: item.concept.name, back: item.concept.definition, citations: cite(item) })),
  };
  return { data, model: 'mock' };
}
