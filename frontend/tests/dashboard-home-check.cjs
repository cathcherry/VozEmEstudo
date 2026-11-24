// Dashboard home in a real browser with a simulated API: summaries, side-sheet workspaces,
// keyboard and focus behaviour, feature-flag fallback, axe-core and screenshots at several widths.
// Nothing here calls a real backend, AI provider or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  day,
  at,
  state,
  errors,
  passed,
  record,
  axeCheck,
  ready,
  noHorizontalScroll,
  focusedText,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'dashboard-home');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- Returning student: Início with real summaries -----------------------------
    const data = state();
    data.allCards = [
      ...data.dueCards,
      {
        id: 'c9',
        front_text: 'Extra',
        back_text: 'x',
        status: 'active',
        due_at: at(5, 8),
        material_id: 'l-foto',
      },
    ];
    let { context, page } = await openApp(browser, base, allFlags, data);
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-tasks-preview] .dash-task-list').waitFor();
    await page.locator('[data-cards-preview] .dash-next-card').waitFor();
    await page.locator('[data-events-preview] .dash-agenda-list').waitFor();
    await page.locator('[data-week-body] .dash-day-bar').first().waitFor();
    await page.locator('[data-notes-summary]', { hasText: 'anotações salvas' }).waitFor();
    await settle(page);
    // The only dialog is the layout sheet ("Personalizar"); tools live on their own pages.
    assert.equal(
      await page.locator('dialog:not([data-dashboard-customize-dialog])').count(),
      0,
      'Início has no hidden tool panels',
    );
    assert.equal(
      await page.locator('.primary-navigation a[aria-current="page"] span').textContent(),
      'Início',
    );
    for (const name of ['Nova transcrição', 'Início', 'Biblioteca', 'Flashcards', 'Planejar'])
      assert(
        await page.locator('.primary-navigation a', { hasText: name }).isVisible(),
        `${name} in the navigation`,
      );
    assert.equal(await page.locator('[data-tasks-count]').textContent(), '3');
    assert.equal(await page.locator('[data-cards-count]').textContent(), '5');
    assert.match(await page.locator('[data-tasks-preview]').textContent(), /Atrasada/);
    assert.equal(await page.locator('.dash-mini-day.is-today').count(), 1);
    assert.equal(await page.locator('main .nino-note').count(), 0, 'no mascot in the cards');
    assert.equal(
      await page.locator('[data-cards-actions] .button-link').textContent(),
      'Revisar 5 cartões',
    );
    for (const host of ['[data-tasks-actions]', '[data-cards-actions]', '[data-events-actions]'])
      assert(
        (await page.locator(`${host} .button-link`).count()) <= 1,
        `${host}: at most one action button`,
      );
    // Balanced columns: the right column ends where the main column ends.
    const mainBox = await page.locator('.dash-main').boundingBox();
    const railBox = await page.locator('.dash-rail').boundingBox();
    assert(
      Math.abs(mainBox.y + mainBox.height - (railBox.y + railBox.height)) < 2,
      'columns end together',
    );
    const hero = page.locator('.dash-continue .dashboard-lesson-card');
    const before = await hero.locator('.dashboard-lesson-percent').boundingBox();
    for (const target of [
      hero.locator('.dashboard-lesson-title'),
      hero.locator('.dashboard-lesson-playback progress'),
    ]) {
      await target.hover();
      await page.waitForTimeout(250);
      const after = await hero.locator('.dashboard-lesson-percent').boundingBox();
      assert(
        Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1,
        'hero progress stays in place on hover',
      );
      assert.equal(
        await hero.locator('.dashboard-lesson-cue').evaluate((n) => getComputedStyle(n).opacity),
        '1',
      );
    }
    await page.mouse.move(0, 0);
    await axeCheck(page, 'body', 'Início');
    await shot(page, 'inicio-1440');
    record(
      'Início: resumo real, cada cartão leva a uma página (no máximo uma ação principal), menu com Flashcards e Planejar, sem painéis escondidos, hover estável, axe sem violações',
    );

    // ---------- Planning journey: task → schedule → time ---------------------------------
    await page.locator('[data-tasks-actions] a', { hasText: 'Adicionar tarefa' }).click();
    await page.waitForURL('**/planejar.html#tarefas');
    await page.locator('[data-planning-task-form]:visible').waitFor();
    assert.equal(await page.locator('#tab-tarefas').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'planning-task-title');
    await page.locator('#planning-task-goal').selectOption('g2');
    await page.locator('#planning-task-title').fill('Resumir o capítulo 5');
    await page.locator('[data-planning-task-form] [type=submit]').click();
    await page.locator('[data-planning-status]', { hasText: 'Tarefa criada' }).waitFor();
    assert(data.tasks.some((t) => t.title === 'Resumir o capítulo 5'));
    assert.equal(new URL(page.url()).search, '', 'the creation request is not repeated on reload');
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › tarefas');
    await shot(page, 'planejar-tarefas-1440');
    await page.locator('#tab-tarefas').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-calendario');
    assert(page.url().endsWith('#calendario'));
    await page.locator('#calendario .study-calendar-grid button').first().waitFor();
    // "Agendar estudo" is the main action and opens a dialog (not a folded section).
    await page.getByRole('button', { name: 'Agendar estudo', exact: true }).first().click();
    await page.getByRole('dialog', { name: 'Agendar estudo' }).waitFor();
    await page
      .locator('#calendario .calendar-event-form input[type=text]')
      .fill('Estudar capítulo 5');
    await page
      .locator('#calendario input[type=datetime-local]')
      .nth(0)
      .fill(`${day(2)}T10:00`);
    await page
      .locator('#calendario input[type=datetime-local]')
      .nth(1)
      .fill(`${day(2)}T11:00`);
    await page.locator('#calendario .calendar-event-form [type=submit]').click();
    await page.locator('#calendario [role=status]', { hasText: 'Horário salvo' }).waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › calendário');
    await shot(page, 'planejar-calendario-1440');
    await page.locator('#tab-tempo').click();
    // 3.6: Planejar shows the week and its analysis; the timer runs on Focar.
    await page.locator('#tempo .week-card').waitFor();
    assert(
      !(await page.locator('#tempo .study-settings').isVisible()),
      'goal settings folded until requested',
    );
    assert.equal(await page.locator('#tempo .study-timer-controls').count(), 0, 'no timer in Planejar');
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › tempo');
    await shot(page, 'planejar-tempo-1440');
    await page.locator('#tempo [data-focus-link]', { hasText: 'Iniciar foco' }).click();
    await page.waitForURL('**/focar.html');
    await page.locator('.study-timer-controls button', { hasText: 'Pausar' }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(data.sessions, 1);
    await page.locator('.study-timer-controls button', { hasText: 'Pausar' }).click();
    record(
      'Jornada de planejamento: Início › Adicionar tarefa abre o formulário certo; abas com setas e #endereço; agendar horário; cronômetro',
    );

    // ---------- Flashcard and question journey -------------------------------------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-cards-actions] a', { hasText: 'Revisar 5 cartões' }).click();
    await page.waitForURL('**/flashcards.html#revisar');
    // The review opens with focus on the card's turn key; Enter turns it.
    await page.locator('[data-flashcard-due-area] .flashcard-flip').waitFor();
    await page.waitForFunction(() => document.activeElement?.classList?.contains('flashcard-flip'));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.flashcard-review-card').getAttribute('data-side'), 'back');
    assert.equal(await page.locator('.flashcard-flip').getAttribute('aria-pressed'), 'true');
    // The ratings follow the card in the reading order.
    await page.keyboard.press('Tab');
    assert.match(await focusedText(page), /De novo/);
    await page.getByRole('button', { name: /^Bom/ }).click();
    await page
      .locator('[data-flashcard-review-status]', { hasText: 'Revisão registrada' })
      .waitFor();
    assert.equal(data.reviews, 1);
    await settle(page);
    await axeCheck(page, 'main', 'Flashcards › revisar');
    await shot(page, 'flashcards-revisar-1440');
    // Attempts left open live with the questions: one quiet link there from Flashcards.
    const quizLink = page.locator('[data-flashcards-quiz-link]');
    await quizLink.waitFor();
    assert.equal(await quizLink.getAttribute('href'), './questoes.html');
    assert.match(await quizLink.textContent(), /em andamento/);
    record(
      'Jornada de revisão: Início › Revisar 5 cartões abre Flashcards com foco no cartão; Enter vira, avaliar registra; questões em andamento a um link',
    );

    // ---------- Finding information: annotations through the global search ---------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('.topbar-search input').fill('energia');
    await page.locator('.topbar-search input').press('Enter');
    await page.getByRole('tab', { name: /Anotações/ }).click();
    const found = page.locator('.search-note', { hasText: 'Cai na prova!' });
    await found.waitFor();
    // Each note opens its lesson on the highlighted passage.
    assert.match(await found.getAttribute('href'), /material\.html\?id=l-foto&busca=/);
    // "Ver todas" on the notes card lists every note on Início (old Revisar › Anotações links too).
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-notes-link]').click();
    await page.waitForURL('**/painel.html?em=notes');
    await page.getByRole('heading', { name: 'Suas anotações' }).waitFor();
    await page.locator('[data-search-results] .search-note').first().waitFor();
    await settle(page);
    await axeCheck(page, 'main', 'Início › suas anotações');
    await shot(page, 'inicio-anotacoes-1440');
    record(
      'Encontrar informação: a busca global encontra anotações (no servidor, só da conta) e abre a aula no trecho; "Ver todas" lista as anotações no Início',
    );

    // ---------- Question practice from the lesson: steps and the next action -------------
    data.lessonStage = { 'l-foto': 'summary', 'l-rev': 'pending', 'l-func': 'questions' };
    await page.goto(base + '/material.html?id=l-foto');
    // A lesson already in study opens in the workspace; the guide is one click away.
    await page.locator('[data-open-lesson-guide]:not([hidden])').waitFor();
    assert(await page.locator('[data-lesson-prep]').isHidden(), 'no guide above a prepared lesson');
    await page.locator('#tab-summary').click();
    await page.goto(base + '/material.html?id=l-foto');
    await page.locator('#tab-summary[aria-selected="true"]').waitFor();
    await page.locator('[data-open-lesson-guide]').click();
    await page.locator('[data-lesson-steps]:not([hidden]) .lesson-next button').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lesson-prep-title');
    assert.deepEqual(
      await page
        .locator('.lesson-step')
        .evaluateAll((items) => items.map((i) => i.className.replace('lesson-step ', ''))),
      ['is-done', 'is-done', 'is-current', 'is-todo'],
    );
    assert.equal(await page.locator('.lesson-next button').textContent(), 'Criar questões');
    // The timer is not a block in the lesson: it runs on Focar (a top-bar indicator shows it).
    assert.equal(await page.locator('.lesson-tools').count(), 0);
    assert.equal(await page.locator('[data-focus-indicator]').count(), 1);
    await settle(page);
    await axeCheck(page, 'main', 'Aula › etapas');
    await shot(page, 'aula-etapas-1440');
    await page.locator('.lesson-next button', { hasText: 'Criar questões' }).click();
    await page.locator('[data-questions-dialog][open]').waitFor();
    assert.equal(await page.locator('#tab-questions').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Escape');
    await page.goto(base + '/material.html?id=l-func');
    await page.locator('[data-open-lesson-guide]').click();
    await page.locator('.lesson-next button', { hasText: 'Responder a lista' }).waitFor();
    await page.goto(base + '/material.html?id=l-rev');
    await page.locator('[data-lesson-steps]:not([hidden])').waitFor();
    assert.equal(
      await page.locator('.lesson-next button').count(),
      0,
      'one primary action: the page already asks to check the transcript',
    );
    assert(
      await page.locator('.lesson-step-button').nth(1).isDisabled(),
      'summary waits for confirmation',
    );
    await shot(page, 'aula-pendente-1440');
    // Just confirmed, nothing generated yet: the guide offers generation or going straight to study.
    data.lessonStage['l-ondas'] = 'fresh';
    await page.goto(base + '/material.html?id=l-ondas');
    await page.locator('[data-lesson-prep-title]', { hasText: 'Aula pronta para estudar' }).waitFor();
    await page.locator('.lesson-next button', { hasText: 'Gerar resumo' }).waitFor();
    await page.getByRole('button', { name: 'Começar a estudar' }).click();
    assert(await page.locator('[data-lesson-prep]').isHidden(), 'guide closes');
    await page.reload();
    await page.locator('[data-open-lesson-guide]:not([hidden])').waitFor();
    assert(await page.locator('[data-lesson-prep]').isHidden(), 'and stays closed for this lesson');
    record(
      'Aula: preparação só enquanto a aula não está pronta; aula em estudo abre no espaço de estudo (última aba), com "Guia da aula" para ver as etapas e o próximo passo',
    );

    // ---------- Widths, zoom, themes, screen-reader mode ---------------------------------
    for (const route of ['painel.html', 'planejar.html#tarefas', 'flashcards.html#revisar']) {
      await page.goto(`${base}/${route}`);
      await settle(page);
      for (const [width, height] of [
        [1920, 1080],
        [1280, 800],
        [834, 1112],
        [640, 800],
        [390, 844],
        [320, 640],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        await noHorizontalScroll(page, `${route} @${width}`);
        if ([1280, 834, 390].includes(width)) await shot(page, `${route.split('.')[0]}-${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    record(
      'Sem rolagem horizontal em Início, Planejar e Flashcards de 320 a 1920 px (640 px = zoom 200%)',
    );
    await page.goto(base + '/painel.html');
    await ready(page);
    for (const [attr, value, name] of [
      ['data-theme', 'night', 'inicio-tema-noturno'],
      ['data-high-contrast', 'true', 'inicio-alto-contraste'],
      ['data-screen-reader-mode', 'true', 'inicio-leitor-de-tela'],
    ]) {
      await page.evaluate(([a, v]) => document.documentElement.setAttribute(a, v), [attr, value]);
      await page.waitForTimeout(250);
      await shot(page, name);
      await page.evaluate(([a]) => document.documentElement.removeAttribute(a), [attr]);
    }
    record('Tema noturno, alto contraste e modo leitor de tela renderizados');
    await context.close();

    // ---------- New student: empty account -----------------------------------------------
    const fresh = state();
    Object.assign(fresh, {
      goals: [],
      subgoals: [],
      tasks: [],
      dueCards: [],
      allCards: [],
      events: [],
      notes: [],
      quizSessions: [],
    });
    ({ context, page } = await openApp(browser, base, allFlags, fresh));
    await page.route('**/api/study/overview', (route) =>
      route.fulfill({
        json: {
          weekStart: day(-3),
          timezone: 'America/Sao_Paulo',
          goalMinutes: 120,
          weekSeconds: 0,
          completedMaterials: 0,
          days: [],
          activeSession: null,
        },
      }),
    );
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-tasks-actions] a', { hasText: 'Criar primeiro objetivo' }).waitFor();
    await page
      .locator('[data-cards-preview]', { hasText: 'Crie cartões a partir do resumo' })
      .waitFor();
    await page.locator('[data-events-preview]', { hasText: 'Planeje quando' }).waitFor();
    await page.locator('[data-week-body]', { hasText: 'Use o cronômetro' }).waitFor();
    await settle(page);
    assert.equal(await page.locator('.dash-day-bar').count(), 0, 'no empty chart');
    assert(await page.locator('[data-tasks-count]').isHidden(), 'no zero counters');
    assert.equal(await page.locator('main .nino-note').count(), 0, 'no mascot in empty cards');
    await axeCheck(page, 'body', 'Início vazio');
    await shot(page, 'inicio-conta-nova-1440');
    await page.locator('[data-tasks-actions] a', { hasText: 'Criar primeiro objetivo' }).click();
    await page.waitForURL('**/planejar.html#tarefas');
    await page.locator('#planning-goal-title:focus').waitFor();
    await page.goto(base + '/flashcards.html');
    await page
      .locator('#revisar', { hasText: 'Nenhum cartão pendente' })
      .waitFor();
    assert(await page.locator('[data-flashcards-quiz-link]').isHidden(), 'no attempts in progress, no link');
    await shot(page, 'flashcards-vazio-1440');
    record(
      'Conta nova: cada cartão explica o recurso e oferece uma ação; sem gráficos ou contadores zerados; "Criar primeiro objetivo" abre o formulário',
    );
    await context.close();

    // ---------- Flags off ----------------------------------------------------------------
    ({ context, page } = await openApp(browser, base, {}, state(), { width: 1280, height: 800 }));
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.waitForTimeout(600);
    assert(await page.locator('.primary-navigation a', { hasText: 'Flashcards' }).isHidden());
    assert(await page.locator('.primary-navigation a', { hasText: 'Planejar' }).isHidden());
    assert(await page.locator('[data-plan-section]').isHidden());
    assert(await page.locator('[data-week-widget]').isHidden());
    assert(await page.locator('[data-notes-widget]').isHidden());
    assert.match(await page.locator('.dash-continue').textContent(), /Fotossíntese/);
    await shot(page, 'inicio-recursos-desligados-1280');
    await page.goto(base + '/planejar.html');
    await page
      .locator('[data-tool-unavailable]', { hasText: 'O planejamento ainda não está ativo' })
      .waitFor();
    record(
      'Flags desligadas: menu sem Flashcards/Planejar, Início só com aula e Biblioteca, página direta explica que o recurso não está ativo',
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} navigation and journey checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
