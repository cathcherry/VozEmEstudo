#!/usr/bin/env node
// Capacity and cost estimator for a Voz em Estudo test round. Offline: reads the token
// measurements made by measure-prompts.mjs (scripts/capacity/measurements.json) and the
// parameters below, and prints Markdown tables (pt-BR). No network, no AI calls, no database.
//
// Usage: node scripts/capacity/estimate.mjs [--participants=10,30,50,100] [--json]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// =============================================================== PARAMETERS (edit here)
const P = {
  participants: [10, 30, 50, 100],
  admins: 1,
  usdToBrl: 5.8, // PTAX de venda 17/11/2026 = R$ 5,7851 (arredondado para cima)
  safetyMargin: 0.2, // folga aplicada às recomendações de teto global
  peak: { share: 0.5, hours: 2 }, // 50% do uso diário concentrado em 2 horas

  prices: {
    groqInputPerM: 0.15, // US$/1M tokens de entrada (openai/gpt-oss-120b) — fonte secundária
    groqOutputPerM: 0.6, // US$/1M tokens de saída, raciocínio incluído — fonte secundária
    assemblyPerHour: 0.21, // AssemblyAI-STT-3.7, pré-gravado — blog oficial (via busca)
    assemblySpeakerLabelsPerHour: 0.02, // só se ASR_SPEAKER_LABELS=true (padrão: false)
    assemblyFreeCreditUsd: 50,
  },
  groqFree: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  groqDeveloper: { rpm: 1000, rpd: 500000, tpm: 250000, tpd: Infinity }, // fonte secundária
  assemblyConcurrency: { free: 5, paid: 200 },
  speakerLabels: false,

  // Raciocínio do gpt-oss-120b com reasoning_effort=low (padrão do app). Não publicado:
  // suposição, a calibrar com os logs LLM_USAGE (completionTokens) da produção.
  reasoning: {
    typical: { ratio: 0.3, min: 150 },
    pessimistic: { ratio: 1.0, min: 400 },
  },
  replacementRoundProbability: { typical: 0.5, worst: 1 },

  // Cotas por participante propostas (testers) e por administrador.
  tester: {
    typical: {
      recordings: [3, 2], // minutos de cada gravação (total 5 min)
      generationMinutes: 3, // tamanho da transcrição usada nas gerações
      summaries: { n: 2, length: 'standard' },
      questionLists: { n: 2, count: 10 },
      flashcardPreviews: { n: 1, count: 10, topUp: false },
      replaceOne: 2,
      warningsRerun: 0,
      multiLesson: 0,
    },
    worst: {
      recordings: [5],
      generationMinutes: 5,
      summaries: { n: 2, length: 'detailed' },
      questionLists: { n: 2, count: 20 },
      flashcardPreviews: { n: 1, count: 50, topUp: true },
      replaceOne: 5,
      warningsRerun: 1,
      multiLesson: 0,
    },
  },
  admin: {
    typical: {
      recordings: [30],
      generationMinutes: 30,
      summaries: { n: 5, length: 'standard' },
      questionLists: { n: 5, count: 10 },
      flashcardPreviews: { n: 5, count: 20, topUp: false },
      replaceOne: 5,
      warningsRerun: 2,
      multiLesson: 1,
    },
    worst: {
      recordings: [30, 30, 30, 30], // 120 min
      generationMinutes: 30,
      summaries: { n: 20, length: 'detailed' },
      questionLists: { n: 20, count: 20 },
      flashcardPreviews: { n: 20, count: 50, topUp: true },
      replaceOne: 20,
      warningsRerun: 20,
      multiLesson: 20,
    },
  },
  // Tentativas do worker (JOB_MAX_ATTEMPTS=3) para o teto absoluto; multiaulas usa 2.
  jobMaxAttempts: 3,
  multiLessonMaxAttempts: 2,

  storage: {
    speechMbPerMinute: 0.48, // MP3 mono 64 kbit/s (media.service SPEECH_ARGS)
    retainShare: 0.3, // fração de gravações com "conservar áudio original"
    dbKbPerAudioMinute: 40, // palavras (jsonb), segmentos, versões e índices
    dbKbPerGeneration: 25, // resumo, lista de questões ou cartões salvos
    playsPerRetainedRecording: 2,
    demoAudioMb: 3,
    demoPlaysPerParticipant: 3,
    apiPayloadMbPerParticipantDay: 5, // leituras de aulas/transcrições (Supabase -> backend)
  },
  supabaseFree: { storageGb: 1, dbMb: 500, egressGb: 5 },
};

// =============================================================== MEASUREMENTS
const here = dirname(fileURLToPath(import.meta.url));
const M = JSON.parse(readFileSync(join(here, 'measurements.json'), 'utf8'));
const byMinutes = new Map(M.results.map((r) => [r.minutes, r]));
const largest = M.results[M.results.length - 1];
const wordsPerMinute = largest.words / largest.minutes;
const item = M.outputItemTokens;

/** Input tokens of a call at `minutes`, measured or linearly extrapolated from the 7-min slope. */
function input(pick, minutes) {
  const exact = byMinutes.get(minutes);
  if (exact) return pick(exact);
  const a = byMinutes.get(5);
  const slope = (pick(largest) - pick(a)) / (largest.minutes - a.minutes);
  return Math.round(pick(largest) + slope * (minutes - largest.minutes));
}
const transcriptTokens = (minutes) => input((r) => r.transcriptTokens, minutes);

// Mirrors question-generation.service + question-plan for the slot count.
function questionPlan(minutes, count) {
  const words = Math.round(wordsPerMinute * minutes);
  const target = Math.min(60, Math.max(8, Math.ceil(count * 1.5)));
  const concepts = Math.min(target, Math.max(4, Math.round(words / 60)));
  const capacity = Math.max(concepts, Math.floor(words / 60), 1);
  const planned = Math.min(count, capacity);
  const spare = Math.max(0, Math.min(Math.min(6, Math.ceil(count / 4)), capacity - planned));
  const slots = planned + spare;
  const missing = Math.max(2, Math.ceil(slots / 4));
  return { target, concepts, slots, missing };
}

// Each call: { input, maxTokens, visible }.
const calls = {
  warning: (m) => ({
    input: input((r) => r.warning.input, m),
    maxTokens: 1200,
    visible: item.warning,
  }),
  summary: (m, length) => {
    const cap = { short: 900, standard: 1800, detailed: 3500 }[length];
    const factor = { short: 0.5, standard: 1, detailed: 1.8 }[length];
    const ratio = item.summaryStandard5min / byMinutes.get(5).transcriptTokens;
    return {
      input: input((r) => r.summary[length].input, m),
      maxTokens: cap,
      visible: Math.min(
        Math.round(cap * 0.8),
        Math.max(150, Math.round(ratio * transcriptTokens(m) * factor)),
      ),
    };
  },
  questionList: (m, count) => {
    const plan = questionPlan(m, count);
    const key = [5, 10, 20].includes(count) ? count : 10;
    const planInput = (slots) => 40 * slots; // ~40 tokens of plan per slot (measured: 12 slots ~ 480)
    const base = (r) =>
      r.questionsV2[key].questions.input - planInput(r.questionsV2[key].questions.items);
    return {
      concepts: {
        input: input((r) => r.questionsV2[key].concepts.input, m),
        maxTokens: Math.min(8000, 1200 + plan.target * 160),
        visible: plan.concepts * item.concept + 10,
      },
      questions: {
        input: input(base, m) + planInput(plan.slots),
        maxTokens: Math.min(16000, 1200 + plan.slots * 600),
        visible: plan.slots * item.question + 10,
      },
      replacement: {
        input: input(base, m) + planInput(plan.missing) + 25 * (plan.slots - plan.missing),
        maxTokens: Math.min(16000, 1200 + plan.missing * 600),
        visible: plan.missing * item.question + 10,
      },
    };
  },
  flashcards: (m, count) => {
    const cards = Math.min(count, Math.max(3, Math.round((wordsPerMinute * m) / 50)));
    const key = [1, 10, 20, 50].includes(count) ? count : 10;
    return {
      input: input((r) => r.flashcards[key].input, m),
      maxTokens: Math.min(12000, count * 550 + 500),
      visible: cards * item.flashcard + 10,
    };
  },
  knowledgeMap: (m) => ({
    input: input((r) => r.knowledgeMap.input, Math.min(m, 40)),
    maxTokens: 4000,
    visible: 2000,
  }),
  synthesis: () => ({ input: M.synthesis4.input, maxTokens: 6000, visible: M.synthesis4.visible }),
};

/** Expands a usage profile into weighted calls. mode: typical | worst | ceiling. */
function expand(profile, mode) {
  const out = [];
  const add = (label, call, times = 1, retries = 1) =>
    out.push({ label, ...call, times: times * (mode === 'ceiling' ? retries : 1) });
  const m = profile.generationMinutes;
  for (const rec of profile.recordings) add('aviso (processamento inicial)', calls.warning(rec), 3);
  add(
    `resumo ${profile.summaries.length}`,
    calls.summary(m, profile.summaries.length),
    profile.summaries.n,
    P.jobMaxAttempts,
  );
  const q = calls.questionList(m, profile.questionLists.count);
  const replacementP = mode === 'typical' ? P.replacementRoundProbability.typical : 1;
  add('questões: conceitos', q.concepts, profile.questionLists.n, P.jobMaxAttempts);
  add('questões: geração', q.questions, profile.questionLists.n, P.jobMaxAttempts);
  add(
    'questões: reposição',
    q.replacement,
    profile.questionLists.n * replacementP,
    P.jobMaxAttempts,
  );
  const fc = profile.flashcardPreviews;
  const topUp = mode === 'ceiling' || fc.topUp ? 2 : 1;
  add('flashcards: prévia', calls.flashcards(m, fc.count), fc.n * topUp);
  add(
    'flashcards: trocar 1',
    calls.flashcards(m, 1),
    profile.replaceOne * (mode === 'ceiling' ? 2 : 1),
  );
  add('avisos (reexecução manual)', calls.warning(m), profile.warningsRerun * 3);
  if (profile.multiLesson) {
    // First run maps 4 lessons; later runs reuse the cached maps (1 synthesis, + 1 repair in the worst case).
    add('multiaulas: mapas', calls.knowledgeMap(m), 4, P.multiLessonMaxAttempts);
    add(
      'multiaulas: síntese',
      calls.synthesis(),
      profile.multiLesson * (mode === 'typical' ? 1 : 2),
      P.multiLessonMaxAttempts,
    );
  }
  return out;
}

function totals(profile, mode) {
  const reasoning = mode === 'typical' ? P.reasoning.typical : P.reasoning.pessimistic;
  let requests = 0,
    inputTokens = 0,
    outputTokens = 0,
    reserved = 0,
    over8k = 0;
  for (const c of expand(profile, mode)) {
    const out =
      mode === 'ceiling'
        ? c.maxTokens
        : Math.min(
            c.maxTokens,
            c.visible + Math.max(reasoning.min, Math.round(c.visible * reasoning.ratio)),
          );
    requests += c.times;
    inputTokens += c.times * c.input;
    outputTokens += c.times * out;
    reserved += c.times * (c.input + c.maxTokens);
    if (c.input + c.maxTokens > P.groqFree.tpm) over8k += c.times;
  }
  const audioMinutes = profile.recordings.reduce((a, b) => a + b, 0);
  return {
    requests,
    inputTokens,
    outputTokens,
    reserved,
    over8k,
    audioMinutes,
    recordings: profile.recordings.length,
  };
}

const add = (a, b, k = 1) =>
  Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + k * b[key]]));
const scale = (a, k) => Object.fromEntries(Object.keys(a).map((key) => [key, a[key] * k]));

/** Testers only (the admin accounts are reported separately and added where stated). */
function scenario(n, mode) {
  return scale(totals(P.tester[mode === 'ceiling' ? 'worst' : mode], mode), n);
}
const adminTotals = (mode) =>
  scale(totals(P.admin[mode === 'typical' ? 'typical' : 'worst'], mode), P.admins);

function money(t) {
  const groq =
    (t.inputTokens / 1e6) * P.prices.groqInputPerM +
    (t.outputTokens / 1e6) * P.prices.groqOutputPerM;
  const asr =
    (t.audioMinutes / 60) *
    (P.prices.assemblyPerHour + (P.speakerLabels ? P.prices.assemblySpeakerLabelsPerHour : 0));
  return { groq, asr, total: groq + asr };
}

// =============================================================== OUTPUT
const fmt = (v, d = 0) =>
  v === Infinity
    ? '∞'
    : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = (v) => `US$ ${fmt(v, 2)}`;
const brl = (v) => `R$ ${fmt(v * P.usdToBrl, 2)}`;
const row = (cells) => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

const arg = process.argv.find((a) => a.startsWith('--participants='));
const participants = arg ? arg.split('=')[1].split(',').map(Number) : P.participants;
const modes = [
  ['typical', 'Típico'],
  ['worst', 'Pior caso (todas as cotas no mesmo dia)'],
  ['ceiling', 'Teto absoluto (max_completion_tokens + todas as tentativas)'],
];
const results = [];
for (const [mode, label] of modes)
  for (const n of participants) {
    const t = scenario(n, mode);
    const withAdmin = add(t, adminTotals(mode));
    const peakHour = scale(t, P.peak.share / P.peak.hours);
    const peakMinute = scale(peakHour, 1 / 60);
    results.push({
      mode,
      label,
      n,
      t,
      withAdmin,
      cost: money(t),
      costWithAdmin: money(withAdmin),
      peakHour,
      peakMinute,
    });
  }

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ parameters: P, results }, null, 2));
  process.exit(0);
}

console.log(
  `Medições: ${M.tokenizer}; câmbio US$ 1 = R$ ${fmt(P.usdToBrl, 2)}. Tabelas por cenário: só testers; a última coluna soma ${P.admins} administrador(es) no perfil correspondente.\n`,
);

console.log('### Por participante (tester), por dia\n');
console.log(
  table(
    [
      'Perfil',
      'Gravações',
      'Áudio (min)',
      'Pedidos LLM',
      'Tokens entrada',
      'Tokens saída (c/ raciocínio)',
      'Pedidos > 8.000 TPM (entrada+max)',
      'Custo',
    ],
    [
      ['typical', 'Típico'],
      ['worst', 'Pior caso'],
      ['ceiling', 'Teto absoluto'],
    ].map(([mode, label]) => {
      const t = totals(P.tester[mode === 'ceiling' ? 'worst' : mode], mode);
      const c = money(t);
      return [
        label,
        t.recordings,
        t.audioMinutes,
        fmt(t.requests, 1),
        fmt(t.inputTokens),
        fmt(t.outputTokens),
        fmt(t.over8k, 1),
        `${usd(c.total)} (${brl(c.total)})`,
      ];
    }),
  ),
);
console.log('\n### Administrador, por dia\n');
console.log(
  table(
    ['Perfil', 'Áudio (min)', 'Pedidos LLM', 'Tokens entrada', 'Tokens saída', 'Custo'],
    [
      ['typical', 'Típico (≈25% da cota)'],
      ['worst', 'Cota cheia'],
      ['ceiling', 'Teto absoluto'],
    ].map(([mode, label]) => {
      const t = totals(P.admin[mode === 'typical' ? 'typical' : 'worst'], mode);
      const c = money(t);
      return [
        label,
        t.audioMinutes,
        fmt(t.requests, 1),
        fmt(t.inputTokens),
        fmt(t.outputTokens),
        `${usd(c.total)} (${brl(c.total)})`,
      ];
    }),
  ),
);

for (const [mode, label] of modes) {
  console.log(`\n### ${label}\n`);
  console.log(
    table(
      [
        'Testers',
        'Transcrição (h)',
        'Pedidos LLM/dia',
        'Tokens entrada/dia',
        'Tokens saída/dia',
        'Total tokens/dia',
        'AssemblyAI',
        'Groq (pago)',
        'Total/dia',
        'Total/dia + admin',
      ],
      results
        .filter((r) => r.mode === mode)
        .map(({ n, t, cost, costWithAdmin }) => [
          n,
          fmt(t.audioMinutes / 60, 2),
          fmt(t.requests),
          fmt(t.inputTokens),
          fmt(t.outputTokens),
          fmt(t.inputTokens + t.outputTokens),
          usd(cost.asr),
          usd(cost.groq),
          `${usd(cost.total)} (${brl(cost.total)})`,
          `${usd(costWithAdmin.total)} (${brl(costWithAdmin.total)})`,
        ]),
    ),
  );
}

console.log(
  `\n### Pico (${P.peak.share * 100}% do dia em ${P.peak.hours} h, média por minuto) e limites do Groq gratuito — só testers\n`,
);
const verdict = (value, limit) =>
  value > limit
    ? `**${fmt(value, 1)} — excede** (${fmt(limit)})`
    : `${fmt(value, 1)} — ok (${fmt(limit)})`;
console.log(
  table(
    [
      'Cenário',
      'Part.',
      'Pedidos/dia vs RPD',
      'Tokens/dia vs TPD',
      'Pedidos/min no pico vs RPM',
      'Tokens/min no pico vs TPM',
      'Pedidos impossíveis no gratuito (entrada+max > 8.000)',
    ],
    results
      .filter((r) => r.mode !== 'ceiling')
      .map(({ label, n, t, peakMinute }) => [
        label.split(' (')[0],
        n,
        verdict(t.requests, P.groqFree.rpd),
        verdict(t.inputTokens + t.outputTokens, P.groqFree.tpd),
        verdict(peakMinute.requests, P.groqFree.rpm),
        verdict(peakMinute.inputTokens + peakMinute.outputTokens, P.groqFree.tpm),
        fmt(t.over8k, 0),
      ]),
  ),
);

console.log(
  '\n### Quantos testers cabem por dia no Groq gratuito (80% do TPD/RPD, sem uso de admin)\n',
);
console.log(
  table(
    ['Perfil do tester', 'Tokens/tester', 'Pedidos/tester', 'Máx. pelo TPD', 'Máx. pelo RPD'],
    [
      ['typical', 'Típico'],
      ['worst', 'Pior caso'],
    ].map(([mode, label]) => {
      const t = totals(P.tester[mode], mode);
      const tokens = t.inputTokens + t.outputTokens;
      return [
        label,
        fmt(tokens),
        fmt(t.requests, 1),
        fmt(Math.floor((0.8 * P.groqFree.tpd) / tokens)),
        fmt(Math.floor((0.8 * P.groqFree.rpd) / t.requests)),
      ];
    }),
  ),
);

console.log(
  '\n### Chamadas que não cabem num minuto do Groq gratuito (entrada + max_completion_tokens > 8.000)\n',
);
const probe = [
  ['Aviso (cada um dos 3, em paralelo)', (m) => calls.warning(m)],
  ['Resumo detalhado', (m) => calls.summary(m, 'detailed')],
  ['Questões 5: geração', (m) => calls.questionList(m, 5).questions],
  ['Questões 10: geração', (m) => calls.questionList(m, 10).questions],
  ['Questões 20: geração', (m) => calls.questionList(m, 20).questions],
  ['Flashcards 10', (m) => calls.flashcards(m, 10)],
  ['Flashcards 20', (m) => calls.flashcards(m, 20)],
];
const probeMinutes = [1, 3, 5, 10, 30];
console.log(
  table(
    ['Chamada', ...probeMinutes.map((m) => `${m} min`)],
    probe.map(([label, f]) => [
      label,
      ...probeMinutes.map((m) => {
        const c = f(m);
        const s = c.input + c.maxTokens;
        return s > 8000 ? `**${fmt(s)}**` : fmt(s);
      }),
    ]),
  ),
);

console.log('\n### Armazenamento e tráfego (Supabase gratuito)\n');
const S = P.storage;
console.log(
  table(
    [
      'Testers (+ admin)',
      'Storage de áudio retido (MB)',
      'Banco (MB)',
      'Egress no dia de teste (MB)',
      'Uso do recurso mais apertado',
    ],
    participants.map((n) => {
      const minutes = n * 5 + P.admins * 120;
      const gens = n * 5 + P.admins * 60;
      const storageMb = minutes * S.speechMbPerMinute * S.retainShare;
      const dbMb = (minutes * S.dbKbPerAudioMinute + gens * S.dbKbPerGeneration) / 1024;
      const egressMb =
        minutes * S.speechMbPerMinute +
        storageMb * S.playsPerRetainedRecording +
        n * S.demoAudioMb * S.demoPlaysPerParticipant +
        n * S.apiPayloadMbPerParticipantDay;
      const worst = Math.max(
        storageMb / (P.supabaseFree.storageGb * 1024),
        dbMb / P.supabaseFree.dbMb,
        egressMb / (P.supabaseFree.egressGb * 1024),
      );
      return [
        n,
        fmt(storageMb, 1),
        fmt(dbMb, 1),
        fmt(egressMb, 0),
        `${fmt(worst * 100, 0)}% (egress conta contra a cota mensal)`,
      ];
    }),
  ),
);

console.log(
  '\n### Tetos globais recomendados (pior caso dos testers + admin com cota cheia + folga) — Groq Developer\n',
);
console.log(
  table(
    [
      'Participantes',
      'Transcrição min/dia',
      'Transcrição min/hora',
      'Pedidos LLM/dia',
      'Tokens estimados/dia',
      'Pedidos LLM/min',
      'Tokens reservados/min (entrada+max)',
    ],
    participants.map((n) => {
      const t = add(scenario(n, 'worst'), adminTotals('worst'));
      const k = 1 + P.safetyMargin;
      const roundUp = (v, step) => Math.ceil(v / step) * step;
      return [
        n,
        fmt(roundUp(t.audioMinutes * k, 10)),
        fmt(roundUp((t.audioMinutes * k * P.peak.share) / P.peak.hours, 10)),
        fmt(roundUp(t.requests * k, 50)),
        fmt(roundUp((t.inputTokens + t.outputTokens) * k, 50000)),
        fmt(
          Math.min(
            60,
            Math.max(10, roundUp(((t.requests * k * P.peak.share) / P.peak.hours / 60) * 3, 5)),
          ),
        ),
        fmt(
          Math.min(
            150000,
            roundUp(((t.reserved * k * P.peak.share) / P.peak.hours / 60) * 3, 10000),
          ),
        ),
      ];
    }),
  ),
);
