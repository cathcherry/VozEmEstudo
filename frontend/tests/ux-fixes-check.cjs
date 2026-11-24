// 3.6 UX fixes in a real browser with the simulated app (support/mock-app.cjs):
//   1. Biblioteca "Selecionar": a click or tap on a lesson or folder selects it and never opens
//      it; Space/Enter toggle; Shift extends; Esc and "Concluir seleção" restore opening; a
//      discipline's page has a band in its colour, counts and units as sub-folders.
//   2. Flashcards (own page, revisar.html redirects): six sections; the card turns by click, tap,
//      Space/Enter or its button; ratings below it; reduced motion; 390 and 1440 without overflow.
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
    await loose.locator('.material-meta').click();
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
    await settle(page); // the page below the desk has finished loading: nothing moves under the pointer
    await slotTarget(page, 'desk-center').scrollIntoViewIfNeeded();
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
    // The Gabinete's "Colocar na mesa" (museum label of an object) follows the same desk
    // (starters included) and swaps.
    const { context, page } = await openApp(browser, base, { ...allFlags, discoveries: true }, data);
    await page.goto(base + '/gabinete.html?gaveta=object');
    await page.locator('.cabinet-item[data-collectible="object.globe"]').click();
    const label = page.locator('[data-specimen-dialog]');
    await label.locator('.specimen-desk-now', { hasText: 'Na mesa: Mesa, ao centro.' }).waitFor();
    const place = label.getByLabel('Lugar na mesa');
    assert.equal(await place.inputValue(), 'desk-center');
    await place.selectOption({ label: 'Mesa, à direita (troca com xícara de chá)' });
    await label.getByRole('button', { name: 'Mudar de lugar' }).click();
    await page.locator('[data-cabinet-status]', { hasText: 'Colocado na mesa: Mesa, à direita.' }).waitFor();
    assert.deepEqual(data.discoveryState.layout.items, [{ slot: 'desk-right', objectId: 'object.globe' }]);
    assert.equal((await prefs(page)).deskStarters['desk-center'], 'object.teacup', 'the teacup took the globe’s place');
    await axeCheck(page, '[data-specimen-dialog]', 'Gabinete, Colocar na mesa');
    await context.close();
  }
  record('Arrumar a mesa: objeto colocado sai da gaveta; mover troca de lugar; guardar devolve; Desfazer e Ctrl+Z; arrastar mostra destinos; com descobertas (layout no servidor) e sem (preferências); Gabinete usa a mesma mesa');
}

async function review(browser, base) {
  for (const width of [1440, 390]) {
    const data = state();
    const { context, page } = await openApp(browser, base, { ...allFlags, flashcards_v3: true }, data, { width, height: width < 700 ? 844 : 1000 });
    const label = `Flashcards ${width}`;
    // The old Revisar address lands on the review of the Flashcards page.
    await page.goto(base + '/revisar.html');
    await page.waitForURL('**/flashcards.html#revisar');
    await page.locator('.flashcard-review-card').waitFor();
    // Six labelled sections, the review first, today's count on its key.
    assert.deepEqual(
      (await page.locator('[data-tool-tabs] [role=tab]').allTextContents()).map((t) => t.trim()),
      ['Revisar cartões5', 'Conjuntos', 'Criar cartão', 'Gerar com IA', 'Importar e mesclar', 'Aparência'],
    );
    assert.equal(await page.locator('#tab-revisar').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#tab-revisar').getAttribute('aria-label'), 'Revisar cartões, 5 para hoje');
    assert.equal(await page.locator('.primary-navigation a[aria-current=page] span').textContent(), 'Flashcards');
    // Question attempts left open are one link away (they live with the questions).
    assert.equal(await page.locator('[data-flashcards-quiz-link]').getAttribute('href'), './questoes.html');
    await page.locator('[data-flashcards-quiz-link]', { hasText: '1 lista de questões em andamento' }).waitFor();
    // One card, front labelled; the panel has no box of its own; no ratings before turning.
    const card = page.locator('.flashcard-review-card');
    assert.equal(await card.count(), 1);
    assert.equal(await card.getAttribute('data-side'), 'front');
    assert.equal(await card.locator('.flashcard-side-label').textContent(), 'Frente');
    assert.equal(await page.locator('.flashcard-rating-buttons').count(), 0);
    const chrome = await page.locator('[data-flashcards-panel]').evaluate((node) => getComputedStyle(node).borderTopWidth);
    assert.equal(chrome, '0px', 'no card around the review card');
    await noHorizontalScroll(page, label);
    await settle(page);
    await axeCheck(page, 'main', label);
    await shot(page, `flashcards-${width}`);
    // A click (or tap) on the card turns it; the back is labelled; ratings appear below it.
    await card.locator('.flashcard-content').click();
    assert.equal(await card.getAttribute('data-side'), 'back');
    assert.equal(await card.locator('.flashcard-side-label').textContent(), 'Verso');
    assert.equal(await page.locator('.flashcard-flip').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-flashcard-side-status]', { hasText: 'Verso do cartão' }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('.flashcard-rating-buttons button').count(), 4);
    await page.waitForTimeout(400); // the quarter turn ends
    await noHorizontalScroll(page, `${label} verso`);
    await axeCheck(page, 'main', `${label} verso`);
    await shot(page, `flashcards-verso-${width}`);
    // Keyboard: Space and Enter on the focused card turn it; focus stays on the card.
    await page.locator('.flashcard-face').focus();
    await page.keyboard.press('Space');
    assert.equal(await card.getAttribute('data-side'), 'front');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'flashcard-face');
    await page.keyboard.press('Enter');
    assert.equal(await card.getAttribute('data-side'), 'back');
    // Rating is not part of the turn: it records the review and shows the next card's front.
    await page.locator('.flashcard-rating-buttons [data-rating="2"]').click();
    await page.locator('[data-flashcard-review-status]', { hasText: 'Revisão registrada' }).waitFor();
    await page.locator('.flashcard-review-card[data-side="front"]').waitFor();
    assert.equal(await page.locator('.flashcard-rating-buttons').count(), 0, 'the next card starts on its front');
    // Each section is reachable and clean.
    for (const [tab, id] of [['Conjuntos', 'conjuntos'], ['Criar cartão', 'criar'], ['Gerar com IA', 'gerar'], ['Importar e mesclar', 'importar'], ['Aparência', 'aparencia']]) {
      await page.getByRole('tab', { name: tab }).click();
      await page.locator(`#${id}:not([hidden])`).waitFor();
      assert(page.url().endsWith(`#${id}`), `${tab} has its own address`);
      await noHorizontalScroll(page, `${label} ${tab}`);
      await axeCheck(page, 'main', `${label} ${tab}`);
    }
    await shot(page, `flashcards-aparencia-${width}`);
    await context.close();
  }
  // The person's reduced-motion choice: the card turns without the animation.
  {
    const { context, page } = await openApp(browser, base, { ...allFlags }, state(), { width: 1024, height: 900 });
    await context.addInitScript(() => localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ reducedMotion: true })));
    await page.goto(base + '/flashcards.html');
    await page.locator('.flashcard-face').click();
    const animation = await page.locator('.flashcard-review-card').evaluate((node) => getComputedStyle(node).animationName);
    assert.equal(animation, 'none');
    await context.close();
  }
  record('Flashcards: página própria com seis seções (revisar, conjuntos, criar, gerar, importar e mesclar, aparência); revisar.html redireciona; cartão vira com clique, toque, Espaço ou Enter e com o botão (aria-pressed), frente e verso rotulados e anunciados; avaliar fica fora do cartão; sem animação com movimento reduzido; 390 e 1440 sem rolagem lateral; axe');
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
