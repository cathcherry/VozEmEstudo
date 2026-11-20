/* global axe */
// Dashboard home in a real browser with a simulated API: summaries, side-sheet workspaces,
// keyboard and focus behaviour, feature-flag fallback, axe-core and screenshots at several widths.
// Nothing here calls a real backend, AI provider or Supabase project.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const backend = path.resolve(root, '../backend');
const express = require(path.join(backend, 'node_modules/express'));
const output = path.join(__dirname, 'artifacts', 'dashboard-home');
fs.mkdirSync(output, { recursive: true });

const USER_ID = 'user-dashboard';
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const at = (offset, hour) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
const lesson = (id, title, subject, daysAgo, durationMs) => ({
  id,
  title,
  subject,
  status: 'PRONTO',
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  audio_files: [{ duration_ms: durationMs, extension: 'mp3' }],
});
const materials = [
  lesson('l-foto', 'Fotossíntese e respiração celular', 'Biologia', 1, 1820000),
  lesson('l-rev', 'Revolução Industrial: causas e consequências', 'História', 3, 2410000),
  lesson('l-func', 'Funções do 2º grau', 'Matemática', 5, 1505000),
  lesson('l-solo', 'Tipos de solo', 'Geografia', 9, 203000),
  lesson('l-ondas', 'Ondas e som', 'Física', 12, 1290000),
];

/** A lesson at a given point of the study path: 'pending' (unconfirmed), 'summary', 'questions'. */
function lessonDetail(m, stage) {
  return {
    ...m,
    review: stage === 'pending'
      ? { state: 'awaiting_confirmation', sourceRevisionId: null, revision: 1, permissionRequired: false }
      : { state: 'ready_to_generate', sourceRevisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', revision: 1, permissionRequired: false },
    warnings: [],
    audio: m.audio_files[0],
    transcription: {
      current_revision: 1,
      id: `tr-${m.id}`,
      transcription_segments: [{ id: 'seg-1', position: 0, start_ms: 0, end_ms: 1500, current_text: 'A fotossíntese converte energia luminosa em energia química.' }],
    },
    summaries: stage === 'pending' ? [] : [{ id: 's1', is_current: true, version: 1, source_transcription_revision: 1, text: 'A **fotossíntese** ocorre no cloroplasto.' }],
    questionBatches: stage === 'questions' ? [{ id: 'b1', generated_count: 1, source_transcription_revision: 1, questions: [{ id: 'q1', statement: 'Onde ocorre a fotossíntese?', options: ['Cloroplasto', 'Núcleo', 'Ribossomo'] }] }] : [],
  };
}

function state() {
  return {
    goals: [
      {
        id: 'g1',
        title: 'Revisar para a prova de Biologia',
        status: 'active',
        target_date: day(10),
      },
      { id: 'g2', title: 'Terminar o módulo de História', status: 'active', target_date: null },
    ],
    subgoals: [{ id: 's1', goal_id: 'g1', title: 'Metabolismo', due_date: day(4) }],
    tasks: [
      {
        id: 't1',
        goal_id: 'g1',
        subgoal_id: 's1',
        title: 'Resumir a fase clara da fotossíntese',
        due_date: day(-1),
        material_id: 'l-foto',
        completed_at: null,
        sort_order: 1000,
        created_at: at(-4, 9),
      },
      {
        id: 't2',
        goal_id: 'g1',
        subgoal_id: null,
        title: 'Refazer as questões erradas',
        due_date: day(1),
        material_id: null,
        completed_at: null,
        sort_order: 2000,
        created_at: at(-3, 9),
      },
      {
        id: 't3',
        goal_id: 'g2',
        subgoal_id: null,
        title: 'Ouvir a aula sobre a Revolução Industrial',
        due_date: day(3),
        material_id: 'l-rev',
        completed_at: null,
        sort_order: 1000,
        created_at: at(-2, 9),
      },
      {
        id: 't4',
        goal_id: 'g2',
        subgoal_id: null,
        title: 'Ler o capítulo 4',
        due_date: null,
        material_id: null,
        completed_at: at(-1, 9),
        sort_order: 2000,
        created_at: at(-2, 9),
      },
    ],
    dueCards: [1, 2, 3, 4, 5].map((n) => ({
      id: `c${n}`,
      front_text: [
        'O que a clorofila absorve?',
        'Onde ocorre o ciclo de Calvin?',
        'Qual o produto da fase clara?',
        'O que é respiração aeróbica?',
        'Qual organela produz ATP?',
      ][n - 1],
      back_text: 'Resposta de teste.',
      status: 'active',
      due_at: at(0, 8),
      material_id: 'l-foto',
    })),
    events: [
      {
        kind: 'event',
        id: 'e1',
        title: 'Estudar fotossíntese',
        startsAt: at(1, 14),
        endsAt: at(1, 15),
        description: '',
        materialId: 'l-foto',
        taskId: null,
        version: 1,
      },
      {
        kind: 'event',
        id: 'e2',
        title: 'Grupo de estudos de História',
        startsAt: at(4, 19),
        endsAt: at(4, 20),
        description: '',
        materialId: null,
        taskId: null,
        version: 1,
      },
    ],
    notes: [
      {
        id: 'n1',
        material_id: 'l-foto',
        source_revision: 2,
        color: 'yellow',
        quote: 'A energia luminosa é convertida em energia química',
        note_text: 'Cai na prova!',
        version: 1,
      },
      {
        id: 'n2',
        material_id: 'l-rev',
        source_revision: 1,
        color: 'green',
        quote: 'máquina a vapor',
        note_text: 'Relacionar com a energia do carvão',
        version: 1,
      },
    ],
    quizSessions: [
      {
        id: 'qs1',
        material_id: 'l-foto',
        batch_id: 'b1',
        status: 'active',
        kind: 'full',
        created_at: at(-1, 10),
      },
      {
        id: 'qs2',
        material_id: 'l-rev',
        batch_id: 'b2',
        status: 'completed',
        kind: 'full',
        created_at: at(-3, 10),
      },
    ],
    reviews: 0,
    sessions: 0,
    ticks: [],
    calendarQueries: 0,
    savedEvents: [],
    createdGoals: [],
  };
}

const sdk = (
  user,
) => `export function createClient(){const user=${JSON.stringify(user)};return {auth:{
getSession:async()=>({data:{session:{user,access_token:'mock-token'}},error:null}),
getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
signOut:async()=>({error:null}),updateUser:async()=>({data:{user},error:null})},
storage:{from:()=>({upload:async()=>({error:null}),remove:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:''},error:null})})}}}`;

async function setup(context, base, flags, data) {
  const user = {
    id: USER_ID,
    email: 'estudante@example.test',
    email_confirmed_at: new Date().toISOString(),
    user_metadata: { display_name: 'Marina Souza' },
  };
  await context.route(base + '/js/vendor/supabase.min.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: sdk(user) }),
  );
  await context.route(base + '/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p === '/api/config')
      return json({
        supabaseUrl: 'https://mock.supabase.co',
        supabasePublishableKey: 'k',
        audioBucket: 'audios',
        featureFlags: flags,
        maxQuestionListCount: 30,
        recordingLanguages: { options: ['pt'], default: 'pt' },
        oauthProviders: [],
      });
    if (p === '/api/materials' && method === 'GET') return json(materials);
    if (/^\/api\/materials\/[^/]+$/.test(p) && method === 'GET') {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      return json({ ...lessonDetail(m, data.lessonStage?.[m.id] || 'summary'), signedAudioUrl: `${base}/__fixture.wav` });
    }
    if (p.endsWith('/captions')) return json({ revision: 1, granularity: 'segment', words: [] });
    if (p.endsWith('/playback')) return json({ video: null, signedVideoUrl: null, signedAudioUrl: `${base}/__fixture.wav` });
    if (p === '/api/planning' && method === 'GET')
      return json({ goals: data.goals, subgoals: data.subgoals, tasks: data.tasks });
    if (p === '/api/planning/goals' && method === 'POST') {
      const body = request.postDataJSON();
      const goal = {
        id: `g${data.goals.length + 1}`,
        title: body.title,
        status: 'active',
        target_date: body.targetDate,
      };
      data.createdGoals.push(goal);
      return json(goal, 201);
    }
    if (/^\/api\/planning\/goals\/[^/]+\/tasks$/.test(p) && method === 'POST') {
      const body = request.postDataJSON();
      const task = {
        id: `t${data.tasks.length + 1}`,
        goal_id: p.split('/')[4],
        subgoal_id: body.subgoalId || null,
        title: body.title,
        due_date: body.dueDate || null,
        material_id: body.materialId || null,
        reference_url: body.referenceUrl || null,
        completed_at: null,
        sort_order: 9000,
        created_at: new Date().toISOString(),
      };
      data.tasks.push(task);
      return json(task, 201);
    }
    if (p === '/api/flashcards/sets') return json([]);
    if (p === '/api/flashcards' && method === 'GET') {
      const filter = url.searchParams.get('filter');
      const cards = filter === 'due' ? data.dueCards : (data.allCards ?? data.dueCards);
      return json({ cards, total: cards.length, limit: 100, offset: 0 });
    }
    if (/^\/api\/flashcards\/[^/]+\/reviews$/.test(p) && method === 'POST') {
      data.reviews++;
      const id = p.split('/')[3];
      data.dueCards = data.dueCards.filter((card) => card.id !== id);
      return json({ dueAt: at(2, 8) });
    }
    if (p === '/api/calendar' && method === 'GET') {
      data.calendarQueries++;
      const items = [
        ...data.events,
        ...data.tasks
          .filter((t) => t.due_date && !t.completed_at)
          .map((t) => ({
            kind: 'task',
            id: t.id,
            title: t.title,
            date: t.due_date,
            materialId: t.material_id,
          })),
      ];
      return json({ items, total: items.length, limit: 100, offset: 0 });
    }
    if (p === '/api/calendar' && method === 'PUT') {
      const body = request.postDataJSON();
      data.savedEvents.push(body);
      data.events.push({ kind: 'event', id: body.id, version: 1, ...body.body });
      return json({ id: body.id, version: 1 });
    }
    if (p === '/api/annotations') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const notes = data.notes.filter(
        (n) => !q || `${n.quote} ${n.note_text}`.toLowerCase().includes(q),
      );
      return json({ notes, total: notes.length + (q ? 0 : 5), limit: 50, offset: 0 });
    }
    if (p === '/api/study/progress' && method === 'GET')
      return json({ progress: [], total: 0, limit: 100, offset: 0 });
    if (p.startsWith('/api/study/progress/')) return json({ version: 1 });
    if (p === '/api/study/overview') {
      const seconds = [1800, 2700, 0, 1200, 0, 0, 0];
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const days = seconds.map((s, i) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        return {
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          seconds: s,
        };
      });
      return json({
        weekStart: days[0].date,
        timezone: 'America/Sao_Paulo',
        goalMinutes: 150,
        weekSeconds: seconds.reduce((a, b) => a + b, 0),
        completedMaterials: 2,
        days,
        activeSession: null,
      });
    }
    if (p === '/api/study/settings') return json({ ok: true });
    if (p === '/api/quiz-sessions' && method === 'GET') return json(data.quizSessions);
    if (p === '/api/study/sessions' && method === 'POST') {
      data.sessions++;
      const body = request.postDataJSON();
      return json({
        id: body.id || 'session-1',
        kind: body.kind,
        last_sequence: 0,
        started_at: new Date().toISOString(),
        total_seconds: 0,
      });
    }
    if (/^\/api\/study\/sessions\/[^/]+\/tick$/.test(p)) {
      const body = request.postDataJSON();
      data.ticks.push(body);
      return json({
        id: p.split('/')[4],
        last_sequence: body.sequence,
        total_seconds: body.sequence,
        ended_at: body.close ? new Date().toISOString() : null,
      });
    }
    if (p === '/api/search')
      return json({
        lessons: [
          {
            materialId: 'l-foto',
            title: 'Fotossíntese e respiração celular',
            subject: 'Biologia',
            createdAt: materials[0].created_at,
          },
        ],
        questions: [],
        transcripts: [],
      });
    return json({ error: { message: `Sem simulação para ${method} ${p}` } }, 404);
  });
  await context.addInitScript(
    ({ owner, ids }) => {
      const now = Date.now();
      const store = {
        [ids[0]]: {
          openedAt: now - 3600000,
          playedAt: now - 3500000,
          position: 742,
          duration: 1820,
          intervals: [[0, 742]],
          visits: 4,
          tags: ['fotossíntese', 'cloroplasto'],
        },
        [ids[1]]: { openedAt: now - 86400000, visits: 2, tags: ['revolução industrial'] },
        [ids[3]]: { openedAt: now - 5 * 86400000, completed: true, visits: 3, tags: [] },
      };
      if (!localStorage.getItem('voz-study-v1:' + owner))
        localStorage.setItem('voz-study-v1:' + owner, JSON.stringify(store));
    },
    { owner: USER_ID, ids: materials.map((m) => m.id) },
  );
}

const errors = [];
const passed = [];
const record = (name) => {
  passed.push(name);
  console.log('PASS', name);
};

async function axeCheck(page, selector, label) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(
    async (target) =>
      (
        await axe.run(document.querySelector(target), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        })
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    selector,
  );
  assert.deepEqual(violations, [], `${label}: axe violations`);
}
async function ready(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-dashboard-data]')?.getAttribute('aria-busy') === 'false',
  );
  await page.waitForTimeout(400);
}
async function noHorizontalScroll(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(overflow <= 1, `${label}: horizontal overflow of ${overflow}px`);
}
const focusedText = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return `${el?.tagName}|${(el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 60)}`;
  });

async function openApp(browser, base, flags, data, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await setup(context, base, flags, data);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${page.url()} ${e.stack || e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text()))
      errors.push(m.text());
  });
  return { context, page };
}
const shot = (page, name, fullPage = true) =>
  page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(350);
}

async function main() {
  const app = express();
  app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(root, 'assets/brand/favicon.png')));
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.use('/js', express.static(path.join(root, 'js')));
  app.use('/css', express.static(path.join(root, 'css')));
  app.use(express.static(path.join(root, 'pages')));
  app.get('/__fixture.wav', (_req, res) => res.sendFile(path.join(__dirname, 'artifacts', 'fixture.wav')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || chromium.executablePath(),
    args: ['--no-sandbox'],
  });
  const allFlags = {
    planning: true,
    flashcards: true,
    flashcard_sets: true,
    study_tracking: true,
    annotations: true,
    calendar: true,
    sharing: true,
    study_authoring: true,
    catalog_units: true,
    quiz_v2: true,
    quiz_review: true,
  };
  try {
    // ---------- Returning student: Início with real summaries -----------------------------
    const data = state();
    data.allCards = [
      ...data.dueCards,
      {
        id: 'c9',
        front_text: 'Extra',
        back_text: 'x',
        status: 'active',
        due_at: at(5, 8),
        material_id: 'l-foto',
      },
    ];
    let { context, page } = await openApp(browser, base, allFlags, data);
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-tasks-preview] .dash-task-list').waitFor();
    await page.locator('[data-cards-preview] .dash-next-card').waitFor();
    await page.locator('[data-events-preview] .dash-agenda-list').waitFor();
    await page.locator('[data-week-body] .dash-day-bar').first().waitFor();
    await page.locator('[data-notes-summary]', { hasText: 'anotações salvas' }).waitFor();
    await settle(page);
    assert.equal(await page.locator('dialog').count(), 0, 'Início has no hidden tool panels');
    assert.equal(
      await page.locator('.primary-navigation a[aria-current="page"] span').textContent(),
      'Início',
    );
    for (const name of ['Nova transcrição', 'Início', 'Biblioteca', 'Revisar', 'Planejar'])
      assert(
        await page.locator('.primary-navigation a', { hasText: name }).isVisible(),
        `${name} in the navigation`,
      );
    assert.match(
      await page.locator('[data-pulse="tasks"]').textContent(),
      /3\s+tarefas pendentes \(1 atrasada\)/,
    );
    assert.equal(
      await page.locator('[data-pulse="tasks"] a').getAttribute('href'),
      './planejar.html#tarefas',
    );
    assert.equal(
      await page.locator('[data-cards-actions] .button-link').textContent(),
      'Revisar 5 cartões',
    );
    for (const host of ['[data-tasks-actions]', '[data-cards-actions]', '[data-events-actions]'])
      assert(
        (await page.locator(`${host} .button-link`).count()) <= 1,
        `${host}: at most one primary action`,
      );
    const hero = page.locator('.dash-continue .dashboard-lesson-card');
    const before = await hero.locator('.dashboard-lesson-percent').boundingBox();
    for (const target of [
      hero.locator('.dashboard-lesson-title'),
      hero.locator('.dashboard-lesson-playback progress'),
    ]) {
      await target.hover();
      await page.waitForTimeout(250);
      const after = await hero.locator('.dashboard-lesson-percent').boundingBox();
      assert(
        Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1,
        'hero progress stays in place on hover',
      );
      assert.equal(
        await hero.locator('.dashboard-lesson-cue').evaluate((n) => getComputedStyle(n).opacity),
        '1',
      );
    }
    await page.mouse.move(0, 0);
    await axeCheck(page, 'body', 'Início');
    await shot(page, 'inicio-1440');
    record(
      'Início: resumo real, cada cartão leva a uma página (no máximo uma ação principal), menu com Revisar e Planejar, sem painéis escondidos, hover estável, axe sem violações',
    );

    // ---------- Planning journey: task → schedule → time ---------------------------------
    await page.locator('[data-tasks-actions] a', { hasText: 'Adicionar tarefa' }).click();
    await page.waitForURL('**/planejar.html#tarefas');
    await page.locator('[data-planning-task-form]:visible').waitFor();
    assert.equal(await page.locator('#tab-tarefas').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'planning-task-goal');
    await page.locator('#planning-task-goal').selectOption('g2');
    await page.locator('#planning-task-title').fill('Resumir o capítulo 5');
    await page.locator('[data-planning-task-form] [type=submit]').click();
    await page.locator('[data-planning-status]', { hasText: 'Tarefa criada' }).waitFor();
    assert(data.tasks.some((t) => t.title === 'Resumir o capítulo 5'));
    assert.equal(new URL(page.url()).search, '', 'the creation request is not repeated on reload');
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › tarefas');
    await shot(page, 'planejar-tarefas-1440');
    await page.locator('#tab-tarefas').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-calendario');
    assert(page.url().endsWith('#calendario'));
    await page.locator('#calendario .study-calendar-grid button').first().waitFor();
    await page.locator('#calendario details.calendar-compose > summary').click();
    await page
      .locator('#calendario .calendar-event-form input[type=text]')
      .fill('Estudar capítulo 5');
    await page
      .locator('#calendario input[type=datetime-local]')
      .nth(0)
      .fill(`${day(2)}T10:00`);
    await page
      .locator('#calendario input[type=datetime-local]')
      .nth(1)
      .fill(`${day(2)}T11:00`);
    await page.locator('#calendario .calendar-event-form [type=submit]').click();
    await page.locator('#calendario [role=status]', { hasText: 'Horário salvo' }).waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › calendário');
    await shot(page, 'planejar-calendario-1440');
    await page.locator('#tab-tempo').click();
    await page.locator('#tempo .study-timer-controls').waitFor();
    assert(
      !(await page.locator('#tempo .study-settings').isVisible()),
      'goal settings folded until requested',
    );
    await page.locator('#tempo .study-timer-controls button', { hasText: 'Iniciar' }).click();
    await page.waitForTimeout(1500);
    assert.equal(data.sessions, 1);
    await page.locator('#tempo .study-timer-controls button', { hasText: 'Pausar' }).click();
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › tempo');
    await shot(page, 'planejar-tempo-1440');
    record(
      'Jornada de planejamento: Início › Adicionar tarefa abre o formulário certo; abas com setas e #endereço; agendar horário; cronômetro',
    );

    // ---------- Flashcard and question journey -------------------------------------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-cards-actions] a', { hasText: 'Revisar 5 cartões' }).click();
    await page.waitForURL('**/revisar.html#flashcards');
    await page
      .locator('[data-flashcard-due-area] button', { hasText: 'Revelar resposta' })
      .waitFor();
    await page.waitForFunction(() =>
      document.activeElement?.textContent?.includes('Revelar resposta'),
    );
    await page.keyboard.press('Enter');
    assert.match(await focusedText(page), /De novo|Difícil|Bom|Fácil/);
    await page.getByRole('button', { name: 'Bom', exact: true }).click();
    await page
      .locator('[data-flashcard-review-status]', { hasText: 'Revisão registrada' })
      .waitFor();
    assert.equal(data.reviews, 1);
    await settle(page);
    await axeCheck(page, 'main', 'Revisar › flashcards');
    await shot(page, 'revisar-flashcards-1440');
    await page.locator('#tab-questoes').click();
    await page.locator('.quiz-history-list a', { hasText: 'Continuar tentativa' }).waitFor();
    assert.match(await page.locator('.quiz-history-list').first().textContent(), /Fotossíntese/);
    assert.match(
      await page
        .locator('.quiz-history-list a', { hasText: 'Ver resultado e erros' })
        .getAttribute('href'),
      /responder\.html\?material=l-rev&batch=b2&session=qs2/,
    );
    await axeCheck(page, 'main', 'Revisar › questões');
    await shot(page, 'revisar-questoes-1440');
    record(
      'Jornada de revisão: Início › Revisar 5 cartões abre a revisão com foco; Questões lista tentativas com Continuar / Ver resultado e erros',
    );

    // ---------- Finding information: annotations through the global search ---------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('.topbar-search input').fill('energia');
    await page.locator('.topbar-search input').press('Enter');
    await page.getByRole('tab', { name: /Anotações/ }).click();
    await page.locator('.search-note', { hasText: 'Cai na prova!' }).waitFor();
    await page.locator('#search-panel-notes button', { hasText: 'em Revisar' }).click();
    await page.waitForURL('**/revisar.html#anotacoes');
    await page.locator('#anotacoes .annotation-card').first().waitFor();
    assert.equal(await page.locator('#anotacoes input[type=search]').inputValue(), 'energia');
    await settle(page);
    await axeCheck(page, 'main', 'Revisar › anotações');
    await shot(page, 'revisar-anotacoes-1440');
    record(
      'Encontrar informação: a busca global mostra a aba Anotações e leva a Revisar com a mesma busca',
    );

    // ---------- Question practice from the lesson: steps and the next action -------------
    data.lessonStage = { 'l-foto': 'summary', 'l-rev': 'pending', 'l-func': 'questions' };
    await page.goto(base + '/material.html?id=l-foto');
    await page.locator('[data-lesson-steps]:not([hidden]) .lesson-next button').waitFor();
    assert.deepEqual(
      await page.locator('.lesson-step').evaluateAll((items) => items.map((i) => i.className.replace('lesson-step ', ''))),
      ['is-done', 'is-done', 'is-current', 'is-todo'],
    );
    assert.equal(await page.locator('.lesson-next button').textContent(), 'Criar questões');
    assert.equal(await page.locator('.lesson-tools .lesson-tool[open] > summary').first().textContent(), 'Cronômetro de estudo');
    const stepsBox = await page.locator('[data-lesson-steps]').boundingBox();
    const toolsBox = await page.locator('.lesson-tools').boundingBox();
    assert(toolsBox.y > stepsBox.y, 'timer and annotations come after the lesson content');
    await settle(page);
    await axeCheck(page, 'main', 'Aula › etapas');
    await shot(page, 'aula-etapas-1440');
    await page.locator('.lesson-next button', { hasText: 'Criar questões' }).click();
    await page.locator('[data-questions-dialog][open]').waitFor();
    assert.equal(await page.locator('#tab-questions').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Escape');
    await page.goto(base + '/material.html?id=l-func');
    await page.locator('.lesson-next button', { hasText: 'Responder a lista' }).waitFor();
    await page.goto(base + '/material.html?id=l-rev');
    await page.locator('[data-lesson-steps]:not([hidden])').waitFor();
    assert.equal(await page.locator('.lesson-next button').count(), 0, 'one primary action: the page already asks to check the transcript');
    assert(await page.locator('.lesson-step-button').nth(1).isDisabled(), 'summary waits for confirmation');
    await shot(page, 'aula-pendente-1440');
    record('Jornada de questões: a aula mostra as etapas e o próximo passo (Criar questões abre a lista; Responder a lista; etapas travadas até confirmar)');

    // ---------- Widths, zoom, themes, screen-reader mode ---------------------------------
    for (const route of ['painel.html', 'planejar.html#tarefas', 'revisar.html#flashcards']) {
      await page.goto(`${base}/${route}`);
      await settle(page);
      for (const [width, height] of [
        [1920, 1080],
        [1280, 800],
        [834, 1112],
        [640, 800],
        [390, 844],
        [320, 640],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        await noHorizontalScroll(page, `${route} @${width}`);
        if ([1280, 834, 390].includes(width)) await shot(page, `${route.split('.')[0]}-${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    record(
      'Sem rolagem horizontal em Início, Planejar e Revisar de 320 a 1920 px (640 px = zoom 200%)',
    );
    await page.goto(base + '/painel.html');
    await ready(page);
    for (const [attr, value, name] of [
      ['data-theme', 'night', 'inicio-tema-noturno'],
      ['data-high-contrast', 'true', 'inicio-alto-contraste'],
      ['data-screen-reader-mode', 'true', 'inicio-leitor-de-tela'],
    ]) {
      await page.evaluate(([a, v]) => document.documentElement.setAttribute(a, v), [attr, value]);
      await page.waitForTimeout(250);
      await shot(page, name);
      await page.evaluate(([a]) => document.documentElement.removeAttribute(a), [attr]);
    }
    record('Tema noturno, alto contraste e modo leitor de tela renderizados');
    await context.close();

    // ---------- New student: empty account -----------------------------------------------
    const fresh = state();
    Object.assign(fresh, {
      goals: [],
      subgoals: [],
      tasks: [],
      dueCards: [],
      allCards: [],
      events: [],
      notes: [],
      quizSessions: [],
    });
    ({ context, page } = await openApp(browser, base, allFlags, fresh));
    await page.route('**/api/study/overview', (route) =>
      route.fulfill({
        json: {
          weekStart: day(-3),
          timezone: 'America/Sao_Paulo',
          goalMinutes: 120,
          weekSeconds: 0,
          completedMaterials: 0,
          days: [],
          activeSession: null,
        },
      }),
    );
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-tasks-actions] a', { hasText: 'Criar primeiro objetivo' }).waitFor();
    await page
      .locator('[data-cards-preview]', { hasText: 'Crie cartões a partir do resumo' })
      .waitFor();
    await page.locator('[data-events-preview]', { hasText: 'Planeje quando' }).waitFor();
    await page.locator('[data-week-body]', { hasText: 'Use o cronômetro' }).waitFor();
    await settle(page);
    assert.equal(await page.locator('.dash-day-bar').count(), 0, 'no empty chart');
    assert(await page.locator('[data-dash-pulse]').isHidden(), 'no zero counters');
    await axeCheck(page, 'body', 'Início vazio');
    await shot(page, 'inicio-conta-nova-1440');
    await page.locator('[data-tasks-actions] a', { hasText: 'Criar primeiro objetivo' }).click();
    await page.waitForURL('**/planejar.html#tarefas');
    await page.locator('#planning-goal-title:focus').waitFor();
    await page.goto(base + '/revisar.html#questoes');
    await page
      .locator('#questoes', { hasText: 'Você ainda não respondeu nenhuma lista' })
      .waitFor();
    await shot(page, 'revisar-questoes-vazio-1440');
    record(
      'Conta nova: cada cartão explica o recurso e oferece uma ação; sem gráficos ou contadores zerados; "Criar primeiro objetivo" abre o formulário',
    );
    await context.close();

    // ---------- Flags off ----------------------------------------------------------------
    ({ context, page } = await openApp(browser, base, {}, state(), { width: 1280, height: 800 }));
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.waitForTimeout(600);
    assert(await page.locator('.primary-navigation a', { hasText: 'Revisar' }).isHidden());
    assert(await page.locator('.primary-navigation a', { hasText: 'Planejar' }).isHidden());
    assert(await page.locator('[data-plan-section]').isHidden());
    assert(await page.locator('[data-week-widget]').isHidden());
    assert(await page.locator('[data-notes-widget]').isHidden());
    assert.match(await page.locator('.dash-continue').textContent(), /Fotossíntese/);
    await shot(page, 'inicio-recursos-desligados-1280');
    await page.goto(base + '/planejar.html');
    await page
      .locator('[data-tool-unavailable]', { hasText: 'O planejamento ainda não está ativo' })
      .waitFor();
    record(
      'Flags desligadas: menu sem Revisar/Planejar, Início só com aula e Biblioteca, página direta explica que o recurso não está ativo',
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} navigation and journey checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
