/* global document, window, getComputedStyle */
// Capturas do Apêndice C do TCC: o front end REAL desta versão rodando com a API SIMULADA
// (./mock-app.cjs) e o conteúdo das aulas de demonstração (database/demo-lessons). Nada aqui
// acessa backend real, provedor de IA ou projeto Supabase; a única peça do backend usada é a
// rota de mídia local (FFmpeg) para ler o áudio escolhido no envio, como em browser-check.cjs.
//
// Uso: BROWSER_EXECUTABLE=/caminho/do/chrome node frontend/tests/support/tcc-captures.cjs [somente...]
// Saída: docs/tcc-apendice-c/*.png (1440x900, deviceScaleFactor 2, tema claro padrão).
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
    { id: 'unit-crase', subject_id: 'sub-por', title: 'Gramática', description: null, sort_order: 0 },
    { id: 'unit-energia', subject_id: 'sub-bio', title: 'Metabolismo energético', description: null, sort_order: 0 },
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
        return json({ video: null, signedVideoUrl: null, signedAudioUrl: `${base}/__demo/${slug}/audio.mp3` });
      if (rest === '/captions') return json({ revision: REVISION, granularity: 'segment', words: [] });
      if (rest === '/transcription/versions') {
        const segs = demo[slug].segments.map((s) => ({ position: s.position, startMs: s.startMs, endMs: s.endMs, text: s.text }));
        return json([
          { id: SOURCE_REVISION_ID, revision: 2, created_at: new Date(Date.now() - 2 * 3600000).toISOString(), segments_snapshot: segs },
          { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', revision: 1, created_at: new Date(Date.now() - 3 * 3600000).toISOString(), segments_snapshot: segs },
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
      cards: cards.map(({ id, front_text, back_text }) => ({ id, front_text, back_text, status: 'active' })),
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
    id, goal_id: goal, subgoal_id: subgoal, title, due_date: due === null ? null : m.day(due),
    material_id: material, completed_at: done ? m.at(-1, 9) : null, sort_order: order, created_at: m.at(-4, 9),
  });
  data.tasks = [
    task('t1', 'g1', 's1', 'Ouvir a aula sobre crase', -1, idOf('crase'), true, 1000),
    task('t2', 'g1', 's1', 'Responder as questões da aula de crase', 1, idOf('crase'), false, 2000),
    task('t3', 'g1', null, 'Revisar os cartões de crase', 2, null, false, 3000),
    task('t4', 'g2', null, 'Ouvir a aula sobre vacinas', 3, idOf('vacinas'), false, 1000),
    task('t5', 'g2', null, 'Ler o resumo e anotar dúvidas', null, null, false, 2000),
  ];
  data.events = [
    { kind: 'event', id: 'e1', title: 'Estudar crase', startsAt: m.at(1, 14), endsAt: m.at(1, 15), description: '', materialId: idOf('crase'), taskId: null, version: 1 },
    { kind: 'event', id: 'e2', title: 'Revisão de Ciências', startsAt: m.at(3, 19), endsAt: m.at(3, 20), description: '', materialId: idOf('vacinas'), taskId: null, version: 1 },
  ];
  data.notes = [];
  data.quizSessions = [];
  return data;
}

/** As questões da aula de crase alimentam a simulação de tentativas (mock-quiz.cjs). */
function useCraseQuiz() {
  const batch = batchOf(demo.crase);
  Object.assign(quizMock.QUIZ_BATCH, { id: batch.id, title: batch.title, generated_count: batch.generated_count, questions: batch.questions });
  for (const key of Object.keys(quizMock.QUIZ_KEY)) delete quizMock.QUIZ_KEY[key];
  demo.crase.questions.items.forEach((q, i) => {
    quizMock.QUIZ_KEY[`q${i + 1}`] = { correct_index: q.correctIndex, explanation: q.explanation, evidence: q.metadata?.evidence || null };
  });
}

async function startServer() {
  const { mediaRouter } = await import(pathToFileURL(path.join(backend, 'src/routes/media.routes.js')).href);
  const app = express();
  app.use(
    '/api/media',
    (req, res, next) =>
      req.headers.authorization === 'Bearer mock-token' ? next() : res.status(401).json({ error: { message: 'Sessão inválida.' } }),
    mediaRouter,
  );
  app.get('/favicon.ico', (_req, res) => res.sendFile('favicon.png', { root: path.join(root, 'assets/brand') }));
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
async function shot(page, name, options = {}) {
  await clean(page);
  await page.waitForTimeout(200);
  const file = path.join(OUT, `${name}.png`);
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
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled, null, { timeout: 30000 });
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
    await page.waitForFunction(() => document.querySelector('[data-wait-status]')?.textContent.includes('Transcrevendo'));
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
      window.scrollTo({ top: box.bottom + window.scrollY - window.innerHeight + 40, behavior: 'instant' });
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
      if (cut) window.scrollBy({ top: cut.getBoundingClientRect().bottom - limit + 12, behavior: 'instant' });
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
      window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 90, behavior: 'instant' });
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
    await page.getByRole('radio', { name: new RegExp(q.options[q.correctIndex].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).check();
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
    await page.locator('main').getByText('Português', { exact: true }).locator('visible=true').first().click();
    await settle(page, 700);
    await page.locator('main').getByText('Gramática', { exact: true }).locator('visible=true').first().click();
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
    await page.locator('#reading-settings').screenshot({ path: path.join(OUT, 'C09_acessibilidade.png') });
    console.log('captura docs/tcc-apendice-c/C09_acessibilidade.png');
  },
  async C10(page, base) {
    await page.goto(base + '/planejar.html');
    await settle(page, 1200);
    await shot(page, 'C10_planejamento');
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { PERMISSION_DECLARATION } = await import(
    pathToFileURL(path.join(backend, 'src/config/permission-declaration.js')).href
  );
  useCraseQuiz();
  const { server, base } = await startServer();
  const browser = await m.launchBrowser();
  const flags = { ...m.allFlags };
  let failed = 0;
  try {
    for (const [name, run] of Object.entries(CAPTURES)) {
      if (only.length && !only.includes(name)) continue;
      const data = captureData();
      const { context, page } = await m.openApp(browser, base, flags, data, VIEWPORT, {
        user: USER,
        context: { deviceScaleFactor: 2, colorScheme: 'light', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
      });
      await overlay(context, base, data, flags, { PERMISSION_DECLARATION });
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
