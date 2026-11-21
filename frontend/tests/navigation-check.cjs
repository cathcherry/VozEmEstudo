// Navigation across every signed-in page with a simulated API: links resolve, the current page is
// marked, the account menu is visible and usable at every width, the top search behaves the same
// on Início, Revisar and Planejar, and browser back/forward restores the selected tool tab.
// Nothing here calls a real backend, AI provider or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  ready,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'navigation');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

// Page → the primary navigation entry that must be marked as current (null: none of them).
const PAGES = [
  ['painel.html', 'Início'],
  ['historico.html', 'Biblioteca'],
  ['revisar.html', 'Revisar'],
  ['planejar.html', 'Planejar'],
  ['nova-transcricao.html', 'Nova transcrição'],
  // A lesson belongs to the Library.
  ['material.html?id=l-foto', 'Biblioteca'],
  ['conta.html', null],
  ['configuracoes.html', null],
  ['aparencia.html', null],
  ['ajuda.html', null],
];

async function accountButton(page, label) {
  const trigger = page.locator('.account-menu-trigger').first();
  await trigger.waitFor();
  const box = await page.locator('.account-menu-trigger .user-initials').first().boundingBox();
  assert(box && box.width >= 24 && box.height >= 24, `${label}: account avatar is visible`);
  return trigger;
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Every page: links, current page, account menu (desktop and phone) ---------
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const { context, page } = await openApp(browser, base, allFlags, state(), viewport);
      const checked = new Set();
      for (const [url, current] of PAGES) {
        await page.goto(`${base}/${url}`);
        await page.waitForLoadState('networkidle');
        const label = `${url} @${viewport.width}`;
        const marked = await page
          .locator('.primary-navigation a[aria-current="page"]')
          .allTextContents();
        assert.deepEqual(
          marked.map((t) => t.trim()),
          current ? [current] : [],
          `${label}: current page in the menu`,
        );
        // Every internal link of the page answers (no broken destinations).
        const hrefs = await page.evaluate(() =>
          [...document.querySelectorAll('a[href]')]
            .map((a) => a.getAttribute('href'))
            .filter((h) => h.startsWith('./') || h.startsWith('/')),
        );
        for (const href of hrefs) {
          const target = new URL(href, page.url());
          target.hash = '';
          if (checked.has(target.pathname)) continue;
          checked.add(target.pathname);
          const response = await page.request.get(target.href);
          assert.equal(response.status(), 200, `${label}: link ${href}`);
        }
        const trigger = await accountButton(page, label);
        await trigger.click();
        const menu = page.locator('.account-menu:visible');
        await menu.waitFor();
        assert.deepEqual(
          (await menu.locator('a').allTextContents()).map((t) => t.trim()),
          ['Perfil', 'Configurações'],
        );
        assert(await menu.getByRole('button', { name: 'Sair da conta' }).isVisible());
        await page.keyboard.press('Escape');
        assert(await menu.isHidden(), `${label}: Escape closes the account menu`);
        assert.equal(
          await page.evaluate(() =>
            document.activeElement.classList.contains('account-menu-trigger'),
          ),
          true,
          `${label}: focus returns to the account button`,
        );
        // On phones the menu opens from ☰ and offers every destination.
        if (viewport.width < 600) {
          await page.locator('[data-menu-toggle]').click();
          const nav = page.locator('.primary-navigation');
          for (const name of ['Início', 'Biblioteca', 'Revisar', 'Planejar'])
            assert(await nav.locator('a', { hasText: name }).isVisible(), `${label}: ${name}`);
          await page.keyboard.press('Escape');
        }
      }
      await shot(page, `ajuda-${viewport.width}`, false);
      await context.close();
    }
    // Maximum text size on desktop must not hide the account avatar either.
    {
      const { context, page } = await openApp(browser, base, allFlags, state());
      await page.addInitScript(() =>
        localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ textSize: 'maximum' })),
      );
      await page.goto(`${base}/painel.html`);
      await ready(page);
      await accountButton(page, 'painel at maximum text size');
      await context.close();
    }
    record(
      'Todas as páginas: links internos respondem, página atual marcada, menu da conta visível e operável por teclado (1440 e 390 px, texto máximo)',
    );

    // ---------- The same search everywhere ------------------------------------------------
    const { context, page } = await openApp(browser, base, allFlags, state());
    for (const from of ['revisar.html', 'planejar.html']) {
      await page.goto(`${base}/${from}`);
      await page.waitForLoadState('networkidle');
      const input = page.locator('.topbar-search input');
      assert.equal(
        await input.getAttribute('placeholder'),
        'Buscar aulas, questões e transcrições',
      );
      await input.fill('fotossíntese');
      await input.press('Enter');
      await page.waitForURL('**/painel.html?busca=*');
      await page
        .locator('[data-search-results]', { hasText: 'Fotossíntese e respiração celular' })
        .waitFor();
      assert.equal(await page.locator('.topbar-search input').inputValue(), 'fotossíntese');
    }
    record('Busca do topo em Revisar e Planejar abre a mesma busca global do Início');

    // ---------- Back and forward keep the chosen tab --------------------------------------
    await page.goto(`${base}/planejar.html#tarefas`);
    await page.waitForLoadState('networkidle');
    await page.locator('#tab-calendario').click();
    assert(page.url().endsWith('#calendario'));
    await page.locator('.primary-navigation a', { hasText: 'Revisar' }).click();
    await page.waitForURL('**/revisar.html');
    await page.locator('#tab-anotacoes').click();
    await page.goBack();
    await page.waitForURL('**/planejar.html#calendario');
    await page.locator('#calendario:not([hidden])').waitFor();
    assert.equal(await page.locator('#tab-calendario').getAttribute('aria-selected'), 'true');
    await page.goForward();
    await page.waitForURL('**/revisar.html#anotacoes');
    await page.locator('#anotacoes:not([hidden])').waitFor();
    assert.equal(await page.locator('#tab-anotacoes').getAttribute('aria-selected'), 'true');
    // A link to another tab of the same page switches the tab without reloading.
    await page.evaluate(() => {
      location.hash = 'questoes';
    });
    await page.locator('#questoes:not([hidden])').waitFor();
    // An unknown or disabled tab falls back to the first available one.
    await page.goto(`${base}/revisar.html#inexistente`);
    await page.locator('#flashcards:not([hidden])').waitFor();
    await settle(page);
    record(
      'Voltar/avançar do navegador restauram a aba escolhida; #endereço desconhecido abre a primeira aba',
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} navigation checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
