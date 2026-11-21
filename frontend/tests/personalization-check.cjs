// Personalization 2.0 in a real browser with a simulated API and an in-memory `profile_state`:
// Início customization (show/hide, order, density, restore), persistence per account, recovery
// from a failed synchronization, and profile view/edit mode. Nothing here calls a real backend,
// AI provider or Supabase project.
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
  noHorizontalScroll,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'personalization');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

const OTHER = {
  id: 'user-other',
  email: 'outra@example.test',
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: 'Rafa Lima' },
};
const units = (page, column) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} > [data-widget-unit]`)].map(
        (node) => node.dataset.widgetUnit,
      ),
    column === 'main' ? '.dash-main' : '.dash-rail',
  );
const row = (data, owner, key) =>
  data.profileState.find((item) => item.user_id === owner && item.key === key);
async function openSheet(page) {
  await page.locator('[data-dashboard-customize]:visible').click();
  await page.locator('[data-dashboard-customize-dialog][open]').waitFor();
  await page.waitForTimeout(300); // opening animation
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Default stays excellent; customization is opt-in ---------------------------
    const data = state();
    data.profileState = [];
    const { context, page } = await openApp(browser, base, allFlags, data);
    await page.goto(base + '/painel.html');
    await ready(page);
    assert.deepEqual(await units(page, 'main'), ['plan', 'recent']);
    assert.deepEqual(await units(page, 'rail'), ['week', 'agenda', 'subjects', 'notes']);
    assert.equal(row(data, 'user-dashboard', 'dashboard-layout'), undefined, 'no layout written');

    // ---------- Keyboard: open, hide, move, density, close ---------------------------------
    await page.locator('[data-dashboard-customize]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-dashboard-customize-dialog][open]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'customize-title');
    assert(await page.locator('[data-customize-reset]').isDisabled(), 'nothing to restore yet');
    await settle(page);
    await axeCheck(page, '[data-dashboard-customize-dialog]', 'Personalizar o Início');
    await shot(page, 'inicio-personalizar-1440', false);
    await page.locator('[data-widget-toggle="cards"]').focus();
    await page.keyboard.press('Space');
    assert(await page.locator('[data-widget="cards"]').isHidden(), 'cards hidden at once');
    assert(await page.locator('[data-widget="tasks"]').isVisible(), 'tasks stay');
    await page.locator('[data-move="notes:-1"]').click();
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.move),
      'notes:-1',
      'focus follows the moved block',
    );
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.move),
      'notes:1',
      'at the top, focus moves to the button that still works',
    );
    assert.deepEqual(await units(page, 'rail'), ['notes', 'week', 'agenda', 'subjects']);
    await page.locator('#dashboard-density').selectOption('compact');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact');
    await page.locator('[data-customize-status]', { hasText: 'Salvo na sua conta' }).waitFor();
    await page.keyboard.press('Escape');
    assert(await page.locator('[data-dashboard-customize-dialog]').evaluate((d) => !d.open));
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-dashboard-customize')),
      true,
      'focus returns to Personalizar',
    );
    // Reading order follows the screen: the rail starts with Anotações.
    assert.equal(
      await page.locator('.dash-rail > .dash-card:not([hidden]) h2').first().textContent(),
      'Anotações',
    );
    await noHorizontalScroll(page, 'Início personalizado');
    await settle(page);
    await axeCheck(page, 'body', 'Início personalizado');
    await shot(page, 'inicio-personalizado-1440');
    const saved = row(data, 'user-dashboard', 'dashboard-layout');
    assert.deepEqual(saved.data.hidden, ['cards']);
    assert.deepEqual(saved.data.order.rail, ['notes', 'week', 'agenda', 'subjects']);
    record(
      'Personalizar o Início por teclado: ocultar cartão, mover bloco (foco acompanha), densidade compacta, Escape devolve o foco, axe sem violações',
    );

    // ---------- Persistence, other account, restore ----------------------------------------
    await page.reload();
    await ready(page);
    assert.deepEqual(await units(page, 'rail'), ['notes', 'week', 'agenda', 'subjects']);
    assert(await page.locator('[data-widget="cards"]').isHidden());
    // Another account signs in on the same browser: it never inherits this layout.
    data.user = OTHER;
    await page.reload();
    await ready(page);
    assert.deepEqual(await units(page, 'rail'), ['week', 'agenda', 'subjects', 'notes']);
    assert(await page.locator('[data-widget="cards"]').isVisible());
    assert.equal(row(data, OTHER.id, 'dashboard-layout'), undefined);
    // Back to the first account: its layout is still there.
    data.user = null;
    await page.reload();
    await ready(page);
    assert.deepEqual(await units(page, 'rail'), ['notes', 'week', 'agenda', 'subjects']);
    await openSheet(page);
    await page.locator('[data-customize-reset]').click();
    assert.equal(
      await page.evaluate(() => document.activeElement.hasAttribute('data-customize-done')),
      true,
    );
    assert.deepEqual(await units(page, 'rail'), ['week', 'agenda', 'subjects', 'notes']);
    assert(await page.locator('[data-widget="cards"]').isVisible());
    await page.locator('[data-customize-status]', { hasText: 'Salvo na sua conta' }).waitFor();
    assert.deepEqual(row(data, 'user-dashboard', 'dashboard-layout').data.hidden, []);
    await page.locator('.dash-customize-foot [data-customize-done]').click();
    record(
      'Layout salvo por conta: sobrevive ao recarregar, outra conta no mesmo navegador vê o padrão, Restaurar padrão volta tudo',
    );

    // ---------- Failed synchronization and a newer copy from another device ----------------
    data.dbDown = true;
    await openSheet(page);
    await page.locator('[data-widget-toggle="recent"]').uncheck();
    await page.locator('[data-customize-status]', { hasText: 'Salvo neste dispositivo' }).waitFor();
    assert(await page.locator('[data-widget="recent"]').isHidden(), 'still applied offline');
    data.dbDown = false;
    await page.reload();
    await ready(page);
    assert(await page.locator('[data-widget="recent"]').isHidden(), 'pending edit kept');
    assert.deepEqual(
      row(data, 'user-dashboard', 'dashboard-layout').data.hidden,
      ['recent'],
      'the pending edit reaches the account on the next load',
    );
    // Another device saves a newer layout: this browser shows it instead of its own copy.
    Object.assign(row(data, 'user-dashboard', 'dashboard-layout'), {
      data: { version: 1, hidden: ['subjects'], order: { main: ['recent', 'plan'], rail: [] } },
      updated_at: new Date(Date.now() + 60000).toISOString(),
    });
    await page.reload();
    await ready(page);
    await page.waitForFunction(() =>
      document.querySelector('[data-widget="subjects"]')?.hasAttribute('data-user-hidden'),
    );
    assert(await page.locator('[data-widget="recent"]').isVisible());
    assert.deepEqual(await units(page, 'main'), ['recent', 'plan']);
    record(
      'Falha de sincronização: a mudança vale na hora, fica pendente e chega à conta depois; cópia mais nova de outro aparelho prevalece',
    );
    await context.close();

    // ---------- Phone: the sheet fits and the essential card stays -------------------------
    const phone = await openApp(browser, base, allFlags, state(), { width: 390, height: 844 });
    await phone.page.goto(base + '/painel.html');
    await ready(phone.page);
    await openSheet(phone.page);
    await noHorizontalScroll(phone.page, 'Personalizar no celular');
    const box = await phone.page.locator('[data-dashboard-customize-dialog]').boundingBox();
    assert(box.width <= 390 && box.x >= 0, 'sheet inside the screen');
    await shot(phone.page, 'inicio-personalizar-390', false);
    await phone.page.keyboard.press('Escape');
    assert(await phone.page.locator('.dash-continue').isVisible());
    record(
      'Celular (390 px): a folha de personalização cabe na tela e "Continuar estudando" permanece',
    );
    await phone.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} personalization checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
