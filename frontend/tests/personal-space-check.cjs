// 3.5 Milestone 5 (Personalization) in a real browser with the simulated app: experience modes
// (quiet hides Lume and decoration, data intact), atmospheres (apply and customise, accessibility
// wins), the desk on Início (keyboard and pointer placement, persistence in both stores), the
// sidebar entry for Descobertas, narrow-screen tabs, axe and no horizontal scroll at 390 px.
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

async function openDesk(page, base) {
  await page.goto(base + '/painel.html');
  await ready(page);
  await page.locator('[data-desk-scene][data-ready="true"]').waitFor({ state: 'attached' });
  await page.locator('.desk-lume .lume-companion').waitFor({ state: 'attached' });
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- 1. Desk without the discoveries feature: starter objects only -------------
    let data = state();
    let { context, page } = await openApp(browser, base, allFlags, data);
    await openDesk(page, base);
    assert.equal(await rootData(page, 'experience'), 'cozy');
    assert(await page.locator('.desk-stage').isVisible(), 'the desk scene is shown in cozy mode');
    assert.equal(await page.locator('[data-desk-slot="desk-right"] [data-object-id="object.teacup"]').count(), 1);
    assert.match(await page.locator('[data-desk-summary]').textContent(), /Xícara de chá/);
    assert.equal(await page.locator('.side-navigation [data-nav-feature="discoveries"]:visible').count(), 0, 'no Descobertas without the feature');
    // Keyboard: open the drawer, choose the hourglass, then the window sill.
    await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
    await page.locator('[data-desk-tray]:not([hidden])').waitFor();
    assert.equal(await page.locator('.desk-tray-object').count(), 4, 'four starter objects');
    assert.equal(await page.locator('[data-desk-object="object.globe"]').count(), 0, 'no collectible without the feature');
    await page.locator('[data-desk-object="object.hourglass"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-desk-status]', { hasText: 'escolha um lugar' }).waitFor();
    const sill = page.getByRole('button', { name: 'Colocar ampulheta em janela' });
    await sill.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-desk-status]', { hasText: 'Mesa salva' }).waitFor();
    assert.equal((await prefs(page)).deskStarters.window, 'object.hourglass');
    // Escape cancels a choice, then closes the drawer.
    await page.locator('[data-desk-object="object.teacup"]').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-desk-object="object.teacup"]').getAttribute('aria-pressed'), 'false');
    await axeCheck(page, 'body', 'Início, arrumando a mesa');
    await shot(page, 'mesa-arrumando-1440', false);
    await page.keyboard.press('Escape');
    assert(await page.locator('[data-desk-tray]').isHidden());
    await page.reload();
    await ready(page);
    await page.locator('[data-desk-slot="window"] [data-object-id="object.hourglass"]').waitFor();
    record('Escrivaninha sem a flag de descobertas: só objetos iniciais; colocar pelo teclado (objeto → lugar), Esc cancela; fica salvo nas preferências da conta; axe');
    await context.close();

    // ---------- 2. With discoveries: an unlocked object, placed by dragging ---------------
    data = state();
    data.seedUnlocks = [
      { id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString(), lessonTitle: 'Fotossíntese e respiração celular' },
      { id: 'stamp.first-evidence', kind: 'stamp', occurredAt: new Date().toISOString() },
    ];
    ({ context, page } = await openApp(browser, base, { ...allFlags, discoveries: true }, data));
    await openDesk(page, base);
    assert(await page.locator('.side-navigation a[href="./descobertas.html"]').isVisible(), 'Descobertas in the sidebar');
    assert(await page.locator('.side-navigation a[href="./gabinete.html"]').isVisible(), 'Gabinete under it');
    await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
    await page.locator('[data-desk-object="object.globe"]').waitFor();
    assert.equal(await page.locator('[data-desk-object="object.desk-lamp"]').count(), 0, 'locked objects never appear');
    const from = await page.locator('[data-desk-object="object.globe"]').boundingBox();
    const to = await page.locator('[data-desk-slot="shelf-right"] .desk-slot-target').boundingBox();
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.locator('[data-desk-slot="shelf-right"] [data-object-id="object.globe"]').waitFor();
    await page.locator('[data-desk-status]', { hasText: 'Mesa salva' }).waitFor();
    assert.deepEqual(data.discoveryState.layout.items, [{ slot: 'shelf-right', objectId: 'object.globe' }]);
    assert(!String(JSON.stringify((await prefs(page)).deskStarters)).includes('globe'), 'collectibles are not saved as starters');
    // The starter objects never reach the server's layout.
    assert(!data.discoveryState.requests.some((r) => r.kind === 'layout' && r.items.some((i) => i.objectId === 'object.teacup')));
    await page.getByRole('button', { name: 'Concluir' }).click();
    record('Escrivaninha com descobertas (API simulada): objeto desbloqueado arrastado até a prateleira e salvo com PUT /api/collection/layout; objetos bloqueados não aparecem; Descobertas e Gabinete na barra lateral');

    // ---------- 3. Experience modes: same data, more or less decoration --------------------
    await page.goto(base + '/aparencia.html');
    await page.locator('[data-atmosphere-tiles] .atmosphere-tile').first().waitFor();
    await page.locator('label.experience-option', { hasText: 'Estudo aventura' }).click();
    assert.equal(await rootData(page, 'experience'), 'adventure');
    await openDesk(page, base);
    await page.locator('[data-desk-expedition]:visible').waitFor();
    assert.match(await page.locator('[data-expedition-text]').textContent(), /itens no Gabinete/);
    await page.goto(base + '/aparencia.html');
    await page.locator('label.experience-option', { hasText: 'Estudo silencioso' }).click();
    assert.equal((await prefs(page)).experience, 'quiet', 'the mode is the account preference (synced)');
    await page.goto(base + '/painel.html');
    await ready(page);
    assert.equal(await rootData(page, 'experience'), 'quiet');
    assert(await page.locator('.desk-stage').isHidden(), 'quiet hides the desk scene');
    assert.equal(await page.locator('.lume-companion:visible').count(), 0, 'and Lume');
    assert(await page.locator('[data-desk-arrange]').isHidden());
    assert(await page.locator('.dash-continue .dashboard-lesson-card').isVisible(), 'the next action stays');
    assert.equal(await page.locator('[data-tasks-count]').textContent(), '3', 'and every function');
    assert.equal(await page.locator('.side-navigation a[href="./descobertas.html"]:visible').count(), 1, 'Descobertas stays in the menu');
    await page.goto(base + '/gabinete.html');
    await page.locator('.cabinet-item').first().waitFor();
    assert.equal(await page.locator('input[name="experience-mode"][value="quiet"]').isChecked(), true, 'Gabinete shows the same choice');
    await page.locator('label', { hasText: 'Estudo aconchegante' }).click();
    await openDesk(page, base);
    assert(await page.locator('[data-desk-slot="shelf-right"] [data-object-id="object.globe"]').isVisible(), 'nothing was lost');
    record('Modos (API simulada): aventura mostra as investigações no Início; silencioso esconde a Lume, a cena e o botão de arrumar, mantendo a próxima ação, as tarefas e o menu; Gabinete e Aparência mostram a mesma preferência da conta; nada se perde');
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
    await page.locator('label', { hasText: 'Sem paisagem' }).click();
    assert.equal(await rootData(page, 'atmosphereWallpaper'), 'off');
    await page.locator('[data-preview-lume] .lume-companion[data-outfit="explorer-hat"]').waitFor();
    await axeCheck(page, 'main', 'Aparência › estúdio');
    await shot(page, 'estudio-detalhes-1440', false);
    // On the desk: the outfit and no landscape in the window.
    await openDesk(page, base);
    await page.locator('.desk-lume .lume-companion[data-outfit="explorer-hat"]').waitFor();
    assert.equal(await page.locator('[data-desk-window][data-wallpaper="off"]').count(), 1);
    assert.equal(await bg(page), 'rgb(241, 244, 247)');
    // "Contraste reforçado" wins over the palette and removes decoration.
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-high-contrast').check();
    assert.equal(await rootData(page, 'highContrast'), 'true');
    assert.notEqual(await bg(page), 'rgb(241, 244, 247)');
    await openDesk(page, base);
    assert(await page.locator('.desk-stage').isHidden(), 'high contrast hides decoration');
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-high-contrast-off').check();
    // A classic theme keeps the atmosphere's desk but not its colours.
    await page.locator('[data-theme-option="forest"]').click();
    assert.equal(await rootData(page, 'atmospherePalette'), 'off');
    assert.equal(await rootData(page, 'atmosphere'), 'rainy-library');
    record('Atmosferas: 8 prévias; escolher aplica paleta, traje e paisagem na hora; som oferecido, nunca tocado sozinho; estúdio muda destaque, traje e janela com prévia ao vivo; contraste reforçado e temas clássicos vencem a paleta; axe');
    await context.close();

    // ---------- 5. 390 px: Início with tabs, Aparência; no horizontal scroll -------------
    data = state();
    ({ context, page } = await openApp(browser, base, allFlags, data, { width: 390, height: 844 }));
    await openDesk(page, base);
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
    // Arranging works on a phone too.
    await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
    await page.locator('[data-desk-object="object.cactus"]').click();
    await page.getByRole('button', { name: 'Colocar cacto em mesa, ao centro' }).click();
    await page.locator('[data-desk-slot="desk-center"] [data-object-id="object.cactus"]').waitFor();
    await noHorizontalScroll(page, 'Início 390, arrumando');
    for (const view of ['simple', 'studio']) {
      await page.goto(base + '/aparencia.html');
      await page.locator('.atmosphere-tile').first().waitFor();
      if (view === 'studio') await page.locator('label', { hasText: 'Estúdio' }).first().click();
      await settle(page);
      await noHorizontalScroll(page, `Aparência 390 ${view}`);
      await axeCheck(page, 'main', `Aparência 390 ${view}`);
    }
    record('390 px: notas da margem em abas (setas do teclado), mesa arrumável por toque, Início e Aparência sem rolagem horizontal; axe');
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
