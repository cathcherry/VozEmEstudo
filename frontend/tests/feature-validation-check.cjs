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
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      'Renomear',
      'focus back',
    );
    await rename.click();
    await field.fill('Biologia — revisão');
    await page.keyboard.press('Enter');
    await setsPanel.locator('h4', { hasText: 'Biologia — revisão' }).waitFor();
    assert.equal(data.sets[0].name, 'Biologia — revisão');
    record(
      'Renomear conjunto: diálogo do app com foco no campo, Esc cancela e devolve o foco, Enter salva',
    );

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
