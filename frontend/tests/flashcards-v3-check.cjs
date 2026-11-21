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
    await page.goto(base + '/revisar.html#flashcards');
    const review = page.locator('.flashcard-review-card');
    await review.locator('.flashcard-type-badge', { hasText: 'Lacunas (cloze)' }).waitFor();
    assert.match(await review.locator('.flashcard-origin').textContent(), /De: Bruno/);
    assert.equal(await review.locator('.flashcard-media img').getAttribute('alt'), 'Imagem do cartão: folha.png');
    await page.locator('[data-flashcard-set-filter]').selectOption('set-ana');
    const look = page.locator('[data-set-look]');
    await look.waitFor();
    await look.selectOption('base:sticky');
    await page.locator('.flashcard-set-look [role=status]', { hasText: 'Aparência aplicada ao conjunto inteiro' }).waitFor();
    assert.equal(data.sets[0].template_base, 'sticky');
    assert.deepEqual(data.sets[0].cards.map((c) => c.back_text), ['Moeda de energia', 'No cloroplasto'], 'content untouched');
    await page.locator('.flashcard-review-card[data-card-template="sticky"]').waitFor();
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
    record('Revisar: cartão mostra tipo, origem e imagem; uma aparência por conjunto (base ou modelo próprio) sem mudar o conteúdo; editor avisa contraste baixo');

    // ---------- Typed card creation ---------------------------------------------------------
    await page.getByRole('button', { name: /Criar cartão manualmente/ }).click();
    const create = page.getByRole('dialog', { name: 'Criar cartão' });
    await create.waitFor();
    await create.getByLabel('Tipo de cartão').selectOption('cloze');
    await create.getByLabel('Texto com lacunas: {{c1::resposta}}').fill('O {{c1::NADPH}} leva elétrons.');
    await create.getByLabel('Conjunto (opcional)').selectOption('set-ana');
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Criar cartão com tipo');
    await create.locator('[type=submit]').click();
    await create.waitFor({ state: 'hidden' });
    assert.deepEqual(data.typedNotes.at(-1), { noteType: 'cloze', fields: { text: 'O {{c1::NADPH}} leva elétrons.' } });
    record('Criar cartão com tipo (lacunas): campos próprios, salvo no conjunto escolhido e renderizado pelo servidor');

    // ---------- Merge with decisions ----------------------------------------------------------
    await page.reload();
    const panel = page.locator('details.flashcard-sets');
    await panel.locator('h4', { hasText: 'Bruno' }).waitFor({ state: 'attached' });
    if (!(await panel.evaluate((n) => n.open))) await panel.locator('summary').click();
    await panel.getByRole('button', { name: 'Mesclar conjuntos' }).click();
    const merge = page.getByRole('dialog', { name: 'Mesclar conjuntos' });
    await merge.getByRole('checkbox', { name: /^Ana/ }).check();
    await merge.getByRole('checkbox', { name: /^Bruno/ }).check();
    await merge.locator('.merge-conflict legend', { hasText: 'Onde ocorre a fotossíntese?' }).waitFor();
    assert.match(await merge.locator('.deck-preview').textContent(), /1 cartão repetido fica de fora/);
    await merge.getByRole('radio', { name: 'Manter a de Bruno: Nas folhas' }).check();
    await merge.getByLabel('Aparência do conjunto novo').selectOption('base:polaroid');
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Mesclar com decisões');
    await merge.getByRole('button', { name: 'Criar conjunto' }).click();
    await panel.locator('[role=status]', { hasText: 'Conjunto mesclado criado com 3 cartões.' }).waitFor();
    const merged = data.sets.at(-1);
    assert.equal(merged.template_base, 'polaroid');
    assert.deepEqual(
      merged.cards.map((c) => [c.front_text, c.back_text]),
      // Ana's set also holds the cloze card created above.
      [['O que é ATP?', 'Moeda de energia'], ['Onde ocorre a fotossíntese?', 'Nas folhas'], ['O […] leva elétrons.', 'O NADPH leva elétrons.']],
    );
    assert.equal(data.sets[0].cards.length, 3, 'Ana keeps her own cards (2 + the typed one)');
    record('Mesclar no servidor: repetidos de fora, escolha por pergunta com respostas diferentes, uma aparência para o conjunto novo');

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
      const view = await openApp(browser, base, { ...flags, classrooms: true }, cls, { width: 1280, height: 900 });
      await view.page.goto(base + '/revisar.html#flashcards');
      const sets = view.page.locator('details.flashcard-sets');
      await sets.locator('h4', { hasText: 'Meu' }).waitFor({ state: 'attached' });
      if (!(await sets.evaluate((n) => n.open))) await sets.locator('summary').click();
      await sets.getByRole('button', { name: 'Mesclar conjuntos' }).click();
      const dialog = view.page.getByRole('dialog', { name: 'Mesclar conjuntos' });
      await dialog.getByRole('checkbox', { name: /^Meu/ }).check();
      await dialog.getByRole('checkbox', { name: /Fotossíntese — Caio \(Biologia 3A\)/ }).check();
      await dialog.locator('.deck-preview', { hasText: '2 cartões no conjunto novo' }).waitFor();
      await dialog.getByRole('button', { name: 'Criar conjunto' }).click();
      await sets.locator('[role=status]', { hasText: 'Conjunto mesclado criado com 2 cartões.' }).waitFor();
      assert.deepEqual(cls.merges.at(-1).sources, [{ setId: 'set-mine' }, { classroomId: 'room-1', sharedId: 'shared-caio' }]);
      assert.equal(cls.classrooms.rooms[0].shared[0].cards.length, 2, "Caio's shared deck is unchanged");
      await view.context.close();
      record('Mesclar com baralho compartilhado na turma: aparece com autor e turma, entra como fonte só de leitura, o original não muda');
    }

    // ---------- Anki package ------------------------------------------------------------------
    await panel.getByRole('button', { name: 'Importar cartões' }).click();
    const importer = page.getByRole('dialog', { name: 'Importar cartões' });
    await importer.getByLabel('Arquivo').setInputFiles({ name: 'quimica.apkg', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004 synthetic') });
    await importer.locator('.deck-preview', { hasText: '2 cartões encontrados' }).waitFor();
    const report = await importer.locator('.deck-preview').textContent();
    assert.match(report, /1 imagem será importada/);
    assert.match(report, /1 som ignorado/);
    assert.equal(await importer.getByLabel('Nome do novo conjunto').inputValue(), 'Química::Orgânica');
    await importer.getByRole('button', { name: 'Criar conjunto' }).click();
    await panel.locator('[role=status]', { hasText: '2 cartões importados para um conjunto novo.' }).waitFor();
    assert.equal(data.apkgImports, 1);
    // A broken package is explained.
    await panel.getByRole('button', { name: 'Importar cartões' }).click();
    await importer.getByLabel('Arquivo').setInputFiles({ name: 'ruim.apkg', mimeType: 'application/octet-stream', buffer: Buffer.from('nada') });
    await importer.locator('.deck-error', { hasText: 'não é um pacote do Anki' }).waitFor();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page, 'revisar flashcards 3.0 (390 px)');
    record('Pacote do Anki (.apkg): prévia com cartões, imagens e sons ignorados; importa para um conjunto novo; pacote inválido explicado');
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
