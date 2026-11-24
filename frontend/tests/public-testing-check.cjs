// Public testing program (FEATURE_PUBLIC_TESTING) in a real browser with the simulated API (no
// backend, no Supabase, no AI): the participants' welcome note (once per browser session), the
// account limits and the administrators' panel, the demo lessons shelf (open → POST → lesson),
// the demo note on a copy, a friendly quota refusal with "Ver meus limites", and the flag off
// rendering nothing new. axe, no sideways scroll at 390 px, night theme.
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
  noHorizontalScroll,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');
const { testingState, DEMOS } = require('./support/mock-testing.cjs');

const output = path.join(__dirname, 'artifacts', 'public-testing');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const FLAGS = { ...allFlags, public_testing: true };

/** A browser context (= a browser session) with the program on and the given policy. */
async function open(browser, base, policy, { viewport, flags = FLAGS, theme } = {}) {
  const data = state();
  if (policy) data.testing = testingState(policy);
  const app = await openApp(browser, base, flags, data, viewport);
  if (theme)
    await app.context.addInitScript((value) => {
      try { localStorage.setItem('audioestudo-theme', value); } catch { /* defaults */ }
    }, theme);
  const apiCalls = [];
  app.page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiCalls.push(`${request.method()} ${url.pathname}`);
  });
  return { ...app, data, apiCalls };
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---- Welcome note: once per browser session -------------------------------------------
    {
      const { context, page } = await open(browser, base, 'tester');
      await page.goto(`${base}/painel.html`);
      const note = page.locator('[data-testing-welcome]');
      await note.waitFor();
      assert.equal(await note.getAttribute('role'), 'status');
      const text = await note.textContent();
      assert.match(text, /Estamos em fase de testes!/);
      assert.match(text, /limite de transcrição para 5 minutos por participante/);
      assert.match(text, /preparamos 3 aulas completas/);
      assert.doesNotMatch(text, /limite normal/i);
      await axeCheck(page, '[data-testing-welcome]', 'welcome note');
      await shot(page, 'welcome-desktop', false);
      // Navigation in the same session: not again.
      await page.goto(`${base}/historico.html`);
      await settle(page);
      await page.locator('[data-demo-shelf]').waitFor();
      assert.equal(await page.locator('[data-testing-welcome]').count(), 0, 'not shown again after navigation');
      record('participante: aviso de boas-vindas aparece uma vez por sessão');
      await context.close();
    }
    {
      // A new session shows it again; Esc closes it; "Ver meus limites" goes to the account section.
      const { context, page } = await open(browser, base, 'tester');
      await page.goto(`${base}/historico.html`);
      await page.locator('[data-testing-welcome]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('[data-testing-welcome]').waitFor({ state: 'detached' });
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(`${base}/painel.html`);
      await page.locator('[data-testing-welcome-limits]').click();
      await page.waitForURL(/conta\.html#limites$/);
      const section = page.locator('#limites[data-testing-account="tester"]');
      await section.waitFor();
      assert.equal(await section.locator('h2').textContent(), 'Conta de participante');
      const inView = await section.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.top < innerHeight && box.bottom > 0;
      });
      assert(inView, 'account section scrolled into view');
      record('nova sessão: aviso de novo; Esc fecha; "Ver meus limites" abre Conta › limites');
      // Meters from /me (used comes as strings).
      const meter = (kind) => section.locator(`[data-kind="${kind}"]`).textContent();
      assert.match(await meter('transcription_seconds'), /1 min 12 s de 5 min usados — restam 3 min 48 s/);
      assert.match(await meter('processing_llm'), /Gravações processadas.*1 de 3 · restam 2/);
      assert.match(await meter('summary'), /Resumos.*1 de 2 · restam 1/);
      assert.match(await meter('questions'), /Listas de questões.*0 de 2 · restam 2/);
      assert.match(await meter('flashcards'), /0 de 1/);
      assert.match(await meter('multi_lesson'), /Material integrado: indisponível durante os testes/);
      assert.match(await section.textContent(), /reduzimos temporariamente o limite de transcrição para 5 minutos/);
      assert.equal(await section.locator('a[href$="#aulas-de-demonstracao"]').count(), 1);
      assert.equal(await page.locator('[data-testing-overview]').count(), 0, 'no admin panel for testers');
      await axeCheck(page, '#limites', 'account limits');
      record('Conta: medidores com os números de /me; participante não vê o painel do programa');
      await context.close();
    }
    // ---- Administrators -------------------------------------------------------------------
    {
      const { context, page } = await open(browser, base, 'admin');
      await page.goto(`${base}/conta.html`);
      const panel = page.locator('[data-testing-overview]');
      await panel.waitFor();
      assert.equal(await page.locator('#limites h2').textContent(), 'Conta de administradora');
      assert.equal(await page.locator('[data-testing-welcome]').count(), 0, 'no welcome note for admins');
      const text = await panel.textContent();
      assert.match(text, /37\s*participantes/);
      assert.match(text, /64\s*cópias de demonstração/);
      assert.match(text, /102 min de 300 min/);
      assert.match(text, /212 de 800/);
      assert.match(text, /2\s*na fila/);
      await axeCheck(page, '[data-testing-overview]', 'admin panel');
      await shot(page, 'conta-admin-desktop');
      record('administradora: painel "Programa de testes" com números e limites globais');
      await context.close();
    }
    // ---- Demo shelf: open → POST → lesson with the demo note --------------------------------
    {
      const { context, page, data, apiCalls } = await open(browser, base, 'tester');
      await page.addInitScript(() => { try { sessionStorage.setItem('voz-testing-welcome:user-dashboard', '1'); } catch { /* */ } });
      await page.goto(`${base}/historico.html`);
      const shelf = page.locator('[data-demo-shelf]');
      await shelf.waitFor();
      assert.equal(await shelf.locator('.demo-card').count(), 3);
      assert.match(await shelf.textContent(), /Já processada — não usa seu limite/);
      assert.match(await shelf.locator('.demo-card').first().textContent(), /Resumo · 10 questões · 12 cartões/);
      assert.deepEqual(
        await shelf.locator('[data-demo-action-label]').allTextContents(),
        ['Começar', 'Começar', 'Começar'],
      );
      await axeCheck(page, '[data-demo-shelf]', 'demo shelf');
      await shot(page, 'biblioteca-desktop');
      // Inside a folder the shelf steps aside.
      await page.goto(`${base}/historico.html?folder=sub-bio`);
      await settle(page);
      assert(await page.locator('[data-demo-shelf]').isHidden(), 'shelf hidden inside a folder');
      await page.goto(`${base}/historico.html`);
      await shelf.waitFor();
      await shelf.locator(`[data-demo-open="${DEMOS[0].id}"]`).click();
      await page.waitForURL(/material\.html\?id=demo-crase/);
      assert(apiCalls.includes(`POST /api/demo-lessons/${DEMOS[0].id}/open`), 'POST open called');
      assert.equal(data.testing.opens.length, 1);
      const note = page.locator('[data-demo-note]');
      await note.waitFor();
      assert.match(await note.locator('summary').textContent(), /Aula de demonstração.*já processada; não usa seu limite/);
      await note.locator('summary').click();
      assert.match(await note.textContent(), /Créditos:/);
      await shot(page, 'material-demo-note', false);
      await axeCheck(page, '.material-header', 'demo note');
      record('Biblioteca: estante com 3 aulas; "Começar" chama POST open e abre a aula com a nota de demonstração');
      // Back in the library: the copy is a normal lesson, and its card now says "Abrir".
      await page.goto(`${base}/historico.html`);
      await shelf.waitFor();
      assert.equal(await shelf.locator(`[data-demo-open="${DEMOS[0].id}"] [data-demo-action-label]`).textContent(), 'Abrir');
      // Início: the compact entry lists only the demos not opened yet.
      await page.goto(`${base}/painel.html`);
      const home = page.locator('[data-demo-home]');
      await home.waitFor();
      assert.equal(await home.locator('.demo-home__tile').count(), 2);
      await axeCheck(page, '[data-demo-home]', 'home entry');
      record('cópia aberta vira "Abrir" na estante; Início mostra só as demonstrações não abertas');
      await context.close();
    }
    // ---- Quota refusal shown clearly --------------------------------------------------------
    {
      const { context, page, data } = await open(browser, base, 'tester');
      data.testing.failSummary = true;
      await page.addInitScript(() => { try { sessionStorage.setItem('voz-testing-welcome:user-dashboard', '1'); } catch { /* */ } });
      await page.goto(`${base}/material.html?id=l-foto`);
      await settle(page);
      await page.getByRole('tab', { name: 'Resumo', exact: true }).click();
      await page.locator('[data-regenerate-summary]').click();
      await page.locator('[data-summary-form] [type=submit]').click();
      const message = page.locator('[data-summary-message]');
      await page.waitForFunction(() => document.querySelector('[data-summary-message] .testing-limits-link'));
      const text = await message.textContent();
      assert.match(text, /Você já usou as 2 gerações de resumos do período de testes/);
      assert.doesNotMatch(text, /GENERATION_QUOTA_EXCEEDED|403/);
      assert.equal(await message.locator('a').getAttribute('href'), './conta.html#limites');
      const toast = page.locator('.app-toast');
      await toast.waitFor();
      assert.equal(await toast.locator('.app-toast__action').textContent(), 'Ver meus limites');
      await shot(page, 'quota-resumo', false);
      record('403 de geração de resumo: mensagem amigável + "Ver meus limites" (status e aviso)');
      await context.close();
    }
    // ---- Upload: remaining allowance ---------------------------------------------------------
    {
      const { context, page } = await open(browser, base, 'tester');
      await page.addInitScript(() => { try { sessionStorage.setItem('voz-testing-welcome:user-dashboard', '1'); } catch { /* */ } });
      await page.goto(`${base}/nova-transcricao.html`);
      const hint = page.locator('[data-testing-allowance]');
      await hint.waitFor();
      assert.match(await hint.textContent(), /Restam 3 min 48 s de transcrição no período de testes/);
      record('Nova transcrição: "Restam X de transcrição" para participantes');
      await context.close();
    }
    // ---- Flag off: nothing new ----------------------------------------------------------------
    {
      const { context, page, apiCalls } = await open(browser, base, 'tester', { flags: { ...allFlags, public_testing: false } });
      for (const target of ['painel.html', 'historico.html', 'conta.html', 'nova-transcricao.html']) {
        await page.goto(`${base}/${target}`);
        await settle(page);
        await page.waitForTimeout(300);
        assert.equal(
          await page.locator('[data-testing-welcome], [data-demo-shelf], [data-demo-home], [data-testing-account], [data-testing-allowance]').count(),
          0,
          `nothing new on ${target}`,
        );
      }
      assert.equal(apiCalls.filter((call) => /testing|demo-lessons/.test(call)).length, 0, 'no program calls');
      assert.equal(
        await page.evaluate(() => document.querySelector('link[href$="/css/public-testing.css"]')),
        null,
        'stylesheet not loaded',
      );
      record('flag desligada: nada novo é renderizado nem pedido');
      await context.close();
    }
    // ---- Legacy accounts: nothing on the account page ----------------------------------------
    {
      const { context, page } = await open(browser, base, 'legacy');
      await page.goto(`${base}/conta.html`);
      await settle(page);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-testing-account], [data-testing-welcome]').count(), 0);
      record('conta legacy: nenhuma seção nova');
      await context.close();
    }
    // ---- 390 px and night theme ------------------------------------------------------------
    for (const theme of [undefined, 'night']) {
      const label = theme || 'paper';
      for (const [policy, targets] of [['tester', ['painel.html', 'historico.html', 'conta.html#limites', 'nova-transcricao.html']], ['admin', ['conta.html']]]) {
        const { context, page } = await open(browser, base, policy, { viewport: { width: 390, height: 844 }, theme });
        for (const target of targets) {
          await page.goto(`${base}/${target}`);
          await settle(page);
          await page.waitForTimeout(250);
          await noHorizontalScroll(page, `${target} ${policy} ${label}`);
          if (theme === 'night') {
            const selector = target.startsWith('historico') ? '[data-demo-shelf]' : target.startsWith('conta') ? '[data-testing-account]' : null;
            if (selector) await axeCheck(page, selector, `${target} night`);
          }
          await shot(page, `${policy}-${target.replace(/[^a-z]+/g, '-')}-390-${label}`);
        }
        await context.close();
      }
    }
    record('390 px (claro e noturno): sem rolagem lateral; axe no tema noturno');
  } finally {
    await browser.close();
    server.close();
  }
  const unexpected = errors.filter((e) => !/Sem simulação|404/.test(e));
  assert.deepEqual(unexpected, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} public testing checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
