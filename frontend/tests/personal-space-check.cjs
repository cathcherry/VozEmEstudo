// 3.5 Milestone 5 (Personalization) in a real browser with the simulated app: experience modes
// (quiet hides Lume and decoration, data intact), atmospheres (apply and customise, accessibility
// wins), Início as a dashboard (3.7: no desk, desk data kept untouched in both stores), the sidebar
// entry for Descobertas, narrow-screen tabs, axe and no horizontal scroll at 390 px.
// Nothing here calls a real backend, AI provider or Supabase project.
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

const output = path.join(__dirname, 'artifacts', 'personal-space');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const prefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('audioestudo-ui-preferences') || '{}'));
const rootData = (page, key) => page.evaluate((k) => document.documentElement.dataset[k], key);
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function openHome(page, base) {
  await page.goto(base + '/painel.html');
  await ready(page);
}

/** 3.7: Início is a dashboard again: no escrivaninha, no "Arrumar a mesa", no desk styles. */
async function assertNoDesk(page, label) {
  const found = await page.evaluate(() => ({
    scene: document.querySelectorAll('[data-desk-scene], .desk-stage, [data-desk-stage], .desk-lume, [data-desk-tray], [data-desk-arrange]').length,
    css: [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /desk\.css/.test(l.href)),
  }));
  assert.equal(found.scene, 0, `${label}: no desk scene, tray or arrange button`);
  assert.equal(found.css, false, `${label}: desk.css is not loaded`);
  assert.equal(await page.getByRole('button', { name: 'Arrumar a mesa' }).count(), 0, `${label}: no "Arrumar a mesa"`);
  assert(await page.locator('.dash-home .dash-main').isVisible(), `${label}: the dashboard is shown`);
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- 1. Início without the discoveries feature: a dashboard, desk data kept -----
    let data = state();
    let { context, page } = await openApp(browser, base, allFlags, data);
    // A desk arranged before 3.7 (starter objects in the account preferences).
    const arranged = { window: 'object.hourglass', 'desk-right': 'object.teacup', 'shelf-left': 'object.cactus' };
    await page.goto(base + '/aparencia.html');
    await page.locator('[data-atmosphere-tiles] .atmosphere-tile').first().waitFor();
    await page.evaluate(async (desk) => (await import('/js/utils/preferences.js')).setUiPreference('deskStarters', desk), arranged);
    assert.deepEqual((await prefs(page)).deskStarters, arranged);
    await openHome(page, base);
    assert.equal(await rootData(page, 'experience'), 'cozy');
    await assertNoDesk(page, 'Início (aconchegante)');
    assert(await page.locator('.dash-continue .dashboard-lesson-card').first().isVisible(), 'the next action leads the page');
    assert.equal(await page.locator('[data-desk-expedition]:visible').count(), 0, 'no investigations summary without the feature');
    assert.equal(await page.locator('.side-navigation [data-nav-feature="discoveries"]:visible').count(), 0, 'no Descobertas without the feature');
    await axeCheck(page, 'body', 'Início (painel, sem mesa)');
    await shot(page, 'inicio-painel-1440', false);
    await page.reload();
    await ready(page);
    assert.deepEqual((await prefs(page)).deskStarters, arranged, 'visiting Início never erases the desk preferences');
    record('Início sem a flag de descobertas: painel sem escrivaninha, sem "Arrumar a mesa" e sem desk.css; próxima ação no topo; sem resumo de investigações; deskStarters das preferências intactos após visitar e recarregar; axe');
    await context.close();

    // ---------- 2. With discoveries: investigations summary, server layout untouched -----
    data = state();
    data.seedUnlocks = [
      { id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString(), lessonTitle: 'Fotossíntese e respiração celular' },
      { id: 'stamp.first-evidence', kind: 'stamp', occurredAt: new Date().toISOString() },
    ];
    // A layout saved on the server before 3.7 (the globe on the right shelf).
    const savedLayout = { items: [{ slot: 'shelf-right', objectId: 'object.globe' }], version: 1 };
    data.discoveryState = {
      investigations: new Map(),
      unlocks: data.seedUnlocks.map((u) => ({ unlockedAt: u.occurredAt, ...u })),
      layout: structuredClone(savedLayout),
      requests: [],
    };
    ({ context, page } = await openApp(browser, base, { ...allFlags, discoveries: true }, data));
    await openHome(page, base);
    await assertNoDesk(page, 'Início com descobertas');
    assert(await page.locator('.side-navigation a[href="./descobertas.html"]').isVisible(), 'Descobertas in the sidebar');
    assert(await page.locator('.side-navigation a[href="./gabinete.html"]').isVisible(), 'Gabinete under it');
    assert.equal(await page.locator('[data-desk-expedition]:visible').count(), 0, 'the summary belongs to the adventure mode');
    record('Início com descobertas (API simulada): continua um painel sem mesa; Descobertas e Gabinete na barra lateral; resumo de investigações só no modo aventura');

    // ---------- 3. Experience modes: same data, more or less decoration --------------------
    await page.goto(base + '/aparencia.html');
    await page.locator('[data-atmosphere-tiles] .atmosphere-tile').first().waitFor();
    await page.locator('label.experience-option', { hasText: 'Estudo aventura' }).click();
    assert.equal(await rootData(page, 'experience'), 'adventure');
    await openHome(page, base);
    await page.locator('[data-desk-expedition]:visible').waitFor();
    assert.match(
      await page.locator('[data-expedition-text]').textContent(),
      /^0 investigações concluídas · 2 de \d+ itens no Gabinete$/,
      'the summary counts investigations and items in the Gabinete',
    );
    await assertNoDesk(page, 'Início (aventura)');
    await axeCheck(page, 'body', 'Início (aventura)');
    await page.goto(base + '/aparencia.html');
    await page.locator('label.experience-option', { hasText: 'Estudo silencioso' }).click();
    assert.equal((await prefs(page)).experience, 'quiet', 'the mode is the account preference (synced)');
    await openHome(page, base);
    assert.equal(await rootData(page, 'experience'), 'quiet');
    assert.equal(await page.locator('.lume-companion:visible').count(), 0, 'quiet hides Lume');
    assert.equal(await page.locator('[data-desk-expedition]:visible').count(), 0, 'and the investigations summary');
    assert(await page.locator('.dash-continue .dashboard-lesson-card').first().isVisible(), 'the next action stays');
    assert.equal(await page.locator('[data-tasks-count]').textContent(), '3', 'and every function');
    assert.equal(await page.locator('.side-navigation a[href="./descobertas.html"]:visible').count(), 1, 'Descobertas stays in the menu');
    await page.goto(base + '/gabinete.html');
    await page.locator('[data-drawer]').first().waitFor();
    assert.equal(await page.locator('input[name="experience-mode"][value="quiet"]').isChecked(), true, 'Gabinete shows the same choice');
    await page.locator('label', { hasText: 'Estudo aconchegante' }).click();
    await openHome(page, base);
    assert.equal(await rootData(page, 'experience'), 'cozy');
    assert.deepEqual(data.discoveryState.layout, savedLayout, 'the server layout is kept as it was');
    assert.equal(data.discoveryState.requests.filter((r) => r.kind === 'layout').length, 0, 'Início never writes the layout');
    record('Modos (API simulada): aventura mostra "N investigações concluídas · X de Y itens no Gabinete" no Início; silencioso esconde a Lume e o resumo, mantendo a próxima ação, as tarefas e o menu; Gabinete e Aparência mostram a mesma preferência da conta; layout do servidor intacto, nenhum PUT /api/collection/layout');
    await context.close();

    // ---------- 4. Atmospheres: apply, customise, accessibility wins ---------------------
    data = state();
    ({ context, page } = await openApp(browser, base, allFlags, data));
    await page.goto(base + '/aparencia.html');
    await page.locator('.atmosphere-tile').first().waitFor();
    assert.equal(await page.locator('.atmosphere-tile').count(), 8);
    await page.locator('.atmosphere-tile', { hasText: 'Biblioteca chuvosa' }).click();
    assert.equal(await rootData(page, 'atmosphere'), 'rainy-library');
    assert.equal(await bg(page), 'rgb(241, 244, 247)', 'the palette applies at once');
    assert.equal(await page.locator('.atmosphere-tile[aria-pressed="true"]').count(), 1);
    assert.match(await page.locator('[data-studio-sound]').textContent(), /Ouvir a mistura sonora Biblioteca chuvosa/, 'the sound is offered');
    assert.notEqual(await page.locator('[data-soundscape-trigger]').getAttribute('data-state'), 'playing', 'choosing an atmosphere never starts the sound');
    await axeCheck(page, 'main', 'Aparência › atmosferas');
    await shot(page, 'estudio-simples-1440', false);
    await page.locator('label', { hasText: 'Estúdio' }).first().click();
    await page.locator('[data-studio-detail]:not([hidden])').waitFor();
    await page.locator('[data-studio-accents] label', { hasText: 'Musgo' }).click();
    assert.equal(await rootData(page, 'atmosphereAccent'), 'moss');
    const strong = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim());
    assert.equal(strong, '#3f634a');
    await page.locator('[data-studio-outfits] label', { hasText: 'Chapéu de explorador' }).click();
    assert.equal((await prefs(page)).lumeOutfit, 'explorer-hat');
    // 3.7: the desk window option only affected the desk; it is hidden, the preference is kept.
    assert(await page.locator('[data-desk-window-setting]').isHidden(), 'no desk window option without a desk');
    await page.locator('[data-preview-lume] .lume-companion[data-outfit="explorer-hat"]').waitFor();
    await axeCheck(page, 'main', 'Aparência › estúdio');
    await shot(page, 'estudio-detalhes-1440', false);
    // On Início: the palette applies; there is no desk window to show the landscape any more.
    await openHome(page, base);
    await assertNoDesk(page, 'Início (atmosfera)');
    assert.equal(await bg(page), 'rgb(241, 244, 247)');
    // "Contraste reforçado" wins over the palette and removes decoration.
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-high-contrast').check();
    assert.equal(await rootData(page, 'highContrast'), 'true');
    assert.notEqual(await bg(page), 'rgb(241, 244, 247)');
    await openHome(page, base);
    assert.equal(await rootData(page, 'highContrast'), 'true');
    assert.notEqual(await bg(page), 'rgb(241, 244, 247)', 'high contrast wins on Início too');
    assert.equal(await page.locator('body [data-decoration]:visible').count(), 0, 'high contrast hides decoration');
    await assertNoDesk(page, 'Início (contraste reforçado)');
    assert(await page.locator('.dash-continue .dashboard-lesson-card').first().isVisible(), 'the dashboard stays complete');
    await axeCheck(page, 'body', 'Início (contraste reforçado)');
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-high-contrast-off').check();
    // A classic theme keeps the atmosphere but not its colours.
    await page.locator('[data-theme-option="forest"]').click();
    assert.equal(await rootData(page, 'atmospherePalette'), 'off');
    assert.equal(await rootData(page, 'atmosphere'), 'rainy-library');
    record('Atmosferas: 8 prévias; escolher aplica paleta, traje e paisagem na hora; som oferecido, nunca tocado sozinho; estúdio muda destaque e traje com prévia ao vivo (sem opção de janela); Início usa a paleta, sem mesa; contraste reforçado vence a paleta e esconde decoração no Início; temas clássicos vencem a paleta; axe');
    await context.close();

    // ---------- 5. 390 px: Início with tabs, Aparência; no horizontal scroll -------------
    data = state();
    ({ context, page } = await openApp(browser, base, allFlags, data, { width: 390, height: 844 }));
    await openHome(page, base);
    await assertNoDesk(page, 'Início 390');
    await page.locator('.dash-rail-tabs:visible').waitFor();
    const tabs = page.locator('.dash-rail-tab');
    assert((await tabs.count()) >= 3, 'margin notes as tabs');
    assert.equal(await page.locator('.dash-rail > .dash-card:visible').count(), 1, 'one panel at a time');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
    const panel = await tabs.nth(1).getAttribute('aria-controls');
    assert(await page.locator(`#${panel}`).isVisible());
    await settle(page);
    await noHorizontalScroll(page, 'Início 390');
    await axeCheck(page, 'body', 'Início 390');
    await shot(page, 'inicio-390');
    for (const view of ['simple', 'studio']) {
      await page.goto(base + '/aparencia.html');
      await page.locator('.atmosphere-tile').first().waitFor();
      if (view === 'studio') await page.locator('label', { hasText: 'Estúdio' }).first().click();
      await settle(page);
      await noHorizontalScroll(page, `Aparência 390 ${view}`);
      await axeCheck(page, 'main', `Aparência 390 ${view}`);
    }
    record('390 px: notas da margem em abas (setas do teclado), Início sem mesa; Início e Aparência sem rolagem horizontal; axe');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) throw new Error(`Erros no navegador:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ passed: passed.length }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
