// Journeys of the tools activated on 2026-11-20 that other checks only create or link to:
// creating a goal, completing and reopening a task, filters that leave a list empty, annotation
// pagination and the link back to the highlighted passage, a tool that fails to load, and a
// calendar export spread over several pages. Simulated API; no real backend or AI provider.
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
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
  noHorizontalScroll,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'feature-validation');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Planning: goal, complete, reopen, filters --------------------------------
    const data = state();
    let { context, page } = await openApp(browser, base, allFlags, data);
    await page.goto(base + '/planejar.html?criar=objetivo#tarefas');
    await page.locator('#planning-goal-title:visible').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'planning-goal-title');
    await page.locator('#planning-goal-title').fill('Preparar o seminário');
    await page.locator('[data-planning-goal-form] [type=submit]').click();
    await page.locator('[data-planning-status]', { hasText: 'Objetivo criado' }).waitFor();
    assert.deepEqual(
      data.createdGoals.map((g) => g.title),
      ['Preparar o seminário'],
    );
    const checkbox = page.getByRole('checkbox', {
      name: 'Concluir tarefa: Refazer as questões erradas',
    });
    await checkbox.check();
    await page.locator('[data-planning-status]', { hasText: 'Tarefa concluída' }).waitFor();
    assert(data.tasks.find((t) => t.id === 't2').completed_at, 'saved as completed');
    await page
      .getByRole('checkbox', { name: 'Concluir tarefa: Refazer as questões erradas' })
      .uncheck();
    await page.locator('[data-planning-status]', { hasText: 'Tarefa reaberta' }).waitFor();
    assert.equal(data.tasks.find((t) => t.id === 't2').completed_at, null, 'reopened');
    await page.locator('#planning-task-filter').selectOption('completed');
    // Goal g1 has no completed task: its lists explain why they are empty.
    await page
      .locator('.planning-goal', { hasText: 'Revisar para a prova de Biologia' })
      .locator('.planning-empty', { hasText: 'Nenhuma tarefa concluída aqui.' })
      .first()
      .waitFor();
    assert.equal(
      await page.locator('.planning-goal ul.planning-tasks:empty').count(),
      0,
      'no empty lists',
    );
    await settle(page);
    await axeCheck(page, 'main', 'Planejar com filtro');
    await shot(page, 'planejar-filtro-concluidas');
    record(
      'Planejamento: criar objetivo, concluir e reabrir tarefa (salvo na conta), filtro sem resultados explica o vazio',
    );

    // ---------- Calendar export over several pages ---------------------------------------
    data.calendarPageSize = 2;
    await page.goto(base + '/planejar.html#calendario');
    await page.locator('#calendario .study-calendar-grid button').first().waitFor();
    const queriesBefore = data.calendarQueries;
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Baixar calendário ICS' }).click(),
    ]);
    const ics = fs.readFileSync(await download.path(), 'utf8');
    const expected =
      data.events.length + data.tasks.filter((t) => t.due_date && !t.completed_at).length;
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, expected, 'every page exported');
    assert(data.calendarQueries - queriesBefore >= Math.ceil(expected / 2));
    data.calendarPageSize = 0;
    record('Calendário: exportação ICS percorre todas as páginas, mesmo sem "limit" na resposta');

    // ---------- Annotations: pages and the way back to the passage ----------------------
    data.notePageSize = 1;
    await page.goto(base + '/revisar.html#anotacoes');
    const card = page.locator('#anotacoes .annotation-card');
    await card.first().waitFor();
    assert.equal(await card.count(), 1);
    const link = card.getByRole('link', { name: 'Abrir no trecho da aula' });
    const href = new URL(await link.getAttribute('href'), base);
    assert.equal(href.searchParams.get('id'), 'l-foto');
    assert.equal(
      href.searchParams.get('busca'),
      'A energia luminosa é convertida em energia química',
    );
    await page.getByRole('button', { name: 'Próximas anotações' }).click();
    await card.filter({ hasText: 'máquina a vapor' }).waitFor();
    assert(await page.getByRole('button', { name: 'Próximas anotações' }).isDisabled());
    assert.match(await page.locator('#anotacoes nav span').textContent(), /2–2 de 2/);
    await page.getByRole('button', { name: 'Anotações anteriores' }).click();
    await card.filter({ hasText: 'Cai na prova!' }).waitFor();
    data.notePageSize = 0;
    await page.goto(base + href.pathname + href.search);
    assert.equal(new URL(page.url()).searchParams.get('busca'), href.searchParams.get('busca'));
    record(
      'Anotações: paginação segue o tamanho informado pelo servidor; "Abrir no trecho da aula" leva à busca do destaque',
    );
    // ---------- Renaming a flashcard set: an app dialog, not the browser's prompt -----------
    data.sets = [
      { id: 'set-1', name: 'Biologia 1', card_count: 3, due_count: 1, status: 'active' },
    ];
    await page.goto(base + '/revisar.html#flashcards');
    const setsPanel = page.locator('details', { hasText: 'Conjuntos de flashcards' }).last();
    await setsPanel.locator('summary').click();
    const rename = setsPanel.getByRole('button', { name: 'Renomear' });
    await rename.click();
    const dialog = page.getByRole('dialog', { name: 'Renomear conjunto' });
    await dialog.waitFor();
    const field = dialog.getByLabel('Nome do conjunto');
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      await field.getAttribute('id'),
    );
    assert.equal(await field.inputValue(), 'Biologia 1');
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Renomear conjunto');
    await page.keyboard.press('Escape');
    assert(await dialog.isHidden(), 'Escape cancels');
    assert.equal(data.sets[0].name, 'Biologia 1');
    // Focus returns on the next tick, after the panel re-enables its button.
    await page.waitForFunction(() => document.activeElement?.textContent === 'Renomear', null, {
      timeout: 3000,
    });
    await rename.click();
    await field.fill('Biologia — revisão');
    await page.keyboard.press('Enter');
    await setsPanel.locator('h4', { hasText: 'Biologia — revisão' }).waitFor();
    assert.equal(data.sets[0].name, 'Biologia — revisão');
    record(
      'Renomear conjunto: diálogo do app com foco no campo, Esc cancela e devolve o foco, Enter salva',
    );

    // ---------- New flashcard: a dialog opened from a tile, not a folded section ------------
    await page.goto(base + '/revisar.html#flashcards');
    const manual = page.getByRole('button', { name: /Criar cartão manualmente/ });
    await manual.click();
    const cardDialog = page.getByRole('dialog', { name: 'Criar cartão' });
    await cardDialog.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'flashcard-front');
    await settle(page);
    await axeCheck(page, 'dialog[open]', 'Criar cartão');
    await cardDialog.getByLabel('Pergunta ou conceito').fill('O que é a fase clara?');
    await cardDialog.getByLabel('Resposta ou explicação').fill('A etapa que depende de luz.');
    await cardDialog.locator('[type=submit]').click();
    await page.locator('[data-flashcard-create-done]', { hasText: 'Cartão criado' }).waitFor();
    assert(await cardDialog.isHidden(), 'dialog closes after saving');
    assert.deepEqual(data.createdCards.map((c) => c.front), ['O que é a fase clara?']);
    await page.waitForFunction(() => /Criar cartão manualmente/.test(document.activeElement?.textContent || ''), null, { timeout: 3000 });
    record('Novo cartão: botão abre um diálogo com foco na pergunta; salvar fecha, confirma e devolve o foco');

    // ---------- Lesson › Flashcards tab: the lesson's sets, review one now -------------------
    data.sets = [];
    await page.goto(base + '/material.html?id=l-foto#flashcards');
    await page.locator('#tab-flashcards[aria-selected="true"]').waitFor();
    await page.locator('[data-lesson-sets] .nino-note', { hasText: 'Ainda não há flashcards desta aula' }).waitFor();
    data.sets = [{ id: 'set-foto', name: 'Fotossíntese — conceitos', card_count: 8, due_count: 3, status: 'active' }];
    await page.reload();
    const setRow = page.locator('.lesson-set-row', { hasText: 'Fotossíntese — conceitos' });
    await setRow.waitFor();
    assert.match(await setRow.textContent(), /8 cartões · 3 para revisar hoje/);
    await settle(page);
    await axeCheck(page, '[data-flashcards-section]', 'Aula › Flashcards');
    await setRow.getByRole('link', { name: 'Revisar agora' }).click();
    await page.waitForURL('**/revisar.html?conjunto=set-foto#flashcards');
    await page.waitForFunction(() => [...document.querySelectorAll('select')].some((s) => s.value === 'set-foto'));
    record('Aula › Flashcards: conjuntos da aula com cartões e pendentes; "Revisar agora" abre Revisar já filtrado no conjunto');

    // ---------- Biblioteca: Finder-like list view inside a folder ----------------------------
    await page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
    await page.getByRole('button', { name: 'Lista' }).click();
    const fileRow = page.locator('.library-tree-row', { hasText: 'Fotossíntese e respiração celular' });
    await fileRow.waitFor();
    assert.match(await fileRow.locator('.library-tree-length').textContent(), /30:20/);
    assert.match(await fileRow.locator('.library-tree-progress').textContent(), /% ouvido|Estudada/);
    await settle(page);
    await axeCheck(page, 'main', 'Biblioteca em lista');
    await noHorizontalScroll(page, 'biblioteca lista');
    await page.goto(base + '/historico.html');
    await page.getByRole('button', { name: '+ Nova disciplina' }).waitFor();
    // Several lessons at once: select, move to a folder, selection ends.
    await page.goto(base + '/historico.html?folder=sub-bio&unit=unit-energia');
    await page.getByRole('button', { name: 'Selecionar' }).click();
    const box = page.getByRole('checkbox', { name: 'Selecionar Fotossíntese e respiração celular' });
    await box.check();
    await page.locator('.library-selection-bar', { hasText: '1 aula selecionada' }).waitFor();
    await settle(page);
    await axeCheck(page, 'body', 'Biblioteca em seleção');
    await page.getByRole('button', { name: 'Mover para…' }).click();
    const move = page.locator('[data-assign-dialog][open]');
    await move.waitFor();
    await move.locator('#assign-subject').selectOption('sub-bio');
    await move.locator('#assign-unit').selectOption('unit-celula');
    await move.locator('[type=submit]').click();
    await move.waitFor({ state: 'hidden' });
    assert.deepEqual(data.moves.at(-1), { id: 'l-foto', subjectId: 'sub-bio', unitId: 'unit-celula' });
    record('Biblioteca em lista: cada aula numa linha com ícone, data, duração e progresso; sem guias soltas na pasta; seleção de várias aulas move de uma vez');

    // ---------- Flashcards 3.0: the look changes, the content and the server do not ----------
    await page.goto(base + '/revisar.html#flashcards');
    const review = page.locator('.flashcard-review-card');
    await review.waitFor();
    const front = await review.locator('.flashcard-content').first().textContent();
    const writes = [];
    page.on('request', (r) => {
      if (/\/api\/flashcards/.test(r.url()) && r.method() !== 'GET') writes.push(r.url());
    });
    for (const template of ['notebook', 'sticky', 'window', 'polaroid']) {
      await page.locator('[data-card-template-picker]').selectOption(template);
      assert.equal(await review.getAttribute('data-card-template'), template);
      assert.equal(await review.locator('.flashcard-content').first().textContent(), front);
      await settle(page);
      await axeCheck(page, '.flashcard-review-card', `Cartão (${template})`);
      await shot(page, `cartao-${template}`, false);
    }
    assert.deepEqual(writes, [], 'changing the look sends nothing to the flashcard API');
    await page.reload();
    await page.locator('.flashcard-review-card[data-card-template="polaroid"]').waitFor();
    record('Flashcards 3.0: aparência do cartão (5 modelos) muda só o visual; conteúdo intacto, nenhuma chamada à API, escolha lembrada');

    // ---------- Notes 3.0: highlight and comment straight from the reading view --------------
    await page.goto(base + '/material.html?id=l-foto');
    const paragraph = page.locator('.transcription-segment .segment-text').first();
    await paragraph.waitFor();
    const select = (words) =>
      paragraph.evaluate((node, target) => {
        const text = node.firstChild;
        const start = text.textContent.indexOf(target);
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + target.length);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }, words);
    await select('energia luminosa');
    const popover = page.locator('.selection-popover:not([hidden])');
    await popover.waitFor();
    await settle(page);
    await axeCheck(page, '.selection-popover', 'Popover de destaque');
    await popover.getByRole('button', { name: 'Destacar' }).click();
    await page.waitForFunction(() => true);
    await page.locator('[data-notes-section] .annotation-card blockquote', { hasText: 'energia luminosa' }).first().waitFor({ state: 'attached' });
    const highlight = data.savedNotes.at(-1).body;
    assert.equal(highlight.quote, 'energia luminosa');
    assert.equal(highlight.segmentPosition, 0);
    assert.equal(highlight.endOffset - highlight.startOffset, 'energia luminosa'.length);
    assert.equal(highlight.startMs, undefined, 'only stored anchor fields are sent');
    await select('energia química');
    await popover.getByRole('button', { name: 'Comentar' }).click();
    await page.locator('#tab-notes[aria-selected="true"]').waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 3000 });
    await page.keyboard.type('Produto da fase clara.');
    await page.locator('[data-notes-section] form [type=submit]').first().click();
    await page.locator('[data-notes-section] [role=status]', { hasText: 'Anotação salva' }).waitFor();
    assert.equal(data.savedNotes.at(-1).body.noteText, 'Produto da fase clara.');
    assert.equal(data.savedNotes.at(-1).body.quote, 'energia química');
    const noteCard = page.locator('[data-notes-section] .annotation-card', { hasText: 'energia química' }).first();
    assert(await noteCard.getByRole('button', { name: /^Ouvir 00:00$/ }).count(), 'a timestamp to listen to the passage');
    await noteCard.getByRole('button', { name: 'Ir ao destaque' }).click();
    await page.locator('#tab-transcription[aria-selected="true"]').waitFor();
    assert.equal(await page.evaluate(() => getSelection().toString()), 'energia química');
    record('Anotações 3.0: selecionar no texto da transcrição abre Destacar/Comentar; o caderno guarda trecho e tempo e volta ao destaque');

    await context.close();

    // ---------- One tool fails: its tab says so, the others work -------------------------
    const broken = state();
    broken.failPlanning = true;
    ({ context, page } = await openApp(browser, base, allFlags, broken));
    await page.goto(base + '/planejar.html#tarefas');
    await page
      .locator('[data-planning-status]', { hasText: 'O planejamento está indisponível agora' })
      .waitFor();
    assert(
      await page.locator('[data-planning-goal-form] [type=submit]').isDisabled(),
      'forms are disabled while planning is unavailable',
    );
    await page.locator('#tab-calendario').click();
    await page.locator('#calendario .study-calendar-grid button').first().waitFor();
    await settle(page);
    await page.locator('#tab-tarefas').click();
    await axeCheck(page, 'main', 'Planejar com falha');
    await shot(page, 'planejar-falha-tarefas');
    record(
      'Falha ao carregar o planejamento aparece na aba Tarefas (formulários bloqueados); calendário segue funcionando',
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  // The failing request in the last journey is expected; anything else is an error.
  const unexpected = errors.filter((e) => !/503|indisponível/.test(e));
  assert.deepEqual(unexpected, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} feature validation checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
