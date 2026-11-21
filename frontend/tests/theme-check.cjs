// Main pages in the dark and both high-contrast themes, with a simulated API: axe (WCAG 2.2 A/AA,
// including contrast) on the whole page. Nothing here calls a real backend or Supabase project.
const assert = require('node:assert/strict');
const {
  state,
  errors,
  record,
  axeCheck,
  openApp,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const PAGES = [
  'painel.html',
  'historico.html',
  'material.html?id=l-foto',
  'revisar.html#flashcards',
  'planejar.html#calendario',
  'configuracoes.html',
  'conta.html',
  'nova-transcricao.html',
];

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    for (const theme of ['night', 'contrast-dark', 'contrast-light']) {
      const { page, context } = await openApp(browser, base, allFlags, state());
      await page.addInitScript((value) => localStorage.setItem('audioestudo-theme', value), theme);
      for (const url of PAGES) {
        await page.goto(`${base}/${url}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
        await axeCheck(page, 'body', `${url} (${theme})`);
      }
      await context.close();
    }
    record(
      'Tema noturno e contrastes claro e escuro: 8 páginas sem violações do axe (WCAG 2.2 A/AA)',
    );
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(
    errors.filter((e) => !/Sem simulação|404/.test(e)),
    [],
    'browser errors',
  );
  console.log('theme checks passed');
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
