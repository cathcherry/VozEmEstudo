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
    // Personalização 3.0: the new themes with wallpapers and glass surfaces stay accessible.
    for (const [theme, wallpaper, surfaces] of [
      ['matcha', 'meadow', 'glass'],
      ['desktop', 'desktop', 'glass'],
      ['planner', 'grid', 'solid'],
    ]) {
      const { page, context } = await openApp(browser, base, allFlags, state());
      await page.addInitScript(
        ([value, ui]) => {
          localStorage.setItem('audioestudo-theme', value);
          localStorage.setItem('audioestudo-ui-preferences', JSON.stringify(ui));
        },
        [theme, { wallpaper, surfaces }],
      );
      for (const url of [...PAGES, 'focar.html']) {
        await page.goto(`${base}/${url}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
        const root = await page.evaluate(() => ({ ...document.documentElement.dataset }));
        assert.equal(root.theme, theme);
        assert.equal(root.wallpaper, wallpaper);
        await axeCheck(page, 'body', `${url} (${theme}, ${wallpaper}, ${surfaces})`);
      }
      await context.close();
    }
    record('Temas Matcha, Mesa digital e Planner com fundos e superfícies de vidro: sem violações do axe');
    // Per-page wallpaper, unknown values ignored, and a reset that keeps reading settings.
    {
      const { page, context } = await openApp(browser, base, allFlags, state());
      await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('audioestudo-theme', 'planner');
        localStorage.setItem(
          'audioestudo-ui-preferences',
          JSON.stringify({
            wallpaper: 'dots',
            textSize: 'large',
            pageWallpapers: { focus: 'stars', library: 'javascript:alert(1)', unknown: 'grid' },
          }),
        );
      });
      await page.goto(`${base}/focar.html`);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.wallpaper), 'stars');
      await page.goto(`${base}/historico.html`);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.wallpaper), 'dots', 'invalid override ignored');
      await page.goto(`${base}/aparencia.html`);
      await page.locator('[data-reset-visual]').click();
      const after = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        wallpaper: document.documentElement.dataset.wallpaper,
        textSize: document.documentElement.dataset.textSize,
        saved: JSON.parse(localStorage.getItem('audioestudo-ui-preferences')),
      }));
      assert.equal(after.theme, 'paper');
      assert.equal(after.wallpaper, 'none');
      assert.equal(after.textSize, 'large', 'reading settings are kept');
      assert.deepEqual(after.saved.pageWallpapers, {});
      await context.close();
    }
    record('Fundo por página, valores desconhecidos ignorados e "Restaurar visual padrão" sem mexer na leitura');
    // Own image as wallpaper: saved for the account, shown on other pages, invalid files refused.
    {
      const { page, context } = await openApp(browser, base, allFlags, state());
      await page.goto(`${base}/aparencia.html`);
      const picker = page.locator('[data-wallpaper-image] input[type=file]');
      await picker.setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('oi') });
      await page.locator('[data-wallpaper-image-status]', { hasText: 'PNG, JPEG, WebP ou GIF' }).waitFor();
      // A 1×1 PNG.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      await picker.setInputFiles({ name: 'fundo.png', mimeType: 'image/png', buffer: png });
      await page.waitForFunction(() => document.documentElement.dataset.wallpaper === 'image' && document.documentElement.style.getPropertyValue('--user-wallpaper').startsWith('url('));
      await page.goto(`${base}/painel.html`);
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--user-wallpaper').startsWith('url('), null, { timeout: 5000 });
      await page.goto(`${base}/aparencia.html`);
      await page.locator('[data-wallpaper-image-remove]:not([hidden])').click();
      await page.waitForFunction(() => document.documentElement.dataset.wallpaper === 'none');
      await context.close();
    }
    record('Imagem própria como fundo: arquivo inválido recusado; a imagem aparece nas outras páginas; remover volta ao liso');
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
