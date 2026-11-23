// 3.5 Milestone 8 (Refinement) in a real browser with the simulated app: Início is a dashboard
// (3.7: no desk scene; the two columns end on the same line; nothing animates in the main column
// with reduced motion); Planejar, Focar and Turmas have no horizontal scroll at 390 px and pass axe at 390 and
// 1440 px; the transcript selection toolbar works with the keyboard (Shift+F10, arrows, Escape,
// the fallback button), never covers the selection, offers Investigar with the passage only for
// confirmed lessons with discoveries on, and passes axe.
// Nothing here calls a real backend, AI provider or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  ready,
  noHorizontalScroll,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'refinement');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const flags = { ...allFlags, classrooms: true };

const classroomData = (data) => {
  data.classrooms = {
    requests: [],
    rooms: [
      {
        id: 'room-bio',
        name: 'Biologia 2º ano B',
        description: 'Aulas de citologia e metabolismo.',
        status: 'active',
        members: [
          { userId: 'user-dashboard', displayName: 'Marina Alves', role: 'teacher', status: 'active' },
          { userId: 's1', displayName: 'Caio Lima', role: 'student', status: 'active' },
        ],
        invites: [],
        lessons: [{ id: 'cl-1', title: 'Fotossíntese e respiração celular', source: 'teacher', status: 'published', ownerId: 'user-dashboard', text: 'A fotossíntese.', questionBatchIds: [] }],
        submissions: [],
        shared: [],
        resources: [{ id: 'r1', title: 'Guia de estudos', url: 'https://example.com/guia', description: 'Roteiro.' }],
      },
    ],
  };
  return data;
};

async function selectWords(page, words) {
  const paragraph = page.locator('.transcription-segment .segment-text').first();
  await paragraph.waitFor();
  await paragraph.evaluate((node, target) => {
    const text = node.firstChild;
    const start = text.textContent.indexOf(target);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + target.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, words);
}
const rectOf = (page, selector) => page.locator(selector).evaluate((node) => node.getBoundingClientRect().toJSON());
const selectionRect = (page) => page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().toJSON());
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- 1. Início, a dashboard (3.7: the desk scene left) ---------------------------
    for (const width of [1440, 390]) {
      const data = state();
      data.seedUnlocks = [{ id: 'object.desk-lamp', kind: 'object', occurredAt: new Date().toISOString(), lessonTitle: 'Fotossíntese e respiração celular' }];
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, data, { width, height: width < 700 ? 844 : 1000 });
      await page.goto(base + '/painel.html');
      await ready(page);
      await settle(page);
      assert.equal(await page.locator('[data-desk-scene], .desk-room, .desk-stage, .desk-lume, [data-desk-arrange]').count(), 0, `Início ${width}: no desk scene`);
      assert.equal(await page.getByRole('button', { name: 'Arrumar a mesa' }).count(), 0);
      // The heading is the first thing shown in main, then the dashboard (no scene between them).
      const order = await page.evaluate(() => [...document.querySelector('main').children].filter((n) => n.getClientRects().length).slice(0, 2).map((n) => n.className));
      assert.match(order[0], /dashboard-heading/);
      assert.match(order[1], /dash-home/);
      if (width > 700) {
        // Columns end on the same line (the last visible block of each column grows).
        const ends = await page.evaluate(() => {
          const bottom = (s) => document.querySelector(s).getBoundingClientRect().bottom;
          return { main: bottom('.dash-main'), rail: bottom('.dash-rail') };
        });
        assert(Math.abs(ends.main - ends.rail) <= 2, `.dash-main and .dash-rail end on the same line (${ends.main} vs ${ends.rail})`);
      }
      await noHorizontalScroll(page, `Início ${width}`);
      await axeCheck(page, 'body', `Início ${width} (painel)`);
      await shot(page, `inicio-${width}`, false);
      // Visiting Início never writes the desk layout.
      assert.equal((data.discoveryState?.requests || []).filter((r) => r.kind === 'layout').length, 0);
      await context.close();
    }
    // Reduced motion: nothing in the main column animates.
    {
      const { context, page } = await openApp(browser, base, flags, state(), { width: 1440, height: 1000 }, { context: { reducedMotion: 'reduce' } });
      await page.goto(base + '/painel.html');
      await ready(page);
      const animated = await page.evaluate(() =>
        [...document.querySelectorAll('main *')].filter((n) => getComputedStyle(n).animationName !== 'none' && getComputedStyle(n).animationDuration !== '0s').map((n) => n.className.baseVal ?? n.className + ':' + getComputedStyle(n).animationName),
      );
      assert.deepEqual(animated, [], 'no animation in main with reduced motion');
      await context.close();
    }
    record('Início como painel (3.7): sem cena da escrivaninha nem "Arrumar a mesa"; título seguido do painel; colunas terminam na mesma linha a 1440 (±2px); sem rolagem horizontal; movimento reduzido sem animações no main; nenhum PUT do layout; axe 1440 e 390');

    // ---------- 2. Planejar, Focar, Turmas at 390 and 1440 ------------------------------------
    const pages = [
      ['Planejar (tarefas)', '/planejar.html#tarefas', '.planning-goal'],
      ['Planejar (calendário)', '/planejar.html#calendario', '.calendar-month'],
      ['Focar', '/focar.html', '.focus-card'],
      ['Turmas', '/turmas.html', '.classroom-card'],
      ['Turma', '/turmas.html?turma=room-bio', '.classroom-title'],
    ];
    for (const width of [390, 1440]) {
      const { context, page } = await openApp(browser, base, flags, classroomData(state()), { width, height: width < 700 ? 844 : 1000 });
      for (const [label, url, marker] of pages) {
        await page.goto(base + url);
        await page.locator(marker).first().waitFor();
        await settle(page);
        await noHorizontalScroll(page, `${label} ${width}`);
        await axeCheck(page, 'main', `${label} ${width}`);
      }
      // The class page: the class is the title; the lessons are ruled rows in one panel.
      assert.equal(await page.locator('main[data-view="classroom"]').count(), 1);
      assert.equal(await page.locator('h1').count(), 1, 'Turmas stays the h1');
      await context.close();
    }
    {
      // Empty states draw the matching art.
      const data = state();
      data.goals = [];
      data.subgoals = [];
      data.tasks = [];
      const { context, page } = await openApp(browser, base, flags, data);
      await page.goto(base + '/planejar.html#tarefas');
      await page.locator('[data-art-slot="empty"][data-art-id="empty.planner"] img.art-empty').waitFor();
      await page.goto(base + '/turmas.html');
      await page.locator('[data-art-slot="empty"][data-art-id="empty.classrooms"] img.art-empty').waitFor();
      await axeCheck(page, 'main', 'Turmas vazia');
      await context.close();
    }
    record('Planejar, Focar e Turmas (lista e turma): sem rolagem horizontal a 390 px; axe a 390 e 1440 px; estados vazios com empty.planner e empty.classrooms');

    // ---------- 2b. Descobertas and Gabinete ----------------------------------------------------
    for (const width of [390, 1440]) {
      const data = state();
      data.seedDiscoveries = [
        { id: '0b1c2d3e-0000-4000-8000-000000000001', materialId: 'l-rev', title: 'De onde vinha a energia das fábricas?', explanation: 'O carvão guardava energia química.', quote: 'máquina a vapor', createdAt: new Date().toISOString() },
      ];
      data.seedUnlocks = [{ id: 'object.globe', kind: 'object', occurredAt: new Date().toISOString(), lessonTitle: 'Revolução Industrial' }];
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, data, { width, height: width < 700 ? 844 : 1000 });
      await page.goto(base + '/descobertas.html');
      await page.locator('.archive-cards .specimen-card').first().waitFor();
      await noHorizontalScroll(page, `Descobertas ${width}`);
      await axeCheck(page, 'main', `Descobertas ${width}`);
      await page.goto(base + '/gabinete.html?gaveta=object');
      await page.locator('[data-drawer="object"]').first().waitFor();
      assert.equal(await page.locator('.cabinet-item[data-state="locked"]').first().evaluate((n) => getComputedStyle(n.querySelector('[data-art-slot]')).filter), 'grayscale(1)', 'locked items are outlines');
      await noHorizontalScroll(page, `Gabinete ${width}`);
      await axeCheck(page, 'main', `Gabinete ${width}`);
      await context.close();
    }
    {
      const data = state();
      data.seedUnlocks = [];
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, data);
      await page.goto(base + '/descobertas.html');
      await page.locator('[data-art-slot="empty"][data-art-id="empty.discoveries"] img.art-empty').waitFor();
      await context.close();
    }
    record('Descobertas (caderno pautado com data na margem) e Gabinete (gavetas com compartimentos): sem rolagem horizontal a 390 px, axe a 390 e 1440 px, estado vazio com empty.discoveries');

    // ---------- 3. Selection toolbar ------------------------------------------------------------
    for (const discoveries of [true, false]) {
      const data = state();
      const { context, page } = await openApp(browser, base, { ...flags, discoveries }, data);
      await page.goto(base + '/material.html?id=l-foto');
      await selectWords(page, 'energia luminosa');
      // The fallback button appears for keyboard users while the selection is usable.
      const trigger = page.getByRole('button', { name: 'Ações do trecho selecionado' });
      await trigger.waitFor({ state: 'attached' });
      await page.waitForFunction(() => !document.querySelector('.selection-toolbar-trigger').hidden);
      // Shift+F10 opens the toolbar and moves focus to its first action.
      await page.keyboard.press('Shift+F10');
      const toolbar = page.getByRole('toolbar', { name: 'Ações do trecho selecionado' });
      await toolbar.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Destacar');
      assert(!overlaps(await rectOf(page, '.selection-toolbar'), await selectionRect(page)), 'the toolbar never covers the selection');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Anotar');
      await page.keyboard.press('End');
      const last = await page.evaluate(() => document.activeElement.textContent);
      const investigate = toolbar.getByRole('link', { name: 'Investigar' });
      if (discoveries) {
        assert.equal(last, 'Investigar');
        assert.match(await investigate.getAttribute('href'), /investigar\.html\?aula=l-foto&trecho=energia\+luminosa/);
      } else {
        assert.equal(last, 'Anotar');
        assert.equal(await investigate.isVisible(), false, 'no Investigar without the discoveries flag');
      }
      await page.keyboard.press('Home');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Destacar');
      await axeCheck(page, '.selection-toolbar', 'Barra da seleção');
      if (discoveries) await shot(page, 'barra-selecao-1440', false);
      await page.keyboard.press('Escape');
      assert(await toolbar.isHidden(), 'Escape closes the toolbar');
      // The fallback button opens it too, then the highlight is saved.
      await trigger.focus();
      await page.keyboard.press('Enter');
      await toolbar.waitFor();
      await page.keyboard.press('Enter');
      await page.locator('[data-notes-section] .annotation-card blockquote', { hasText: 'energia luminosa' }).first().waitFor({ state: 'attached' });
      assert.equal(data.savedNotes.at(-1).body.quote, 'energia luminosa');
      await context.close();
    }
    {
      // At 390 px, after a pointer selection.
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, state(), { width: 390, height: 844 });
      await page.goto(base + '/material.html?id=l-foto');
      await selectWords(page, 'energia luminosa');
      await page.locator('.transcription-segment .segment-text').first().dispatchEvent('mouseup');
      const toolbar = page.getByRole('toolbar', { name: 'Ações do trecho selecionado' });
      await toolbar.waitFor();
      assert(!overlaps(await rectOf(page, '.selection-toolbar'), await selectionRect(page)), 'never covers the selection at 390 px');
      await noHorizontalScroll(page, 'Aula 390 com a barra da seleção');
      await shot(page, 'barra-selecao-390', false);
      await context.close();
    }
    {
      // A lesson awaiting confirmation: no Investigar, even with the flag.
      const data = state();
      data.lessonStage = { 'l-foto': 'pending' };
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, data);
      await page.goto(base + '/material.html?id=l-foto');
      await page.locator('.transcription-segment').first().waitFor({ state: 'attached' });
      await settle(page);
      assert.equal(await page.locator('.selection-toolbar a[data-action="investigate"]:visible').count(), 0);
      await context.close();
    }
    // The investigation starts from the passage.
    {
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, state());
      await page.goto(base + '/investigar.html?aula=l-foto&trecho=energia+luminosa');
      await page.locator('[data-question-input]').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-question-input]').value.includes('energia luminosa'));
      await context.close();
    }
    record('Barra da seleção: Shift+F10 e o botão alternativo abrem e focam a primeira ação; setas, Home/End; Esc fecha; nunca cobre a seleção (1440 e 390); Investigar só com descobertas e aula confirmada, com o trecho na investigação; axe');
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
