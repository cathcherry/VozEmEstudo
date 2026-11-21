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

    // ---------- Questions: "Reportar problema" (own flag, saved in the account, undo) ----------
    {
      const q = state();
      q.lessonStage = { 'l-foto': 'questions' };
      q.profileState = [];
      const view = await openApp(browser, base, allFlags, q, { width: 1280, height: 900 });
      const p = view.page;
      await p.goto(base + '/material.html?id=l-foto#questoes');
      const list = p.locator('details.list-questions').first();
      await list.locator('summary').click();
      const open = list.getByRole('button', { name: 'Reportar problema' });
      await open.click();
      const dialog = p.getByRole('dialog', { name: 'Reportar problema na questão' });
      await dialog.waitFor();
      await settle(p);
      await axeCheck(p, 'dialog[open]', 'Reportar problema');
      await dialog.getByLabel('Não está na aula').check();
      await dialog.getByLabel('Detalhe (opcional)').fill('Ribossomo não foi citado.');
      await dialog.getByRole('button', { name: 'Marcar problema' }).click();
      await list.locator('.question-report-flag', { hasText: 'Você marcou: Não está na aula' }).waitFor();
      await p.waitForFunction(() => document.activeElement?.textContent === 'Editar', null, { timeout: 3000 });
      await p.waitForTimeout(600);
      const saved = q.profileState.find((row) => row.key === 'question-reports').data.q1;
      assert.deepEqual(
        { reason: saved.reason, note: saved.note, materialId: saved.materialId, batchId: saved.batchId },
        { reason: 'not_in_lesson', note: 'Ribossomo não foi citado.', materialId: 'l-foto', batchId: 'b1' },
      );
      assert.equal(saved.statement, 'Onde ocorre a fotossíntese?');
      // Revisar › Questões lists it with the lesson.
      await p.goto(base + '/revisar.html#questoes');
      const flagged = p.locator('[data-question-reports]');
      await flagged.locator('.question-report-row', { hasText: 'Onde ocorre a fotossíntese?' }).waitFor();
      assert.match(await flagged.textContent(), /Não está na aula/);
      assert.equal(
        await flagged.getByRole('link', { name: 'Abrir Fotossíntese e respiração celular' }).getAttribute('href'),
        './material.html?id=l-foto#questoes',
      );
      await settle(p);
      await axeCheck(p, '[data-question-reports]', 'Questões marcadas');
      // Another device (fresh browser, same account) sees the flag; undo keeps a dated removal.
      const other = await openApp(browser, base, allFlags, q, { width: 1280, height: 900 });
      await other.page.goto(base + '/material.html?id=l-foto#questoes');
      const otherList = other.page.locator('details.list-questions').first();
      await otherList.locator('summary').click();
      await otherList.locator('.question-report-flag', { hasText: 'Não está na aula' }).waitFor();
      await otherList.getByRole('button', { name: 'Desfazer a marcação desta questão' }).click();
      await otherList.getByRole('button', { name: 'Reportar problema' }).waitFor();
      await other.page.waitForTimeout(600);
      assert.equal(q.profileState.find((row) => row.key === 'question-reports').data.q1.removed, true);
      await other.context.close();
      await view.context.close();
      record('Questões: "Reportar problema" com motivo e detalhe, salvo na conta, visto em outro aparelho e desfeito sem voltar');
    }

    // ---------- A very long lesson (3 h, 2 200 segments): renders, searches without freezing ---
    {
      const long = state();
      long.longLesson = 2200;
      const view = await openApp(browser, base, allFlags, long, { width: 1280, height: 900 });
      const p = view.page;
      await p.addInitScript(() => {
        window.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
        }).observe({ type: 'longtask', buffered: true });
      });
      const started = Date.now();
      await p.goto(base + '/material.html?id=l-foto#transcricao');
      await p.locator('.transcription-segment').nth(2199).waitFor({ state: 'attached', timeout: 30000 });
      const renderMs = Date.now() - started;
      assert(renderMs < 15000, `long lesson rendered in ${renderMs} ms`);
      await p.evaluate(() => {
        window.__longTasks = [];
      });
      const box = p.locator('.transcript-search input');
      await box.pressSequentially('glicose', { delay: 40 });
      const status = p.locator('.search-status');
      await status.filter({ hasText: /^2200 trechos encontrados$/ }).waitFor({ timeout: 20000 });
      assert.equal(await p.locator('mark.search-hit').count(), 2200);
      await p.getByRole('button', { name: 'Próximo resultado' }).click();
      await status.filter({ hasText: 'Trecho 1 de 2200' }).waitFor();
      await box.fill('');
      await p.waitForFunction(() => !document.querySelector('mark.search-hit'), null, { timeout: 20000 });
      const tasks = await p.evaluate(() => window.__longTasks.sort((a, b) => b - a).slice(0, 3));
      await view.context.close();
      record(`Aula muito longa (2 200 trechos, 3 h): abre em ${renderMs} ms; busca sem travar (maior tarefa ${tasks[0] || 0} ms), resultados navegáveis, limpar remove os destaques`);
    }

    // ---------- Planejar uma unidade: a task per lesson, deadlines spread, re-run adds only new --
    {
      const u = state();
      const extra = (id, title, daysAgo) => ({
        id, title, subject: 'Biologia', status: 'PRONTO', subject_id: 'sub-bio', unit_id: 'unit-energia',
        created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
        audio_files: [{ duration_ms: 600000, extension: 'mp3' }],
      });
      u.extraMaterials = [extra('l-ciclo', 'Ciclo de Krebs', 3), extra('l-ferm', 'Fermentação', 2)];
      const view = await openApp(browser, base, allFlags, u, { width: 1280, height: 900 });
      const p = view.page;
      await p.goto(base + '/planejar.html#tarefas');
      const open = p.getByRole('button', { name: 'Planejar uma unidade' });
      await open.click();
      const dialog = p.getByRole('dialog', { name: 'Planejar uma unidade' });
      await dialog.waitFor();
      await dialog.getByLabel('Unidade').selectOption('unit-energia');
      await dialog.getByLabel('Objetivo').selectOption('g1');
      await dialog.getByLabel('Ritmo').selectOption('2');
      await dialog.getByLabel('Começar em').fill('2026-12-01');
      await dialog.getByLabel('Começar em').dispatchEvent('change');
      // Fotossíntese already has a task in this goal: only the other two are planned.
      await dialog.locator('.unit-plan-summary', { hasText: '1 já tem tarefa neste objetivo' }).waitFor();
      await dialog.locator('.unit-plan-summary', { hasText: '2 tarefas serão criadas' }).waitFor();
      await settle(p);
      await axeCheck(p, 'dialog[open]', 'Planejar uma unidade');
      const before = u.tasks.length;
      await dialog.getByRole('button', { name: 'Criar tarefas' }).click();
      await dialog.waitFor({ state: 'detached' });
      await p.locator('.app-toast:not([hidden])', { hasText: '2 tarefas criadas para a unidade.' }).waitFor();
      const created = u.tasks.slice(before);
      assert.deepEqual(
        created.map((t) => [t.material_id, t.due_date, t.goal_id]),
        [['l-ciclo', '2026-12-01', 'g1'], ['l-ferm', '2026-12-03', 'g1']],
      );
      await p.locator('[data-planning-panel]', { hasText: 'Estudar: Fermentação' }).first().waitFor();
      await p.waitForFunction(() => document.activeElement?.matches('[data-unit-plan-open]'), null, { timeout: 3000 });
      // A new lesson arrives in the unit: running again adds only that one.
      u.extraMaterials.push(extra('l-glico', 'Glicólise', 1));
      await p.reload();
      await open.click();
      await dialog.getByLabel('Unidade').selectOption('unit-energia');
      await dialog.getByLabel('Objetivo').selectOption('g1');
      await dialog.locator('.unit-plan-summary', { hasText: '3 já têm tarefa neste objetivo' }).waitFor();
      await dialog.locator('.unit-plan-summary', { hasText: '1 tarefa será criada' }).waitFor();
      await dialog.getByRole('button', { name: 'Criar tarefas' }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(u.tasks.at(-1).material_id, 'l-glico');
      assert.equal(u.tasks.filter((t) => t.goal_id === 'g1' && t.material_id === 'l-foto').length, 1, 'no duplicate task');
      await view.context.close();
      record('Planejar uma unidade: uma tarefa por aula com prazos espaçados; usar de novo acrescenta só as aulas novas');
    }

    // ---------- Calendar › Semana: blocks on a time grid, moved without dragging ------------
    {
      const today = new Date();
      today.setHours(14, 0, 0, 0);
      const end = new Date(today);
      end.setHours(15, 0, 0, 0);
      data.events = [
        { kind: 'event', id: 'w1', title: 'Revisar genética', startsAt: today.toISOString(), endsAt: end.toISOString(), description: 'cap. 3', materialId: 'l-foto', taskId: null, version: 1 },
      ];
      await page.goto(base + '/planejar.html#calendario');
      await page.reload();
      await page.getByRole('button', { name: 'Semana', exact: true }).click();
      const block = page.locator('.week-event', { hasText: 'Revisar genética' });
      await block.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Semana', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.locator('.week-day.is-today .week-event').waitFor();
      await settle(page);
      await axeCheck(page, '[data-calendar-panel]', 'Calendário › Semana');
      // Keyboard: open "Mover" and move 30 minutes later.
      await block.locator('summary').focus();
      await page.keyboard.press('Enter');
      await block.getByRole('button', { name: '30 min mais tarde' }).click();
      await page.locator('.calendar-status', { hasText: 'Horário movido para' }).waitFor();
      const moved = data.events.find((e) => e.id === 'w1');
      assert.equal(new Date(moved.startsAt).getHours(), 14);
      assert.equal(new Date(moved.startsAt).getMinutes(), 30);
      assert.equal(Date.parse(moved.endsAt) - Date.parse(moved.startsAt), 3_600_000, 'duration kept');
      assert.equal(moved.version, 2);
      assert.equal(moved.description, 'cap. 3', 'other fields kept');
      assert.equal(moved.materialId, 'l-foto');
      // Focus comes back to the same block's "Mover".
      await page.waitForFunction(() => document.activeElement?.closest('.week-move'), null, { timeout: 3000 });
      // The choice is remembered on this device; the phone shows a list of days.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.locator('.calendar-week .week-event', { hasText: 'Revisar genética' }).waitFor();
      await noHorizontalScroll(page, 'calendário semana (390 px)');
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole('button', { name: 'Mês', exact: true }).click();
      await page.locator('.study-calendar-grid').waitFor();
      record('Calendário › Semana: blocos na grade de horários, mover 30 min pelo teclado mantém duração e dados, escolha lembrada, lista no celular');
    }

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

    // ---------- Flashcards 3.0: merge own sets and import a text file (new set each) ---------
    {
      const cardsOf = (prefix, from, to) =>
        Array.from({ length: to - from }, (_, i) => ({
          id: `${prefix}-${from + i}`,
          front_text: `Pergunta ${from + i}?`,
          back_text: `Resposta ${from + i}`,
        }));
      const ana = cardsOf('ana', 0, 70);
      const bruno = [
        ...cardsOf('bruno', 40, 110), // 30 repeated from Ana, 40 new
        { id: 'bruno-x', front_text: 'pergunta 1', back_text: 'Outra resposta' }, // same question
      ];
      data.sets = [
        { id: 'set-ana', name: 'Ana', card_count: ana.length, due_count: 0, status: 'active', cards: ana },
        { id: 'set-bruno', name: 'Bruno', card_count: bruno.length, due_count: 0, status: 'active', cards: bruno },
      ];
      data.setRequests = 0;
      await page.goto(base + '/revisar.html#flashcards');
      await page.reload(); // same URL: goto alone only changes the hash
      const panel = page.locator('details.flashcard-sets');
      await panel.locator('h4', { hasText: 'Bruno' }).waitFor({ state: 'attached' });
      if (!(await panel.evaluate((node) => node.open))) await panel.locator('summary').click();
      await panel.getByRole('button', { name: 'Mesclar conjuntos' }).click();
      const mergeDialog = page.getByRole('dialog', { name: 'Mesclar conjuntos' });
      await mergeDialog.waitFor();
      await mergeDialog.getByRole('checkbox', { name: /Ana/ }).check();
      await mergeDialog.getByRole('checkbox', { name: /Bruno/ }).check();
      await mergeDialog.locator('.deck-preview', { hasText: '111 cartões no conjunto novo' }).waitFor();
      const preview = await mergeDialog.locator('.deck-preview').textContent();
      assert.match(preview, /30 cartões repetidos ficam de fora/);
      assert.match(preview, /1 pergunta aparece com respostas diferentes/);
      assert.equal(await mergeDialog.getByLabel('Nome do novo conjunto').inputValue(), 'Mesclado: Ana + Bruno');
      await settle(page);
      await axeCheck(page, 'dialog[open]', 'Mesclar conjuntos');
      await mergeDialog.getByRole('button', { name: 'Criar conjunto' }).click();
      await panel.locator('[role=status]', { hasText: 'Conjunto mesclado criado com 111 cartões.' }).waitFor();
      const created = data.sets.at(-1);
      assert.equal(created.cards.length, 111);
      assert.equal(created.material_id, null);
      assert.deepEqual(created.config.origin.sets.map((x) => x.name), ['Ana', 'Bruno']);
      assert.equal(data.setRequests, 2, 'one create (100) and one add (11)');
      assert.equal(data.sets[0].cards.length, 70, 'sources unchanged');
      await panel.locator('h4', { hasText: 'Mesclado: Ana + Bruno' }).waitFor();

      await panel.getByRole('button', { name: 'Importar cartões' }).click();
      const importDialog = page.getByRole('dialog', { name: 'Importar cartões' });
      await importDialog.waitFor();
      const anki = ['#separator:tab', '#html:true', 'O que é <b>ATP</b>?\tMoeda de energia', 'A {{c1::clorofila}} absorve luz.\t', 'Só frente\t'].join('\n');
      await importDialog.getByLabel('Arquivo').setInputFiles({ name: 'Biologia Anki.txt', mimeType: 'text/plain', buffer: Buffer.from(anki) });
      await importDialog.locator('.deck-preview', { hasText: '2 cartões encontrados' }).waitFor();
      assert.match(await importDialog.locator('.deck-preview').textContent(), /1 linha ignorada: sem pergunta ou sem resposta/);
      assert.equal(await importDialog.getByLabel('Nome do novo conjunto').inputValue(), 'Biologia Anki');
      await settle(page);
      await axeCheck(page, 'dialog[open]', 'Importar cartões');
      await importDialog.getByRole('button', { name: 'Criar conjunto' }).click();
      await panel.locator('[role=status]', { hasText: '2 cartões importados para um conjunto novo.' }).waitFor();
      assert.deepEqual(
        data.sets.at(-1).cards.map((c) => [c.front_text, c.back_text]),
        [['O que é ATP?', 'Moeda de energia'], ['A […] absorve luz.', 'A clorofila absorve luz.']],
      );
      // An .apkg package is explained, not sent anywhere.
      await panel.getByRole('button', { name: 'Importar cartões' }).click();
      await importDialog.getByLabel('Arquivo').setInputFiles({ name: 'deck.apkg', mimeType: 'application/zip', buffer: Buffer.from('PK') });
      await importDialog.locator('.deck-error', { hasText: 'Notas em texto simples' }).waitFor();
      assert(await importDialog.getByRole('button', { name: 'Criar conjunto' }).isDisabled());
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.textContent === 'Importar cartões', null, { timeout: 3000 });
      record('Mesclar conjuntos (repetidos de fora, mais de 100 cartões em partes, originais intactos) e importar arquivo do Anki (HTML, cloze, .apkg explicado)');
    }

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
