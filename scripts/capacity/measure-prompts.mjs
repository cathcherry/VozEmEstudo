#!/usr/bin/env node
// Measures the tokens of the ACTUAL prompts the app sends to the text model (Groq
// openai/gpt-oss-120b), built by importing the app's own prompt builders with a representative
// pt-BR lesson transcript (scripts/capacity/transcript-fixture.mjs). No network, no AI calls,
// no database.
//
// Tokenizer: o200k_base (the gpt-oss tokenizer "o200k_harmony" is o200k_base plus special
// tokens, so plain-text counts are identical). Loaded from js-tiktoken, which bundles the
// encoding file (no download). js-tiktoken is NOT a project dependency: point JS_TIKTOKEN_DIR
// at an installed copy, e.g.
//   npm install --prefix /tmp/tok js-tiktoken@1.0.21
//   JS_TIKTOKEN_DIR=/tmp/tok/node_modules/js-tiktoken node scripts/capacity/measure-prompts.mjs
// Without it, a heuristic calibrated on these same prompts is used (and reported as such).
//
// Usage: node scripts/capacity/measure-prompts.mjs [--json] [--write]
//   --write  saves scripts/capacity/measurements.json (read by estimate.mjs)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSummaryMessages } from '../../backend/src/prompts/summary.v1.js';
import { buildQuestionMessages } from '../../backend/src/prompts/questions.v1.js';
import {
  buildConceptMessages,
  buildPlannedQuestionMessages,
} from '../../backend/src/prompts/questions.v2.js';
import { buildWarningMessages } from '../../backend/src/prompts/warnings.v1.js';
import { buildFlashcardMessages } from '../../backend/src/prompts/flashcards.v1.js';
import { buildFlashcardMessagesV2 } from '../../backend/src/prompts/flashcards.v2.js';
import {
  buildKnowledgeMapMessages,
  buildSynthesisMessages,
} from '../../backend/src/prompts/multi-lesson.v1.js';
import { planCoverage, conceptKey } from '../../backend/src/domain/question-plan.js';
import { validateQuestionConfig } from '../../backend/src/validators/question-config.validator.js';
import {
  conceptTarget,
  MAX_MODEL_CALLS,
} from '../../backend/src/services/question-generation.service.js';
import { transcriptFor, segmentsFor, SAMPLE_OUTPUTS } from './transcript-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

// ---------------------------------------------------------------- tokenizer
// Heuristic fallback, calibrated with o200k_base on these prompts (see the doc): Portuguese prose
// ~4.1 chars/token, JSON with UUIDs/timestamps ~2.9 chars/token. Blended per message by the share
// of digits/punctuation.
function heuristicTokens(text) {
  const s = String(text);
  const symbols = (s.match(/[0-9{}[\]":,-]/g) || []).length / Math.max(1, s.length);
  const charsPerToken = symbols > 0.12 ? 2.9 : 4.1;
  return Math.ceil(s.length / charsPerToken);
}
let encode = null;
let tokenizer = 'heuristic (chars/4.1 prose, chars/2.9 JSON)';
if (process.env.JS_TIKTOKEN_DIR) {
  try {
    const mod = await import(
      pathToFileURL(join(process.env.JS_TIKTOKEN_DIR, 'dist/index.js')).href
    );
    const enc = mod.getEncoding('o200k_base');
    encode = (text) => enc.encode(String(text)).length;
    tokenizer = 'o200k_base (js-tiktoken, offline)';
  } catch (error) {
    console.error(`js-tiktoken not loaded (${error.message}); using the heuristic.`);
  }
}
const count = (text) => (encode ? encode(text) : heuristicTokens(text));

// Harmony chat format: each message is <|start|>{role}<|message|>{content}<|end|> (~4 tokens of
// framing), the API's system message (model identity, dates, "Reasoning: low", channels) is
// injected server-side, and the app's "system" message becomes a developer message with an
// "# Instructions" header. The exact text Groq injects is not published: this is the
// openai-harmony default, used as an approximation.
const HARMONY_SYSTEM =
  'You are ChatGPT, a large language model trained by OpenAI.\nKnowledge cutoff: 2024-06\nCurrent date: 2026-11-24\n\nReasoning: low\n\n# Valid channels: analysis, commentary, final. Channel must be included for every message.';
const HARMONY_OVERHEAD = count(HARMONY_SYSTEM) + 4 + count('# Instructions\n\n') + 3; // + assistant priming
const inputTokens = (messages) =>
  HARMONY_OVERHEAD + messages.reduce((sum, m) => sum + 4 + count(m.content), 0);

// ---------------------------------------------------------------- output calibration
const outputItem = {
  concept: count(JSON.stringify(SAMPLE_OUTPUTS.concept)) + 1,
  question: count(JSON.stringify(SAMPLE_OUTPUTS.question)) + 1,
  flashcard: count(JSON.stringify(SAMPLE_OUTPUTS.flashcard)) + 1,
  warning: count(JSON.stringify(SAMPLE_OUTPUTS.warning)),
  summaryStandard5min: count(SAMPLE_OUTPUTS.summaryStandard5min),
};
const LENGTH_FACTOR = { short: 0.5, standard: 1, detailed: 1.8 };
const SUMMARY_CAP = { short: 900, standard: 1800, detailed: 3500 };

// ---------------------------------------------------------------- scenarios
const MINUTES = [1, 2, 3, 5, 7];
const config = validateQuestionConfig({});
const transcriptTokens5 = count(transcriptFor(5));

/** Concepts the analysis step would plausibly return: one per ~60 words, within the asked range. */
function simulatedConcepts(text, wanted) {
  const sentences = text
    .match(/[^.!?]+[.!?]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  const words = text.split(/\s+/u).length;
  const n = Math.min(wanted, Math.max(4, Math.round(words / 60)), sentences.length);
  const step = sentences.length / n;
  return Array.from({ length: n }, (_, i) => {
    const evidence = sentences[Math.floor(i * step)].slice(0, 400);
    const label = evidence.split(/\s+/u).slice(0, 5).join(' ');
    return { key: conceptKey(label + i), label, evidence };
  });
}

function questionCalls(text, questionCount) {
  const words = text.split(/\s+/u).filter(Boolean).length;
  const target = conceptTarget(questionCount);
  const conceptMessages = buildConceptMessages(text, {
    maxConcepts: target,
    minConcepts: Math.min(target, Math.ceil(questionCount / 2) + 2),
  });
  const concepts = simulatedConcepts(text, target);
  const slots = planCoverage({
    count: questionCount,
    concepts,
    config,
    words,
    spare: Math.min(6, Math.ceil(questionCount / 4)),
  });
  const questionMessages = buildPlannedQuestionMessages(text, { slots, avoid: [] });
  // Replacement round: assume a quarter of the slots (at least 2) come back, avoiding accepted ones.
  const missing = slots.slice(0, Math.max(2, Math.ceil(slots.length / 4)));
  const accepted = Array.from(
    { length: slots.length - missing.length },
    () => SAMPLE_OUTPUTS.question.statement,
  );
  const replacementMessages = buildPlannedQuestionMessages(text, {
    slots: missing,
    avoid: accepted,
  });
  return {
    concepts: {
      input: inputTokens(conceptMessages),
      maxTokens: Math.min(8000, 1200 + target * 160),
      visible: concepts.length * outputItem.concept + 10,
      items: concepts.length,
    },
    questions: {
      input: inputTokens(questionMessages),
      maxTokens: Math.min(16000, 1200 + slots.length * 600),
      visible: slots.length * outputItem.question + 10,
      items: slots.length,
    },
    replacement: {
      input: inputTokens(replacementMessages),
      maxTokens: Math.min(16000, 1200 + missing.length * 600),
      visible: missing.length * outputItem.question + 10,
      items: missing.length,
    },
  };
}

function measure(minutes) {
  const text = transcriptFor(minutes);
  const segments = segmentsFor(minutes);
  const source = {
    id: '00000000-0000-4000-8000-00000000abcd',
    full_text: text,
    segments_snapshot: segments,
  };
  const transcript = count(text);
  const summaryVisible = (length) =>
    Math.min(
      Math.round(SUMMARY_CAP[length] * 0.8),
      Math.max(
        150,
        Math.round(
          (outputItem.summaryStandard5min / transcriptTokens5) * transcript * LENGTH_FACTOR[length],
        ),
      ),
    );
  const summary = Object.fromEntries(
    ['short', 'standard', 'detailed'].map((length) => [
      length,
      {
        input: inputTokens(
          buildSummaryMessages(text, { format: 'structured', length, focus: ['concepts', 'exam'] }),
        ),
        maxTokens: SUMMARY_CAP[length],
        visible: summaryVisible(length),
      },
    ]),
  );
  const warning = {
    input: inputTokens(buildWarningMessages('factual_suspicion', source, 'Geografia')),
    maxTokens: 1200,
    visible: outputItem.warning,
  };
  const questionsV2 = Object.fromEntries([5, 10, 20].map((n) => [n, questionCalls(text, n)]));
  const legacy10 = {
    input: inputTokens(buildQuestionMessages(text, 10)),
    maxTokens: Math.max(2500, 10 * 550),
    visible: 10 * (outputItem.question - count(SAMPLE_OUTPUTS.question.evidence) - 8),
  };
  const fcConfig = {
    style: 'question_answer',
    focus: ['definitions', 'concepts'],
    difficulties: ['basic', 'intermediate'],
  };
  const flashcardCards = (n) =>
    Math.min(n, Math.max(3, Math.round(text.split(/\s+/u).length / 50)));
  const flashcards = Object.fromEntries(
    [1, 10, 20, 50].map((n) => [
      n,
      {
        input: inputTokens(
          buildFlashcardMessagesV2(text, {
            count: n,
            config: fcConfig,
            avoid: n === 1 ? Array(9).fill(SAMPLE_OUTPUTS.flashcard.front) : [],
          }),
        ),
        maxTokens: Math.min(12000, n * 550 + 500),
        visible: flashcardCards(n) * outputItem.flashcard + 10,
        items: flashcardCards(n),
      },
    ]),
  );
  const flashcardsV1 = {
    input: inputTokens(buildFlashcardMessages(text, 10)),
    maxTokens: Math.min(12000, 10 * 550 + 500),
    visible: flashcardCards(10) * (outputItem.flashcard - 12) + 10,
  };
  const knowledgeMap = {
    input: inputTokens(
      buildKnowledgeMapMessages({ title: 'Ciclo da água e bacias hidrográficas', segments }),
    ),
    maxTokens: 4000,
    visible: Math.min(3200, simulatedConcepts(text, 25).length * (outputItem.concept + 20) + 300),
  };
  return {
    minutes,
    words: text.split(/\s+/u).length,
    chars: text.length,
    segments: segments.length,
    transcriptTokens: transcript,
    segmentsJsonTokens: count(JSON.stringify(segments)),
    summary,
    warning,
    questionsV2,
    legacy10,
    flashcards,
    flashcardsV1,
    knowledgeMap,
  };
}

const results = MINUTES.map(measure);
// Multi-lesson synthesis over 4 maps (knowledge-map outputs are ~visible tokens each).
const fakeMap = {
  concepts: Array.from({ length: 12 }, () => ({
    name: 'Divisores de águas',
    definition: SAMPLE_OUTPUTS.concept.evidence,
    evidence: [{ position: 3, quote: SAMPLE_OUTPUTS.concept.evidence }],
  })),
  relations: Array.from({ length: 6 }, () => ({
    from: 'Desmatamento',
    to: 'Enchente',
    type: 'causa',
    evidence: [{ position: 9, quote: SAMPLE_OUTPUTS.question.evidence }],
  })),
};
const synthesis4 = {
  input: inputTokens(
    buildSynthesisMessages({
      lessons: [1, 2, 3, 4].map((i) => ({ label: `A${i}`, title: `Aula ${i}`, map: fakeMap })),
      outputs: ['summary', 'questions', 'flashcards'],
    }),
  ),
  maxTokens: 6000,
  visible: 4500,
};

// Per-minute slope (tokens of transcript per minute of audio), for extrapolating long lessons.
const r3 = results.find((r) => r.minutes === 3);
const r7 = results.find((r) => r.minutes === 7);
const perMinute = {
  transcriptTokens: (r7.transcriptTokens - r3.transcriptTokens) / 4,
  warningInput: (r7.warning.input - r3.warning.input) / 4,
  summaryInput: (r7.summary.standard.input - r3.summary.standard.input) / 4,
  conceptsInput: (r7.questionsV2[10].concepts.input - r3.questionsV2[10].concepts.input) / 4,
  questionsInputPerTranscript: 1, // the question prompt carries the full transcript once
  flashcardInput: (r7.flashcards[10].input - r3.flashcards[10].input) / 4,
};

const output = {
  generatedBy: 'scripts/capacity/measure-prompts.mjs',
  tokenizer,
  harmonyOverheadTokens: HARMONY_OVERHEAD,
  outputItemTokens: outputItem,
  maxModelCallsPerQuestionList: MAX_MODEL_CALLS,
  results,
  synthesis4,
  perMinute,
};

if (args.has('--write'))
  writeFileSync(join(here, 'measurements.json'), JSON.stringify(output, null, 2) + '\n');

if (args.has('--json')) {
  console.log(JSON.stringify(output, null, 2));
} else {
  const row = (cells) => `| ${cells.join(' | ')} |`;
  console.log(
    `Tokenizador: ${tokenizer}; sobrecarga do formato harmony por pedido: ${HARMONY_OVERHEAD} tokens`,
  );
  console.log(`Tokens por item de saída (amostras): ${JSON.stringify(outputItem)}\n`);
  console.log(
    row([
      'Duração',
      'Palavras',
      'Caracteres',
      'Segmentos',
      'Tokens da transcrição',
      'Tokens do JSON de segmentos',
    ]),
  );
  console.log(row(Array(6).fill('---')));
  for (const r of results)
    console.log(
      row([
        `${r.minutes} min`,
        r.words,
        r.chars,
        r.segments,
        r.transcriptTokens,
        r.segmentsJsonTokens,
      ]),
    );
  console.log('');
  console.log(
    row([
      'Chamada',
      ...results.map((r) => `${r.minutes} min: entrada / max_completion_tokens / saída visível`),
    ]),
  );
  console.log(row(Array(results.length + 1).fill('---')));
  const calls = [
    ['Resumo breve', (r) => r.summary.short],
    ['Resumo padrão', (r) => r.summary.standard],
    ['Resumo detalhado', (r) => r.summary.detailed],
    ['Aviso (1 de 3)', (r) => r.warning],
    ['Questões v2 (10): conceitos', (r) => r.questionsV2[10].concepts],
    ['Questões v2 (10): questões', (r) => r.questionsV2[10].questions],
    ['Questões v2 (10): reposição', (r) => r.questionsV2[10].replacement],
    ['Questões v2 (20): conceitos', (r) => r.questionsV2[20].concepts],
    ['Questões v2 (20): questões', (r) => r.questionsV2[20].questions],
    ['Questões v1 legado (10)', (r) => r.legacy10],
    ['Flashcards v2 (10)', (r) => r.flashcards[10]],
    ['Flashcards v2 (50)', (r) => r.flashcards[50]],
    ['Flashcards: trocar 1', (r) => r.flashcards[1]],
    ['Mapa de conhecimento (multiaulas)', (r) => r.knowledgeMap],
  ];
  for (const [label, pick] of calls)
    console.log(
      row([
        label,
        ...results.map((r) => {
          const c = pick(r);
          return `${c.input} / ${c.maxTokens} / ~${c.visible}`;
        }),
      ]),
    );
  console.log(
    `\nSíntese multiaulas (4 mapas): entrada ${synthesis4.input}, max ${synthesis4.maxTokens}`,
  );
  console.log(`Inclinação por minuto de áudio: ${JSON.stringify(perMinute)}`);
}
