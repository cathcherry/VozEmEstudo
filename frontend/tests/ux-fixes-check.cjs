// 3.6 UX fixes in a real browser with the simulated app (support/mock-app.cjs):
//   1. Biblioteca "Selecionar": a click or tap on a lesson or folder selects it and never opens
//      it; Space/Enter toggle; Shift extends; Esc and "Concluir seleção" restore opening; a
//      discipline's page has a band in its colour, counts and units as sub-folders.
//   2. Revisar: today's work first (counts on the tabs, one review card), management tools in a
//      compact toolbar and a "Gerenciar" view; no nested cards; 390 and 1440 without overflow.
//   3. One focus engine: the timer controls live only on Focar; Planejar shows history and
//      analysis and links to Focar; other pages show a small topbar indicator while it runs.
//   4. 3.7, no desk on Início: the Gabinete's museum label of a found object no longer offers
//      "Colocar na mesa", and neither the Gabinete nor Início touches the saved desk data
//      (server layout, deskStarters in the preferences).
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
async function desk(browser, base) {
  const data = state();
  data.seedUnlocks = [
    { id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString(), lessonTitle: 'Fotossíntese e respiração celular' },
    { id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString() },
  ];
  // A desk arranged before 3.7: the globe in the middle on the server, the starters in the preferences.
  const savedLayout = { items: [{ slot: 'desk-center', objectId: 'object.globe' }], version: 1 };
  data.discoveryState = {
    investigations: new Map(),
    unlocks: data.seedUnlocks.map((u) => ({ unlockedAt: u.occurredAt, ...u })),
    layout: structuredClone(savedLayout),
    requests: [],
  };
  const { context, page } = await openApp(browser, base, { ...allFlags, discoveries: true }, data);
  await page.goto(base + '/gabinete.html?gaveta=object');
  const starters = { 'desk-left': 'object.inkwell', 'desk-right': 'object.teacup', window: 'object.hourglass' };
  await page.evaluate(async (value) => (await import('/js/utils/preferences.js')).setUiPreference('deskStarters', value), starters);
  await page.locator('.cabinet-item[data-collectible="object.globe"]').click();
  const label = page.locator('[data-specimen-dialog]');
  await label.locator('[data-specimen-title]', { hasText: 'Globo' }).waitFor();
  // The museum label stays (facts), but there is no desk to send the object to.
  assert.match(await label.locator('[data-specimen-facts]').textContent(), /Quando.*Como apareceu/);
  assert.equal(await label.getByRole('button', { name: 'Colocar na mesa' }).count(), 0, 'no "Colocar na mesa"');
  assert.equal(await label.getByRole('button', { name: 'Mudar de lugar' }).count(), 0);
  assert.equal(await label.getByRole('button', { name: 'Guardar no gabinete' }).count(), 0);
  assert.equal(await label.locator('[data-specimen-desk], #specimen-desk-slot').count(), 0, 'no desk place picker');
  assert.doesNotMatch(await label.textContent(), /Colocar na mesa|Lugar na mesa|Na mesa:/);
  await settle(page);
  await axeCheck(page, '[data-specimen-dialog]', 'Gabinete, etiqueta sem mesa');
  await label.getByRole('button', { name: 'Fechar' }).click();
  // Início neither shows nor rewrites the desk.
  await page.goto(base + '/painel.html');
  await page.waitForFunction(() => document.querySelector('[data-dashboard-data]')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('[data-desk-scene], [data-desk-arrange], [data-desk-tray]').count(), 0, 'no desk on Início');
  await settle(page);
  // The saved desk data is exactly as it was.
  assert.deepEqual(data.discoveryState.layout, savedLayout, 'server layout untouched');
  assert.equal(data.discoveryState.requests.filter((r) => r.kind === 'layout').length, 0, 'no PUT /api/collection/layout');
  assert.deepEqual((await prefs(page)).deskStarters, starters, 'deskStarters untouched');
  await context.close();
  record('Sem mesa no Início (3.7): a etiqueta de um objeto no Gabinete não oferece "Colocar na mesa" nem escolha de lugar; Gabinete e Início não alteram o layout do servidor nem os deskStarters das preferências; axe');
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
