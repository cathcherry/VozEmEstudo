// Public testing program (FEATURE_PUBLIC_TESTING) for the simulated API: GET /api/testing/me,
// admin-only GET /api/testing/overview, GET /api/demo-lessons and POST /api/demo-lessons/:id/open,
// plus the quota refusals of AI endpoints. State lives in `data.testing` (see testingState()).
// Nothing here reaches a real backend.

const DEMOS = [
  {
    id: '7d1f3a52-1c11-4f7a-9a11-000000000001',
    slug: 'crase',
    title: 'Crase sem mistério',
    subject: 'Português',
    description: 'Quando usar o acento grave, com exemplos do dia a dia e os casos que mais confundem.',
    cover: { tone: 'rose', emblem: 'emblem.literatura' },
    durationMs: 312000,
    hasVideo: false,
    questionCount: 10,
    flashcardCount: 12,
    credits: 'Aula gravada pela equipe do Voz em Estudo para o período de testes.',
  },
  {
    id: '7d1f3a52-1c11-4f7a-9a11-000000000002',
    slug: 'vacinas',
    title: 'Como as vacinas treinam o corpo',
    subject: 'Ciências',
    description: 'Antígenos, anticorpos e memória imunológica explicados passo a passo.',
    cover: { tone: 'matcha', emblem: 'emblem.biologia' },
    durationMs: 287000,
    hasVideo: false,
    questionCount: 8,
    flashcardCount: 10,
    credits: 'Texto e narração: equipe do Voz em Estudo.',
  },
  {
    id: '7d1f3a52-1c11-4f7a-9a11-000000000003',
    slug: 'internet',
    title: 'O caminho de uma mensagem na internet',
    subject: 'Tecnologia',
    description: 'Pacotes, roteadores e protocolos: o que acontece entre enviar e receber.',
    cover: { tone: 'mist', emblem: 'emblem.computacao' },
    durationMs: 298000,
    hasVideo: true,
    questionCount: 9,
    flashcardCount: 11,
    credits: 'Vídeo e roteiro: equipe do Voz em Estudo.',
  },
];

const TESTER_LIMITS = { transcription_seconds: 300, processing_llm: 3, summary: 2, questions: 2, flashcards: 1, flashcard_replace: 5, warnings: 1, multi_lesson: 0 };
const ADMIN_LIMITS = { transcription_seconds: 7200, processing_llm: 60, summary: 30, questions: 30, flashcards: 20, flashcard_replace: 60, warnings: 20, multi_lesson: 10 };

/** policy: 'tester' | 'admin' | 'legacy' | 'off'. Numbers come back as strings, like Postgres bigint. */
function testingState(policy = 'tester', overrides = {}) {
  const limits = policy === 'admin' ? ADMIN_LIMITS : policy === 'tester' ? TESTER_LIMITS : {};
  return {
    policy,
    used: policy === 'admin' ? { transcription_seconds: '1260', summary: '4', questions: '3' } : { transcription_seconds: '72', processing_llm: '1', summary: '1' },
    limits,
    demoAccess: policy === 'tester' || policy === 'admin',
    demos: DEMOS.map((demo) => ({ ...demo, materialId: null })),
    opens: [],
    failSummary: false,
    ...overrides,
  };
}

const OVERVIEW = {
  config: {
    enabled: true,
    registrationStartsAt: '2026-11-20T12:00:00Z',
    registrationEndsAt: '2026-12-20T12:00:00Z',
    demoAccessEnabled: true,
    testerLimits: TESTER_LIMITS,
    adminLimits: ADMIN_LIMITS,
    globalLimits: {
      transcription_seconds: { total: 54000, day: 18000, hour: 5400 },
      llm_requests: { total: null, day: 800, hour: 300 },
      llm_tokens: { total: null, day: 160000, hour: 60000 },
      concurrent_transcriptions: 2,
    },
  },
  participants: '37',
  admins: '2',
  demoCopies: '64',
  transcriptionSeconds: { total: '20430', day: '6120', hour: '940' },
  llmRequests: { total: '1288', day: '212', hour: '31' },
  llmTokens: { total: '402113', day: '61200', hour: '9400' },
  byKind: { transcription_seconds: '20430', summary: '88', questions: '61' },
  queue: { PENDENTE: '2', EM_EXECUCAO: '1' },
};

function copyFor(demo) {
  return {
    id: `demo-${demo.slug}`,
    title: demo.title,
    subject: demo.subject,
    status: 'PRONTO',
    created_at: new Date().toISOString(),
    audio_files: [{ duration_ms: demo.durationMs, extension: 'mp3' }],
    demo: { slug: demo.slug, credits: demo.credits },
  };
}

/** Returns a response, or undefined when the path is not part of the program. */
function handleTesting({ request, p, method, json, data }) {
  const t = data.testing;
  if (p === '/api/testing/me') {
    if (!t) return json({ policy: 'off', admin: false, programEnabled: false, limits: {}, used: {}, demoAccess: false });
    return json({
      policy: t.policy,
      admin: t.policy === 'admin',
      programEnabled: true,
      registrationEndsAt: OVERVIEW.config.registrationEndsAt,
      limits: t.limits,
      used: t.used,
      demoAccess: t.demoAccess,
    });
  }
  if (p === '/api/testing/overview') {
    if (t?.policy !== 'admin') return json({ error: { code: 'NOT_FOUND', message: 'Recurso não encontrado.' } }, 404);
    return json(OVERVIEW);
  }
  if (p === '/api/demo-lessons' && method === 'GET') {
    if (!t?.demoAccess) return json([]);
    return json(t.demos.map(({ credits: _credits, ...demo }) => demo));
  }
  const open = p.match(/^\/api\/demo-lessons\/([^/]+)\/open$/);
  if (open && method === 'POST') {
    const demo = t?.demos.find((item) => item.id === open[1]);
    if (!demo) return json({ error: { code: 'NOT_FOUND', message: 'Aula de demonstração não encontrada.' } }, 404);
    t.opens.push(demo.id);
    const created = !demo.materialId;
    if (created) {
      const copy = copyFor(demo);
      demo.materialId = copy.id;
      data.extraMaterials = [...(data.extraMaterials || []), copy];
    }
    return json({ materialId: demo.materialId, created });
  }
  // Quota refusal of an AI action (e.g. summary generation) when the test asks for it.
  if (t?.failSummary && /^\/api\/materials\/[^/]+\/summaries$/.test(p) && method === 'POST') {
    void request;
    return json(
      {
        error: {
          code: 'GENERATION_QUOTA_EXCEEDED',
          message: 'Você já usou as 2 gerações de resumos do período de testes. O que já foi gerado continua disponível.',
          details: { kind: 'summary', limit: 2, used: 2, remaining: 0 },
        },
      },
      403,
    );
  }
  return undefined;
}

module.exports = { DEMOS, OVERVIEW, TESTER_LIMITS, ADMIN_LIMITS, testingState, handleTesting, copyFor };
