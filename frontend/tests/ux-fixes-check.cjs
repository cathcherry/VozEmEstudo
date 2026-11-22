// 3.6 UX fixes in a real browser with the simulated app (support/mock-app.cjs):
//   1. Biblioteca "Selecionar": a click or tap on a lesson or folder selects it and never opens
//      it; Space/Enter toggle; Shift extends; Esc and "Concluir seleção" restore opening; a
//      discipline's page has a band in its colour, counts and units as sub-folders.
//   2. Revisar: today's work first (counts on the tabs, one review card), management tools in a
//      compact toolbar and a "Gerenciar" view; no nested cards; 390 and 1440 without overflow.
//   3. One focus engine: the timer controls live only on Focar; Planejar shows history and
//      analysis and links to Focar; other pages show a small topbar indicator while it runs.
//   4. Arrumar a mesa: an object on the desk leaves the drawer list, moving swaps, storing
//      returns it, "Desfazer" undoes the last move; with discoveries on (server layout) and off.
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
  noHorizontalScroll,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'ux-fixes');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

/** More lessons in Biologia: two units with lessons, and one loose lesson. */
function richLibrary(data) {
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const lesson = (id, title, unit, days) => ({
    id,
    title,
    subject: 'Biologia',
    subject_id: 'sub-bio',
    unit_id: unit,
    status: 'PRONTO',
    created_at: ago(days),
    audio_files: [{ duration_ms: 1500000, extension: 'mp3' }],
  });
  data.extraMaterials = [
    lesson('l-ciclo', 'Ciclo de Krebs', 'unit-energia', 2),
    lesson('l-memb', 'Membrana plasmática', 'unit-celula', 6),
    lesson('l-vir', 'Vírus: estrutura e replicação', null, 10),
  ];
  return data;
}
const barText = (page) => page.locator('.library-selection-bar p').textContent();

async function library(browser, base) {
  for (const width of [1440, 390]) {
    const { context, page } = await openApp(browser, base, allFlags, richLibrary(state()), { width, height: width < 700 ? 844 : 1000 });
    const label = `Biblioteca ${width}`;
    // Root: folders select (all their lessons), never open.
    await page.goto(base + '/historico.html');
    await settle(page);
    await page.getByRole('button', { name: 'Selecionar' }).click();
    const biology = page.locator('.library-subject-folder > summary', { hasText: 'Biologia' });
    await biology.click();
    assert.doesNotMatch(page.url(), /folder=/, `${label}: a folder click must not open it while selecting`);
    assert.equal(await barText(page), '4 aulas selecionadas');
    assert.equal(await page.getByRole('checkbox', { name: /Selecionar a pasta Biologia/ }).isChecked(), true);
    // Shift-click on another folder selects the range in between (Física).
    await page.locator('.library-subject-folder > summary', { hasText: 'Física' }).click({ modifiers: ['Shift'] });
    assert.equal(await barText(page), '5 aulas selecionadas');
    await biology.click();
    assert.equal(await barText(page), '1 aula selecionada');
    await noHorizontalScroll(page, `${label} seleção`);
    await axeCheck(page, 'body', `${label} seleção na raiz`);
    // Esc ends the mode: a folder opens again.
    await page.keyboard.press('Escape');
    await page.locator('.library-selection-bar').waitFor({ state: 'hidden' });
    await biology.click();
    await page.waitForURL(/folder=sub-bio/);
    // The discipline's interior: a band in its colour with the counts, units as sub-folders.
    const band = page.locator('[data-folder-band]');
    await band.waitFor();
    assert.match(await band.locator('h2').textContent(), /Biologia/);
    assert.match(await band.textContent(), /4 aulas/);
    assert.match(await band.textContent(), /2 unidades/);
    assert.equal(await page.locator('.library-folder-page').getAttribute('data-folder-tone'), 'lavender');
    assert.equal(await page.locator('.library-unit-grid > .library-unit-folder').count(), 2);
    if (width > 700) {
      const tile = await page.locator('.library-unit-grid > .library-unit-folder > summary').first().evaluate((node) => getComputedStyle(node).flexDirection);
      assert.equal(tile, 'column', 'units are folder icons in the icon view');
    }
    await shot(page, `disciplina-${width}`);
    // Inside: lessons and unit folders select on click, Space/Enter toggle, nothing navigates.
    await page.getByRole('button', { name: 'Selecionar' }).click();
    const loose = page.locator('.library-material', { hasText: 'Vírus' });
    await loose.getByRole('link', { name: 'Vírus: estrutura e replicação', exact: true }).click({ force: true });
    await page.waitForTimeout(150);
    assert.match(page.url(), /historico\.html\?folder=sub-bio$/, `${label}: a lesson title click must not open the lesson`);
    assert.equal(await barText(page), '1 aula selecionada');
    // A click on an empty part of the row toggles it off again.
    const box = await loose.boundingBox();
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 8);
    assert.equal(await barText(page), 'Toque nas aulas ou pastas para selecionar');
    await page.locator('.library-unit-folder > summary', { hasText: 'Célula' }).click();
    assert.match(page.url(), /folder=sub-bio$/);
    assert.equal(await barText(page), '1 aula selecionada');
    // Keyboard: links step aside, the checkbox is the stop; Space and Enter toggle.
    const virusBox = page.getByRole('checkbox', { name: 'Selecionar Vírus: estrutura e replicação' });
    await virusBox.focus();
    await page.keyboard.press('Space');
    assert.equal(await virusBox.isChecked(), true);
    await page.keyboard.press('Enter');
    assert.equal(await virusBox.isChecked(), false);
    assert.equal(await loose.getByRole('link').first().getAttribute('tabindex'), '-1');
    await page.keyboard.press('Enter');
    assert.equal(await barText(page), '2 aulas selecionadas');
    await axeCheck(page, 'body', `${label} seleção na disciplina`);
    await shot(page, `disciplina-selecao-${width}`);
    // "Concluir seleção" restores opening.
    await page.getByRole('button', { name: 'Concluir seleção' }).click();
    assert.equal(await loose.getByRole('link').first().getAttribute('tabindex'), null);
    await loose.getByRole('link', { name: 'Vírus: estrutura e replicação', exact: true }).click();
    await page.waitForURL(/material\.html\?id=l-vir/);
    // A unit page: the band names the unit and its discipline.
    await page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
    await settle(page);
    assert.match(await page.locator('[data-folder-band]').textContent(), /BiologiaMetabolismo energético/);
    // Tap on a phone (touch) selects too.
    if (width < 700) {
      const touch = await openApp(browser, base, allFlags, richLibrary(state()), { width, height: 844 }, { context: { hasTouch: true, isMobile: true } });
      await touch.page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
      await settle(touch.page);
      await touch.page.getByRole('button', { name: 'Selecionar' }).tap();
      await touch.page.locator('.library-material input.library-select').first().waitFor();
      await touch.page.locator('.library-material', { hasText: 'Fotossíntese' }).getByRole('link').tap({ force: true });
      await touch.page.waitForTimeout(150);
      assert.match(touch.page.url(), /historico\.html/, 'a tap selects instead of opening');
      assert.equal(await barText(touch.page), '1 aula selecionada');
      await touch.context.close();
    }
    await context.close();
  }
  record('Biblioteca: em "Selecionar", clique, toque, Espaço e Enter selecionam aulas e pastas (pasta = suas aulas), Shift estende, nada abre; Esc e "Concluir seleção" devolvem o abrir; a disciplina tem faixa na sua cor, contagens e unidades como subpastas');
}

const prefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('audioestudo-ui-preferences') || '{}'));
const drawer = (page) => page.locator('[data-desk-object]').evaluateAll((nodes) => nodes.map((node) => node.dataset.deskObject));
const onDesk = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-desk-slot]')]
        .map((slot) => [slot.dataset.deskSlot, slot.querySelector('.desk-slot-object')?.dataset.objectId || ''])
        .filter(([, id]) => id),
    ),
  );
const slotTarget = (page, slot) => page.locator(`[data-desk-slot="${slot}"] .desk-slot-target`);
async function dragTo(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(40, b.height / 2), { steps: 8 });
  return async () => page.mouse.up();
}

async function desk(browser, base) {
  // ---- Discoveries off: starter objects in the appearance preferences ----------------------
  {
    const { context, page } = await openApp(browser, base, allFlags, state());
    await page.goto(base + '/painel.html');
    await page.locator('[data-desk-scene][data-ready="true"]').waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
    // Teacup, inkwell and cactus are on the desk: the drawer holds only the hourglass.
    assert.deepEqual(await drawer(page), ['object.hourglass']);
    assert.equal(await page.getByRole('button', { name: 'Desfazer' }).isDisabled(), true);
    await page.locator('[data-desk-object="object.hourglass"]').click();
    await slotTarget(page, 'desk-center').click();
    await page.locator('[data-desk-status]', { hasText: 'Mesa salva' }).waitFor();
    assert.deepEqual(await drawer(page), [], 'placed: the hourglass left the drawer');
    await page.locator('.desk-tray-empty').waitFor();
    assert.equal((await prefs(page)).deskStarters['desk-center'], 'object.hourglass');
    // Choose the hourglass on the desk: it is lifted and can be stored.
    await slotTarget(page, 'desk-center').click();
    assert.equal(await page.locator('[data-desk-slot="desk-center"]').getAttribute('data-picked'), 'true');
    await page.getByRole('button', { name: 'Guardar ampulheta na gaveta' }).click();
    await page.locator('[data-desk-object="object.hourglass"]').waitFor();
    assert.equal((await prefs(page)).deskStarters['desk-center'], undefined, 'stored: back in the drawer');
    // Undo the last move: the hourglass is back where it was, in the screen and the preferences.
    await page.getByRole('button', { name: 'Desfazer' }).click();
    await page.locator('[data-desk-slot="desk-center"] [data-object-id="object.hourglass"]').waitFor();
    assert.deepEqual(await drawer(page), []);
    assert.equal((await prefs(page)).deskStarters['desk-center'], 'object.hourglass');
    // Drag a placed object onto another: they swap places; nothing is ever in two places.
    const release = await dragTo(page, slotTarget(page, 'desk-center'), slotTarget(page, 'desk-right'));
    assert.equal(await page.locator('[data-desk-slot="desk-center"]').getAttribute('data-lifting'), 'true', 'carried: faded at its place');
    assert.equal(await page.locator('[data-desk-tray]').getAttribute('data-dropzone'), 'true', 'the drawer takes it back');
    await release();
    await page.locator('[data-desk-slot="desk-right"] [data-object-id="object.hourglass"]').waitFor();
    const placed = await onDesk(page);
    assert.equal(placed['desk-center'], 'object.teacup');
    assert.equal(new Set(Object.values(placed)).size, Object.values(placed).length, 'each object once');
    // Ctrl+Z undoes the swap.
    await page.keyboard.press('Control+z');
    await page.locator('[data-desk-slot="desk-center"] [data-object-id="object.hourglass"]').waitFor();
    await axeCheck(page, 'body', 'Arrumar a mesa (sem descobertas)');
    await page.getByRole('button', { name: 'Concluir' }).click();
    await page.reload();
    await page.locator('[data-desk-slot="desk-center"] [data-object-id="object.hourglass"]').waitFor();
    await context.close();
  }
  // ---- Discoveries on: collectibles saved with PUT /api/collection/layout ------------------
  {
    const data = state();
    data.seedUnlocks = [
      { id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString() },
      { id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString() },
    ];
    for (const width of [1440, 390]) {
      const { context, page } = await openApp(browser, base, { ...allFlags, discoveries: true }, data, { width, height: width < 700 ? 844 : 1000 });
      await page.goto(base + '/painel.html');
      await page.locator('[data-desk-scene][data-ready="true"]').waitFor({ state: 'attached' });
      await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
      if (width > 700) {
        await page.locator('[data-desk-object="object.globe"]').waitFor();
        assert.deepEqual(await drawer(page), ['object.hourglass', 'object.globe'], 'one globe, even if unlocked twice');
        // From the drawer onto the teacup: the globe takes the place, the teacup goes to the drawer.
        await page.locator('[data-desk-object="object.globe"]').click();
        await slotTarget(page, 'desk-right').click();
        await page.locator('[data-desk-status]', { hasText: 'Mesa salva' }).waitFor();
        assert.deepEqual(data.discoveryState.layout.items, [{ slot: 'desk-right', objectId: 'object.globe' }]);
        assert.deepEqual(await drawer(page), ['object.teacup', 'object.hourglass']);
        assert.equal((await prefs(page)).deskStarters['desk-right'], undefined);
        // Undo: the teacup is back and the server layout is empty again.
        await page.getByRole('button', { name: 'Desfazer' }).click();
        await page.locator('[data-desk-slot="desk-right"] [data-object-id="object.teacup"]').waitFor();
        await page.waitForFunction(() => document.querySelector('[data-desk-status]').textContent.includes('Desfeito'));
        assert.deepEqual(data.discoveryState.layout.items, []);
        assert.deepEqual(await drawer(page), ['object.hourglass', 'object.globe']);
        await shot(page, `mesa-${width}`, false);
      } else {
        // Phone: tap the globe, tap the free middle place.
        await page.locator('[data-desk-object="object.globe"]').click();
        await slotTarget(page, 'desk-center').click();
        await page.locator('[data-desk-slot="desk-center"] [data-object-id="object.globe"]').waitFor();
        assert(!(await drawer(page)).includes('object.globe'));
        await noHorizontalScroll(page, 'Arrumar a mesa 390');
        await shot(page, `mesa-${width}`, false);
      }
      await context.close();
    }
    // The Gabinete's "Sua mesa" follows the same desk (starters included) and swaps.
    const { context, page } = await openApp(browser, base, { ...allFlags, discoveries: true }, data);
    await page.goto(base + '/gabinete.html');
    await page.locator('[data-desk-section]:not([hidden])').waitFor();
    assert.equal(await page.locator('.desk-slot[data-slot="desk-right"] .desk-slot-object').textContent(), 'Xícara de chá', 'starters are shown');
    const globe = page.getByLabel('Globo');
    assert.equal(await globe.inputValue(), 'desk-center');
    await globe.selectOption({ label: 'Mesa, à direita (troca com xícara de chá)' });
    assert.equal(await page.locator('.desk-slot[data-slot="desk-center"] .desk-slot-object').textContent(), 'Xícara de chá', 'swapped');
    await page.getByRole('button', { name: 'Salvar a mesa' }).click();
    await page.locator('[data-cabinet-status]', { hasText: 'Mesa salva.' }).waitFor();
    assert.deepEqual(data.discoveryState.layout.items, [{ slot: 'desk-right', objectId: 'object.globe' }]);
    assert.equal((await prefs(page)).deskStarters['desk-center'], 'object.teacup');
    await axeCheck(page, 'main', 'Gabinete, Sua mesa');
    await context.close();
  }
  record('Arrumar a mesa: objeto colocado sai da gaveta; mover troca de lugar; guardar devolve; Desfazer e Ctrl+Z; arrastar mostra destinos; com descobertas (layout no servidor) e sem (preferências); Gabinete usa a mesma mesa');
}

async function review(browser, base) {
  for (const width of [1440, 390]) {
    const { context, page } = await openApp(browser, base, { ...allFlags, flashcards_v3: true }, state(), { width, height: width < 700 ? 844 : 1000 });
    const label = `Revisar ${width}`;
    await page.goto(base + '/revisar.html');
    await page.locator('.review-toolbar').waitFor();
    await page.locator('.review-today-item').first().waitFor();
    // Today's work first: one line of what is waiting, counts on the tabs, the tab with work open.
    assert.deepEqual(await page.locator('.review-today-item').allTextContents(), ['5 cartões para revisar', '1 lista de questões para terminar']);
    assert.equal(await page.locator('#tab-flashcards .tool-tab-count').textContent(), '5');
    assert.equal(await page.locator('#tab-questoes .tool-tab-count').textContent(), '1');
    assert.equal(await page.locator('#tab-flashcards').getAttribute('aria-selected'), 'true');
    // One card on the page: the panel has no chrome of its own, management is out of sight.
    const chrome = await page.locator('[data-flashcards-panel]').evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.borderTopWidth} ${style.backgroundColor} ${style.boxShadow}`;
    });
    assert.equal(chrome, '0px rgba(0, 0, 0, 0) none', 'no card around the review card');
    assert.equal(await page.locator('.flashcard-review-card').count(), 1);
    assert(await page.locator('.review-manage').isHidden(), 'managing is a second view');
    assert(await page.locator('[data-flashcard-set-filter]').isHidden(), 'filters live in a popover');
    assert.equal(await page.locator('.flashcard-create-tile:visible').count(), 0, 'creating lives in a popover');
    await noHorizontalScroll(page, label);
    await settle(page);
    await axeCheck(page, 'main', label);
    await shot(page, `revisar-${width}`);
    // The popovers open, close with Esc and give focus back.
    await page.locator('.review-filter > summary').click();
    assert(await page.locator('[data-flashcard-set-filter]').isVisible());
    await noHorizontalScroll(page, `${label} filtros`);
    await axeCheck(page, '.review-toolbar', `${label} filtros`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.review-filter').evaluate((node) => node.open), false);
    await page.locator('.review-create > summary').click();
    await page.getByRole('button', { name: /Gerar cartões com IA/ }).waitFor();
    await page.locator('.review-stage').click({ position: { x: 5, y: 5 } });
    assert.equal(await page.locator('.review-create').evaluate((node) => node.open), false, 'a click outside closes it');
    // Gerenciar: merge/import, organize and sets, ruled; back to the review.
    await page.getByRole('button', { name: 'Gerenciar' }).click();
    assert(await page.locator('.review-manage').isVisible());
    assert(await page.locator('.review-stage').isHidden());
    assert(await page.getByRole('button', { name: 'Mesclar conjuntos' }).isVisible());
    assert.equal(await page.locator('.review-manage details.flashcard-management').count(), 2);
    await noHorizontalScroll(page, `${label} gerenciar`);
    await axeCheck(page, 'main', `${label} gerenciar`);
    await page.getByRole('button', { name: 'Voltar à revisão' }).click();
    assert(await page.locator('.review-stage').isVisible());
    // The other tabs: ruled lists, no boxes.
    await page.locator('#tab-questoes').click();
    await page.locator('.quiz-history-list li').first().waitFor();
    assert.equal(await page.locator('.quiz-history-list').first().evaluate((node) => getComputedStyle(node).borderLeftWidth), '0px');
    await page.locator('#tab-anotacoes').click();
    await page.locator('#anotacoes .annotation-card').first().waitFor();
    assert.equal(await page.locator('#anotacoes .annotation-card').first().evaluate((node) => getComputedStyle(node).borderTopWidth), '0px');
    await noHorizontalScroll(page, `${label} anotações`);
    await axeCheck(page, 'main', `${label} anotações`);
    await context.close();
  }
  record('Revisar: "Para hoje" e contagens nas abas; um cartão por vez sem caixa em volta; filtros e novo cartão em popovers; gerenciar (mesclar, importar, organizar, conjuntos) numa segunda vista; Questões e Anotações em linhas; 390 e 1440 sem rolagem lateral; axe');
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
  try {
    for (const [name, run] of Object.entries({ library, review, desk })) if (!only || only.test(name)) await run(browser, base);
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed.length} ux-fixes checks passed.`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
