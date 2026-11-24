// Design audit capture (not part of test:browser): screenshots of the key pages and states with
// the simulated app (support/mock-app.cjs), synthetic data only. Usage:
//   BROWSER_EXECUTABLE=... node frontend/tests/design-audit-capture.cjs <before|after> [filter]
// Writes JPEG (quality 72, deviceScaleFactor 1) to docs/design-audit/<set>/.
const path = require('node:path');
const fs = require('node:fs');
const { state, openApp, settle, allFlags, startServer, launchBrowser } = require('./support/mock-app.cjs');
const { populated, ID } = require('./support/cabinet-fixtures.cjs');

const set = process.argv[2] || 'after';
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const output = path.resolve(__dirname, '../../docs/design-audit', set);
fs.mkdirSync(output, { recursive: true });
const flags = { ...allFlags, classrooms: true, multi_lesson: true, flashcards_v3: true };
const ALL = [390, 768, 1024, 1440, 1920];
const KEY = [390, 1440];

const empty = async (context, base) => {
  await context.route(base + '/api/materials', (route) => route.fulfill({ json: [] }));
  await context.route(base + '/api/catalog', (route) => route.fulfill({ json: { subjects: [], units: [] } }));
};
const signedOut = async (context) => context.addInitScript(() => localStorage.setItem('mock-signed-out', '1'));
const failAll = async (context, base) => {
  await context.route(base + '/api/materials', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Serviço indisponível agora.' } } }),
  );
};

// [name, url, widths, options]
const shots = [
  ['inicio', '/painel.html', ALL],
  ['inicio-vazio', '/painel.html', KEY, { prepare: empty }],
  ['inicio-erro', '/painel.html', KEY, { prepare: failAll, data: (d) => ((d.failPlanning = true), d) }],
  ['inicio-personalizar', '/painel.html', KEY, { act: (p) => p.locator('[data-dashboard-customize]').click(), full: false }],
  ['biblioteca', '/historico.html', ALL],
  ['biblioteca-pasta', '/historico.html?folder=sub-bio&unit=unit-energia', KEY],
  ['biblioteca-vazia', '/historico.html', KEY, { prepare: empty }],
  ['biblioteca-erro', '/historico.html', KEY, { prepare: failAll }],
  ['material-transcricao', '/material.html?id=l-foto#transcricao', ALL],
  ['material-resumo', '/material.html?id=l-foto#resumo', KEY],
  ['material-questoes', '/material.html?id=l-foto#questoes', KEY, { data: (d) => ((d.lessonStage = { 'l-foto': 'questions' }), d) }],
  ['material-flashcards', '/material.html?id=l-foto#flashcards', KEY],
  ['material-anotacoes', '/material.html?id=l-foto#anotacoes', KEY],
  ['material-pendente', '/material.html?id=l-rev', KEY, { data: (d) => ((d.lessonStage = { 'l-rev': 'pending' }), d) }],
  ['nova-transcricao', '/nova-transcricao.html', KEY],
  ['processando', '/processando.html?id=l-foto&job=job-1', KEY],
  ['revisar', '/flashcards.html#revisar', KEY],
  ['flashcards-aparencia', '/flashcards.html#aparencia', KEY],
  ['flashcards-criar', '/flashcards.html#criar', KEY],
  ['planejar', '/planejar.html#tarefas', KEY],
  ['planejar-calendario', '/planejar.html#calendario', KEY],
  ['focar', '/focar.html', KEY],
  ['turmas', '/turmas.html', KEY],
  ['integrado', '/integrado.html', KEY],
  ['conta', '/conta.html', KEY],
  ['configuracoes', '/configuracoes.html', KEY],
  ['aparencia', '/aparencia.html', KEY],
  ['ajuda', '/ajuda.html', KEY],
  ['landing', '/index.html', KEY, { prepare: signedOut }],
  ['login', '/login.html', KEY, { prepare: signedOut }],
  ['cadastro', '/cadastro.html', KEY, { prepare: signedOut }],
  ['inicio-noturno', '/painel.html', KEY, { theme: 'night' }],
  ['material-noturno', '/material.html?id=l-foto#resumo', [1440], { theme: 'night' }],
  ['inicio-contraste', '/painel.html', [1440], { theme: 'contrast-light' }],
  // 3.5 M5 (Personalization), since 3.7 without the escrivaninha: Início (a dashboard) under the
  // atmospheres and the experience modes; the Creative Studio and the atmospheres.
  ['3-7-inicio-biblioteca-chuvosa', '/painel.html', KEY, { full: false, prefs: { atmosphere: 'rainy-library' } }],
  ['3-7-inicio-inverno', '/painel.html', KEY, { full: false, prefs: { atmosphere: 'cozy-winter', decoration: 'abundant' } }],
  ['3-7-inicio-jardim-noturno', '/painel.html', KEY, { full: false, theme: 'night', prefs: { atmosphere: 'night-garden' } }],
  ['3-7-inicio-matcha-aventura', '/painel.html', [1440], { full: false, discoveries: true, prefs: { atmosphere: 'matcha-afternoon', experience: 'adventure' } }],
  ['3-7-inicio-silencioso', '/painel.html', KEY, { full: false, prefs: { experience: 'quiet' } }],
  ['3-7-inicio-completo', '/painel.html', KEY, { prefs: { atmosphere: 'rainy-library' } }],
  ['estudio-simples', '/aparencia.html', KEY, { full: false, discoveries: true, prefs: { atmosphere: 'lavender-desk' },
    act: (p) => p.locator('[data-creative-studio]').scrollIntoViewIfNeeded() }],
  ['estudio-detalhes', '/aparencia.html', KEY, { full: false, discoveries: true, prefs: { atmosphere: 'cozy-winter' },
    act: async (p) => { await p.locator('input[name="studio-view"][value="studio"]').check(); await p.locator('[data-studio-detail]').scrollIntoViewIfNeeded(); } }],
  ['biblioteca-pastas-coloridas', '/historico.html', KEY],
  // 3.5 M8 (Refinement): Planejar/Focar/Turmas, the selection toolbar, Descobertas and Gabinete
  // (the art-directed desk captures left with the desk in 3.7). `before` was taken from
  // feat/3.5-experience with this same list.
  ['m8-planejar', '/planejar.html#tarefas', KEY],
  ['m8-planejar-calendario', '/planejar.html#calendario', KEY],
  ['m8-planejar-vazio', '/planejar.html#tarefas', KEY, { data: (d) => Object.assign(d, { goals: [], subgoals: [], tasks: [] }) }],
  ['m8-focar', '/focar.html', KEY],
  ['m8-turmas', '/turmas.html', KEY, { data: withClassrooms }],
  ['m8-turma', '/turmas.html?turma=room-bio', KEY, { data: withClassrooms }],
  ['m8-turmas-vazia', '/turmas.html', KEY],
  ['m8-selecao', '/material.html?id=l-foto', KEY, { full: false, discoveries: true, act: selectPassage }],
  ['m8-descobertas', '/descobertas.html', KEY, { discoveries: true, data: withDiscoveries }],
  ['m8-descobertas-vazio', '/descobertas.html', KEY, { discoveries: 'none' }],
  ['m8-gabinete', '/gabinete.html', KEY, { discoveries: true }],
  // 3.6 (UX fixes): selection in the Biblioteca, discipline interiors, Revisar, Planejar vs
  // Focar (arranging the desk left with the desk in 3.7). `before` was taken from feat/3.6-scrapbook with this same list.
  ['3-6-biblioteca-selecao', '/historico.html', KEY, { data: richLibrary, act: selectFolder }],
  ['3-6-biblioteca-disciplina', '/historico.html?folder=sub-bio', KEY, { data: richLibrary }],
  ['3-6-biblioteca-unidade-selecao', '/historico.html?folder=sub-bio&unit=unit-energia', KEY, { data: richLibrary, act: selectLesson }],
  ['3-6-biblioteca-disciplina-vazia', '/historico.html?folder=sub-geo', KEY, { data: (d) => ((d.catalog = { ...CATALOG_WITH_EMPTY }), d) }],
  ['3-6-revisar', '/flashcards.html#revisar', KEY],
  ['3-6-flashcards-conjuntos', '/flashcards.html#conjuntos', KEY],
  ['3-6-flashcards-importar', '/flashcards.html#importar', KEY],
  ['3-6-planejar-tempo', '/planejar.html#tempo', KEY],
  ['3-6-focar', '/focar.html', KEY],
  ['3-6-foco-em-andamento', '/focar.html', KEY, { full: false, act: runFocusThenLibrary }],
  // 3.6 Milestone E: the cabinet of curiosities, the archive of evolving cards, the investigation.
  ['3-6-gabinete', '/gabinete.html?gaveta=stamp', KEY, { discoveries: 'rich', data: populated }],
  ['3-6-gabinete-especimes', '/gabinete.html?gaveta=specimen', KEY, { discoveries: 'rich', data: populated }],
  ['3-6-gabinete-objeto', '/gabinete.html?gaveta=object', KEY, { discoveries: 'rich', data: populated, full: false,
    act: (p) => p.locator('.cabinet-item[data-collectible="object.globe"]').click() }],
  ['3-6-gabinete-vazio', '/gabinete.html', KEY, { discoveries: 'none', data: (d) => ((d.seedUnlocks = []), d) }],
  ['3-6-gabinete-noturno', '/gabinete.html?gaveta=specimen', [1440], { discoveries: 'rich', data: populated, theme: 'night' }],
  ['3-6-descobertas', '/descobertas.html', KEY, { discoveries: 'rich', data: populated }],
  ['3-6-descobertas-ligacoes', '/descobertas.html', KEY, { discoveries: 'rich', data: populated, act: (p) => p.getByRole('tab', { name: 'Ligações' }).click() }],
  ['3-6-descobertas-colecoes', '/descobertas.html', KEY, { discoveries: 'rich', data: populated, prefs: { discoveryCollections: [{ id: 'c-energia', name: 'Energia na natureza', ids: [ID(1), ID(2), ID(3)] }] },
    act: (p) => p.getByRole('tab', { name: 'Coleções' }).click() }],
  ['3-6-descobertas-vazio', '/descobertas.html', KEY, { discoveries: 'none', data: (d) => ((d.seedUnlocks = []), d) }],
  ['3-6-descoberta', `/descobertas.html?id=${ID(1)}`, KEY, { discoveries: 'rich', data: populated }],
  ['3-6-investigacao', `/investigar.html?id=${ID(4)}&etapa=evidencias`, KEY, { discoveries: 'rich', data: populated }],
];

const CATALOG_WITH_EMPTY = {
  subjects: [
    { id: 'sub-bio', name: 'Biologia', color_token: null, sort_order: 0 },
    { id: 'sub-geo', name: 'Geografia', color_token: null, sort_order: 1 },
  ],
  units: [],
};
function richLibrary(d) {
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const lesson = (id, title, unit, days, ms) => ({ id, title, subject: 'Biologia', subject_id: 'sub-bio', unit_id: unit, status: 'PRONTO', created_at: ago(days), audio_files: [{ duration_ms: ms, extension: 'mp3' }] });
  d.extraMaterials = [
    lesson('l-ciclo', 'Ciclo de Krebs', 'unit-energia', 2, 1640000),
    lesson('l-ferm', 'Fermentação láctica e alcoólica', 'unit-energia', 4, 1210000),
    lesson('l-memb', 'Membrana plasmática', 'unit-celula', 6, 1985000),
    lesson('l-orga', 'Organelas e suas funções', 'unit-celula', 8, 2260000),
    lesson('l-vir', 'Vírus: estrutura e replicação', null, 10, 1510000),
  ];
  return d;
}
async function selectFolder(page) {
  await page.getByRole('button', { name: 'Selecionar' }).click();
  await page.locator('.library-subject-folder > summary', { hasText: 'Biologia' }).click();
  await page.waitForTimeout(300);
}
async function selectLesson(page) {
  await page.getByRole('button', { name: 'Selecionar' }).click();
  // Click the titles: before 3.6 this opened the lesson instead of selecting it.
  for (const title of ['Ciclo de Krebs', 'Fermentação láctica e alcoólica']) {
    await page.getByRole('link', { name: title, exact: true }).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForLoadState('networkidle');
}
async function runFocusThenLibrary(page) {
  await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).click();
  await page.waitForTimeout(1500);
  await page.goto(page.url().replace(/focar\.html.*/, 'historico.html'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}
async function selectPassage(page) {
  const paragraph = page.locator('.transcription-segment .segment-text').first();
  await paragraph.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, -120));
  await paragraph.evaluate((node) => {
    const text = node.firstChild;
    const start = text.textContent.indexOf('energia luminosa');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'energia luminosa'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}
function withClassrooms(d) {
  const member = (userId, displayName, role) => ({ userId, displayName, role, status: 'active' });
  const lesson = (id, title, ownerId) => ({ id, title, source: 'teacher', status: 'published', ownerId, text: 'A fotossíntese converte energia luminosa.', questionBatchIds: [] });
  const room = (id, name, description, members, lessons, resources = []) => ({ id, name, description, status: 'active', members, invites: [], lessons, submissions: [], shared: [], resources });
  d.classrooms = {
    requests: [],
    rooms: [
      room('room-bio', 'Biologia 2º ano B', 'Aulas de citologia e metabolismo, com listas para a prova.',
        [member('user-dashboard', 'Marina Alves', 'teacher'), member('s1', 'Caio Lima', 'student'), member('s2', 'Bia Rocha', 'student')],
        [lesson('cl-1', 'Fotossíntese e respiração celular', 'user-dashboard'), lesson('cl-2', 'Membrana plasmática', 'user-dashboard')],
        [{ id: 'r1', title: 'Guia de estudos (PDF)', url: 'https://example.com/guia', description: 'Roteiro da unidade.' }]),
      room('room-hist', 'Grupo de História', '', [member('s3', 'Prof. Rui', 'teacher'), member('user-dashboard', 'Marina Alves', 'student')], [lesson('cl-3', 'Revolução Industrial', 's3')]),
    ],
  };
  return d;
}
function withDiscoveries(d) {
  const earlier = new Date(Date.now() - 5 * 86400000).toISOString();
  d.seedDiscoveries = [
    { id: '0b1c2d3e-0000-4000-8000-000000000001', materialId: 'l-rev', title: 'De onde vinha a energia das fábricas?', explanation: 'O carvão guardava energia química que as máquinas a vapor transformavam em trabalho.', quote: 'máquina a vapor', createdAt: earlier },
    { id: '0b1c2d3e-0000-4000-8000-000000000002', materialId: 'l-foto', title: 'Por que a folha é verde?', explanation: 'A clorofila absorve o vermelho e o azul e reflete o verde.', quote: 'energia luminosa', createdAt: new Date().toISOString() },
  ];
  return d;
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  let count = 0;
  try {
    for (const [name, url, widths, options = {}] of shots) {
      if (filter && !filter.test(name)) continue;
      for (const width of widths) {
        const data = options.data ? options.data(state()) : state();
        if (options.discoveries === true)
          data.seedUnlocks = [
            { id: 'object.globe', kind: 'object', occurredAt: '2026-11-18T14:00:00Z', lessonTitle: 'Fotossíntese e respiração celular' },
            { id: 'object.magnifying-glass', kind: 'object', occurredAt: '2026-11-19T14:00:00Z', lessonTitle: 'Fotossíntese e respiração celular' },
            { id: 'object.desk-lamp', kind: 'object', occurredAt: '2026-11-19T14:00:00Z', lessonTitle: 'Fotossíntese e respiração celular' },
            { id: 'stamp.first-evidence', kind: 'stamp', occurredAt: '2026-11-18T14:00:00Z' },
          ];
        const { context, page } = await openApp(browser, base, { ...flags, discoveries: Boolean(options.discoveries) }, data, { width, height: width < 700 ? 844 : 1000 }, { context: { timezoneId: 'America/Sao_Paulo' } });
        if (options.prepare) await options.prepare(context, base);
        if (options.prefs)
          await context.addInitScript((prefs) => {
            const current = JSON.parse(localStorage.getItem('audioestudo-ui-preferences') || '{}');
            localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ ...current, ...prefs }));
          }, options.prefs);
        if (options.theme)
          await context.addInitScript((theme) => localStorage.setItem('audioestudo-theme', theme), options.theme);
        try {
          await page.goto(base + url);
          await settle(page);
          await page.waitForTimeout(500);
          if (options.act) {
            await options.act(page);
            await page.waitForTimeout(400);
          }
          await page.screenshot({
            path: path.join(output, `${name}-${width}.jpg`),
            type: 'jpeg',
            quality: 72,
            fullPage: options.full !== false,
          });
          count++;
        } catch (error) {
          console.error('FAIL', name, width, error.message.split('\n')[0]);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${count} screenshots in ${output}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
