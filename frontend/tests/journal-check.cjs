// 3.6 Milestone D in a real browser with a SIMULATED API (support/mock-journals.cjs) and a
// simulated profile_state (mock-app.cjs): the Diário de estudo — shelf → new journal → rename →
// cover with live preview → new page → paper → stickers, washi and a frame placed by MOUSE (drag
// with snapping) and by KEYBOARD (arrows, R, +, Delete) → a lesson link and a quote with its
// source → saved, reloaded and still there. The lesson notebook: closed cover, opened from the
// lesson header, cover and paper chosen with a live preview and kept after a reload (account
// preferences). axe at 1440 and 390 px, no horizontal scroll at 390 px, reduced motion (no cover
// or page animation), quiet mode (no decoration). Nothing here reaches a real backend: the rules
// are tested against Postgres in backend/tests/journals-*.test.js.
// JOURNAL_SHOTS=<dir> also writes the review captures (3-6-diario-*, 3-6-caderno-*) as JPEG there.
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
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'journal');
fs.mkdirSync(output, { recursive: true });
const review = process.env.JOURNAL_SHOTS ? path.resolve(process.env.JOURNAL_SHOTS) : null;
async function capture(page, name, fullPage = false) {
  await page.locator('.page-turn-out, .cover-flap, .nb-cover-flap').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  // The lesson notebook sits below the player: capture the notebook itself.
  const target = name.startsWith('3-6-caderno') ? page.locator('[data-lesson-notebook]') : page;
  const options = target === page ? { fullPage } : {};
  await target.screenshot({ path: path.join(output, `${name}.png`), ...options });
  if (review) await target.screenshot({ path: path.join(review, `${name}.jpg`), type: 'jpeg', quality: 82, ...options });
}
const flags = { ...allFlags, notebooks: true, journal: true };
const journalOf = (data) => [...data.journalState.journals.values()][0];
const pagesOf = (data) => [...data.journalState.pages.values()].filter((p) => !p.deleted);
const decorById = (page, id) => page.locator(`.decor[data-decor-id="${id}"]`);
const saved = (page) => page.locator('[data-save-state][data-state="saved"]').waitFor({ timeout: 6000 });

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---- Desktop: the whole journey ------------------------------------------------------
    const data = { ...state(), profileState: [] };
    const { context, page } = await openApp(browser, base, flags, data, { width: 1440, height: 1000 });
    await page.goto(`${base}/diario.html`);
    await page.locator('[data-new-journal]').waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'estante vazia');
    await capture(page, '3-6-diario-estante-vazia-1440');

    await page.locator('[data-new-journal]').click();
    const rename = page.getByRole('textbox', { name: 'Nome do diário' });
    await rename.waitFor();
    await rename.fill('Biologia — 2º bimestre');
    await rename.press('Enter');
    await page.locator('#journal-name', { hasText: 'Biologia — 2º bimestre' }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-journal-announce]')?.textContent.includes('Nome salvo'));
    assert.equal(journalOf(data).title, 'Biologia — 2º bimestre');
    record('Diário: "Novo diário" cria e abre o diário; renomear grava o nome');

    // Cover: the book changes while choosing (live preview); "Usar esta capa" saves it.
    await page.locator('[data-open-covers]').click();
    const dialog = page.locator('.cover-dialog');
    await dialog.waitFor();
    const spineBefore = await page.locator('.journal-spine').evaluate((n) => getComputedStyle(n).getPropertyValue('--spine'));
    await dialog.locator('.cover-choice', { hasText: 'Herbário' }).click();
    assert.match(await dialog.locator('[data-cover-preview] img').getAttribute('src'), /botanical-press/);
    const spineLive = await page.locator('.journal-spine').evaluate((n) => getComputedStyle(n).getPropertyValue('--spine'));
    assert.notEqual(spineLive, spineBefore, 'the book behind changes at once');
    await settle(page);
    await axeCheck(page, '.cover-dialog', 'escolher capa');
    await capture(page, '3-6-diario-capa-1440');
    await dialog.getByRole('button', { name: 'Usar esta capa' }).click();
    await page.waitForFunction(() => document.querySelector('[data-journal-announce]')?.textContent.includes('Capa'));
    assert.equal(journalOf(data).cover, 'cover.botanical-press');
    record('Capa: prévia ao vivo no livro e na capa grande; salva ao confirmar');

    // A ruled page: text, paper, then decorations.
    await page.locator('[data-new-page]').click();
    await page.locator('.template-card[data-template="ruled"]').click();
    await page.locator('.journal-sheet:not(.page-turn-out) .sheet-title').fill('Fotossíntese');
    await page.locator('.journal-sheet:not(.page-turn-out) .sheet-body').fill('A luz vira energia química no cloroplasto. Fase clara: ATP e NADPH. Fase escura: o carbono é fixado.');
    await page.locator('.swatch', { hasText: 'Creme envelhecido' }).click();
    assert.equal(await page.locator('.journal-sheet').getAttribute('data-paper'), 'aged', 'paper preview at once');
    await saved(page);
    assert.equal(pagesOf(data)[0].paper, 'aged');

    // Mouse: place a sticker and drag it; it snaps to whole percents (and to the guides).
    await page.getByRole('button', { name: 'Colocar Adesivo Folha' }).click();
    const sticker = pagesOf(data)[0];
    await page.locator('.decor').first().waitFor();
    const stickerId = await page.locator('.decor').first().getAttribute('data-decor-id');
    const box = await decorById(page, stickerId).boundingBox();
    const sheetBox = await page.locator('.journal-sheet').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(sheetBox.x + sheetBox.width * 0.8, sheetBox.y + sheetBox.height * 0.08, { steps: 8 });
    await page.mouse.move(sheetBox.x + sheetBox.width * 0.823, sheetBox.y + sheetBox.height * 0.071, { steps: 4 });
    await page.mouse.up();
    await saved(page);
    const dragged = pagesOf(data)[0].decorations.find((d) => d.id === stickerId);
    assert(dragged.x > 74 && dragged.x <= 90 && dragged.y < 25, `dragged to the top right: ${JSON.stringify(dragged)}`);
    assert(Number.isInteger(dragged.x) && Number.isInteger(dragged.y), 'snapped to whole percents');
    assert(sticker);
    record('Adesivo arrastado com o mouse até o canto, com encaixe na grade de 1 %');

    // Keyboard: washi tape placed, then moved with arrows, rotated with R, enlarged with +.
    await page.locator('.decor-kinds label', { hasText: 'Fitas' }).click();
    await page.getByRole('button', { name: 'Colocar Fita Bolinhas lavanda' }).click();
    const tapeId = await page.locator('.decor-tape').getAttribute('data-decor-id');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.decorId), tapeId, 'focus goes to the new tape');
    const tapeStart = { ...pagesOf(data)[0].decorations.find((d) => d.id === tapeId) };
    await page.waitForTimeout(800);
    const before = (await saved(page), pagesOf(data)[0].decorations.find((d) => d.id === tapeId));
    for (const key of ['ArrowLeft', 'ArrowLeft', 'Shift+ArrowUp', 'r', 'r', '+']) await page.keyboard.press(key);
    await saved(page);
    const after = pagesOf(data)[0].decorations.find((d) => d.id === tapeId);
    assert.equal(after.x, before.x - 2);
    assert.equal(after.y, before.y - 5);
    assert.equal(after.rotation, before.rotation + 10);
    assert.equal(after.scale, Math.round((before.scale + 0.1) * 100) / 100);
    assert.ok(tapeStart);
    await page.locator('[data-journal-announce]').filter({ hasText: /tamanho/ }).waitFor();
    record('Fita washi: setas movem (Shift = 5 %), R gira 5°, + aumenta; anunciado para leitores de tela');

    // A frame, then Delete removes it by keyboard.
    await page.locator('.decor-kinds label', { hasText: 'Molduras' }).click();
    await page.getByRole('button', { name: 'Colocar Moldura Polaroide' }).click();
    await page.getByRole('button', { name: 'Colocar Moldura Borda deckle' }).click();
    await page.keyboard.press('Delete');
    await saved(page);
    const arts = pagesOf(data)[0].decorations.map((d) => d.art).sort();
    assert.deepEqual(arts, ['frame.polaroid', 'sticker.leaf', 'tape.lavender-dots']);
    record('Moldura colocada; Delete remove a decoração em foco');

    // Link the lesson and quote it, keeping its source.
    await page.locator('[data-link-select]').selectOption({ label: 'Fotossíntese e respiração celular' });
    await page.getByRole('button', { name: 'Ligar', exact: true }).click();
    await page.locator('.sheet-links a', { hasText: 'Fotossíntese e respiração celular' }).waitFor();
    await page.getByRole('radio', { name: 'Escrever' }).check();
    await page.getByLabel('Citação', { exact: true }).fill('A fotossíntese converte energia luminosa em energia química.');
    await page.locator('[data-save-state][data-state="quote"]').waitFor({ timeout: 4000 });
    await page.getByLabel('Fonte da citação').selectOption({ label: 'Aula: Fotossíntese e respiração celular' });
    await saved(page);
    assert.deepEqual(pagesOf(data)[0].content.quote.source, { kind: 'lesson', id: 'l-foto' });
    record('Citação só é salva com a fonte; a página guarda a ligação com a aula');
    await settle(page);
    await axeCheck(page, 'main', 'diário aberto (escrever)');
    await page.getByRole('radio', { name: 'Decorar' }).check();
    await settle(page);
    await axeCheck(page, 'main', 'diário aberto (decorar)');
    await capture(page, '3-6-diario-pagina-1440');

    // More layouts for the review: a collage and a concept card.
    await page.locator('[data-new-page]').click();
    await page.locator('.template-card[data-template="collage"]').click();
    await page.getByLabel('Legenda da foto 1').fill('cloroplasto');
    await page.getByLabel('Legenda da foto 2').fill('chá de hibisco');
    await page.getByLabel('Legenda da foto 3').fill('noite de estudo');
    await page.locator('.journal-sheet:not(.page-turn-out) .sheet-title').fill('Lembranças da semana');
    await page.locator('.decor-kinds label', { hasText: 'Fitas' }).click();
    await page.getByRole('button', { name: 'Colocar Fita Xadrez mel' }).click();
    await saved(page);
    await capture(page, '3-6-diario-colagem-1440');
    await page.locator('[data-new-page]').click();
    await page.locator('.template-card[data-template="concept"]').click();
    await page.getByLabel('Termo', { exact: true }).fill('Ciclo de Calvin');
    await page.getByLabel('Definição', { exact: true }).fill('Etapa da fotossíntese que usa ATP e NADPH para fixar o carbono do CO₂ em açúcares.');
    await page.getByLabel('Exemplo', { exact: true }).fill('A folha ao sol: o CO₂ do ar vira glicose.');
    await saved(page);
    await capture(page, '3-6-diario-ficha-1440');
    assert.equal(pagesOf(data).length, 3);

    // Page turns (and back), then reload: everything is still there.
    await page.locator('[data-page-prev]').click();
    await page.locator('.pager-where', { hasText: 'Página 2 de 3' }).waitFor();
    await page.reload();
    await page.locator('.journal-sheet').waitFor();
    await settle(page);
    assert.equal(await page.locator('#journal-name').textContent(), 'Biologia — 2º bimestre');
    assert.match(await page.locator('[data-open-covers] img').getAttribute('src'), /botanical-press/);
    assert.equal(await page.locator('.journal-sheet').getAttribute('data-paper'), 'aged');
    assert.equal(await page.locator('.journal-sheet .decor').count(), 3);
    assert.equal(await page.locator('.journal-sheet:not(.page-turn-out) .sheet-body').inputValue(), 'A luz vira energia química no cloroplasto. Fase clara: ATP e NADPH. Fase escura: o carbono é fixado.');
    const left = await decorById(page, stickerId).evaluate((n) => n.style.left);
    assert.equal(left, `${dragged.x}%`);
    record('Depois de recarregar: nome, capa, papel, texto, citação e as 3 decorações nas mesmas posições');

    // Quiet mode and "Página limpa": no decoration, the text stays.
    await page.evaluate(() => (document.documentElement.dataset.experience = 'quiet'));
    assert.equal(await page.locator('.journal-decor').isVisible(), false);
    assert.equal(await page.locator('[data-tray] .decor-tools').isVisible(), false);
    assert.equal(await page.locator('.journal-sheet:not(.page-turn-out) .sheet-body').isVisible(), true);
    await page.evaluate(() => (document.documentElement.dataset.experience = 'cozy'));
    await page.getByText('Página limpa (sem decorações)').click();
    assert.equal(await page.locator('.journal-decor').isVisible(), false);
    await page.getByText('Página limpa (sem decorações)').click();
    record('Modo silencioso e "Página limpa" escondem as decorações (que continuam salvas)');

    await page.locator('.journal-back').click();
    await page.locator('.shelf-book[data-journal-id]').waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'estante');
    await capture(page, '3-6-diario-estante-1440');

    // ---- Lesson notebook: cover, paper, live preview, kept after reload ---------------------
    await page.goto(`${base}/material.html?id=l-foto#anotacoes`);
    await page.locator('[data-open-notebook]').waitFor();
    const notebook = page.locator('[data-lesson-notebook]');
    await notebook.getByRole('button', { name: 'Abrir o caderno' }).waitFor();
    await settle(page);
    await axeCheck(page, '[data-notes-section]', 'caderno fechado');
    await capture(page, '3-6-caderno-capa-1440');
    await notebook.getByRole('button', { name: 'Abrir o caderno' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'lesson-notebook-name', 'focus moves into the open notebook');
    await page.locator('#lesson-notebook-name').fill('Fotossíntese');
    for (const [label, text] of [
      ['Título', 'Fase clara'],
      ['Parágrafo', 'A luz vira energia química: ATP e NADPH.'],
      ['Título', 'Fase escura'],
      ['Citação', 'O carbono é fixado no ciclo de Calvin.'],
    ]) {
      await notebook.locator('.notebook-add').getByRole('button', { name: label, exact: true }).click();
      await page.keyboard.type(text);
    }
    await notebook.locator('.nb-tabs .paper-tab', { hasText: 'Fase escura' }).waitFor();
    assert.equal(await notebook.locator('.nb-divider').count(), 1, 'a divider opens the second section');
    await notebook.locator('.nb-look > summary').click();
    await notebook.getByRole('radio', { name: 'Constelação' }).check();
    assert.match(await notebook.locator('.nb-look-preview img').getAttribute('src'), /constellation/);
    await notebook.getByRole('radio', { name: 'Pontilhado' }).check();
    assert.equal(await notebook.locator('.nb-page').getAttribute('data-paper'), 'dot');
    await notebook.locator('.notebook-status', { hasText: /^Salvo$/ }).waitFor({ timeout: 6000 });
    await page.waitForFunction(() => true);
    await settle(page);
    await axeCheck(page, '[data-notes-section]', 'caderno aberto');
    await capture(page, '3-6-caderno-aberto-1440');
    const looks = data.profileState.find((row) => row.key === 'notebook-looks');
    assert.equal(looks.data['l-foto'].cover, 'cover.constellation');
    assert.equal(looks.data['l-foto'].paper, 'dot');
    assert(!JSON.stringify(data.notebooks['l-foto']).includes('constellation'), 'the look is not in the notebook body');
    await page.reload();
    await notebook.locator('.nb-page').waitFor();
    assert.equal(await notebook.locator('.nb-page').getAttribute('data-paper'), 'dot');
    assert.equal(await notebook.locator('.nb-book').isVisible(), true, 'still open in this tab');
    assert.equal(await notebook.getByRole('link', { name: 'Abrir meu Diário de estudo' }).getAttribute('href'), './diario.html');
    record('Caderno da aula: capa fechada abre o caderno; capa e papel com prévia ao vivo, salvos na conta e mantidos depois de recarregar');
    await context.close();

    // ---- Phone width -----------------------------------------------------------------------
    const phone = await openApp(browser, base, flags, data, { width: 390, height: 844 });
    await phone.page.goto(`${base}/diario.html`);
    await phone.page.locator('.shelf-book[data-journal-id]').waitFor();
    await settle(phone.page);
    await noHorizontalScroll(phone.page, 'estante 390');
    await axeCheck(phone.page, 'main', 'estante 390');
    await capture(phone.page, '3-6-diario-estante-390');
    await phone.page.locator('.shelf-book[data-journal-id]').click();
    await phone.page.locator('.journal-sheet').waitFor();
    await settle(phone.page);
    await noHorizontalScroll(phone.page, 'diário 390');
    await axeCheck(phone.page, 'main', 'diário 390');
    await capture(phone.page, '3-6-diario-pagina-390');
    // Touch-sized drag still works at phone width (pointer events).
    await phone.page.getByRole('radio', { name: 'Decorar' }).check();
    const phoneDecor = phone.page.locator('.decor-sticker');
    const pb = await phoneDecor.boundingBox();
    const ps = await phone.page.locator('.journal-sheet').boundingBox();
    await phone.page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await phone.page.mouse.down();
    await phone.page.mouse.move(ps.x + ps.width * 0.5, ps.y + ps.height * 0.5, { steps: 6 });
    await phone.page.mouse.up();
    await phone.page.locator('[data-save-state][data-state="saved"]').waitFor({ timeout: 6000 });
    const centred = pagesOf(data)[0].decorations.find((d) => d.art === 'sticker.leaf');
    assert.deepEqual([centred.x, centred.y], [50, 50], 'snapped to the centre guides');
    record('390 px: estante e diário sem rolagem horizontal, axe limpo; arrastar encaixa nas guias do centro');
    await phone.page.goto(`${base}/material.html?id=l-foto#anotacoes`);
    await phone.page.locator('.nb-cover').waitFor();
    await settle(phone.page);
    await capture(phone.page, '3-6-caderno-capa-390');
    await phone.page.locator('.nb-cover').click();
    await phone.page.locator('.nb-page').waitFor();
    await settle(phone.page);
    await noHorizontalScroll(phone.page, 'caderno 390');
    await axeCheck(phone.page, '[data-notes-section]', 'caderno 390');
    await capture(phone.page, '3-6-caderno-aberto-390');
    await phone.context.close();

    // ---- Reduced motion: no cover opening or page turn animation ---------------------------
    const calm = await openApp(browser, base, flags, data, { width: 1280, height: 900 }, { context: { reducedMotion: 'reduce' } });
    await calm.page.goto(`${base}/diario.html`);
    await calm.page.locator('.shelf-book[data-journal-id]').click();
    await calm.page.locator('.journal-sheet').waitFor();
    assert.equal(await calm.page.locator('.cover-flap').count(), 0, 'no cover animation');
    await calm.page.locator('[data-page-next]').click();
    assert.equal(await calm.page.locator('.page-turn-out, .page-turn-in').count(), 0, 'pages turn instantly');
    await calm.page.locator('.pager-where', { hasText: 'Página 2 de 3' }).waitFor();
    record('Movimento reduzido: o diário abre e vira a página sem animação');
    await calm.context.close();

    // ---- Without the migration: the page explains, nothing breaks ---------------------------
    const down = await openApp(browser, base, flags, { ...state(), journalsDown: true });
    await down.page.goto(`${base}/diario.html`);
    await down.page.locator('[data-journal-status]', { hasText: 'ainda não foi habilitado' }).waitFor();
    record('Sem a migration (503): a estante explica que o diário ainda não foi habilitado');
    await down.context.close();
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
