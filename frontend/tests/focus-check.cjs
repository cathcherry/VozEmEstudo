// Focar with a simulated API: one focus session for the account across pages, reloads and tabs.
// Focar is the full page; every other page has the focus drawer (a top-bar button that shows the
// time, a side panel or bottom sheet, and a floating capsule) controlling the same session; one
// server session, never duplicated.
// History and analysis ("Seu ritmo", recent blocks) live in Planejar › Tempo de estudo.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
  noHorizontalScroll,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'focus');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const seconds = (text) =>
  text
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const data = state();
    const { context, page } = await openApp(browser, base, allFlags, data, {
      width: 1440,
      height: 900,
    });

    // ---------- Start on Focar, continue on other pages and after a reload -----------------
    await page.goto(base + '/focar.html');
    await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Focar');
    await page.locator('.focus-primary').click();
    await page.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    await page.waitForTimeout(2200);
    const onFocar = seconds(await page.locator('.focus-time').textContent());
    assert(onFocar < 25 * 60, 'counting down');
    await page.goto(base + '/historico.html');
    const indicator = page.locator('[data-utility-trigger].is-active');
    await indicator.waitFor();
    const onLibrary = seconds(await indicator.locator('.utility-trigger-time').textContent());
    assert(onLibrary <= onFocar, `continues after navigation (${onFocar} → ${onLibrary})`);
    await page.reload();
    await indicator.waitFor();
    await page.waitForTimeout(1200);
    assert(
      seconds(await indicator.locator('.utility-trigger-time').textContent()) < onLibrary,
      'and after a reload',
    );
    assert.equal(data.sessions, 1, 'one server session across pages');
    await shot(page, 'indicador-biblioteca', false);
    record(
      'Focar: uma sessão continua entre Focar, Biblioteca e recarga; uma só sessão no servidor',
    );

    // ---------- One engine; the drawer controls it on every page but Focar ------------------
    assert.equal(await page.locator('[data-focus-indicator]').count(), 0, 'no second top-bar control');
    assert.match(await indicator.getAttribute('aria-label'), /^Cronômetro de foco: Foco em andamento, \d\d:\d\d$/);
    for (const url of ['/historico.html', '/material.html?id=l-foto', '/planejar.html#tempo', '/flashcards.html#revisar']) {
      await page.goto(base + url);
      await indicator.waitFor();
    }
    // Open the panel, pause there: the same session pauses (Focar shows "Retomar").
    await indicator.click();
    const panel = page.locator('[data-utility-shell]');
    await panel.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'utility-panel-title', 'focus moves into the panel');
    await settle(page);
    await axeCheck(page, '[data-utility-shell]', 'Painel de foco');
    await shot(page, 'painel-foco', false);
    await panel.locator('[data-focus-primary]', { hasText: 'Pausar' }).click();
    await panel.locator('[data-focus-primary]', { hasText: 'Retomar' }).waitFor();
    // Esc closes the panel; a paused block keeps the capsule on screen.
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    const capsule = page.locator('[data-focus-capsule]');
    await capsule.waitFor();
    await settle(page);
    await axeCheck(page, '[data-focus-capsule]', 'Cápsula do foco');
    await capsule.locator('.focus-capsule-toggle').click();
    await page.locator('[data-utility-trigger][data-state="running"]').waitFor();
    assert.equal(data.sessions, 2, 'resuming from the capsule opens a new server session, never a duplicate');
    await page.goto(base + '/focar.html');
    assert.equal(await page.locator('[data-utility-trigger], [data-utility-shell], [data-focus-capsule]').count(), 0, 'Focar is the timer itself');
    await page.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    record('Painel de foco em todas as páginas menos Focar: botão no topo com o tempo, painel que abre e fecha (Esc), cápsula; controla a mesma sessão de Focar');

    // ---------- Two tabs share the session: pausing in one shows in the other -------------
    const second = await context.newPage();
    await second.goto(base + '/focar.html');
    await second.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    await second.locator('.focus-primary').click();
    await second.locator('.focus-primary', { hasText: 'Retomar' }).waitFor();
    await page.bringToFront();
    await page.goto(base + '/historico.html');
    await page.locator('[data-utility-trigger][data-state="paused"]').waitFor();
    assert.match(await page.locator('[data-utility-trigger]').getAttribute('aria-label'), /Foco pausado/);
    assert.equal(data.sessions, 2, 'no duplicate session from the second tab');
    assert(
      data.ticks.some((tick) => tick.close),
      'pausing closes the server session',
    );
    await second.close();
    record('Duas abas: a mesma sessão; pausar em uma aparece na outra; nenhuma sessão duplicada');

    // ---------- A lesson opened before Focar: the block counts for it --------------------------
    await page.goto(base + '/focar.html');
    await page.locator('.focus-primary', { hasText: 'Retomar' }).click();
    await page.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    assert.equal(data.sessions, 3, 'resuming opens a new server session');
    await page.locator('.focus-stop').click();
    await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).waitFor();
    await page.goto(base + '/material.html?id=l-foto');
    await page.locator('[data-material-title]:not([aria-busy="true"])').waitFor();
    await page.waitForTimeout(300);
    await page.goto(base + '/focar.html');
    await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).click();
    await page.locator('.focus-lesson', { hasText: 'Aula: Fotossíntese e respiração celular' }).waitFor();
    await page.locator('.focus-stop').click();
    await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).waitFor();
    record('Retomar e encerrar em Focar; aberto depois de uma aula, o bloco conta para ela');

    // ---------- Sons ambientes follow focus blocks when asked (mixer: soundscape-check.cjs) ---
    await page.locator('[data-soundscape-trigger]').click();
    await page.getByLabel('Tocar junto com o foco').check();
    await page.keyboard.press('Escape');
    const mixerState = (value) =>
      page.locator(`#soundscape-popover .soundscape-mixer[data-state="${value}"]`).waitFor({ state: 'attached' });
    await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).click();
    await mixerState('playing');
    await page.locator('.focus-primary', { hasText: 'Pausar' }).click();
    await mixerState('off');
    assert.equal(
      JSON.parse(await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('voz-soundscape-v1:'))?.[1])).withFocus,
      true,
    );
    await page.locator('.focus-stop').click();
    await page.locator('.focus-primary', { hasText: 'Iniciar foco' }).waitFor();
    record('Sons ambientes: opção de tocar junto com o foco (começa no bloco de foco, pausa na pausa)');

    // ---------- Início and Planejar: "Iniciar foco" opens Focar and starts there -------------
    await page.goto(base + '/painel.html');
    const shortcut = page.locator('[data-focus-shortcut]');
    await shortcut.waitFor();
    assert.equal(await shortcut.evaluate((node) => node.tagName), 'A');
    await shortcut.click();
    await page.waitForURL('**/focar.html');
    await page.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    await page.goto(base + '/painel.html');
    await page.locator('[data-focus-shortcut]', { hasText: /^Foco · \d\d:\d\d$/ }).waitFor();
    await page.goto(base + '/planejar.html#tempo');
    const planLink = page.locator('#tempo [data-focus-link]');
    await planLink.waitFor();
    assert.equal(await planLink.textContent(), 'Abrir Focar', 'a running block: Planejar just links to it');
    assert.equal(await page.locator('#tempo .focus-card, #tempo .focus-primary').count(), 0, 'no timer in Planejar');
    await page.goto(base + '/focar.html');
    await page.locator('.focus-stop').click();
    await page.goto(base + '/planejar.html#tempo');
    await page.locator('#tempo [data-focus-link]', { hasText: 'Iniciar foco' }).waitFor();
    record('Início e Planejar: "Iniciar foco" é um link para Focar, que começa o bloco; Planejar não tem cronômetro');

    // ---------- Phone: the indicator fits; no horizontal scroll -------------------------------
    await page.goto(base + '/focar.html?iniciar=foco');
    await page.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/material.html?id=l-foto');
    await indicator.waitFor();
    await noHorizontalScroll(page, 'aula com indicador @390');
    await shot(page, 'indicador-celular', false);
    record('Celular: o indicador cabe no topo, sem rolagem horizontal');
    await context.close();

    // ---------- Durations follow the account to another device ----------------------------
    {
      const one = await openApp(browser, base, allFlags, data, { width: 1280, height: 900 });
      await one.page.goto(base + '/focar.html');
      await one.page.locator('.week-settings').click();
      await one.page.locator('.focus-settings-dialog [type=number]').first().fill('50');
      await one.page.locator('.focus-settings-dialog [type=submit]').click();
      await one.page.locator('.focus-caption', { hasText: 'Foco de 50 minutos' }).waitFor();
      const durations = await one.page.evaluate(() => JSON.parse(localStorage.getItem('audioestudo-ui-preferences')).focusSettings);
      assert.equal(durations.focus, 50, 'saved with the synced preferences');
      await one.context.close();
      // A fresh browser that only has the account's preferences (as after a cloud pull).
      const two = await openApp(browser, base, allFlags, data, { width: 1280, height: 900 });
      await two.page.addInitScript((prefs) => localStorage.setItem('audioestudo-ui-preferences', JSON.stringify(prefs)), { focusSettings: durations });
      await two.page.goto(base + '/focar.html');
      await two.page.locator('.focus-caption', { hasText: 'Foco de 50 minutos' }).waitFor();
      assert.equal(await two.page.locator('.focus-time').textContent(), '50:00');
      await two.context.close();
      record('Durações do Focar salvas nas preferências da conta e aplicadas em outro navegador');
    }

    // ---------- Block history follows the account -------------------------------------------
    {
      const cloud = state();
      const endedAt = Date.now() - 3_600_000;
      cloud.profileState = [
        {
          user_id: 'user-dashboard',
          key: 'focus-history',
          updated_at: new Date(endedAt).toISOString(),
          data: [{ mode: 'pomodoro', seconds: 1500, endedAt, materialId: 'l-foto', materialTitle: 'Bloco do notebook' }],
        },
      ];
      const fresh = await openApp(browser, base, allFlags, cloud, { width: 1280, height: 900 });
      await fresh.page.goto(base + '/planejar.html#tempo');
      await fresh.page.locator('[data-focus-history-list] li', { hasText: 'Bloco do notebook' }).waitFor();
      // A block finished here is added to the account copy, next to the other device's.
      // (written straight into this browser's session, as another tab finishing a short break)
      await fresh.page.evaluate(() => {
        const key = 'voz-focus-v1:user-dashboard';
        const stored = JSON.parse(localStorage.getItem(key));
        stored.history.unshift({ mode: 'short', seconds: 300, endedAt: Date.now(), materialId: null });
        localStorage.setItem(key, JSON.stringify(stored));
      });
      await fresh.page.waitForFunction(() => document.querySelectorAll('[data-focus-history-list] li').length === 2);
      await fresh.page.waitForTimeout(2500);
      const row = cloud.profileState.find((item) => item.key === 'focus-history');
      assert.equal(row.data.length, 2, 'both blocks in the account copy');
      assert.equal(row.data[1].materialTitle, 'Bloco do notebook');
      await fresh.context.close();
      record('Histórico de blocos na conta: o de outro aparelho aparece aqui, e o novo soma aos dois sem apagar nada');
    }

    // ---------- "Seu ritmo": 12 weeks, lessons studied most, optional year ----------------
    {
      const stats = state();
      const view = await openApp(browser, base, allFlags, stats, { width: 390, height: 844 });
      await view.page.goto(base + '/planejar.html#tempo');
      const section = view.page.locator('[data-study-stats]');
      await section.locator('.stats-bars li').nth(11).waitFor();
      assert.equal(await section.locator('.stats-bars li').count(), 12);
      assert.match(await section.locator('figcaption').textContent(), /meta de 2 h 30 min/);
      await section.locator('.stats-table summary').click();
      assert.equal(await section.locator('.stats-table tbody tr').count(), 12);
      await section.locator('.stats-lessons a', { hasText: 'Fotossíntese e respiração celular' }).waitFor();
      await section.locator('.stats-lessons', { hasText: 'Aula removida' }).waitFor();
      assert.deepEqual(stats.historyRequests, [84], 'the year is only asked for on demand');
      await section.getByRole('button', { name: 'Ver o ano' }).click();
      await section.locator('.stats-year-grid [data-level="4"]').first().waitFor();
      assert.deepEqual(stats.historyRequests, [84, 371]);
      assert.equal(await section.getByRole('button', { name: 'Ocultar o ano' }).getAttribute('aria-expanded'), 'true');
      await settle(view.page);
      await axeCheck(view.page, '[data-study-stats]', 'Seu ritmo');
      await noHorizontalScroll(view.page, 'seu ritmo (390 px)');
      await view.context.close();
      // Nothing recorded yet: an invitation, not an empty chart. Unavailable: hidden.
      const empty = state();
      empty.emptyHistory = true;
      const fresh = await openApp(browser, base, allFlags, empty, { width: 1280, height: 900 });
      await fresh.page.goto(base + '/planejar.html#tempo');
      await fresh.page.locator('[data-study-stats] .stats-empty').waitFor();
      assert.equal(await fresh.page.locator('[data-study-stats] .stats-chart').count(), 0);
      empty.emptyHistory = false;
      empty.historyDown = true;
      await fresh.page.reload();
      await fresh.page.locator('#tempo .week-card').waitFor();
      await fresh.page.waitForTimeout(500);
      assert(await fresh.page.locator('[data-study-stats]').isHidden(), 'hidden when the history is unavailable');
      await fresh.context.close();
      record('Seu ritmo: 12 semanas com a meta, tabela, aulas mais estudadas e mapa do ano sob demanda; vazio convida; indisponível some');
    }
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(
    errors.filter((e) => !/Sem simulação|404/.test(e)),
    [],
    'browser errors',
  );
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} focus checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
