// Focar 3.0 with a simulated API: one focus session for the account across pages, reloads and
// tabs; the Focar page, the side panel and the floating capsule are views of the same session;
// hiding a view never stops it; one server session, never duplicated.
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
    const capsule = page.locator('[data-focus-capsule]:not([hidden])');
    await capsule.waitFor();
    const onLibrary = seconds(await capsule.locator('.focus-capsule-time').textContent());
    assert(onLibrary <= onFocar, `continues after navigation (${onFocar} → ${onLibrary})`);
    await page.reload();
    await capsule.waitFor();
    await page.waitForTimeout(1200);
    assert(
      seconds(await capsule.locator('.focus-capsule-time').textContent()) < onLibrary,
      'and after a reload',
    );
    assert.equal(data.sessions, 1, 'one server session across pages');
    await shot(page, 'capsula-biblioteca', false);
    record(
      'Focar: uma sessão continua entre Focar, Biblioteca e recarga; uma só sessão no servidor',
    );

    // ---------- The side panel beside a lesson; closing it does not stop the session ------
    await page.goto(base + '/material.html?id=l-foto');
    await capsule.waitFor();
    await page.locator('[data-utility-trigger]').click();
    const panel = page.locator('#utility-panel:not([hidden])');
    await panel.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'utility-panel-title');
    assert(
      await page.evaluate(() => document.body.classList.contains('utility-open')),
      'content narrows beside the panel',
    );
    const lesson = await page.locator('.material-header').boundingBox();
    const box = await panel.boundingBox();
    assert(lesson.x + lesson.width <= box.x, 'the lesson is not covered by the panel');
    await settle(page);
    await axeCheck(page, '#utility-panel', 'Painel do cronômetro');
    await shot(page, 'painel-aula', false);
    await page.keyboard.press('Escape');
    assert(await page.locator('#utility-panel').isHidden());
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.utilityTrigger),
      '',
      'focus returns to the trigger',
    );
    assert(
      await page.locator('[data-utility-trigger].is-active').isVisible(),
      'the topbar shows the running session',
    );
    record(
      'Painel lateral ao lado da aula (sem cobrir), Esc fecha e devolve o foco; fechar não encerra a sessão',
    );

    // ---------- Two tabs share the session: pausing in one shows in the other -------------
    const second = await context.newPage();
    await second.goto(base + '/planejar.html#tempo');
    await second.locator('.focus-primary', { hasText: 'Pausar' }).waitFor();
    await second.locator('.focus-primary').click();
    await second.locator('.focus-primary', { hasText: 'Retomar' }).waitFor();
    await page.bringToFront();
    await page.locator('[data-focus-capsule][data-state="paused"]').waitFor();
    assert.equal(data.sessions, 1, 'no duplicate session from the second tab');
    assert(
      data.ticks.some((tick) => tick.close),
      'pausing closes the server session',
    );
    await second.close();
    record('Duas abas: a mesma sessão; pausar em uma aparece na outra; nenhuma sessão duplicada');

    // ---------- Hidden capsule; resume from the panel ---------------------------------------
    await page.locator('[data-focus-capsule] .focus-capsule-hide').click();
    assert(await page.locator('[data-focus-capsule]').isHidden());
    await page.locator('[data-utility-trigger]').click();
    await panel.locator('[data-focus-primary]', { hasText: 'Retomar' }).click();
    await panel.locator('[data-focus-primary]', { hasText: 'Pausar' }).waitFor();
    assert.equal(data.sessions, 2, 'resuming opens a new server session');
    await panel.locator('.utility-stop').click();
    await panel.locator('[data-focus-primary]', { hasText: 'Iniciar foco' }).waitFor();
    // Started on the lesson page: the block is linked to that lesson.
    await panel.locator('[data-focus-primary]').click();
    await panel.locator('.utility-lesson', { hasText: 'Aula: Fotossíntese e respiração celular' }).waitFor();
    await panel.locator('.utility-stop').click();
    record('Esconder a cápsula não para o cronômetro; retomar e encerrar pelo painel');

    // ---------- Sons ambientes follow focus blocks when asked (mixer: soundscape-check.cjs) ---
    await page.goto(base + '/material.html?id=l-foto');
    await page.locator('[data-soundscape-trigger]').click();
    await page.getByLabel('Tocar junto com o foco').check();
    await page.keyboard.press('Escape');
    if (await page.locator('#utility-panel').isHidden()) await page.locator('[data-utility-trigger]').click();
    const soundPanel = page.locator('#utility-panel');
    const mixerState = (value) =>
      page.locator(`#soundscape-popover .soundscape-mixer[data-state="${value}"]`).waitFor({ state: 'attached' });
    await soundPanel.locator('[data-focus-primary]', { hasText: 'Iniciar foco' }).click();
    await mixerState('playing');
    await soundPanel.locator('[data-focus-primary]', { hasText: 'Pausar' }).click();
    await mixerState('off');
    assert.equal(
      JSON.parse(await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('voz-soundscape-v1:'))?.[1])).withFocus,
      true,
    );
    await soundPanel.locator('.utility-stop').click();
    record('Sons ambientes: opção de tocar junto com o foco (começa no bloco de foco, pausa na pausa)');

    // ---------- Início: one click starts focusing ------------------------------------------
    await page.goto(base + '/painel.html');
    const shortcut = page.locator('[data-focus-shortcut]');
    await shortcut.waitFor();
    await shortcut.click();
    await page.locator('[data-focus-shortcut]', { hasText: /^Pausar · / }).waitFor();
    // The capsule stays hidden (the student hid it above); the topbar shows the running session.
    await page.locator('[data-utility-trigger].is-active').waitFor();
    await shortcut.click();
    await page.locator('[data-focus-shortcut]', { hasText: 'Retomar foco' }).waitFor();
    record('Início: "Iniciar foco" começa a sessão com um clique; o mesmo botão pausa e retoma');

    // ---------- Phone: the panel is a bottom sheet; no horizontal scroll --------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#utility-panel').getAttribute('data-sheet'), 'true');
    await noHorizontalScroll(page, 'aula com painel @390');
    await shot(page, 'painel-celular', false);
    record('Celular: o painel vira uma folha inferior, sem rolagem horizontal');
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
      await fresh.page.goto(base + '/focar.html');
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
      await view.page.goto(base + '/focar.html');
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
      await fresh.page.goto(base + '/focar.html');
      await fresh.page.locator('[data-study-stats] .stats-empty').waitFor();
      assert.equal(await fresh.page.locator('[data-study-stats] .stats-chart').count(), 0);
      empty.emptyHistory = false;
      empty.historyDown = true;
      await fresh.page.reload();
      await fresh.page.locator('.focus-time').waitFor();
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
