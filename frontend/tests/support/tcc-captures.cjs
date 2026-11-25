/* global document, window, getComputedStyle */
// Capturas do Apêndice C do TCC: o front end REAL desta versão rodando com a API SIMULADA
// (./mock-app.cjs) e o conteúdo das aulas de demonstração (database/demo-lessons). Nada aqui
// acessa backend real, provedor de IA ou projeto Supabase; a única peça do backend usada é a
// rota de mídia local (FFmpeg) para ler o áudio escolhido no envio, como em browser-check.cjs.
//
// Uso: BROWSER_EXECUTABLE=/caminho/do/chrome node frontend/tests/support/tcc-captures.cjs [somente...]
// Saída: docs/tcc-apendice-c/*.png (1440x900 ou 390x844 no celular, deviceScaleFactor 2; cada
// captura usa um tema do app, definido em SETTINGS).
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const m = require('./mock-app.cjs');
const quizMock = require('./mock-quiz.cjs');

const root = path.resolve(__dirname, '../..');
const repo = path.resolve(root, '..');
const backend = path.join(repo, 'backend');
const express = require(path.join(backend, 'node_modules/express'));
const DEMO_DIR = path.join(repo, 'database/demo-lessons');
const OUT = path.join(repo, 'docs/tcc-apendice-c');
const VIEWPORT = { width: 1440, height: 900 };
const only = process.argv.slice(2);

const demo = Object.fromEntries(
  ['crase', 'vacinas', 'internet'].map((slug) => [
    slug,
    JSON.parse(fs.readFileSync(path.join(DEMO_DIR, slug, 'lesson.json'), 'utf8')),
  ]),
);
const idOf = (slug) => `aula-${slug}`;
const slugOf = (id) => (id.startsWith('aula-') ? id.slice(5) : null);

// Usuário fictício e neutro (não é pessoa real).
const USER = {
  id: m.USER_ID,
  email: 'estudante@exemplo.test',
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: 'Estudante' },
};

const CATALOG = {
  subjects: [
    { id: 'sub-por', name: 'Português', color_token: null, sort_order: 0 },
    { id: 'sub-cie', name: 'Ciências', color_token: null, sort_order: 1 },
    { id: 'sub-tec', name: 'Tecnologia', color_token: null, sort_order: 2 },
    { id: 'sub-bio', name: 'Biologia', color_token: null, sort_order: 3 },
    { id: 'sub-fis', name: 'Física', color_token: null, sort_order: 4 },
    { id: 'sub-geo', name: 'Geografia', color_token: null, sort_order: 5 },
    { id: 'sub-his', name: 'História', color_token: null, sort_order: 6 },
    { id: 'sub-mat', name: 'Matemática', color_token: null, sort_order: 7 },
  ],
  units: [
    {
      id: 'unit-crase',
      subject_id: 'sub-por',
      title: 'Gramática',
      description: null,
      sort_order: 0,
    },
    {
      id: 'unit-energia',
      subject_id: 'sub-bio',
      title: 'Metabolismo energético',
      description: null,
      sort_order: 0,
    },
  ],
};
const SUBJECT_IDS = { crase: 'sub-por', vacinas: 'sub-cie', internet: 'sub-tec' };

function demoMaterials() {
  return Object.entries(demo).map(([slug, d], i) => ({
    ...m.lesson(idOf(slug), d.title, d.subject, i, d.durationMs),
    subject_id: SUBJECT_IDS[slug],
    unit_id: slug === 'crase' ? 'unit-crase' : null,
  }));
}

const REVISION = 2;
const SOURCE_REVISION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const segmentsOf = (d) =>
  d.segments.map((s) => ({
    id: `seg-${s.position}`,
    position: s.position,
    start_ms: s.startMs,
    end_ms: s.endMs,
    current_text: s.text,
  }));
const batchOf = (d) => ({
  id: 'bq',
  title: d.questions.title,
  generated_count: d.questions.items.length,
  requested_count: d.questions.items.length,
  source_transcription_revision: REVISION,
  created_at: new Date(Date.now() - 3600000).toISOString(),
  questions: d.questions.items.map((q, i) => ({
    id: `q${i + 1}`,
    position: i,
    statement: q.statement,
    options: q.options,
  })),
});

/** Detalhe completo de uma aula de demonstração, no formato de GET /api/materials/:id. */
function demoDetail(slug, base, stage) {
  const d = demo[slug];
  const material = demoMaterials().find((x) => x.id === idOf(slug));
  const pending = stage === 'pending';
  return {
    ...material,
    review: {
      state: pending ? 'awaiting_confirmation' : 'ready_to_generate',
      sourceRevisionId: SOURCE_REVISION_ID,
      revision: REVISION,
      permissionRequired: false,
    },
    warnings: [],
    audio: { duration_ms: d.durationMs, extension: 'mp3' },
    transcription: {
      id: `tr-${slug}`,
      current_revision: REVISION,
      transcription_segments: segmentsOf(d),
    },
    summaries: pending
      ? []
      : [
          {
            id: `sum-${slug}`,
            is_current: true,
            version: 1,
            label: d.summary.label,
            source_transcription_revision: REVISION,
            created_at: new Date(Date.now() - 3600000).toISOString(),
            text: d.summary.text,
          },
        ],
    questionBatches: pending ? [] : [batchOf(d)],
    signedAudioUrl: `${base}/__demo/${slug}/audio.mp3`,
  };
}

/** Rotas por cima da API simulada (registradas depois, têm prioridade; o resto cai no mock). */
async function overlay(context, base, data, flags, config) {
  const { PERMISSION_DECLARATION } = config;
  await context.route(base + '/api/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p === '/api/config')
      return json({
        supabaseUrl: 'https://mock.supabase.co',
        supabasePublishableKey: 'k',
        audioBucket: 'audios',
        featureFlags: flags,
        maxQuestionListCount: 30,
        allowedQuestionCounts: [3, 5, 10, 20],
        maxAudioBytes: 100 * 1024 * 1024,
        maxTranscriptionSeconds: 3276,
        recordingLanguages: { options: ['auto', 'pt', 'en', 'es'], default: 'pt' },
        oauthProviders: [],
        permissionDeclaration: PERMISSION_DECLARATION,
      });
    // Leitura real do arquivo escolhido (FFmpeg local, rota do backend montada no servidor).
    if (p.startsWith('/api/media/')) return route.continue();
    if (/^\/api\/jobs\/[^/]+$/.test(p))
      return json({
        id: p.split('/')[3],
        status: 'EM_EXECUCAO',
        current_stage: 'TRANSCRICAO',
        attempt_count: 1,
        max_attempts: 3,
        created_at: new Date(Date.now() - 95000).toISOString(),
      });
    const match = p.match(/^\/api\/materials\/([^/]+)(\/.*)?$/);
    const slug = match && slugOf(match[1]);
    if (slug && demo[slug]) {
      const rest = match[2] || '';
      if (!rest && method === 'GET') return json(demoDetail(slug, base, data.demoStage?.[slug]));
      if (rest === '/playback')
        return json({
          video: null,
          signedVideoUrl: null,
          signedAudioUrl: `${base}/__demo/${slug}/audio.mp3`,
        });
      if (rest === '/captions')
        return json({ revision: REVISION, granularity: 'segment', words: [] });
      if (rest === '/transcription/versions') {
        const segs = demo[slug].segments.map((s) => ({
          position: s.position,
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
        }));
        return json([
          {
            id: SOURCE_REVISION_ID,
            revision: 2,
            created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
            segments_snapshot: segs,
          },
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            revision: 1,
            created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
            segments_snapshot: segs,
          },
        ]);
      }
    }
    return route.fallback();
  });
}

function captureData() {
  const data = m.state();
  data.extraMaterials = demoMaterials();
  data.catalog = CATALOG;
  data.demoStage = {};
  const crase = demo.crase;
  // Conjunto de cartões da aula de crase (cartões escritos pela equipe, em lesson.json).
  const cards = crase.flashcards.cards.map((c, i) => ({
    id: `fc-crase-${i}`,
    front_text: c.front,
    back_text: c.back,
    status: 'active',
    due_at: m.at(0, 8),
    material_id: idOf('crase'),
    set_id: 'set-crase',
  }));
  data.sets = [
    {
      id: 'set-crase',
      name: crase.flashcards.name,
      material_id: idOf('crase'),
      status: 'active',
      card_count: cards.length,
      due_count: cards.length,
      cards: cards.map(({ id, front_text, back_text }) => ({
        id,
        front_text,
        back_text,
        status: 'active',
      })),
    },
  ];
  data.dueCards = cards;
  data.allCards = cards;
  // Planejamento ligado às aulas de demonstração.
  data.goals = [
    { id: 'g1', title: 'Preparar a prova de Português', status: 'active', target_date: m.day(10) },
    { id: 'g2', title: 'Revisar Ciências do bimestre', status: 'active', target_date: m.day(21) },
  ];
  data.subgoals = [{ id: 's1', goal_id: 'g1', title: 'Crase e acentuação', due_date: m.day(4) }];
  const task = (id, goal, subgoal, title, due, material, done, order) => ({
    id,
    goal_id: goal,
    subgoal_id: subgoal,
    title,
    due_date: due === null ? null : m.day(due),
    material_id: material,
    completed_at: done ? m.at(-1, 9) : null,
    sort_order: order,
    created_at: m.at(-4, 9),
  });
  data.tasks = [
    task('t1', 'g1', 's1', 'Ouvir a aula sobre crase', -1, idOf('crase'), true, 1000),
    task('t2', 'g1', 's1', 'Responder as questões da aula de crase', 1, idOf('crase'), false, 2000),
    task('t3', 'g1', null, 'Revisar os cartões de crase', 2, null, false, 3000),
    task('t4', 'g2', null, 'Ouvir a aula sobre vacinas', 3, idOf('vacinas'), false, 1000),
    task('t5', 'g2', null, 'Ler o resumo e anotar dúvidas', null, null, false, 2000),
  ];
  data.events = [
    {
      kind: 'event',
      id: 'e1',
      title: 'Estudar crase',
      startsAt: m.at(1, 14),
      endsAt: m.at(1, 15),
      description: '',
      materialId: idOf('crase'),
      taskId: null,
      version: 1,
    },
    {
      kind: 'event',
      id: 'e2',
      title: 'Revisão de Ciências',
      startsAt: m.at(3, 19),
      endsAt: m.at(3, 20),
      description: '',
      materialId: idOf('vacinas'),
      taskId: null,
      version: 1,
    },
  ];
  // Destaques e caderno da aula de crase (texto fictício escrito para a captura).
  const note = (id, position, quote, noteText, color) => ({
    id,
    material_id: idOf('crase'),
    source_revision: REVISION,
    source_revision_id: SOURCE_REVISION_ID,
    segment_position: position,
    end_segment_position: position,
    start_offset: null,
    end_offset: null,
    quote,
    note_text: noteText,
    color,
    version: 1,
  });
  data.notes = [
    note(
      '11111111-1111-4111-8111-000000000001',
      2,
      'Crase é o nome do fenômeno: a fusão de duas vogais iguais em uma só.',
      'Crase não é o acento! O acento é o grave.',
      'yellow',
    ),
    note(
      '11111111-1111-4111-8111-000000000002',
      4,
      'a crase é o encontro da preposição a com o artigo feminino a.',
      'Regra principal para a prova.',
      'green',
    ),
  ];
  data.lessonRevision = { [idOf('crase')]: REVISION };
  data.notebooks = {
    [idOf('crase')]: {
      id: 'nb-crase',
      material_id: idOf('crase'),
      title: 'Como usar crase?',
      version: 3,
      last_request_id: 'x',
      visibility: 'private',
      doc: {
        type: 'doc',
        schemaVersion: 1,
        blocks: [
          { id: 'h1', type: 'heading', level: 2, text: 'Crase: o essencial' },
          {
            id: 'p1',
            type: 'paragraph',
            text: 'Crase é a fusão de duas vogais "a": a preposição a + o artigo feminino a. O acento grave (à) é o sinal que marca essa fusão.',
          },
          {
            id: 'r1',
            type: 'annotation_ref',
            annotationId: '11111111-1111-4111-8111-000000000001',
            sourceRevisionId: SOURCE_REVISION_ID,
            sourceRevision: REVISION,
          },
          { id: 'h2', type: 'heading', level: 3, text: 'Como saber se tem crase' },
          {
            id: 'o1',
            type: 'ordered_list',
            items: [
              'Veja se o verbo ou o nome pede a preposição a (quem vai, vai a algum lugar).',
              'Veja se a palavra seguinte aceita o artigo a (é feminina).',
              'Se as duas coisas acontecem, tem crase.',
            ],
          },
          { id: 'h3', type: 'heading', level: 3, text: 'Teste do masculino' },
          {
            id: 'p2',
            type: 'paragraph',
            text: 'Troque a palavra feminina por uma masculina. Se aparecer "ao", tem crase.',
          },
          {
            id: 'l1',
            type: 'bullet_list',
            items: [
              'Vou à escola → Vou ao colégio ✓',
              'Assisti à palestra → Assisti ao filme ✓',
              'Comprei a revista → Comprei o livro ✗ (sem crase)',
            ],
          },
          { id: 'h4', type: 'heading', level: 3, text: 'Quando NÃO usar' },
          {
            id: 'l2',
            type: 'bullet_list',
            items: [
              'Antes de palavra masculina: andar a cavalo',
              'Antes de verbo: começou a chover',
              'Antes da maioria dos pronomes: entreguei a ela',
              'Entre palavras repetidas: cara a cara, frente a frente',
            ],
          },
          { id: 'h5', type: 'heading', level: 3, text: 'Casos especiais' },
          {
            id: 'l3',
            type: 'bullet_list',
            items: [
              'Horas: chegou às 8h',
              'À moda de: bife à milanesa',
              'Nomes de lugar: Vou à Bahia (volto da Bahia) / Vou a Recife (volto de Recife)',
            ],
          },
          { id: 'h6', type: 'heading', level: 3, text: 'Para a prova' },
          {
            id: 'c1',
            type: 'checklist',
            items: [
              { text: 'Ouvir a aula de crase', checked: true },
              { text: 'Refazer as questões da aula', checked: true },
              { text: 'Revisar os flashcards amanhã', checked: false },
              { text: 'Fazer 10 exercícios do livro', checked: false },
            ],
          },
          { id: 'p3', type: 'paragraph', text: '' },
        ],
      },
    },
  };
  data.quizSessions = [];
  return data;
}

/** Turmas fictícias para a captura C27. */
function withClassrooms(d) {
  const member = (userId, displayName, role) => ({ userId, displayName, role, status: 'active' });
  const lesson = (id, title, ownerId) => ({
    id,
    title,
    source: 'teacher',
    status: 'published',
    ownerId,
    text: 'Crase é a fusão de duas vogais iguais.',
    questionBatchIds: [],
  });
  const room = (id, name, description, members, lessons, resources = []) => ({
    id,
    name,
    description,
    status: 'active',
    members,
    invites: [],
    lessons,
    submissions: [],
    shared: [],
    resources,
  });
  d.classrooms = {
    requests: [],
    rooms: [
      room(
        'room-por',
        'Português 1º ano A',
        'Gramática e interpretação de texto, com listas para a prova.',
        [
          member(m.USER_ID, 'Estudante', 'teacher'),
          member('s1', 'Aluno A', 'student'),
          member('s2', 'Aluna B', 'student'),
        ],
        [
          lesson('cl-1', 'Crase: quando usar o acento grave', m.USER_ID),
          lesson('cl-2', 'Concordância verbal', m.USER_ID),
        ],
        [
          {
            id: 'r1',
            title: 'Guia de estudos',
            url: 'https://example.com/guia',
            description: 'Roteiro da unidade.',
          },
        ],
      ),
      room(
        'room-cie',
        'Grupo de Ciências',
        '',
        [member('s3', 'Professora C', 'teacher'), member(m.USER_ID, 'Estudante', 'student')],
        [lesson('cl-3', 'Como as vacinas treinam o corpo', 's3')],
      ),
    ],
  };
  return d;
}

/** As questões da aula de crase alimentam a simulação de tentativas (mock-quiz.cjs). */
function useCraseQuiz() {
  const batch = batchOf(demo.crase);
  Object.assign(quizMock.QUIZ_BATCH, {
    id: batch.id,
    title: batch.title,
    generated_count: batch.generated_count,
    questions: batch.questions,
  });
  for (const key of Object.keys(quizMock.QUIZ_KEY)) delete quizMock.QUIZ_KEY[key];
  demo.crase.questions.items.forEach((q, i) => {
    quizMock.QUIZ_KEY[`q${i + 1}`] = {
      correct_index: q.correctIndex,
      explanation: q.explanation,
      evidence: q.metadata?.evidence || null,
    };
  });
}

async function startServer() {
  const { mediaRouter } = await import(
    pathToFileURL(path.join(backend, 'src/routes/media.routes.js')).href
  );
  const app = express();
  app.use(
    '/api/media',
    (req, res, next) =>
      req.headers.authorization === 'Bearer mock-token'
        ? next()
        : res.status(401).json({ error: { message: 'Sessão inválida.' } }),
    mediaRouter,
  );
  app.get('/favicon.ico', (_req, res) =>
    res.sendFile('favicon.png', { root: path.join(root, 'assets/brand') }),
  );
  app.use('/__demo', express.static(DEMO_DIR, { index: false }));
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.use('/js', express.static(path.join(root, 'js')));
  app.use('/css', express.static(path.join(root, 'css')));
  app.use(express.static(path.join(root, 'pages')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}
/** Fecha avisos breves (toasts) e tira o foco, para não aparecerem na captura. */
async function clean(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.app-toast').forEach((t) => t.remove());
    document.activeElement?.blur?.();
  });
  await page.mouse.move(0, 899);
}
// Sufixo do arquivo da captura em andamento ('_celular' nas versões de celular).
let SUFFIX = '';
async function shot(page, name, options = {}) {
  await clean(page);
  await page.waitForTimeout(200);
  const file = path.join(OUT, `${name}${SUFFIX}.png`);
  await page.screenshot({ path: file, ...options });
  console.log('captura', path.relative(repo, file));
}

const CAPTURES = {
  // C01: envio, passo 1 (arquivo escolhido: forma de onda e recorte) e passo 2 (declaração).
  async C01(page, base) {
    await page.goto(base + '/nova-transcricao.html');
    await settle(page);
    await page.setInputFiles('#audio-file', {
      name: 'aula-crase.mp3',
      mimeType: 'audio/mpeg',
      buffer: fs.readFileSync(path.join(DEMO_DIR, 'crase/audio.mp3')),
    });
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled, null, {
      timeout: 30000,
    });
    await settle(page, 900);
    await shot(page, 'C01_envio_aula');
    await page.click('[data-wizard-next]');
    await page.fill('#class-title', demo.crase.title);
    await page.fill('#subject', 'Português');
    await page.keyboard.press('Escape');
    await page.check('#permission-declaration');
    await settle(page, 500);
    await shot(page, 'C01b_envio_identificacao', { fullPage: true });
  },
  async C02(page, base) {
    await page.goto(base + `/processando.html?id=${idOf('crase')}&job=job-demo`);
    await page.waitForFunction(() =>
      document.querySelector('[data-wait-status]')?.textContent.includes('Transcrevendo'),
    );
    await settle(page, 1500);
    await shot(page, 'C02_processamento');
  },
  async C03(page, base) {
    await page.goto(base + `/material.html?id=${idOf('crase')}`);
    await page.locator('.transcription-segment').first().waitFor();
    await settle(page);
    // Toca o áudio real da aula e pausa em ~14 s: o trecho atual (00:11–00:19) fica destacado.
    const media = "[...document.querySelectorAll('audio, video')].find((m) => m.currentSrc)";
    await page.waitForFunction(`${media}?.readyState >= 1`);
    await page.evaluate(`(() => { const m = ${media}; m.muted = true; m.currentTime = 12.5; })()`);
    await page.locator('.player-play').first().click();
    await page.waitForFunction(`${media}.currentTime > 14`, null, { timeout: 15000 });
    await page.evaluate(`${media}.pause()`);
    await settle(page, 900);
    await shot(page, 'C03_transcricao_player');
  },
  async C04(page, base, data) {
    data.demoStage.crase = 'pending';
    await page.goto(base + `/material.html?id=${idOf('crase')}`);
    await page.locator('.transcription-segment').first().waitFor({ state: 'attached' });
    await settle(page);
    await page.getByRole('button', { name: 'Conferir transcrição' }).first().click();
    await page.locator('.transcription-segment textarea').first().waitFor();
    await settle(page, 800);
    await page.evaluate(() => {
      // Fim da conferência: últimos trechos editáveis e o botão "Confirmar e continuar".
      const box = document.querySelector('.confirmation-footer').getBoundingClientRect();
      window.scrollTo({
        top: box.bottom + window.scrollY - window.innerHeight + 40,
        behavior: 'instant',
      });
    });
    await page.waitForTimeout(300);
    // A barra "Editando a revisão" é fixa: rola até nenhum trecho ficar cortado sob ela.
    await page.evaluate(() => {
      const bar = [...document.querySelectorAll('#transcricao *')].find(
        (el) => getComputedStyle(el).position === 'sticky' && el.textContent.includes('Editando'),
      );
      if (!bar) return;
      const limit = bar.getBoundingClientRect().bottom;
      const cut = [...document.querySelectorAll('.transcription-segment')].find((seg) => {
        const r = seg.getBoundingClientRect();
        return r.top < limit && r.bottom > limit;
      });
      if (cut)
        window.scrollBy({
          top: cut.getBoundingClientRect().bottom - limit + 12,
          behavior: 'instant',
        });
    });
    await settle(page, 500);
    await shot(page, 'C04_revisao_confirmacao');
    data.demoStage.crase = undefined;
    await page.goto(base + `/material.html?id=${idOf('crase')}`);
    await page.locator('.transcription-segment').first().waitFor();
    await settle(page);
    await page.click('[data-show-versions]');
    await page.locator('[data-version-list] .version-row').first().waitFor();
    await settle(page, 500);
    await shot(page, 'C04b_revisao_versoes');
  },
  async C05(page, base) {
    await page.goto(base + `/material.html?id=${idOf('crase')}`);
    await page.locator('#tab-summary').waitFor();
    await settle(page);
    await page.click('#tab-summary');
    await page.evaluate(() => {
      const tabs = document.querySelector('.material-tabs');
      window.scrollTo({
        top: tabs.getBoundingClientRect().top + window.scrollY - 90,
        behavior: 'instant',
      });
    });
    await settle(page, 600);
    await shot(page, 'C05_resumo');
  },
  async C06(page, base) {
    await page.goto(base + `/responder.html?material=${idOf('crase')}&batch=bq`);
    await page.getByRole('heading', { name: 'Como você quer responder?' }).waitFor();
    await page.getByRole('radio', { name: 'Correção a cada questão' }).check();
    await page.getByRole('button', { name: 'Começar', exact: true }).click();
    await page.locator('[data-quiz-primary]').waitFor();
    const q = demo.crase.questions.items[0];
    await page
      .getByRole('radio', {
        name: new RegExp(q.options[q.correctIndex].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .check();
    await page.locator('[data-quiz-primary]').click();
    await page.locator('.quiz-feedback').first().waitFor();
    await settle(page, 600);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await shot(page, 'C06_questoes', { fullPage: true });
  },
  async C07(page, base) {
    await page.goto(base + '/historico.html');
    await settle(page, 1200);
    await shot(page, 'C07_biblioteca');
    await page
      .locator('main')
      .getByText('Português', { exact: true })
      .locator('visible=true')
      .first()
      .click();
    await settle(page, 700);
    await page
      .locator('main')
      .getByText('Gramática', { exact: true })
      .locator('visible=true')
      .first()
      .click();
    await settle(page, 900);
    await shot(page, 'C07b_biblioteca_pasta');
  },
  async C08(page, base) {
    await page.goto(base + '/flashcards.html#revisar');
    await page.locator('.flashcard-review-card').first().waitFor();
    await settle(page, 900);
    await shot(page, 'C08_flashcards');
    await page.getByRole('button', { name: 'Virar cartão' }).click();
    await settle(page, 900);
    await shot(page, 'C08b_flashcards_verso');
  },
  async C09(page, base) {
    await page.goto(base + '/aparencia.html#reading-settings');
    await settle(page, 1000);
    await clean(page);
    // The section is taller than the viewport: grow the viewport to fit it, then capture the element.
    const height = await page
      .locator('#reading-settings')
      .evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: Math.max(900, height + 200) });
    await settle(page, 600);
    await clean(page);
    await page
      .locator('#reading-settings')
      .screenshot({ path: path.join(OUT, 'C09_acessibilidade.png') });
    console.log('captura docs/tcc-apendice-c/C09_acessibilidade.png');
  },
  async C10(page, base) {
    await page.goto(base + '/planejar.html');
    await settle(page, 1200);
    await shot(page, 'C10_planejamento');
  },
  // C00: Início, com a próxima aula como player (forma de onda do progresso).
  async C00(page, base) {
    await page.goto(base + '/painel.html');
    await page.locator('.dash-continue .dashboard-lesson-card').waitFor();
    await settle(page, 1200);
    await shot(page, 'C00_inicio');
  },
  // C11: painel de foco ao lado da aula, com um bloco em andamento.
  async C11(page, base) {
    await page.goto(base + `/material.html?id=${idOf('crase')}`);
    await page.locator('[data-utility-trigger]').waitFor();
    await settle(page);
    await page.locator('[data-utility-trigger]').click();
    await page.locator('[data-focus-primary]').click();
    await page.locator('[data-focus-primary]', { hasText: 'Pausar' }).waitFor();
    await page.waitForTimeout(3200);
    await settle(page, 400);
    await shot(page, 'C11_painel_foco');
  },
  // C12: a página Focar (cronômetro completo e a aula do bloco).
  async C12(page, base) {
    await page.goto(base + '/focar.html');
    await page.locator('.focus-primary').waitFor();
    await settle(page, 1000);
    await shot(page, 'C12_focar');
  },
  // C13: aulas de demonstração na Biblioteca e a conta de participante (programa de testes).
  async C13(page, base) {
    await page.goto(base + '/historico.html');
    await page.locator('.demo-shelf').waitFor();
    await settle(page, 1200);
    await page.evaluate(() => document.querySelector('[data-testing-welcome]')?.remove());
    await shot(page, 'C13_aulas_demonstracao');
    await page.goto(base + '/conta.html#limites');
    await page.locator('#limites').waitFor();
    await settle(page, 1000);
    await page.evaluate(() => {
      document.querySelector('[data-testing-welcome]')?.remove();
      const box = document.querySelector('#limites').getBoundingClientRect();
      window.scrollTo({ top: box.top + window.scrollY - 90, behavior: 'instant' });
    });
    await settle(page, 400);
    await shot(page, 'C13b_conta_participante');
  },
  // C14: tutorial da primeira entrada de uma conta nova.
  async C14(page, base) {
    await page.goto(base + '/painel.html');
    const tour = page.locator('[data-guided-tour]');
    await tour.waitFor({ timeout: 10000 });
    await page.locator('[data-tour-next]').click();
    await page.locator('[data-tour-next]').click();
    await settle(page, 700);
    // O tutorial tem o foco: não o tira (clean() tiraria).
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `C14_tutorial${SUFFIX}.png`) });
    console.log(`captura docs/tcc-apendice-c/C14_tutorial${SUFFIX}.png`);
  },
  // C15: página pública (antes do login).
  async C15(page, base) {
    await page.goto(base + '/index.html');
    await settle(page, 1200);
    await shot(page, 'C15_landing');
  },
  // C16: entrar e criar conta.
  async C16(page, base) {
    await page.goto(base + '/login.html');
    await settle(page, 1000);
    await shot(page, 'C16_login');
    await page.goto(base + '/cadastro.html');
    await settle(page, 1000);
    await shot(page, 'C16b_cadastro');
  },
  // C17: perfil (Conta).
  async C17(page, base) {
    await page.goto(base + '/conta.html');
    await settle(page, 1500);
    await shot(page, 'C17_perfil');
  },
  // C18: configurações, aparência (temas) e ajuda.
  async C18(page, base) {
    await page.goto(base + '/configuracoes.html');
    await settle(page, 1000);
    await shot(page, 'C18_configuracoes');
  },
  async C19(page, base) {
    await page.goto(base + '/aparencia.html');
    await settle(page, 1200);
    await shot(page, 'C19_aparencia');
  },
  async C20(page, base) {
    await page.goto(base + '/ajuda.html');
    await settle(page, 1000);
    await shot(page, 'C20_ajuda');
  },
  // C21: anotações da aula (destaques) e o caderno.
  async C21(page, base) {
    await page.goto(base + `/material.html?id=${idOf('crase')}#anotacoes`);
    await settle(page, 1500);
    if (SUFFIX) {
      // No celular, a página inteira repetiria a barra fixa: rola até os destaques.
      await page.evaluate(() => {
        const el = document.querySelector('[data-lesson-notebook]');
        const top = el.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top, behavior: 'instant' });
      });
      await settle(page, 500);
      await shot(page, 'C21_anotacoes');
    } else await shot(page, 'C21_anotacoes', { fullPage: true });
    const book = page.locator('[data-lesson-notebook]');
    await book.getByRole('button', { name: 'Abrir o caderno' }).click();
    await book.locator('.nb-editor h2, .nb-editor h3').first().waitFor();
    // Opções de capa e papel abertas, para mostrar a personalização do caderno.
    await book.locator('summary', { hasText: 'Capa e papel' }).click();
    await book.evaluate((el) => {
      const top = el.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top, behavior: 'instant' });
    });
    await settle(page, 1000);
    await shot(page, 'C21b_caderno');
  },
  // C29: a página da aula inteira com o caderno aberto (capa e papel à mostra).
  async C29(page, base) {
    await page.goto(base + `/material.html?id=${idOf('crase')}#anotacoes`);
    await settle(page, 1500);
    const book = page.locator('[data-lesson-notebook]');
    await book.getByRole('button', { name: 'Abrir o caderno' }).click();
    await book.locator('.nb-editor h2, .nb-editor h3').first().waitFor();
    await book.locator('summary', { hasText: 'Capa e papel' }).click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await settle(page, 1000);
    await shot(page, 'C29_caderno_pagina_inteira', { fullPage: true });
  },
  // C23: listas de questões.
  async C23(page, base) {
    await page.goto(base + '/questoes.html');
    await settle(page, 1500);
    await shot(page, 'C23_listas_questoes');
  },
  // C24: Planejar, calendário e tempo de estudo.
  async C24(page, base) {
    await page.goto(base + '/planejar.html#calendario');
    await settle(page, 1500);
    await shot(page, 'C24_calendario');
    await page.goto(base + '/planejar.html#tempo');
    await settle(page, 1500);
    await shot(page, 'C24b_tempo_estudo');
  },
  // C25: conjuntos de flashcards.
  async C25(page, base) {
    await page.goto(base + '/flashcards.html#conjuntos');
    await settle(page, 1500);
    await shot(page, 'C25_flashcards_conjuntos');
  },
  // C27: turmas.
  async C27(page, base) {
    await page.goto(base + '/turmas.html');
    await settle(page, 1500);
    await shot(page, 'C27_turmas');
    await page.goto(base + '/turmas.html?turma=room-por');
    await settle(page, 1500);
    await shot(page, 'C27b_turma');
  },
  // C28: recuperar a senha.
  async C28(page, base) {
    await page.goto(base + '/recuperar-senha.html');
    await settle(page, 1000);
    await shot(page, 'C28_recuperar_senha');
  },
};
// Versões de celular (as mesmas telas, outro tema).
for (const name of ['C00', 'C03', 'C06', 'C11', 'C15', 'C16', 'C17', 'C21'])
  CAPTURES[`${name}m`] = (...args) => CAPTURES[name](...args);

// Tema de cada captura (para mostrar a personalização) e as que são no celular.
const MOBILE = { width: 390, height: 844 };
const DARK_THEMES = new Set(['night', 'contrast-dark']);
const SETTINGS = {
  C00: { theme: 'paper' },
  C00m: { theme: 'night', mobile: true },
  C01: { theme: 'planner' },
  C02: { theme: 'desktop' },
  C03: { theme: 'night' },
  C03m: { theme: 'matcha', mobile: true },
  C04: { theme: 'forest' },
  C05: { theme: 'soft' },
  C06: { theme: 'gabriela' },
  C06m: { theme: 'night', mobile: true },
  C07: { theme: 'ocean' },
  C08: { theme: 'night' },
  C09: { theme: 'contrast-light' },
  C10: { theme: 'matcha' },
  C11: { theme: 'planner' },
  C11m: { theme: 'ocean', mobile: true },
  C12: { theme: 'night' },
  C13: { theme: 'paper', testing: true },
  C14: { theme: 'matcha', newUser: true },
  C15: { theme: 'paper', signedOut: true },
  C15m: { theme: 'paper', signedOut: true, mobile: true },
  C16: { theme: 'forest', signedOut: true },
  C16m: { theme: 'gabriela', signedOut: true, mobile: true },
  C17: { theme: 'gabriela' },
  C17m: { theme: 'soft', mobile: true },
  C18: { theme: 'ocean' },
  C19: { theme: 'soft' },
  C20: { theme: 'desktop' },
  C21: { theme: 'contrast-light' },
  C21m: { theme: 'forest', mobile: true },
  C23: { theme: 'gabriela', quizHistory: true },
  C29: { theme: 'paper' },
  C24: { theme: 'ocean' },
  C25: { theme: 'matcha' },
  C27: { theme: 'planner', classrooms: true },
  C28: { theme: 'soft', signedOut: true },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { PERMISSION_DECLARATION } = await import(
    pathToFileURL(path.join(backend, 'src/config/permission-declaration.js')).href
  );
  useCraseQuiz();
  const { server, base } = await startServer();
  const browser = await m.launchBrowser();
  // Os mesmos recursos ligados na produção (GET /api/config em 25/11/2026).
  const flags = {
    ...m.allFlags,
    flashcards_v3: true,
    classrooms: true,
    notebooks: true,
    multi_lesson: true,
  };
  let failed = 0;
  try {
    for (const [name, run] of Object.entries(CAPTURES)) {
      if (only.length && !only.includes(name)) continue;
      const settings = SETTINGS[name] || {};
      SUFFIX = settings.mobile ? '_celular' : '';
      const data = captureData();
      if (settings.testing) data.testing = require('./mock-testing.cjs').testingState('tester');
      if (settings.newUser) data.profileState = [];
      if (settings.classrooms) withClassrooms(data);
      if (settings.quizHistory)
        data.quizSessions = [
          {
            id: 'qs-crase',
            material_id: idOf('crase'),
            batch_id: 'bq',
            status: 'completed',
            kind: 'full',
            created_at: m.at(-1, 10),
          },
          ...m.state().quizSessions,
        ];
      const runFlags = settings.testing ? { ...flags, public_testing: true } : flags;
      const user = settings.newUser ? { ...USER, created_at: new Date().toISOString() } : USER;
      const theme = settings.theme || 'paper';
      const { context, page } = await m.openApp(
        browser,
        base,
        runFlags,
        data,
        settings.mobile ? MOBILE : VIEWPORT,
        {
          user,
          context: {
            deviceScaleFactor: 2,
            colorScheme: DARK_THEMES.has(theme) ? 'dark' : 'light',
            locale: 'pt-BR',
            timezoneId: 'America/Sao_Paulo',
            ...(settings.mobile ? { isMobile: true, hasTouch: true } : {}),
          },
        },
      );
      await context.addInitScript((value) => {
        try {
          localStorage.setItem('audioestudo-theme', value);
        } catch {
          /* storage blocked: default theme */
        }
      }, theme);
      if (settings.signedOut)
        await context.addInitScript(() => localStorage.setItem('mock-signed-out', '1'));
      await overlay(context, base, data, runFlags, { PERMISSION_DECLARATION });
      try {
        await run(page, base, data);
      } catch (error) {
        failed += 1;
        console.error(`FALHOU ${name}: ${error.message}`);
        await page.screenshot({ path: path.join(OUT, `_erro_${name}.png`) }).catch(() => {});
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    if (m.errors.length) console.log('ERROS DO NAVEGADOR\n' + m.errors.slice(0, 30).join('\n'));
  }
  process.exitCode = failed ? 1 : 0;
})();
