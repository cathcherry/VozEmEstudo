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
    if (p === '/api/flashcards/sets') return json([]);
    if (p === '/api/flashcards' && method === 'GET') {
      const filter = url.searchParams.get('filter');
      const cards = filter === 'due' ? data.dueCards : data.dueCards;
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

async function main() {
  const app = express();
  app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(root, 'assets/brand/favicon.png')));
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.use('/js', express.static(path.join(root, 'js')));
  app.use('/css', express.static(path.join(root, 'css')));
  app.use(express.static(path.join(root, 'pages')));
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
  };
  try {
    // ---------- All study tools enabled -------------------------------------------------
    const data = state();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    await setup(context, base, allFlags, data);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.stack || e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text()))
        errors.push(m.text());
    });
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-tasks-widget]:not([hidden])').waitFor();
    await page.locator('[data-cards-widget]:not([hidden])').waitFor();
    await page.locator('[data-events-widget] .dash-agenda-list').waitFor();
    await page.locator('[data-week-widget]:not([hidden]) .dash-day-bar').first().waitFor();
    await page.locator('[data-notes-widget]:not([hidden])').waitFor();

    assert.equal(await page.locator('dialog[open]').count(), 0, 'no workspace is open by default');
    for (const form of [
      '[data-planning-goal-form]',
      '[data-flashcard-create-form]',
      '.calendar-event-form',
      '.study-settings',
    ])
      assert(!(await page.locator(form).isVisible()), `${form} is hidden until requested`);
    assert.match(
      await page.locator('.dash-continue').textContent(),
      /Fotossíntese e respiração celular/,
    );
    assert.match(
      await page.locator('[data-pulse="tasks"]').textContent(),
      /3\s+tarefas pendentes \(1 atrasada\)/,
    );
    assert.match(
      await page.locator('[data-pulse="cards"]').textContent(),
      /5\s+cartões para revisar/,
    );
    assert.match(
      await page.locator('[data-pulse="week"]').textContent(),
      /95\s+de 150 min na semana/,
    );
    assert.match(await page.locator('[data-tasks-preview]').textContent(), /Atrasada desde/);
    assert.match(await page.locator('[data-events-preview]').textContent(), /Estudar fotossíntese/);
    assert.match(await page.locator('[data-notes-summary]').textContent(), /7 anotações salvas/);
    assert.equal(await page.locator('[data-recent-list] .dashboard-lesson-card').count(), 4);
    const desktopHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    record(
      `Painel com todos os recursos: resumo real de tarefas, cartões, semana, agenda e anotações; nenhum formulário aberto (altura ${desktopHeight}px)`,
    );
    // Hovering the hero (and its progress bar) must not move or hide its content.
    const hero = page.locator('.dash-continue .dashboard-lesson-card');
    const before = await hero.locator('.dashboard-lesson-percent').boundingBox();
    for (const target of [hero.locator('.dashboard-lesson-title'), hero.locator('.dashboard-lesson-playback progress')]) {
      await target.hover();
      await page.waitForTimeout(250);
      const after = await hero.locator('.dashboard-lesson-percent').boundingBox();
      const card = await hero.boundingBox();
      assert(Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, 'progress text stays in place on hover');
      assert(after.x >= card.x, 'progress text stays inside the card');
      assert.equal(await hero.locator('.dashboard-lesson-cue').evaluate((n) => getComputedStyle(n).opacity), '1');
    }
    await page.mouse.move(0, 0);
    record('Continuar estudando: passar o mouse não desloca nem esconde o progresso e o botão');
    await axeCheck(page, 'body', 'dashboard');
    record('Painel sem violações automáticas WCAG A/AA (axe-core)');
    await page.screenshot({ path: path.join(output, 'painel-1440.png'), fullPage: true });

    // Planning workspace: open, one form at a time, Escape layers, focus restoration.
    const openPlanning = page.locator('[data-tasks-widget] button', {
      hasText: 'Abrir planejamento',
    });
    await openPlanning.focus();
    await page.keyboard.press('Enter');
    await page.locator('#workspace-planning[open]').waitFor();
    await page.locator('#workspace-planning .planning-goal').first().waitFor();
    assert(!(await page.locator('[data-planning-goal-form]').isVisible()));
    await page.locator('[data-planning-open="goal"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'planning-goal-title');
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('#workspace-planning[open]').count(),
      1,
      'Escape closes the form first',
    );
    assert(!(await page.locator('[data-planning-goal-form]').isVisible()));
    assert.match(await focusedText(page), /Novo objetivo/);
    await page
      .getByRole('button', { name: 'Adicionar tarefa em Terminar o módulo de História' })
      .click();
    assert.equal(await page.locator('#planning-task-goal').inputValue(), 'g2');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'planning-task-title');
    await page.locator('[data-planning-task-form] [data-planning-cancel]').click();
    await page.locator('[data-planning-open="goal"]').click();
    await page.locator('#planning-goal-title').fill('Preparar seminário de Física');
    await page.locator('[data-planning-goal-form] [type=submit]').click();
    await page.locator('[data-planning-status]', { hasText: 'Objetivo criado' }).waitFor();
    assert.equal(data.createdGoals.length, 1);
    assert(
      !(await page.locator('[data-planning-goal-form]').isVisible()),
      'form closes after creating',
    );
    await page.screenshot({ path: path.join(output, 'workspace-planejamento-1440.png') });
    await axeCheck(page, '#workspace-planning', 'planning workspace');
    await page.keyboard.press('Escape');
    await page
      .locator('#workspace-planning[open]')
      .waitFor({ state: 'detached' })
      .catch(() => {});
    assert.equal(await page.locator('#workspace-planning[open]').count(), 0);
    assert.match(await focusedText(page), /Abrir planejamento/);
    record(
      'Planejamento: formulários sob demanda, ações por objetivo, Esc em camadas e foco devolvido ao botão de origem',
    );

    // Flashcards: review straight from the dashboard.
    await page.locator('[data-cards-review]').click();
    await page.locator('#workspace-flashcards[open]').waitFor();
    await page.waitForTimeout(350);
    assert.match(await focusedText(page), /Revelar resposta/);
    assert(!(await page.locator('[data-flashcard-create-form]').isVisible()), 'manual form folded');
    await page.keyboard.press('Enter');
    assert.match(await focusedText(page), /De novo|Difícil|Bom|Fácil/);
    await page.screenshot({ path: path.join(output, 'workspace-flashcards-1440.png') });
    await page.getByRole('button', { name: 'Bom', exact: true }).click();
    await page
      .locator('[data-flashcard-review-status]', { hasText: 'Revisão registrada' })
      .waitFor();
    assert.equal(data.reviews, 1);
    assert.match(await focusedText(page), /Revelar resposta/);
    await axeCheck(page, '#workspace-flashcards', 'flashcards workspace');
    await page.locator('#workspace-flashcards [data-workspace-close]').click();
    assert.match(
      await page.locator('[data-pulse="cards"]').textContent(),
      /4\s+cartões para revisar/,
    );
    record(
      'Flashcards: "Revisar agora" abre a revisão com foco, avaliação registrada e contagem do painel atualizada',
    );

    // Calendar: schedule from the dashboard.
    const queriesBefore = data.calendarQueries;
    await page.locator('[data-events-widget] button', { hasText: 'Agendar estudo' }).click();
    await page.locator('#workspace-calendar[open]').waitFor();
    await page.locator('#workspace-calendar .study-calendar-grid button').first().waitFor();
    assert(
      await page.locator('#workspace-calendar details.calendar-compose').evaluate((d) => d.open),
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.closest('form')?.className),
      'calendar-event-form',
    );
    await page.keyboard.type('Revisar funções');
    const local = (offset, hour) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${day(offset)}T${String(hour).padStart(2, '0')}:00`;
    };
    await page.locator('#workspace-calendar input[type=datetime-local]').nth(0).fill(local(2, 10));
    await page.locator('#workspace-calendar input[type=datetime-local]').nth(1).fill(local(2, 11));
    await page.locator('#workspace-calendar .calendar-event-form [type=submit]').click();
    await page.locator('#workspace-calendar [role=status]', { hasText: 'Horário salvo' }).waitFor();
    await page.screenshot({ path: path.join(output, 'workspace-calendario-1440.png') });
    await axeCheck(page, '#workspace-calendar', 'calendar workspace');
    await page.keyboard.press('Escape');
    await page.locator('[data-events-preview]', { hasText: 'Revisar funções' }).waitFor();
    assert(data.calendarQueries > queriesBefore);
    record(
      'Calendário: "Agendar estudo" abre o formulário com foco, salva e a agenda do painel se atualiza',
    );

    // Study time: the timer keeps running with the sheet closed.
    await page.locator('[data-timer-toggle]').click();
    await page.locator('[data-week-timer].is-running').waitFor();
    assert.equal(data.sessions, 1);
    await page.locator('[data-week-widget] [data-open-workspace="tracking"]').click();
    await page.locator('#workspace-tracking[open]').waitFor();
    await page.waitForTimeout(350);
    assert(
      !(await page.locator('#workspace-tracking .study-settings').isVisible()),
      'goal settings folded',
    );
    await page.screenshot({ path: path.join(output, 'workspace-tempo-1440.png') });
    await axeCheck(page, '#workspace-tracking', 'tracking workspace');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2200);
    assert(
      await page.locator('[data-week-timer].is-running').count(),
      'timer still running after closing the sheet',
    );
    assert.notEqual(await page.locator('[data-timer-clock]').textContent(), '00:00');
    await page.locator('[data-timer-toggle]').click();
    await page.locator('[data-week-timer]:not(.is-running)').waitFor();
    assert(data.ticks.length > 0);
    record(
      'Tempo de estudo: iniciar/pausar no painel; a sessão continua ao fechar o painel lateral',
    );

    // Annotations through the existing global search.
    await page.locator('.topbar-search input').fill('energia');
    await page.locator('.topbar-search input').press('Enter');
    await page.getByRole('tab', { name: /Anotações/ }).click();
    await page.locator('.search-note', { hasText: 'Cai na prova!' }).waitFor();
    await page.locator('#search-panel-notes button', { hasText: 'anotaç' }).click();
    await page.locator('#workspace-notes[open]').waitFor();
    assert.equal(await page.locator('#workspace-notes input[type=search]').inputValue(), 'energia');
    await page.locator('#workspace-notes .annotation-card').first().waitFor();
    await page.screenshot({ path: path.join(output, 'workspace-anotacoes-1440.png') });
    await axeCheck(page, '#workspace-notes', 'notes workspace');
    await page.keyboard.press('Escape');
    record(
      'Anotações: aba na busca global e painel completo com a mesma busca, sem um segundo campo de busca no painel',
    );

    // Widths, zoom and preferences.
    await page.goto(base + '/painel.html');
    await ready(page);
    for (const [width, height, name] of [
      [1920, 1080, 'painel-1920'],
      [1280, 800, 'painel-1280'],
      [834, 1112, 'painel-tablet-834'],
      [390, 844, 'painel-mobile-390'],
      [640, 800, 'painel-zoom200-640'],
      [320, 640, 'painel-320'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(350);
      await noHorizontalScroll(page, name);
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tasks-widget] button', { hasText: 'Abrir planejamento' }).click();
    await page.locator('#workspace-planning[open]').waitFor();
    await noHorizontalScroll(page, 'planning sheet on phone');
    const sheet = await page.locator('#workspace-planning').boundingBox();
    assert(sheet.width >= 389, 'sheet fills the phone screen');
    await page.screenshot({ path: path.join(output, 'workspace-planejamento-mobile-390.png') });
    await page.keyboard.press('Escape');
    await page.locator('[data-cards-review]').click();
    await page.locator('#workspace-flashcards[open]').waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, 'workspace-flashcards-mobile-390.png') });
    await page.keyboard.press('Escape');
    record(
      'Sem rolagem horizontal em 1920, 1280, 834, 640 (zoom 200%), 390 e 320 px; painéis laterais em tela cheia no celular',
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [attr, value, name] of [
      ['data-theme', 'night', 'painel-tema-noturno'],
      ['data-high-contrast', 'true', 'painel-alto-contraste'],
      ['data-focus-mode', 'true', 'painel-modo-foco'],
    ]) {
      await page.evaluate(([a, v]) => document.documentElement.setAttribute(a, v), [attr, value]);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      await page.evaluate(([a]) => document.documentElement.removeAttribute(a), [attr]);
    }
    record('Tema noturno, alto contraste e modo foco renderizados');
    await context.close();

    // ---------- Fallback: study tools disabled ------------------------------------------
    const offContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await setup(offContext, base, {}, state());
    const off = await offContext.newPage();
    off.on('pageerror', (e) => errors.push(e.stack || e.message));
    await off.goto(base + '/painel.html');
    await ready(off);
    await off.waitForTimeout(600);
    assert(await off.locator('[data-plan-section]').isHidden());
    assert(await off.locator('[data-week-widget]').isHidden());
    assert(await off.locator('[data-dash-pulse]').isHidden());
    assert(await off.locator('[data-notes-widget]').isHidden());
    assert.match(await off.locator('.dash-continue').textContent(), /Fotossíntese/);
    assert.equal(await off.locator('[data-recent-list] .dashboard-lesson-card').count(), 4);
    await off.screenshot({
      path: path.join(output, 'painel-recursos-desligados-1280.png'),
      fullPage: true,
    });
    record(
      'Flags desligadas: só aparecem aula em andamento e Biblioteca; nenhum resumo ou botão sem função',
    );
    await offContext.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} dashboard checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
