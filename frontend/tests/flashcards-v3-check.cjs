// Flashcards 3.0 with a simulated API (FEATURE_FLASHCARDS_V3 on): typed card creation, one look per
// set and a template editor, merge with "same question, different answers" decisions, and an
// Anki package preview/import. The real server logic is covered by backend tests (PGlite).
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
  settle,
  allFlags,
  startServer,
  launchBrowser,
  noHorizontalScroll,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'flashcards-v3');
fs.mkdirSync(output, { recursive: true });
const flags = { ...allFlags, flashcards_v3: true };
const card = (id, front, back) => ({ id, front_text: front, back_text: back, status: 'active' });

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const data = state();
    data.sets = [
      { id: 'set-ana', name: 'Ana', card_count: 2, due_count: 0, status: 'active', cards: [card('a1', 'O que é ATP?', 'Moeda de energia'), card('a2', 'Onde ocorre a fotossíntese?', 'No cloroplasto')] },
      { id: 'set-bruno', name: 'Bruno', card_count: 2, due_count: 0, status: 'active', cards: [card('b1', 'o que é ATP', 'moeda de energia.'), card('b2', 'Onde ocorre a fotossíntese?', 'Nas folhas')] },
    ];
    // The first due card belongs to Ana's set, is a cloze note from a merge and has an image.
    Object.assign(data.dueCards[0], {
      set_id: 'set-ana',
      note_type: 'cloze',
      origin_label: 'Bruno',
      media: [{ name: 'folha.png', mime: 'image/png', url: base + '/assets/brand/logo-symbol.png' }],
    });
    const { context, page } = await openApp(browser, base, flags, data, { width: 1280, height: 900 });

    // ---------- Review card: type, origin and image; one look per set (server) --------------
    await page.goto(base + '/flashcards.html#revisar');
    const review = page.locator('.flashcard-review-card');
    await review.locator('.flashcard-type-badge', { hasText: 'Lacunas (cloze)' }).waitFor();
    assert.match(await review.locator('.flashcard-origin').textContent(), /De: Bruno/);
    assert.equal(await review.locator('.flashcard-media img').getAttribute('alt'), 'Imagem do cartão: folha.png');
    // 3.6 (Flashcards page): the set is chosen above the card; its look in the Aparência section,
    // which starts on the set being reviewed.
    await page.locator('[data-flashcard-set-filter]').selectOption('set-ana');
    await page.getByRole('tab', { name: 'Aparência' }).click();
    const look = page.locator('[data-set-look]');
    await look.waitFor();
    await look.selectOption('base:sticky');
    await page.locator('.flashcard-set-look [role=status]', { hasText: 'Aparência aplicada ao conjunto inteiro' }).waitFor();
    assert.equal(data.sets[0].template_base, 'sticky');
    assert.deepEqual(data.sets[0].cards.map((c) => c.back_text), ['Moeda de energia', 'No cloroplasto'], 'content untouched');
    await page.locator('.flashcard-review-card[data-card-template="sticky"]').waitFor({ state: 'attached' });
    // Own template: editor with contrast warning, saved, applied to the whole set.
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    const editor = page.getByRole('dialog', { name: 'Novo modelo de cartão' });
    await editor.waitFor();
    await editor.getByLabel('Nome do modelo').fill('Matcha');
    await editor.getByLabel('Base').selectOption('notebook');
    await editor.getByLabel('Texto').fill('#eeeeee'); // light ink on white paper
    await editor.getByLabel('Texto').dispatchEvent('input');
    await editor.locator('.card-template-warning', { hasText: 'Contraste baixo' }).waitFor();
    await editor.getByLabel('Texto').fill('#1f3b1f');
    await editor.getByLabel('Texto').dispatchEvent('input');
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Editor de modelo de cartão');
    await editor.getByRole('button', { name: 'Salvar modelo' }).click();
    await editor.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('[data-set-look]')?.value.startsWith('template:'));
    const template = data.cardTemplates[0];
    assert.equal(template.name, 'Matcha');
    assert.equal(template.tokens.ink, '#1f3b1f');
    // The select changes before the request: wait for the server to record the new look.
    for (let i = 0; i < 50 && data.sets[0].template_id !== template.id; i += 1) await page.waitForTimeout(100);
    assert.equal(data.sets[0].template_id, template.id);
    await page.waitForFunction(() => document.querySelector('.flashcard-review-card')?.style.getPropertyValue('--card-ink') === '#1f3b1f');
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    const again = page.getByRole('dialog', { name: 'Novo modelo de cartão' });
    await again.getByLabel('Nome do modelo').fill(' matcha ');
    await again.getByRole('button', { name: 'Salvar modelo' }).click();
    await again.getByRole('alert').filter({ hasText: 'Você já tem um modelo com esse nome' }).waitFor();
    assert.equal(await again.getByLabel('Nome do modelo').getAttribute('aria-invalid'), 'true');
    assert.equal(data.cardTemplates.length, 1, 'no second template with the same name');
    await again.getByRole('button', { name: 'Cancelar' }).click();
    await again.waitFor({ state: 'detached' });
    record('Revisar: cartão mostra tipo, origem e imagem; uma aparência por conjunto (base ou modelo próprio) sem mudar o conteúdo; editor avisa contraste baixo');

    // ---------- Typed card creation ---------------------------------------------------------
    // 3.6: "Criar cartão" is a section of the page, not a dialog; saving confirms with a toast.
    await page.getByRole('tab', { name: 'Criar cartão' }).click();
    const create = page.locator('#criar');
    await create.waitFor();
    await create.getByLabel('Tipo de cartão').selectOption('cloze');
    await create.getByLabel('Texto com lacunas: {{c1::resposta}}').fill('O {{c1::NADPH}} leva elétrons.');
    await create.getByLabel('Conjunto (opcional)').selectOption('set-ana');
    await settle(page);
    await axeCheck(page, '#criar', 'Criar cartão com tipo');
    await create.locator('[type=submit]').click();
    await page.locator('.app-toast', { hasText: 'Cartão salvo. Ele já entra na revisão.' }).waitFor();
    assert.deepEqual(data.typedNotes.at(-1), { noteType: 'cloze', fields: { text: 'O {{c1::NADPH}} leva elétrons.' } });
    assert.equal(await create.getByLabel('Conjunto (opcional)').inputValue(), 'set-ana', 'the set stays chosen for the next card');
    assert.equal(await create.locator('[data-flashcard-create-status]').textContent(), '', 'no message left in the form');
    record('Criar cartão com tipo (lacunas): seção própria, salvo no conjunto escolhido, confirmação em aviso breve (toast)');

    // ---------- Merge with decisions ----------------------------------------------------------
    // An older template with the same name (saved before names were checked) must stay distinguishable.
    data.cardTemplates.push({ id: 'tpl-old', name: 'Matcha', base: 'sticky', tokens: {}, variants: {}, version: 1 });
    await page.reload();
    const panel = page.locator('#conjuntos .flashcard-sets');
    await panel.locator('h4', { hasText: 'Bruno' }).waitFor({ state: 'attached' });
    // Merge and import have their own section.
    await page.getByRole('tab', { name: 'Importar e mesclar' }).click();
    const tools = page.locator('#importar .deck-tools');
    assert(await tools.getByRole('button', { name: 'Mesclar conjuntos' }).isVisible(), 'merge is discoverable');
    assert(await tools.getByRole('button', { name: 'Importar cartões' }).isVisible(), 'import is discoverable');
    await tools.getByRole('button', { name: 'Mesclar conjuntos' }).click();
    const merge = page.getByRole('dialog', { name: 'Mesclar conjuntos' });
    await merge.waitFor();
    assert.match(await merge.locator('.app-dialog-hint').textContent(), /originais não mudam/);
    await page.waitForFunction(() => document.activeElement?.type === 'checkbox', null, { timeout: 3000 });
    await merge.getByRole('checkbox', { name: /^Ana/ }).check();
    await merge.locator('.deck-preview', { hasText: 'Escolha mais um conjunto' }).waitFor();
    assert(await merge.getByRole('button', { name: 'Criar conjunto' }).isDisabled(), 'nothing to create with one set');
    // A dropped connection while previewing is explained and can be retried.
    await page.route('**/api/flashcards/merge/preview', (route) => route.abort('internetdisconnected'), { times: 1 });
    await merge.getByRole('checkbox', { name: /^Bruno/ }).check();
    await merge.locator('.deck-preview .deck-error', { hasText: 'Sem conexão com o servidor' }).waitFor();
    assert(await merge.getByRole('button', { name: 'Criar conjunto' }).isDisabled());
    await merge.getByRole('button', { name: 'Atualizar prévia' }).click();
    await merge.locator('.merge-conflict legend', { hasText: 'Onde ocorre a fotossíntese?' }).waitFor();
    const summaryText = await merge.locator('.deck-preview').textContent();
    assert.match(summaryText, /3 cartões no conjunto novo/);
    assert.match(summaryText, /2 cartões sem repetição entram como estão/);
    assert.match(summaryText, /1 cartão repetido fica de fora/);
    assert.match(summaryText, /1 pergunta aparece com respostas diferentes/);
    assert.equal(await merge.locator('.deck-preview input').count(), 0, 'the live region holds counts only, not the choices');
    assert(await merge.getByRole('heading', { name: 'Resolva as perguntas com respostas diferentes' }).isVisible());
    await merge.getByRole('radio', { name: 'Manter a de Bruno: Nas folhas' }).check();
    // One look for the whole new set; templates with the same name are told apart.
    const lookSelect = merge.getByLabel('Aparência do conjunto novo');
    await page.waitForFunction(() => document.querySelectorAll('dialog[open] optgroup option').length === 2);
    const own = await merge.locator('optgroup option').allTextContents();
    assert.deepEqual(own.sort(), ['Matcha · Caderno', 'Matcha · Post-it']);
    await lookSelect.selectOption('base:polaroid');
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Mesclar com decisões');
    // A 409 from the server keeps the dialog open, says nothing was created and allows a retry.
    await page.route(
      (url) => url.pathname === '/api/flashcards/merge',
      (route) => route.fulfill({ status: 409, json: { error: { code: 'FLASHCARD_SET_LIMIT', message: 'Um conjunto pode ter no máximo 500 cartões.' } } }),
      { times: 1 },
    );
    await merge.getByRole('button', { name: 'Criar conjunto' }).click();
    await merge.getByRole('alert').filter({ hasText: 'no máximo 500 cartões. Nada foi criado.' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Criar conjunto');
    await merge.getByRole('button', { name: 'Criar conjunto' }).click();
    const done = tools.locator('.deck-tools-result');
    await done.locator('strong', { hasText: 'Conjunto mesclado criado com 3 cartões.' }).waitFor();
    assert.match(await done.textContent(), /1 cartão repetido ficou de fora\. 1 pergunta com respostas diferentes resolvida\. Os conjuntos originais não mudaram\./);
    await page.waitForFunction(() => document.activeElement?.textContent === 'Abrir o conjunto novo', null, { timeout: 3000 });
    const merged = data.sets.at(-1);
    assert.equal(merged.template_base, 'polaroid');
    assert.equal(data.merges.length, 1, 'the refused try created nothing; one merge in the end');
    assert.deepEqual(
      merged.cards.map((c) => [c.front_text, c.back_text]),
      // Ana's set also holds the cloze card created above.
      [['O que é ATP?', 'Moeda de energia'], ['Onde ocorre a fotossíntese?', 'Nas folhas'], ['O […] leva elétrons.', 'O NADPH leva elétrons.']],
    );
    assert.equal(data.sets[0].cards.length, 3, 'Ana keeps her own cards (2 + the typed one)');
    await done.getByRole('button', { name: 'Abrir o conjunto novo' }).click();
    assert.equal(await page.locator('[data-flashcard-set-filter]').inputValue(), merged.id, 'the new set opens');
    // …and is reviewed right away: the review view is back, with the filter marked on its key.
    await page.locator('#revisar:not([hidden])').waitFor();
    assert.equal(await page.locator('#tab-revisar').getAttribute('aria-selected'), 'true');
    record('Mesclar no servidor: seção Importar e mesclar; passos claros; prévia ao vivo só com contagens; sem conexão e 409 explicados; escolha por conflito; um modelo para o conjunto novo (nomes iguais diferenciados); confirmação com link para o conjunto novo');

    // ---------- Merge with a classmate's deck shared in a class (Turmas) ---------------------
    {
      const cls = state();
      cls.sets = [{ id: 'set-mine', name: 'Meu', card_count: 1, due_count: 0, status: 'active', cards: [card('m1', 'O que é ATP?', 'Moeda de energia')] }];
      cls.classrooms = {
        requests: [],
        rooms: [{
          id: 'room-1', name: 'Biologia 3A', description: '', status: 'active',
          members: [
            { userId: 'teacher-1', displayName: 'Prof. Lia', role: 'teacher', status: 'active' },
            { userId: 'user-dashboard', displayName: 'Marina', role: 'student', status: 'active' },
            { userId: 'colega-1', displayName: 'Caio', role: 'student', status: 'active' },
          ],
          invites: [], lessons: [], submissions: [], resources: [],
          shared: [{ id: 'shared-caio', setId: 'set-caio', name: 'Fotossíntese', ownerId: 'colega-1', cards: [
            { id: 'cc1', front: 'Onde ocorre a fotossíntese?', back: 'No cloroplasto' },
            { id: 'cc2', front: 'O que é ATP?', back: 'Moeda de energia' },
          ] }],
        }],
      };
      const view = await openApp(browser, base, { ...flags, classrooms: true }, cls, { width: 390, height: 844 });
      // An old Revisar link still works: it lands on the Flashcards page.
      await view.page.goto(base + '/revisar.html#flashcards');
      await view.page.waitForURL('**/flashcards.html#revisar');
      const sets = view.page.locator('.flashcard-sets');
      await sets.locator('h4', { hasText: 'Meu' }).waitFor({ state: 'attached' });
      await view.page.getByRole('tab', { name: 'Importar e mesclar' }).click();
      const classTools = view.page.locator('#importar .deck-tools');
      await classTools.getByRole('button', { name: 'Mesclar conjuntos' }).click();
      const dialog = view.page.getByRole('dialog', { name: 'Mesclar conjuntos' });
      // Own sets and classmates' shared decks are grouped; the shared one names author and class.
      await dialog.getByText('Compartilhados nas turmas').waitFor();
      await dialog.getByRole('checkbox', { name: /^Meu/ }).check();
      await dialog.getByRole('checkbox', { name: /^Fotossíntese.*Caio · Biologia 3A/ }).check();
      await dialog.locator('.deck-preview', { hasText: '2 cartões no conjunto novo' }).waitFor();
      await noHorizontalScroll(view.page, 'mesclar (390 px, diálogo aberto)');
      const inside = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
      assert(inside <= 1, `merge dialog overflows by ${inside}px at 390 px`);
      await settle(view.page);
      await axeCheck(view.page, 'dialog[open]', 'Mesclar com baralho da turma (390 px)');
      await dialog.getByRole('button', { name: 'Criar conjunto' }).click();
      await classTools.locator('.deck-tools-result', { hasText: 'Conjunto mesclado criado com 2 cartões.' }).waitFor();
      await noHorizontalScroll(view.page, 'confirmação da mesclagem (390 px)');
      assert.deepEqual(cls.merges.at(-1).sources, [{ setId: 'set-mine' }, { classroomId: 'room-1', sharedId: 'shared-caio' }]);
      assert.equal(cls.classrooms.rooms[0].shared[0].cards.length, 2, "Caio's shared deck is unchanged");
      await view.context.close();
      record('Mesclar com baralho compartilhado na turma (390 px): agrupado, com autor e turma, fonte só de leitura, o original não muda; sem rolagem lateral');
    }

    // ---------- Anki package ------------------------------------------------------------------
    await page.getByRole('tab', { name: 'Importar e mesclar' }).click();
    await tools.getByRole('button', { name: 'Importar cartões' }).click();
    const importer = page.getByRole('dialog', { name: 'Importar cartões' });
    await importer.getByLabel('Arquivo').setInputFiles({ name: 'quimica.apkg', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004 synthetic') });
    await importer.locator('.deck-preview', { hasText: '2 cartões encontrados' }).waitFor();
    const report = await importer.locator('.deck-preview').textContent();
    assert.match(report, /1 imagem será importada/);
    assert.match(report, /1 som ignorado/);
    assert.equal(await importer.getByLabel('Nome do novo conjunto').inputValue(), 'Química::Orgânica');
    assert.equal(data.apkgImports || 0, 0, 'the preview creates nothing');
    assert.equal(await importer.locator('.deck-preview dl').count(), 0, 'sample cards stay out of the live region');
    await importer.locator('.deck-sample dt', { hasText: 'Fórmula do metano?' }).waitFor();
    // The package takes one look too: a base here.
    await importer.getByLabel('Aparência do conjunto novo').selectOption('base:window');
    await importer.getByRole('button', { name: 'Criar conjunto' }).click();
    await tools.locator('.deck-tools-result', { hasText: '2 cartões importados para um conjunto novo.' }).waitFor();
    assert.equal(data.apkgImports, 1);
    assert.equal(data.sets.at(-1).template_base, 'window');
    assert.equal(data.sets.at(-1).template_id, null);
    // A text file: the chosen look (one of the student's templates) applies to the whole new deck.
    await tools.getByRole('button', { name: 'Importar cartões' }).click();
    const textLook = importer.getByLabel('Aparência do conjunto novo');
    await page.waitForFunction(() => document.querySelectorAll('dialog[open] optgroup option').length === 2);
    assert.equal(await textLook.inputValue(), '', 'the favourite look by default');
    await importer.getByLabel('Arquivo').setInputFiles({
      name: 'Citologia.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(['Organela da respiração?\tMitocôndria', 'A {{c1::membrana}} separa a célula do meio.\t'].join('\n')),
    });
    await importer.locator('.deck-preview', { hasText: '2 cartões encontrados' }).waitFor();
    await textLook.selectOption(`template:${template.id}`);
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Importar texto com aparência');
    await importer.getByRole('button', { name: 'Criar conjunto' }).click();
    await tools.locator('.deck-tools-result', { hasText: '2 cartões importados para um conjunto novo.' }).waitFor();
    const textDeck = data.decks.at(-1);
    assert.equal(textDeck.origin, 'text_import');
    assert.equal(textDeck.templateId, template.id);
    assert.equal(textDeck.templateBase, undefined, 'a template or a base, never both');
    const imported = data.sets.at(-1);
    assert.equal(imported.name, 'Citologia');
    assert.equal(imported.template_id, template.id, 'the look is stored on the deck, for every card');
    assert.deepEqual(imported.cards.map((c) => c.note_type), ['basic', 'cloze']);
    await tools.getByRole('button', { name: 'Abrir o conjunto novo' }).click();
    await page.waitForFunction(() => document.querySelector('[data-set-look]')?.value.startsWith('template:'));
    assert.equal(await page.locator('[data-set-look]').inputValue(), `template:${template.id}`);
    // A broken package is explained.
    await page.getByRole('tab', { name: 'Importar e mesclar' }).click();
    await tools.getByRole('button', { name: 'Importar cartões' }).click();
    await importer.getByLabel('Arquivo').setInputFiles({ name: 'ruim.apkg', mimeType: 'application/octet-stream', buffer: Buffer.from('nada') });
    await importer.locator('.deck-error', { hasText: 'não é um pacote do Anki' }).waitFor();
    // At 390 px the import dialog, with its look selector, fits without sideways scrolling.
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page, 'importar cartões com aparência (390 px, diálogo aberto)');
    const importInside = await importer.evaluate((node) => node.scrollWidth - node.clientWidth);
    assert(importInside <= 1, `import dialog overflows by ${importInside}px at 390 px`);
    await page.keyboard.press('Escape');
    await noHorizontalScroll(page, 'revisar flashcards 3.0 (390 px)');
    record('Pacote do Anki (.apkg): prévia com cartões, imagens e sons ignorados; importa para um conjunto novo; pacote inválido explicado');
    record('Importar texto ou .apkg com uma aparência (base ou modelo próprio) para o conjunto novo inteiro');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors.filter((e) => !/Sem simulação|404/.test(e)), [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} flashcards 3.0 checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
