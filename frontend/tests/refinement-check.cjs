// 3.5 Milestone 8 (Refinement) in a real browser with the simulated app: the art-directed desk
// scene renders (wood, edge, Lume and window proportions, lamp light), the sheet rests on the
// desk; Planejar, Focar and Turmas have no horizontal scroll at 390 px and pass axe at 390 and
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
    // ---------- 1. The desk scene ------------------------------------------------------------
    for (const width of [1440, 390]) {
      const data = state();
      data.seedUnlocks = [{ id: 'object.desk-lamp', kind: 'object', occurredAt: new Date().toISOString(), lessonTitle: 'Fotossíntese e respiração celular' }];
      const { context, page } = await openApp(browser, base, { ...flags, discoveries: true }, data, { width, height: width < 700 ? 844 : 1000 });
      await page.goto(base + '/painel.html');
      await ready(page);
      await page.locator('[data-desk-scene][data-ready="true"]').waitFor({ state: 'attached' });
      await page.locator('.desk-lume .lume-companion').waitFor({ state: 'attached' });
      const scene = await page.evaluate(() => {
        const room = document.querySelector('.desk-room');
        const top = getComputedStyle(room, '::before');
        const edge = getComputedStyle(room, '::after');
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        return {
          surface: top.backgroundImage,
          edgeShadow: edge.boxShadow,
          room: box('.desk-room').toJSON(),
          lume: box('.desk-lume').toJSON(),
          window: box('.desk-window').toJSON(),
          sheet: box('.dash-continue').toJSON(),
          teacup: box('[data-object-id="object.teacup"]').toJSON(),
        };
      });
      assert.match(scene.surface, /data:image\/svg\+xml/, 'the desk top has wood grain');
      assert.notEqual(scene.edgeShadow, 'none', 'the desk edge casts a shadow');
      assert(scene.lume.width >= scene.teacup.width * 1.4, 'Lume is clearly bigger than an object');
      assert(scene.window.width >= (width < 700 ? 140 : 150), `a generous window (${scene.window.width}px)`);
      assert(scene.sheet.top < scene.room.bottom, 'the lesson sheet rests on the desk (overlaps its edge)');
      if (width < 700) assert(scene.room.height <= 300, `the phone scene stays compact (${scene.room.height}px)`);
      // The lamp throws a light pool once it is on the desk.
      await page.getByRole('button', { name: 'Arrumar a mesa' }).click();
      await page.locator('[data-desk-object="object.desk-lamp"]').click();
      await page.locator('[data-desk-slot="lamp-corner"] .desk-slot-target').click();
      await page.locator('[data-desk-status]', { hasText: 'Mesa salva' }).waitFor();
      await page.getByRole('button', { name: 'Concluir' }).click();
      const glow = await page.evaluate(() => getComputedStyle(document.querySelector('[data-desk-slot="lamp-corner"]'), '::before').backgroundImage);
      assert.match(glow, /radial-gradient/, 'the lamp light pool');
      await noHorizontalScroll(page, `Início ${width}`);
      await axeCheck(page, 'body', `Início ${width} (mesa com luminária)`);
      await shot(page, `mesa-${width}`, false);
      await context.close();
    }
    // Reduced motion: nothing in the scene animates.
    {
      const { context, page } = await openApp(browser, base, flags, state(), { width: 1440, height: 1000 }, { context: { reducedMotion: 'reduce' } });
      await page.goto(base + '/painel.html');
      await ready(page);
      const animated = await page.evaluate(() =>
        [...document.querySelectorAll('.desk-scene *')].filter((n) => getComputedStyle(n).animationName !== 'none' && getComputedStyle(n).animationDuration !== '0s').map((n) => n.className.baseVal ?? n.className + ':' + getComputedStyle(n).animationName),
      );
      assert.deepEqual(animated, [], 'no animation in the desk scene with reduced motion');
      await context.close();
    }
    record('Escrivaninha: madeira com veios, borda com sombra, Lume e janela maiores, a folha da aula sobre a borda da mesa, luz da luminária; compacta no celular; movimento reduzido; axe 1440 e 390');

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
