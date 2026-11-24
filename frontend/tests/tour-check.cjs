// Guided tour and Ajuda in a real browser with the simulated API (no backend, no Supabase):
// a new account is invited once on Início, "Agora não" is remembered in the account, the tour
// restarts from Ajuda and Configurações, keyboard navigation and focus work, steps without a
// visible target are skipped, the Ajuda search filters topics, axe has nothing to report and
// nothing scrolls sideways at 390 px (also with the largest text).
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
  defaultUser,
  noHorizontalScroll,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'tour');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const newUser = () => ({ ...defaultUser(), created_at: new Date().toISOString() });
const tourRow = (data) => data.profileState.find((row) => row.key === 'guided-tour');
const step = (page) => page.locator('[data-guided-tour]').getAttribute('data-step');
const focusedInTour = (page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest('[data-guided-tour]')));

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- First entry: invitation, "Agora não" is remembered -------------------------
    {
      const data = state();
      data.profileState = [];
      const { context, page } = await openApp(browser, base, allFlags, data, undefined, {
        user: newUser(),
      });
      await page.goto(base + '/painel.html');
      const invite = page.locator('[data-tour-invite]');
      await invite.waitFor({ timeout: 8000 });
      assert.equal(await page.locator('[data-guided-tour]').count(), 0, 'no tour before asked');
      // Non-blocking: the page keeps working (the search field takes focus and text).
      await page.locator('.topbar-search input').fill('fotossíntese');
      assert.equal(await page.locator('.topbar-search input').inputValue(), 'fotossíntese');
      await page.locator('.topbar-search input').fill('');
      await settle(page);
      await axeCheck(page, '[data-tour-invite]', 'Convite do tour');
      await shot(page, 'convite-1440', false);
      await invite.getByRole('button', { name: 'Agora não' }).click();
      await invite.waitFor({ state: 'detached' });
      for (let i = 0; i < 40 && !tourRow(data); i++) await page.waitForTimeout(50);
      assert.equal(tourRow(data)?.data.status, 'dismissed', 'saved in the account');
      await page.reload();
      await page.waitForTimeout(2200);
      assert.equal(await invite.count(), 0, 'not offered again (this browser)');
      await context.close();
      // Another browser of the same account: the account copy decides.
      const second = await openApp(browser, base, allFlags, data, undefined, { user: newUser() });
      await second.page.goto(base + '/painel.html');
      await second.page.waitForTimeout(2200);
      assert.equal(
        await second.page.locator('[data-tour-invite]').count(),
        0,
        'not offered on another browser',
      );
      await second.context.close();
      record(
        'Conta nova: convite discreto no Início, sem bloquear a página; "Agora não" fica salvo na conta e o convite não volta',
      );
    }

    // ---------- An older account is not interrupted ----------------------------------------
    {
      const data = state();
      const { context, page } = await openApp(browser, base, allFlags, data);
      await page.goto(base + '/painel.html');
      await page.waitForTimeout(2200);
      assert.equal(await page.locator('[data-tour-invite]').count(), 0);
      await context.close();
      record('Conta antiga (ou sem data de criação) não recebe o convite');
    }

    // ---------- Start from the invitation, keyboard, focus, completion -----------------------
    {
      const data = state();
      data.profileState = [];
      const { context, page } = await openApp(browser, base, allFlags, data, undefined, {
        user: newUser(),
      });
      await page.goto(base + '/painel.html');
      await page.locator('[data-tour-start]').click({ timeout: 8000 });
      const tour = page.locator('[data-guided-tour]');
      await tour.waitFor();
      assert.equal(await step(page), 'create');
      assert.equal(await page.locator('[data-tour-counter]').textContent(), 'Passo 1 de 9');
      assert(await focusedInTour(page), 'focus moves into the tour');
      assert.equal(
        await tour.locator('[data-tour-back]').isHidden(),
        true,
        'no "Voltar" on step 1',
      );
      // Beside the target, not over it.
      const target = await page.locator('.side-navigation .nav-create').boundingBox();
      const box = await tour.boundingBox();
      assert(box.x >= target.x + target.width, 'popover beside the target');
      await settle(page);
      await axeCheck(page, '[data-guided-tour]', 'Tour (passo 1)');
      await shot(page, 'tour-passo-1-1440', false);
      await page.keyboard.press('ArrowRight');
      assert.equal(await step(page), 'home');
      await page.keyboard.press('Enter');
      assert.equal(await step(page), 'library');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await step(page), 'home');
      assert.equal(await page.locator('[data-tour-counter]').textContent(), 'Passo 2 de 9');
      assert.equal(await page.locator('[data-tour-counter]').getAttribute('aria-live'), 'polite');
      // Phone-only step is skipped on desktop; search and Personalizar are reached.
      const seen = ['home'];
      for (let i = 0; i < 12; i++) {
        const next = tour.locator('[data-tour-next]');
        if ((await next.textContent()).trim() === 'Concluir') break;
        await next.click();
        seen.push(await step(page));
      }
      assert(!seen.includes('menu'), 'menu step skipped when the sidebar is visible');
      assert(seen.includes('search') && seen.includes('customize'), seen.join());
      assert.equal(await step(page), 'settings');
      await tour.locator('[data-tour-next]').click();
      await tour.waitFor({ state: 'detached' });
      for (let i = 0; i < 40 && !tourRow(data); i++) await page.waitForTimeout(50);
      assert.equal(tourRow(data)?.data.status, 'done');
      record(
        'Tour: popover ao lado do alvo, "Passo n de N" anunciado, → / Enter avançam, ← volta, foco no tour, conclusão salva na conta',
      );
      await context.close();
    }

    // ---------- Restart from Ajuda; Esc closes; missing targets are skipped ------------------
    {
      const data = state();
      const flags = { ...allFlags, planning: false, calendar: false, study_tracking: false };
      const { context, page } = await openApp(browser, base, flags, data);
      await page.goto(base + '/ajuda.html');
      await settle(page);
      await Promise.all([
        page.waitForURL('**/painel.html*'),
        page.locator('[data-start-tour]').first().click(),
      ]);
      const tour = page.locator('[data-guided-tour]');
      await tour.waitFor({ timeout: 8000 });
      assert.doesNotMatch(page.url(), /tour=1/, 'the request leaves the address');
      // Planejar and Focar are off: their steps are not in the count.
      assert.equal(await page.locator('[data-tour-counter]').textContent(), 'Passo 1 de 7');
      for (let i = 0; i < 8; i++) {
        const id = await step(page);
        assert(!['plan', 'focus'].includes(id), `hidden page skipped (${id})`);
        if (id === 'settings') break;
        await page.keyboard.press('ArrowRight');
      }
      await page.keyboard.press('Escape');
      await tour.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.tour-ring').count(), 0, 'ring removed');
      record('Tour reiniciado pela Ajuda; Esc fecha; passos de recursos desligados são pulados');

      // From Configurações too.
      await page.goto(base + '/configuracoes.html');
      await settle(page);
      await Promise.all([
        page.waitForURL('**/painel.html*'),
        page.locator('[data-start-tour]').click(),
      ]);
      await tour.waitFor({ timeout: 8000 });
      await tour.locator('[data-tour-close]').click();
      await tour.waitFor({ state: 'detached' });
      record('Tour reiniciado por Configurações; o × fecha');
      await context.close();
    }

    // ---------- Phone width and largest text: menu step, no sideways scroll ------------------
    for (const big of [false, true]) {
      const data = state();
      const { context, page } = await openApp(browser, base, allFlags, data, {
        width: 390,
        height: 844,
      });
      if (big)
        await context.addInitScript(() =>
          localStorage.setItem(
            'audioestudo-ui-preferences',
            JSON.stringify({ textSize: 'maximum' }),
          ),
        );
      await page.goto(base + '/painel.html?tour=1');
      const tour = page.locator('[data-guided-tour]');
      await tour.waitFor({ timeout: 8000 });
      const steps = [await step(page)];
      for (let i = 0; i < 10; i++) {
        const box = await tour.boundingBox();
        assert(
          box.x >= 0 && box.x + box.width <= 390,
          `popover inside the screen (${steps.at(-1)})`,
        );
        await noHorizontalScroll(page, `tour 390 ${steps.at(-1)}${big ? ' texto máximo' : ''}`);
        if ((await tour.locator('[data-tour-next]').textContent()).trim() === 'Concluir') break;
        await page.keyboard.press('ArrowRight');
        steps.push(await step(page));
      }
      assert.equal(steps[0], 'menu', `phone starts at the menu button (${steps.join()})`);
      assert(!steps.includes('library'), 'drawer items are skipped while the drawer is closed');
      await shot(page, `tour-390${big ? '-texto-maximo' : ''}`, false);
      await settle(page);
      await axeCheck(page, '[data-guided-tour]', `Tour 390${big ? ' texto máximo' : ''}`);
      await context.close();
    }
    record(
      '390 px (e texto máximo): passo do menu no lugar da barra lateral, popover dentro da tela, sem rolagem lateral, axe',
    );

    // ---------- Reduced motion: no transition ------------------------------------------------
    {
      const data = state();
      const { context, page } = await openApp(browser, base, allFlags, data);
      await context.addInitScript(() =>
        localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ reducedMotion: true })),
      );
      await page.goto(base + '/painel.html?tour=1');
      const tour = page.locator('[data-guided-tour]');
      await tour.waitFor({ timeout: 8000 });
      const transition = await tour.evaluate((node) => getComputedStyle(node).transitionDuration);
      assert.match(transition, /^0s(, 0s)*$/, `no transition (${transition})`);
      await context.close();
      record('Movimento reduzido do app: o tour não anima');
    }

    // ---------- Ajuda: search filters topics; anchors -----------------------------------------
    {
      const data = state();
      const { context, page } = await openApp(browser, base, allFlags, data);
      await page.goto(base + '/ajuda.html');
      await settle(page);
      const visibleTopics = () =>
        page.locator('.help-topic:visible').evaluateAll((nodes) => nodes.map((n) => n.id));
      const all = await visibleTopics();
      assert(all.length >= 15, `${all.length} topics`);
      for (const id of [
        'nova-transcricao',
        'conferir-transcricao',
        'resumo',
        'criacao-questoes',
        'flashcards',
        'biblioteca',
        'material-integrado',
        'anotacoes',
        'planejar',
        'focar',
        'foco-leitura',
        'idiomas',
        'seus-dados',
      ])
        assert(all.includes(id), `topic ${id}`);
      await page.locator('#help-filter').fill('flashcard');
      await page.waitForTimeout(300);
      const found = await visibleTopics();
      assert(found.includes('flashcards') && found.length < all.length, found.join());
      assert.match(await page.locator('[data-help-status]').textContent(), /tópicos? encontrados?/);
      assert.equal(
        await page.locator('[data-help-index] li:visible').count(),
        found.length,
        'index follows the filter',
      );
      await page.locator('#help-filter').fill('confirmar transcricao'); // no accents
      await page.waitForTimeout(300);
      assert((await visibleTopics()).includes('conferir-transcricao'), 'accents ignored');
      await page.locator('#help-filter').fill('palavrainexistente');
      await page.waitForTimeout(300);
      assert(await page.locator('[data-help-empty]').isVisible(), 'empty message');
      await page.locator('#help-filter').press('Escape');
      await page.waitForTimeout(300);
      assert.equal((await visibleTopics()).length, all.length, 'Esc clears the search');
      await page.locator('[data-help-index] a[href="#material-integrado"]').click();
      let top = Infinity;
      for (let i = 0; i < 30 && !(top >= 0 && top < 300); i++) {
        await page.waitForTimeout(100);
        top = await page
          .locator('#material-integrado')
          .evaluate((n) => n.getBoundingClientRect().top);
      }
      assert(top >= 0 && top < 300, `anchor scrolled into view (${top})`);
      await axeCheck(page, 'main', 'Ajuda');
      await context.close();
      for (const big of [false, true]) {
        const phone = await openApp(browser, base, allFlags, state(), { width: 390, height: 844 });
        if (big)
          await phone.context.addInitScript(() =>
            localStorage.setItem(
              'audioestudo-ui-preferences',
              JSON.stringify({ textSize: 'maximum' }),
            ),
          );
        await phone.page.goto(base + '/ajuda.html');
        await settle(phone.page);
        await noHorizontalScroll(phone.page, `Ajuda 390${big ? ' texto máximo' : ''}`);
        await phone.context.close();
      }
      record(
        'Ajuda: tópicos com âncora, busca sem acento que filtra tópicos e índice, aviso quando nada é encontrado, Esc limpa, axe, sem rolagem lateral a 390 px',
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
  const unexpected = errors.filter((e) => !/Sem simulação|404/.test(e));
  assert.deepEqual(unexpected, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} tour checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
