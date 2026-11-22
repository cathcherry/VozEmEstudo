// 3.5 Milestone 6 in a real browser with a SIMULATED API (support/mock-discoveries.cjs): from a
// lesson, "Investigar uma pergunta" → a question (suggested from the lesson) → evidence picked by
// selecting transcript text and by a whole segment → own explanation → apply (a highlight) →
// reflection → discovery; the Arquivo de Descobertas (edit, reflection, connection across
// subjects) and the Gabinete (drawers with date and lesson, desk placement, experience modes).
// axe at 1280 and 390 px, no horizontal scroll at 390 px, keyboard paths. Nothing here calls a
// real backend, database or AI provider: the rules are tested against Postgres in
// backend/tests/discoveries-*.test.js.
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

const output = path.join(__dirname, 'artifacts', 'discoveries');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const flags = { ...allFlags, discoveries: true };
const EXPLANATION = 'A planta usa a luz para fabricar glicose, guardando energia química nas ligações.';

function sample() {
  const data = state();
  const earlier = new Date(Date.now() - 5 * 86400000).toISOString();
  data.seedDiscoveries = [
    {
      id: '0b1c2d3e-0000-4000-8000-000000000001',
      materialId: 'l-rev',
      title: 'De onde vinha a energia das fábricas?',
      explanation: 'O carvão guardava energia química que as máquinas a vapor transformavam em trabalho.',
      quote: 'máquina a vapor',
      createdAt: earlier,
    },
  ];
  // Found earlier (three investigations): placeable on the desk.
  data.seedUnlocks = [
    { id: 'object.magnifying-glass', event: 'investigation_completed', sourceId: '0b1c2d3e-0000-4000-8000-000000000001', investigationId: '0b1c2d3e-0000-4000-8000-000000000001', currentDiscoveryId: '0b1c2d3e-0000-4000-8000-000000000001', materialId: 'l-rev', lessonTitle: 'Revolução Industrial: causas e consequências', subject: 'História', occurredAt: earlier },
  ];
  return data;
}

/** Selects [from, to) code points of a segment's text, as a person dragging the mouse would. */
const selectInSegment = (page, position, from, to) =>
  page.evaluate(
    (args) => {
      const text = document.querySelector(`.transcription-segment[data-segment-position="${args.position}"] .segment-text`).firstChild;
      const units = (n) => [...text.data].slice(0, n).join('').length;
      const range = document.createRange();
      range.setStart(text, units(args.from));
      range.setEnd(text, units(args.to));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { position, from, to },
  );

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Flag off: no entry point; the pages explain ---------------------------------
    {
      const { context, page } = await openApp(browser, base, allFlags, sample());
      await page.goto(base + '/material.html?id=l-foto');
      await page.locator('[data-material-actions]:not([hidden])').waitFor();
      assert.equal(await page.locator('[data-start-investigation]').isVisible(), false);
      for (const [file, text] of [['investigar.html?aula=l-foto', 'ainda não estão ativas'], ['descobertas.html', 'ainda não está ativo'], ['gabinete.html', 'ainda não está ativo']]) {
        await page.goto(`${base}/${file}`);
        await page.locator('[data-tool-unavailable]:not([hidden])', { hasText: text }).waitFor();
      }
      await context.close();
      record('Sem a flag (API simulada): a aula não oferece investigação e as três páginas explicam que o recurso não está ativo');
    }

    const data = sample();
    const { context, page } = await openApp(browser, base, flags, data, { width: 1280, height: 900 });

    // ---------- From the lesson ------------------------------------------------------------
    await page.goto(base + '/material.html?id=l-foto');
    const entry = page.getByRole('link', { name: 'Investigar uma pergunta' });
    await entry.waitFor();
    assert.equal(await entry.getAttribute('href'), './investigar.html?aula=l-foto');
    await entry.click();
    await page.waitForURL(/investigar\.html\?aula=l-foto/);
    await page.locator('[data-investigation-layout]:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-investigation-lesson]').textContent(), 'Fotossíntese e respiração celular');
    // Prompts come from the lesson (title, a defined term, its questions); no AI call.
    const prompts = await page.locator('[data-prompts] button').allTextContents();
    assert.deepEqual(prompts.slice(0, 2), ['Qual é a ideia central de “Fotossíntese e respiração celular”?', 'Por que “fotossíntese” importa nesta aula?']);
    assert(prompts.includes('Onde ocorre a fotossíntese?'));
    assert.equal(await page.locator('[data-step-button="evidence"]').isDisabled(), true, 'later steps wait for the question');
    await settle(page);
    await axeCheck(page, 'main', 'Investigação: pergunta');
    await shot(page, 'investigacao-pergunta');
    record('Aula → "Investigar uma pergunta" (API simulada): abre a investigação com sugestões tiradas da própria aula, sem chamada de IA');

    // 1. Question: a prompt, then the student's own words.
    await page.locator('[data-prompts] button').nth(1).click();
    const question = page.locator('[data-question-input]');
    assert.equal(await question.inputValue(), 'Por que “fotossíntese” importa nesta aula?');
    await question.fill('Por que a fotossíntese guarda energia?');
    await page.getByRole('button', { name: 'Começar a investigação' }).click();
    await page.waitForURL(/investigar\.html\?id=/);
    await page.locator('[data-step="explore"]:not([hidden])').waitFor();
    const created = data.discoveryState.requests.find((r) => r.kind === 'save' && r.version === 0);
    assert.deepEqual(created.body, { materialId: 'l-foto', sourceRevisionId: 'rev-l-foto', question: 'Por que a fotossíntese guarda energia?', questionOrigin: 'student' });
    assert.equal(await page.locator('[data-step-button="explore"]').getAttribute('aria-current'), 'step');
    // 3.6: the card this question becomes is a pencil sketch, and says what turns it into ink.
    const sketch = page.locator('[data-investigation-card] .specimen-card');
    assert.equal(await sketch.getAttribute('data-stage'), 'sketch');
    assert.match(await sketch.locator('.specimen-why').textContent(), /passa a tinta quando você guardar um trecho conferido da aula como evidência e explicar com as suas palavras/);
    record('Pergunta (API simulada): a pergunta escrita pela pessoa começa a investigação na revisão confirmada mostrada');

    // 2. Explore: filter the passages, mark explored.
    await page.getByLabel('Procurar nos trechos').fill('cloroplastos');
    assert.equal(await page.locator('.investigation-segment-row:not([hidden])').count(), 1);
    await page.getByLabel('Procurar nos trechos').fill('');
    await page.getByRole('button', { name: 'Já explorei os trechos' }).click();
    await page.locator('[data-step="evidence"]:not([hidden])').waitFor();
    record('Explorar (API simulada): busca nos trechos confirmados e registro da exploração');

    // 3. Evidence by selecting text, then a whole segment by keyboard.
    await selectInSegment(page, 0, 2, 14);
    await page.locator('[data-selection-preview]', { hasText: 'fotossíntese' }).waitFor();
    await page.getByLabel('Por que este trecho importa? (opcional)').fill('Define o processo');
    await page.getByRole('button', { name: 'Usar a seleção como evidência' }).click();
    await page.locator('[data-evidence-list] .evidence-quote', { hasText: 'fotossíntese' }).waitFor();
    const sent = data.discoveryState.requests.find((r) => r.kind === 'evidence');
    assert.deepEqual(
      { segmentPosition: sent.segmentPosition, startOffset: sent.startOffset, endOffset: sent.endOffset, quote: sent.quote, note: sent.note },
      { segmentPosition: 0, startOffset: 2, endOffset: 14, quote: 'fotossíntese', note: 'Define o processo' },
    );
    await page.locator('[data-unlock-notice]:not([hidden])', { hasText: 'Primeira evidência' }).waitFor();
    assert.equal(await page.locator('[data-unlock-notice] [data-art-slot][data-art-id="stamp.first-evidence"]').count(), 1);
    const whole = page.locator('[data-whole-segment="2"]');
    await whole.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-evidence-list] .evidence-item').nth(1).waitFor();
    assert.match(await page.locator('[data-evidence-list] .evidence-source a').first().getAttribute('href'), /^\.\/material\.html\?id=l-foto&busca=fotoss%C3%ADntese&trecho=0#transcricao$/);
    await settle(page);
    await axeCheck(page, 'main', 'Investigação: evidências');
    await shot(page, 'investigacao-evidencias');
    record('Evidências (API simulada): seleção de texto vira citação com âncora (trecho, offsets em code points); trecho inteiro pelo teclado; o selo "Primeira evidência" aparece com o id da arte');

    // 4. Explanation (counter, minimum), 5. apply, 6. reflection.
    await page.locator('[data-step-button="explain"]').click();
    assert.match(await page.locator('[data-missing]').textContent(), /a sua explicação/);
    assert.equal(await page.getByRole('button', { name: 'Registrar a descoberta' }).isDisabled(), true);
    await page.getByLabel('Sua explicação').fill(EXPLANATION);
    assert.match(await page.locator('[data-explanation-counter]').textContent(), /caracteres/);
    await page.getByRole('button', { name: 'Salvar a explicação' }).click();
    await page.locator('[data-unlock-notice]', { hasText: 'Com as próprias palavras' }).waitFor();
    await page.locator('[data-step-button="apply"]').click();
    const linkButton = page.locator('.link-option', { hasText: 'A energia luminosa é convertida' }).getByRole('button');
    await linkButton.click();
    await page.locator('.link-option', { hasText: 'A energia luminosa é convertida' }).getByRole('button', { name: 'Ligado' }).waitFor();
    assert.equal(await page.locator('.link-option button[aria-pressed="true"]').count(), 1);
    await page.locator('[data-step-button="reflect"]').click();
    await page.getByLabel('Sua reflexão').fill('Antes eu achava que a planta tirava energia do solo.');
    await page.getByRole('button', { name: 'Salvar a reflexão' }).click();
    await page.locator('[data-investigation-status]', { hasText: 'Reflexão salva.' }).waitFor();
    assert.equal(await page.locator('.investigation-rail li[data-done="true"]').count(), 6);
    record('Explicar, aplicar e refletir (API simulada): contador do mínimo, ligação por referência a um destaque, reflexão; todas as etapas marcadas');

    // Discovery.
    const complete = page.getByRole('button', { name: 'Registrar a descoberta' });
    assert.equal(await complete.isDisabled(), false);
    await complete.click();
    await page.locator('[data-investigation-done]:not([hidden])').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.investigationDone !== undefined), true, 'focus moves to the result');
    assert.equal(await page.locator('[data-investigation-card] .specimen-card').getAttribute('data-traits'), 'inked stamped', 'inked, and stamped by the reflection');
    const stamps = await page.locator('[data-done-stamps] [data-art-slot][data-art-id]').evaluateAll((nodes) => nodes.map((n) => n.dataset.artId).sort());
    assert.deepEqual(stamps, ['stamp.first-evidence', 'stamp.first-investigation', 'stamp.first-reflection', 'stamp.own-explanation']);
    await settle(page);
    await axeCheck(page, 'main', 'Investigação: descoberta registrada');
    await shot(page, 'investigacao-descoberta');
    const discoveryHref = await page.getByRole('link', { name: 'Abrir a descoberta' }).getAttribute('href');
    record('Descoberta (API simulada): registrada com pergunta, evidência verificada e explicação própria; selos com a lembrança do que a pessoa fez');

    // ---------- Arquivo de Descobertas -----------------------------------------------------
    await page.goto(base + '/descobertas.html');
    await page.locator('.archive-cards .specimen-card').nth(1).waitFor();
    assert.deepEqual((await page.locator('.archive-cards .specimen-title').allTextContents()).sort(), ['De onde vinha a energia das fábricas?', 'Por que a fotossíntese guarda energia?']);
    await settle(page);
    await axeCheck(page, 'main', 'Arquivo de Descobertas');
    await page.goto(base + '/' + discoveryHref.replace('./', ''));
    await page.locator('[data-discovery-title]', { hasText: 'Por que a fotossíntese guarda energia?' }).waitFor();
    assert.equal(await page.locator('[data-discovery-explanation]').textContent(), EXPLANATION);
    assert.equal(await page.locator('[data-discovery-evidence] .evidence-item').count(), 2);
    assert.match(await page.locator('[data-discovery-links]').textContent(), /Destaque: A energia luminosa/);
    // Edit → a new version; reflection; connection to the History discovery.
    await page.locator('[data-discovery-edit] summary').click();
    await page.getByLabel('Explicação', { exact: true }).fill(`${EXPLANATION} A respiração depois libera essa energia.`);
    await page.getByRole('button', { name: 'Salvar nova versão' }).click();
    await page.locator('[data-discoveries-status]', { hasText: 'Nova versão salva.' }).waitFor();
    assert.match(await page.locator('[data-discovery-meta]').textContent(), /versão 2/);
    assert.equal(await page.locator('[data-discovery-versions] li').count(), 2);
    await page.getByLabel('Nova reflexão').fill('A respiração é o caminho de volta.');
    await page.getByRole('button', { name: 'Guardar a reflexão' }).click();
    await page.locator('[data-discovery-reflections] li').nth(1).waitFor();
    await page.getByLabel('Ligar a outra descoberta').selectOption({ label: 'De onde vinha a energia das fábricas? (História)' });
    await page.getByLabel('O que as liga? (opcional)').fill('Energia guardada e liberada');
    await page.getByRole('button', { name: 'Ligar as descobertas' }).click();
    await page.locator('[data-unlock-notice]', { hasText: 'Ponte entre disciplinas' }).waitFor();
    await page.locator('.discovery-connection[data-across="true"]', { hasText: 'De onde vinha a energia das fábricas?' }).waitFor();
    assert(await page.locator('[data-discovery-stamps] [data-art-id="stamp.connection"]').count());
    await settle(page);
    await axeCheck(page, 'main', 'Página da descoberta');
    await shot(page, 'descoberta');
    record('Arquivo de Descobertas (API simulada): lista as páginas; a descoberta evolui por versões, recebe reflexão e se liga a outra de História (selo "Ponte entre disciplinas")');

    // ---------- Gabinete -------------------------------------------------------------------
    await page.goto(base + '/gabinete.html');
    const stampDrawer = page.locator('[data-drawer="stamp"]');
    await stampDrawer.waitFor();
    assert.match(await stampDrawer.textContent(), /5 de 6/);
    await stampDrawer.click();
    await page.locator('#curio-tray .cabinet-item[data-state="unlocked"]').first().waitFor();
    const evidenceStamp = page.locator('.cabinet-item[data-collectible="stamp.first-evidence"]');
    assert(await evidenceStamp.locator('time').getAttribute('datetime'));
    await evidenceStamp.click();
    const dialog = page.locator('[data-specimen-dialog]');
    await dialog.locator('[data-specimen-title]', { hasText: 'Primeira evidência' }).waitFor();
    assert.match(await dialog.textContent(), /Você guardou o primeiro trecho conferido/);
    assert.match(await dialog.locator('[data-specimen-facts]').textContent(), /Fotossíntese e respiração celular/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('[data-drawer="object"]').click();
    assert.equal(await page.locator('.cabinet-item[data-collectible="object.desk-lamp"]').getAttribute('data-state'), 'locked');
    assert.doesNotMatch(await page.locator('main').textContent(), /domina|dominou|mestre/i, 'never claims mastery');
    // Place the magnifying glass on the desk from its museum label.
    await page.locator('.cabinet-item[data-collectible="object.magnifying-glass"]').click();
    await dialog.getByLabel('Lugar na mesa').selectOption({ label: 'Janela' });
    await dialog.getByRole('button', { name: 'Colocar na mesa' }).click();
    await page.locator('[data-cabinet-status]', { hasText: 'Colocado na mesa: Janela.' }).waitFor();
    assert.deepEqual(data.discoveryState.layout.items, [{ slot: 'window', objectId: 'object.magnifying-glass' }]);
    await dialog.getByRole('button', { name: 'Guardar no gabinete' }).waitFor();
    await settle(page);
    await axeCheck(page, '[data-specimen-dialog]', 'Gabinete: etiqueta do objeto');
    await page.keyboard.press('Escape');
    await settle(page);
    await axeCheck(page, 'main', 'Gabinete');
    await shot(page, 'gabinete');
    // Modes: adventure shows the way to the next items; quiet hides game interface elsewhere.
    await page.getByLabel('Estudo aventura').check();
    await page.locator('.cabinet-item[data-collectible="object.desk-lamp"] .cabinet-progress', { hasText: '2 de 5' }).waitFor();
    await page.getByLabel('Estudo silencioso').check();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.experienceMode), 'quiet');
    await page.goto(base + '/descobertas.html');
    await page.locator('.archive-cards .specimen-card').first().waitFor();
    assert.equal(await page.locator('.stamp-row').first().isVisible(), false, 'quiet mode hides stamps');
    assert.equal(await page.locator('[data-archive-panel="subjects"] .specimen-card').count(), 2, 'and keeps every record');
    record('Gabinete (API simulada): gavetas com data e aula de origem, itens ainda não encontrados com o que os faz aparecer, objeto colocado na mesa; modos aventura e silencioso mudam só o que aparece');

    // ---------- 390 px: axe and no horizontal scroll on the three pages ---------------------
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [file, label] of [
      [discoveryHref.replace('./descobertas.html', 'investigar.html').replace('?id=', '?id=') + '&etapa=evidencias', 'investigação 390'],
      ['descobertas.html', 'arquivo 390'],
      [discoveryHref.replace('./', ''), 'descoberta 390'],
      ['gabinete.html', 'gabinete 390'],
    ]) {
      await page.goto(`${base}/${file}`);
      await page.locator('main').waitFor();
      await settle(page);
      await noHorizontalScroll(page, label);
      await axeCheck(page, 'main', label);
      await shot(page, label.replace(/\s+/g, '-'));
    }
    record('390 px (API simulada): investigação, arquivo, descoberta e gabinete sem rolagem horizontal e sem violações de axe');
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
