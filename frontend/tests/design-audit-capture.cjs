// Design audit capture (not part of test:browser): screenshots of the key pages and states with
// the simulated app (support/mock-app.cjs), synthetic data only. Usage:
//   BROWSER_EXECUTABLE=... node frontend/tests/design-audit-capture.cjs <before|after> [filter]
// Writes JPEG (quality 72, deviceScaleFactor 1) to docs/design-audit/<set>/.
const path = require('node:path');
const fs = require('node:fs');
const { state, openApp, settle, allFlags, startServer, launchBrowser } = require('./support/mock-app.cjs');

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
  ['revisar', '/revisar.html#flashcards', KEY],
  ['revisar-questoes', '/revisar.html#questoes', KEY],
  ['revisar-anotacoes', '/revisar.html#anotacoes', KEY],
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
  // 3.5 M5 (Personalization): the escrivaninha, the Creative Studio and the atmospheres.
  ['escrivaninha', '/painel.html', KEY, { full: false }],
  ['escrivaninha-biblioteca-chuvosa', '/painel.html', KEY, { full: false, prefs: { atmosphere: 'rainy-library' } }],
  ['escrivaninha-inverno', '/painel.html', KEY, { full: false, prefs: { atmosphere: 'cozy-winter', decoration: 'abundant' } }],
  ['escrivaninha-jardim-noturno', '/painel.html', KEY, { full: false, theme: 'night', prefs: { atmosphere: 'night-garden' } }],
  ['escrivaninha-caderno-antigo', '/painel.html', [1440], { full: false, prefs: { atmosphere: 'old-notebook' } }],
  ['escrivaninha-pastel', '/painel.html', [1440], { full: false, prefs: { atmosphere: 'dreamy-pastel' } }],
  ['escrivaninha-beira-mar', '/painel.html', [1440], { full: false, prefs: { atmosphere: 'seaside' } }],
  ['escrivaninha-matcha-aventura', '/painel.html', [1440], { full: false, discoveries: true, prefs: { atmosphere: 'matcha-afternoon', experience: 'adventure' } }],
  ['escrivaninha-silencioso', '/painel.html', KEY, { full: false, prefs: { experience: 'quiet' } }],
  ['escrivaninha-arrumando', '/painel.html', KEY, { full: false, discoveries: true, prefs: { atmosphere: 'lavender-desk', decoration: 'abundant' },
    act: async (p) => { await p.getByRole('button', { name: 'Arrumar a mesa' }).click(); await p.locator('[data-desk-object="object.globe"]').click(); } }],
  ['escrivaninha-inicio-completo', '/painel.html', KEY, { prefs: { atmosphere: 'rainy-library' } }],
  ['estudio-simples', '/aparencia.html', KEY, { full: false, discoveries: true, prefs: { atmosphere: 'lavender-desk' },
    act: (p) => p.locator('[data-creative-studio]').scrollIntoViewIfNeeded() }],
  ['estudio-detalhes', '/aparencia.html', KEY, { full: false, discoveries: true, prefs: { atmosphere: 'cozy-winter' },
    act: async (p) => { await p.locator('input[name="studio-view"][value="studio"]').check(); await p.locator('[data-studio-detail]').scrollIntoViewIfNeeded(); } }],
  ['biblioteca-pastas-coloridas', '/historico.html', KEY],
  // 3.5 M8 (Refinement): the art-directed desk, Planejar/Focar/Turmas, the selection toolbar,
  // Descobertas and Gabinete. `before` was taken from feat/3.5-experience with this same list.
  ['m8-escrivaninha', '/painel.html', KEY, { full: false }],
  ['m8-escrivaninha-jardim-noturno', '/painel.html', KEY, { full: false, theme: 'night', prefs: { atmosphere: 'night-garden' } }],
  ['m8-escrivaninha-biblioteca-chuvosa', '/painel.html', KEY, { full: false, prefs: { atmosphere: 'rainy-library', decoration: 'abundant' } }],
  ['m8-escrivaninha-luminaria', '/painel.html', KEY, { full: false, discoveries: true, act: placeLamp }],
  ['m8-escrivaninha-luminaria-noite', '/painel.html', KEY, { full: false, discoveries: true, theme: 'night', prefs: { atmosphere: 'night-garden' }, act: placeLamp }],
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
];

async function placeLamp(page) {
  await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
  await page.locator('[data-desk-object="object.desk-lamp"]').click();
  await page.locator('[data-desk-slot="lamp-corner"] .desk-slot-target').click();
  await page.locator('[data-desk-object="object.globe"]').click();
  await page.locator('[data-desk-slot="desk-center"] .desk-slot-target').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Concluir' }).click();
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
