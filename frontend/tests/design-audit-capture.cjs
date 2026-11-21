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
];

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  let count = 0;
  try {
    for (const [name, url, widths, options = {}] of shots) {
      if (filter && !filter.test(name)) continue;
      for (const width of widths) {
        const data = options.data ? options.data(state()) : state();
        const { context, page } = await openApp(browser, base, flags, data, { width, height: width < 700 ? 844 : 1000 });
        if (options.prepare) await options.prepare(context, base);
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
