// Preferences and local data on a shared browser, with a simulated API and an in-memory
// profile_state: one account's theme and language never reach another account or the sign-in
// page, they come back for their owner, the sync indicator (Configurações › Dados neste navegador) reports the real state,
// and "Apagar dados desta conta neste navegador" removes only that account's copies (asking
// first when changes are not synchronized). No real backend or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  ready,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'account-privacy');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const A = 'user-dashboard';
const B = {
  id: 'user-bianca',
  email: 'bianca@example.test',
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: 'Bianca Alves' },
};
const root = (page, key) => page.evaluate((k) => document.documentElement.dataset[k], key);
const row = (data, owner, key) =>
  data.profileState.find((item) => item.user_id === owner && item.key === key);
async function until(check, label) {
  for (let i = 0; i < 60; i++) {
    try {
      if (await check()) return;
    } catch {
      /* not yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out: ${label}`);
}

// Configurações › Dados neste navegador is a sub-view (#dados-neste-navegador): going to the same
// address again is only a hash change, so reload to read the changed storage like a new visit.
async function openDeviceData(page, base) {
  const url = base + '/configuracoes.html#dados-neste-navegador';
  const same = page.url() === url;
  await page.goto(url);
  if (same) await page.reload();
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const data = state();
    data.profileState = [];
    const { context, page } = await openApp(browser, base, allFlags, data);

    // ---------- A chooses a dark theme and Chinese; it is saved to A's account --------------
    await page.goto(base + '/aparencia.html');
    await page.locator('[data-theme-option="night"]').click();
    await Promise.all([
      page.waitForNavigation(),
      page.locator('#setting-language').selectOption('zh-CN'),
    ]);
    await page.locator('h1', { hasText: '外观' }).waitFor();
    await until(() => {
      const prefs = row(data, A, 'preferences')?.data;
      return (
        prefs?.['audioestudo-theme'] === 'night' &&
        /zh-CN/.test(prefs['audioestudo-ui-preferences'])
      );
    }, "A's choices in A's account");

    // ---------- Signing out: the sign-in page shows the device look, not A's ----------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('.account-menu-trigger').click();
    await Promise.all([page.waitForURL('**/login.html'), page.locator('[data-logout]').click()]);
    await page.waitForLoadState('networkidle');
    assert.equal(await root(page, 'theme'), 'paper', 'sign-in page without A theme');
    assert.equal(
      await page.evaluate(() => document.documentElement.lang),
      'pt-BR',
      'nor A language',
    );
    record(
      'Sair da conta: a tela de entrada volta ao visual do dispositivo, sem o tema e o idioma da conta',
    );

    // ---------- B signs in on the same browser: nothing of A ---------------------------------
    data.user = B;
    await page.goto(base + '/login.html');
    await page.locator('#email, [name=email]').first().fill(B.email);
    await page.locator('[name=senha]').fill('uma-senha-qualquer-123');
    await Promise.all([
      page.waitForURL('**/painel.html'),
      page.locator('.login-form [type=submit]').click(),
    ]);
    await ready(page);
    assert.equal(await root(page, 'theme'), 'paper');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'pt-BR');
    await until(() => row(data, B.id, 'preferences'), "B's account created");
    assert.notEqual(row(data, B.id, 'preferences').data['audioestudo-theme'], 'night');
    assert.doesNotMatch(
      row(data, B.id, 'preferences').data['audioestudo-ui-preferences'] || '',
      /zh-CN/,
    );
    record(
      'Outra conta no mesmo navegador começa do visual do dispositivo e nunca recebe o tema ou o idioma da anterior',
    );

    // ---------- A returns: A's look comes back from A's account ------------------------------
    await page.locator('.account-menu-trigger').click();
    await Promise.all([page.waitForURL('**/login.html'), page.locator('[data-logout]').click()]);
    data.user = null;
    await page.goto(base + '/login.html');
    await page.locator('[name=email]').fill('estudante@example.test');
    await page.locator('[name=senha]').fill('uma-senha-qualquer-123');
    await Promise.all([
      page.waitForURL('**/painel.html'),
      page.locator('.login-form [type=submit]').click(),
    ]);
    await ready(page);
    await until(async () => (await root(page, 'theme')) === 'night', 'A theme back');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');
    record('A conta original recupera o próprio tema e idioma ao entrar de novo');

    // ---------- Configurações: honest synchronization state ----------------------------------
    await openDeviceData(page, base);
    const panel = page.locator('[data-sync-panel]');
    await panel.waitFor();
    await until(async () => (await panel.getAttribute('data-state')) === 'saved', 'saved state');
    assert(await panel.locator('[data-sync-now]').isHidden(), 'no retry without pending changes');
    data.dbDown = true;
    await page.evaluate(() => window.VozAppearance.storage.set('audioestudo-theme', 'forest'));
    await openDeviceData(page, base);
    await until(
      async () => (await panel.getAttribute('data-state')) === 'pending',
      'pending state',
    );
    assert(await panel.locator('[data-sync-now]').isVisible());
    await settle(page);
    await axeCheck(page, '[data-sync-panel]', 'Sincronização');
    await shot(page, 'configuracoes-pendente', false);
    data.dbDown = false;
    await panel.locator('[data-sync-now]').click();
    await until(
      async () => (await panel.getAttribute('data-state')) === 'saved',
      'saved after retry',
    );
    assert.equal(row(data, A, 'preferences').data['audioestudo-theme'], 'forest');
    record(
      'Configurações mostra "salvo", "pendente" e só oferece "Sincronizar agora" quando há o que enviar; o reenvio chega à conta',
    );

    // ---------- Clearing this account's data from the browser --------------------------------
    // B's copies (from the earlier visit) must survive.
    const bKeysBefore = await page.evaluate(
      (id) => Object.keys(localStorage).filter((k) => k.includes(id)),
      B.id,
    );
    assert(bKeysBefore.length > 0, 'B left copies in this browser');
    data.dbDown = true;
    // The simulated app seeds sample study history on each load; stop that to see real leftovers.
    await page.evaluate(() => localStorage.setItem('mock-no-seed', '1'));
    await page.evaluate(() => window.VozAppearance.storage.set('audioestudo-theme', 'wine'));
    await openDeviceData(page, base);
    await until(
      async () => (await panel.getAttribute('data-state')) === 'pending',
      'pending again',
    );
    await panel.locator('[data-clear-device]').click();
    const dialog = page.locator('[data-clear-device-dialog][open]');
    await dialog.waitFor();
    assert.match(
      await dialog.locator('[data-clear-device-warning]').textContent(),
      /这些更改将会丢失/, // the account uses Chinese: the warning is translated too
    );
    assert.equal(
      await dialog.locator('[data-clear-device-confirm]').textContent(),
      '仍然删除并退出',
    );
    await settle(page);
    await axeCheck(page, '[data-clear-device-dialog]', 'Apagar dados (diálogo)');
    await page.keyboard.press('Escape');
    assert.equal(
      (await page.evaluate(
        (id) => Object.keys(localStorage).filter((k) => k.includes(id)).length,
        A,
      )) > 0,
      true,
      'cancel keeps everything',
    );
    data.dbDown = false;
    await panel.locator('[data-clear-device]').click();
    await dialog.locator('[data-clear-device-sync]').click();
    await dialog.locator('[data-clear-device-status]', { hasText: '现在可以安全删除' }).waitFor();
    assert.equal(
      row(data, A, 'preferences').data['audioestudo-theme'],
      'wine',
      'synchronized before deleting',
    );
    await Promise.all([
      page.waitForURL('**/login.html'),
      dialog.locator('[data-clear-device-confirm]').click(),
    ]);
    const left = await page.evaluate(
      ({ a, b }) => ({
        a: Object.keys(localStorage).filter((k) => k.includes(a)),
        b: Object.keys(localStorage).filter((k) => k.includes(b)),
        owner: localStorage.getItem('voz-preferences-owner'),
        theme: document.documentElement.dataset.theme,
      }),
      { a: A, b: B.id },
    );
    assert.deepEqual(left.a, [], "A's copies removed");
    assert.deepEqual(left.b.sort(), bKeysBefore.sort(), "B's copies untouched");
    assert.equal(left.owner, null);
    assert.equal(left.theme, 'paper', 'device look after leaving');
    record(
      'Apagar dados desta conta: avisa sobre mudanças não enviadas, permite sincronizar antes, remove só as cópias da conta e sai',
    );
    // ---------- Public shared copy: the visitor's own device settings, nothing from accounts ----
    await page.evaluate(() => {
      localStorage.setItem('audioestudo-theme', 'night');
      localStorage.setItem(
        'audioestudo-ui-preferences',
        JSON.stringify({ language: 'en', textSize: 'large' }),
      );
    });
    await page.route(base + '/api/shared-material', (route) =>
      route.fulfill({
        json: {
          title: 'Aula compartilhada',
          subject: 'Biologia',
          revision: 2,
          transcript: 'Salvar energia é importante.',
        },
      }),
    );
    await page.goto(`${base}/compartilhado.html#token=${'a'.repeat(64)}`);
    await page.locator('[data-shared-content] section').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await root(page, 'theme'), 'night');
    assert.equal(await root(page, 'textSize'), 'large');
    assert.equal(
      await page.locator('[data-shared-title]').textContent(),
      'Aula compartilhada',
      'shared title untouched',
    );
    assert.match(
      await page.locator('[data-shared-content]').textContent(),
      /Salvar energia é importante\./,
      'content untouched',
    );
    assert.equal(await page.locator('[data-shared-print]').textContent(), 'Print / save PDF');
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      'rgb(21, 25, 31)',
      'dark background',
    );
    await settle(page);
    await axeCheck(page, 'body', 'Cópia compartilhada (en, noturno)');
    await shot(page, 'compartilhado-en-noturno', false);
    record(
      'Cópia compartilhada pública: idioma, tema e tamanho do texto do próprio visitante; conteúdo intacto; axe sem violações',
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  const unexpected = errors.filter((e) => !/Sem simulação|404|offline/.test(e));
  assert.deepEqual(unexpected, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} account privacy checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
