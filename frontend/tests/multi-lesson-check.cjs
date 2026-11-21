// Material integrado (Milestone C) in a real browser with a SIMULATED API
// (support/mock-multi-lesson.cjs): from the library selection and from a unit folder, the dialog
// previews included/excluded lessons, the request is sent with the previewed revisions, and the
// integrated page shows summary and questions with citations linking to the exact lesson segment.
// Keyboard, Escape and focus return; axe at 1280 and 390 px; no horizontal scroll. Nothing here
// calls a real backend, database or AI provider: the rules are tested against Postgres and a fake
// provider in backend/tests/multi-lesson-*.test.js.
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
  lesson,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'multi-lesson');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const flags = { ...allFlags, multi_lesson: true };
const activeText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim());

function sample() {
  const data = state();
  data.extraMaterials = [
    { ...lesson('l-resp', 'Respiração celular', 'Biologia', 2, 1600000), subject_id: 'sub-bio', unit_id: 'unit-energia' },
    { ...lesson('l-cloro', 'Cloroplastos (rascunho)', 'Biologia', 4, 900000), subject_id: 'sub-bio', unit_id: 'unit-energia' },
    { ...lesson('l-membrana', 'Membrana plasmática', 'Biologia', 6, 1200000), subject_id: 'sub-bio', unit_id: 'unit-celula' },
  ];
  data.unconfirmedLessons = ['l-cloro', 'l-rev'];
  return data;
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Flag off: no entry point, the page explains ----------------------------------
    {
      const { context, page } = await openApp(browser, base, allFlags, sample());
      await page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
      await page.getByRole('button', { name: 'Selecionar' }).waitFor();
      assert.equal(await page.locator('[data-multi-lesson-folder]').count(), 0);
      await page.getByRole('button', { name: 'Selecionar' }).click();
      assert.equal(await page.locator('[data-multi-lesson-selection]').isVisible(), false);
      await page.goto(base + '/integrado.html');
      await page.locator('[data-tool-unavailable]:not([hidden])', { hasText: 'ainda não está ativo' }).waitFor();
      await context.close();
      record('Sem a flag (API simulada): nenhum botão de material integrado na Biblioteca e a página explica que o recurso não está ativo');
    }

    const data = sample();
    const { context, page } = await openApp(browser, base, flags, data, { width: 1280, height: 900 });

    // ---------- From a unit folder: "Estudar a unidade inteira" --------------------------------
    await page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
    const unitButton = page.getByRole('button', { name: 'Estudar a unidade inteira' });
    await unitButton.click();
    const dialog = page.locator('dialog[open].multi-lesson-dialog');
    await dialog.locator('.multi-lesson-status', { hasText: '2 aulas prontas para estudar juntas.' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.labels?.[0]?.textContent.trim().startsWith('Nome do material')), true);
    assert.equal(await dialog.locator('input[name="title"]').inputValue(), 'Metabolismo energético');
    const included = await dialog.locator('.multi-lesson-sources li').allTextContents();
    assert.deepEqual(included, ['Fotossíntese e respiração celular', 'Respiração celular']);
    assert.match(await dialog.locator('.multi-lesson-excluded').textContent(), /Cloroplastos \(rascunho\) — transcrição ainda não confirmada/);
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Diálogo do material integrado');
    await shot(page, 'dialogo-unidade', false);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await activeText(page), 'Estudar a unidade inteira', 'Escape closes and focus returns');
    record('Pasta da unidade (API simulada): "Estudar a unidade inteira" mostra as aulas confirmadas e as que ficam de fora com o motivo; Esc fecha e devolve o foco');

    // Ask: flashcards too, 5 questions; the previewed revisions go with the request.
    await unitButton.click();
    await dialog.locator('.multi-lesson-status', { hasText: 'prontas' }).waitFor();
    await dialog.getByLabel('Flashcards').check();
    await dialog.getByLabel('Quantidade de questões').fill('5');
    await dialog.getByRole('button', { name: 'Gerar material integrado' }).click();
    await page.waitForURL(/integrado\.html\?id=/);
    const sent = data.multiLessonRequests.at(-1);
    assert.deepEqual(sent.selection, { kind: 'unit', ids: ['unit-energia'] });
    assert.deepEqual(sent.outputs, ['summary', 'questions', 'flashcards']);
    assert.deepEqual(sent.settings, { questionCount: 5 });
    assert.deepEqual(sent.expectedRevisionIds, ['rev-l-foto', 'rev-l-resp']);
    assert.equal(sent.reuse, true);
    record('Pedido (API simulada): envia a seleção, o que gerar, a quantidade e as revisões vistas na prévia; abre a página do material');

    // ---------- Integrated page: generating → ready with citations ----------------------------
    await page.locator('[data-multi-lesson-status]', { hasText: 'Gerando o material integrado' }).waitFor();
    await page.locator('#multi-lesson-summary-title').waitFor({ timeout: 10000 });
    await page.locator('[data-multi-lesson-status]', { hasText: 'Material pronto.' }).waitFor();
    assert.deepEqual(await page.locator('[data-multi-lesson-sources] li').allTextContents(), ['Fotossíntese e respiração celular · revisão 1', 'Respiração celular · revisão 1']);
    assert.match(await page.locator('.multi-lesson-report').textContent(), /1 item sem trecho das aulas que o sustentasse foi descartado/);
    const link = page.locator('.multi-lesson-section .multi-lesson-citations a').first();
    const href = await link.getAttribute('href');
    assert.match(href, /^\.\/material\.html\?id=l-foto&busca=A\+fotoss%C3%ADntese.+&trecho=0#transcricao$/);
    // The answer and its passages are revealed on demand (keyboard).
    const reveal = page.locator('.multi-lesson-question > button').first();
    assert.equal(await reveal.textContent(), 'Ver resposta e trechos');
    await reveal.focus();
    await page.keyboard.press('Enter');
    assert.equal(await reveal.getAttribute('aria-expanded'), 'true');
    await page.locator('.multi-lesson-answer:not([hidden])', { hasText: 'A energia guardada e liberada' }).waitFor();
    await page.locator('#multi-lesson-cards-title').waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Material integrado pronto');
    await noHorizontalScroll(page, 'material integrado 1280');
    await shot(page, 'material-integrado');
    await link.click();
    await page.waitForURL(/material\.html\?id=l-foto&busca=.+&trecho=0#transcricao/);
    await page.goBack();
    record('Página do material integrado (API simulada): resumo, questões e flashcards com citações; cada citação abre a aula no trecho exato (#transcricao, busca e trecho); itens descartados são informados');

    // ---------- 3.4: questions → an answerable list; cards → a personal set --------------------
    const integratedUrl = page.url();
    await page.locator('[data-multi-lesson-status]', { hasText: 'Material pronto.' }).waitFor();
    const questionsBox = page.locator('[data-multi-lesson-export="questions"]');
    const makeList = questionsBox.getByRole('button', { name: 'Transformar em lista de questões' });
    await makeList.focus();
    await page.keyboard.press('Enter');
    await questionsBox.locator('.multi-lesson-export-status', { hasText: 'Lista de questões pronta.' }).waitFor();
    assert.match(await questionsBox.locator('.multi-lesson-export-status').textContent(), /Guardada na aula “Fotossíntese e respiração celular”/);
    const answerLink = questionsBox.getByRole('link', { name: 'Responder a lista' });
    assert.equal(await answerLink.evaluate((node) => node === document.activeElement), true, 'focus moves to the new link');
    assert.match(await answerLink.getAttribute('href'), /^\.\/responder\.html\?material=l-foto&batch=batch-/);
    assert.equal(await questionsBox.getByRole('button').count(), 0, 'no second button: nothing to duplicate');
    const exportRequests = data.multiLessonExportRequests;
    assert.equal(exportRequests.length, 1);
    assert.match(exportRequests[0].requestId, /^[0-9a-f-]{36}$/);
    // Cards: a temporary failure is explained and the same request can be sent again.
    data.failNextExport = true;
    const cardsBox = page.locator('[data-multi-lesson-export="flashcards"]');
    await cardsBox.getByRole('button', { name: 'Salvar como conjunto de flashcards' }).click();
    await cardsBox.locator('[role="alert"]', { hasText: 'temporariamente indisponível' }).waitFor();
    assert.equal(await cardsBox.getByRole('button', { name: 'Salvar como conjunto de flashcards' }).isDisabled(), false);
    await cardsBox.getByRole('button', { name: 'Salvar como conjunto de flashcards' }).click();
    await cardsBox.locator('.multi-lesson-export-status', { hasText: 'Conjunto de flashcards salvo.' }).waitFor();
    assert.equal(await cardsBox.locator('[role="alert"]').textContent(), '');
    assert.match(await cardsBox.getByRole('link', { name: 'Abrir o conjunto' }).getAttribute('href'), /^\.\/revisar\.html\?conjunto=set-.+#flashcards$/);
    await settle(page);
    await axeCheck(page, 'main', 'Material integrado com lista e conjunto salvos');
    await noHorizontalScroll(page, 'material integrado salvo 1280');
    await shot(page, 'material-integrado-salvo');
    // Coming back: what exists is shown directly, no new request.
    await page.goto(integratedUrl);
    await questionsBox.getByRole('link', { name: 'Responder a lista' }).waitFor();
    await cardsBox.getByRole('link', { name: 'Abrir o conjunto' }).waitFor();
    assert.equal(data.multiLessonExportRequests.length, 2);
    // The list opens in the usual quiz page of the lesson.
    await questionsBox.getByRole('link', { name: 'Responder a lista' }).click();
    await page.waitForURL(/responder\.html\?material=l-foto&batch=batch-/);
    await page.locator('main', { hasText: /Começar|Iniciar|O que relaciona a fotossíntese/ }).first().waitFor();
    record('Material pronto (API simulada): "Transformar em lista de questões" cria a lista (guardada na primeira aula) e leva a responder.html; "Salvar como conjunto de flashcards" cria o conjunto; falha temporária explicada; ao voltar, os links aparecem sem novo pedido');

    // ---------- From the selection bar: several lessons ---------------------------------------
    await page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
    await page.getByRole('button', { name: 'Selecionar' }).click();
    const integrate = page.locator('[data-multi-lesson-selection]');
    await page.getByRole('checkbox', { name: 'Selecionar Fotossíntese e respiração celular' }).check();
    assert.equal(await integrate.isDisabled(), true, 'needs at least two lessons');
    await page.getByRole('checkbox', { name: 'Selecionar Cloroplastos (rascunho)' }).check();
    await page.locator('.library-selection-bar', { hasText: '2 aulas selecionadas' }).waitFor();
    await integrate.click();
    await dialog.locator('.multi-lesson-status', { hasText: '1 aula pronta para estudar.' }).waitFor();
    assert.match(await dialog.locator('.multi-lesson-excluded').textContent(), /Cloroplastos/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await activeText(page), 'Material integrado');
    // Nothing confirmed: the dialog says why and cannot submit.
    await page.getByRole('checkbox', { name: 'Selecionar Fotossíntese e respiração celular' }).uncheck();
    await page.getByRole('checkbox', { name: 'Selecionar Respiração celular' }).check();
    data.unconfirmedLessons.push('l-resp');
    await integrate.click();
    await dialog.locator('.multi-lesson-status', { hasText: 'Nenhuma aula desta seleção' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Gerar material integrado' }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    record('Barra de seleção (API simulada): "Material integrado" exige duas aulas; a prévia mostra o que fica de fora e impede pedir sem aula confirmada');

    // ---------- 3.4: several units picked in the dialog -----------------------------------------
    data.unconfirmedLessons = ['l-cloro', 'l-rev'];
    await page.goto(base + '/historico.html?folder=sub-bio');
    const unitsButton = page.getByRole('button', { name: 'Estudar várias unidades' });
    await unitsButton.click();
    const unitsDialog = page.locator('dialog[open].multi-lesson-dialog');
    await unitsDialog.locator('.multi-lesson-status', { hasText: 'Escolha pelo menos uma unidade.' }).waitFor();
    assert.equal(await unitsDialog.getByRole('button', { name: 'Gerar material integrado' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'units', 'focus starts on the first unit');
    await unitsDialog.getByRole('group', { name: 'Biologia' }).waitFor();
    await page.keyboard.press('Space');
    await unitsDialog.locator('.multi-lesson-status', { hasText: '2 aulas prontas para estudar juntas.' }).waitFor();
    assert.match(await unitsDialog.locator('.multi-lesson-excluded').textContent(), /Cloroplastos \(rascunho\) — transcrição ainda não confirmada/);
    await unitsDialog.getByRole('checkbox', { name: 'Célula' }).check();
    await unitsDialog.locator('.multi-lesson-status', { hasText: '3 aulas prontas para estudar juntas.' }).waitFor();
    assert.deepEqual(await unitsDialog.locator('.multi-lesson-sources li').allTextContents(), ['Fotossíntese e respiração celular', 'Respiração celular', 'Membrana plasmática']);
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Diálogo de várias unidades');
    await shot(page, 'dialogo-unidades', false);
    // The selection changes between the preview and the request: refused, the new list is shown.
    data.unconfirmedLessons.push('l-membrana');
    await unitsDialog.getByRole('button', { name: 'Gerar material integrado' }).click();
    await unitsDialog.locator('[role="alert"]', { hasText: 'As aulas da seleção mudaram desde a prévia' }).waitFor();
    await unitsDialog.locator('.multi-lesson-status', { hasText: '2 aulas prontas para estudar juntas.' }).waitFor();
    assert.match(await unitsDialog.locator('.multi-lesson-excluded').textContent(), /Membrana plasmática — transcrição ainda não confirmada/);
    await unitsDialog.getByRole('button', { name: 'Gerar material integrado' }).click();
    await page.waitForURL(/integrado\.html\?id=/);
    const unitsRequest = data.multiLessonRequests.at(-1);
    assert.deepEqual(unitsRequest.selection, { kind: 'units', ids: ['unit-energia', 'unit-celula'] });
    assert.deepEqual(unitsRequest.expectedRevisionIds, ['rev-l-foto', 'rev-l-resp']);
    record('Várias unidades (API simulada): "Estudar várias unidades" lista as unidades por disciplina; cada marcação atualiza a prévia; se as aulas mudam antes do pedido (409), a lista nova aparece e o estudante confirma de novo');

    // ---------- Exports unavailable (migration missing): the material still shows -------------
    data.multiLessonExportsUnavailable = true;
    await page.goto(integratedUrl);
    await page.locator('#multi-lesson-questions-title').waitFor();
    assert.equal(await page.locator('[data-multi-lesson-export]').count(), 0);
    data.multiLessonExportsUnavailable = false;
    record('Sem a migration de exportação (API simulada, 503): o material aparece normalmente, sem os botões de salvar');

    // ---------- Phone width: list and detail without horizontal scroll ------------------------
    const phone = await openApp(browser, base, flags, data, { width: 390, height: 844 });
    await phone.page.goto(base + '/integrado.html');
    await phone.page.locator('.multi-lesson-list-item').first().waitFor();
    await settle(phone.page);
    await axeCheck(phone.page, 'main', 'Lista de materiais integrados 390');
    await noHorizontalScroll(phone.page, 'lista 390');
    await phone.page.locator('.multi-lesson-list-item a').first().click();
    await phone.page.locator('#multi-lesson-questions-title').waitFor();
    await settle(phone.page);
    await axeCheck(phone.page, 'main', 'Material integrado 390');
    await noHorizontalScroll(phone.page, 'material 390');
    await phone.page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
    await phone.page.getByRole('button', { name: 'Estudar a unidade inteira' }).click();
    await phone.page.locator('dialog[open] .multi-lesson-status', { hasText: /pronta|Nenhuma/ }).waitFor();
    await settle(phone.page);
    await axeCheck(phone.page, 'dialog[open]', 'Diálogo 390');
    await noHorizontalScroll(phone.page, 'diálogo 390');
    await shot(phone.page, 'material-390', false);
    await phone.page.keyboard.press('Escape');
    await phone.page.goto(base + '/historico.html?folder=sub-bio');
    await phone.page.getByRole('button', { name: 'Estudar várias unidades' }).click();
    await phone.page.locator('dialog[open] .multi-lesson-units').waitFor();
    await phone.page.locator('dialog[open]').getByRole('checkbox', { name: 'Célula' }).check();
    await phone.page.locator('dialog[open] .multi-lesson-status', { hasText: /pronta|Nenhuma/ }).waitFor();
    await settle(phone.page);
    await axeCheck(phone.page, 'dialog[open]', 'Diálogo de várias unidades 390');
    await noHorizontalScroll(phone.page, 'diálogo de unidades 390');
    await phone.context.close();
    record('390 px (API simulada): lista, material e diálogo sem rolagem horizontal e sem violações do axe');
    await context.close();
    assert.deepEqual(errors, [], 'page errors');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`multi-lesson-check: ${passed.length} journeys passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
