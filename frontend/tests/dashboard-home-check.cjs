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
    for (const name of ['Nova transcrição', 'Início', 'Biblioteca', 'Revisar', 'Planejar'])
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
      'Início: resumo real, cada cartão leva a uma página (no máximo uma ação principal), menu com Revisar e Planejar, sem painéis escondidos, hover estável, axe sem violações',
    );

    // ---------- Planning journey: task → schedule → time ---------------------------------
    await page.locator('[data-tasks-actions] a', { hasText: 'Adicionar tarefa' }).click();
    await page.waitForURL('**/planejar.html#tarefas');
    await page.locator('[data-planning-task-form]:visible').waitFor();
    assert.equal(await page.locator('#tab-tarefas').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'planning-task-goal');
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
    await page.locator('#calendario details.calendar-compose > summary').click();
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
    await page.locator('#tempo .study-timer-controls').waitFor();
    assert(
      !(await page.locator('#tempo .study-settings').isVisible()),
      'goal settings folded until requested',
    );
    await page.locator('#tempo .study-timer-controls button', { hasText: 'Iniciar' }).click();
    await page.waitForTimeout(1500);
    assert.equal(data.sessions, 1);
    await page.locator('#tempo .study-timer-controls button', { hasText: 'Pausar' }).click();
    await settle(page);
    await axeCheck(page, 'main', 'Planejar › tempo');
    await shot(page, 'planejar-tempo-1440');
    record(
      'Jornada de planejamento: Início › Adicionar tarefa abre o formulário certo; abas com setas e #endereço; agendar horário; cronômetro',
    );

    // ---------- Flashcard and question journey -------------------------------------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('[data-cards-actions] a', { hasText: 'Revisar 5 cartões' }).click();
    await page.waitForURL('**/revisar.html#flashcards');
    await page
      .locator('[data-flashcard-due-area] button', { hasText: 'Revelar resposta' })
      .waitFor();
    await page.waitForFunction(() =>
      document.activeElement?.textContent?.includes('Revelar resposta'),
    );
    await page.keyboard.press('Enter');
    assert.match(await focusedText(page), /De novo|Difícil|Bom|Fácil/);
    await page.getByRole('button', { name: 'Bom', exact: true }).click();
    await page
      .locator('[data-flashcard-review-status]', { hasText: 'Revisão registrada' })
      .waitFor();
    assert.equal(data.reviews, 1);
    await settle(page);
    await axeCheck(page, 'main', 'Revisar › flashcards');
    await shot(page, 'revisar-flashcards-1440');
    await page.locator('#tab-questoes').click();
    await page.locator('.quiz-history-list a', { hasText: 'Continuar tentativa' }).waitFor();
    assert.match(await page.locator('.quiz-history-list').first().textContent(), /Fotossíntese/);
    assert.match(
      await page
        .locator('.quiz-history-list a', { hasText: 'Ver resultado e erros' })
        .getAttribute('href'),
      /responder\.html\?material=l-rev&batch=b2&session=qs2/,
    );
    await axeCheck(page, 'main', 'Revisar › questões');
    await shot(page, 'revisar-questoes-1440');
    record(
      'Jornada de revisão: Início › Revisar 5 cartões abre a revisão com foco; Questões lista tentativas com Continuar / Ver resultado e erros',
    );

    // ---------- Finding information: annotations through the global search ---------------
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.locator('.topbar-search input').fill('energia');
    await page.locator('.topbar-search input').press('Enter');
    await page.getByRole('tab', { name: /Anotações/ }).click();
    await page.locator('.search-note', { hasText: 'Cai na prova!' }).waitFor();
    await page.locator('#search-panel-notes button', { hasText: 'em Revisar' }).click();
    await page.waitForURL('**/revisar.html#anotacoes');
    await page.locator('#anotacoes .annotation-card').first().waitFor();
    assert.equal(await page.locator('#anotacoes input[type=search]').inputValue(), 'energia');
    await settle(page);
    await axeCheck(page, 'main', 'Revisar › anotações');
    await shot(page, 'revisar-anotacoes-1440');
    record(
      'Encontrar informação: a busca global mostra a aba Anotações e leva a Revisar com a mesma busca',
    );

    // ---------- Question practice from the lesson: steps and the next action -------------
    data.lessonStage = { 'l-foto': 'summary', 'l-rev': 'pending', 'l-func': 'questions' };
    await page.goto(base + '/material.html?id=l-foto');
    await page.locator('[data-lesson-steps]:not([hidden]) .lesson-next button').waitFor();
    assert.deepEqual(
      await page
        .locator('.lesson-step')
        .evaluateAll((items) => items.map((i) => i.className.replace('lesson-step ', ''))),
      ['is-done', 'is-done', 'is-current', 'is-todo'],
    );
    assert.equal(await page.locator('.lesson-next button').textContent(), 'Criar questões');
    assert.equal(
      await page.locator('.lesson-tools .lesson-tool[open] > summary').first().textContent(),
      'Cronômetro de estudo',
    );
    const stepsBox = await page.locator('[data-lesson-steps]').boundingBox();
    const toolsBox = await page.locator('.lesson-tools').boundingBox();
    assert(toolsBox.y > stepsBox.y, 'timer and annotations come after the lesson content');
    await settle(page);
    await axeCheck(page, 'main', 'Aula › etapas');
    await shot(page, 'aula-etapas-1440');
    await page.locator('.lesson-next button', { hasText: 'Criar questões' }).click();
    await page.locator('[data-questions-dialog][open]').waitFor();
    assert.equal(await page.locator('#tab-questions').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Escape');
    await page.goto(base + '/material.html?id=l-func');
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
    record(
      'Jornada de questões: a aula mostra as etapas e o próximo passo (Criar questões abre a lista; Responder a lista; etapas travadas até confirmar)',
    );

    // ---------- Widths, zoom, themes, screen-reader mode ---------------------------------
    for (const route of ['painel.html', 'planejar.html#tarefas', 'revisar.html#flashcards']) {
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
      'Sem rolagem horizontal em Início, Planejar e Revisar de 320 a 1920 px (640 px = zoom 200%)',
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
    await page.goto(base + '/revisar.html#questoes');
    await page
      .locator('#questoes', { hasText: 'Você ainda não respondeu nenhuma lista' })
      .waitFor();
    await shot(page, 'revisar-questoes-vazio-1440');
    record(
      'Conta nova: cada cartão explica o recurso e oferece uma ação; sem gráficos ou contadores zerados; "Criar primeiro objetivo" abre o formulário',
    );
    await context.close();

    // ---------- Flags off ----------------------------------------------------------------
    ({ context, page } = await openApp(browser, base, {}, state(), { width: 1280, height: 800 }));
    await page.goto(base + '/painel.html');
    await ready(page);
    await page.waitForTimeout(600);
    assert(await page.locator('.primary-navigation a', { hasText: 'Revisar' }).isHidden());
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
      'Flags desligadas: menu sem Revisar/Planejar, Início só com aula e Biblioteca, página direta explica que o recurso não está ativo',
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
