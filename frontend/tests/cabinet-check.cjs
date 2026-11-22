// 3.6 Milestone E in a real browser with a SIMULATED API (support/mock-discoveries.cjs and the
// synthetic account of support/cabinet-fixtures.cjs): the cabinet of curiosities (drawers by mouse
// and keyboard, the museum label, the shelves that fill, the empty cabinet and its guide, reduced
// motion), the archive (evolving cards with their explanations, threads, subject groups, a
// collection saved in the account preferences, milestones) and the discovery page's card.
// axe at 1440 and 390 px; no horizontal scroll at 390 px. Card states are unit-tested in
// tests/discovery-card.test.mjs; the list fields come from 20261124090000_discovery_archive.sql
// (backend/tests/discovery-archive-migration.test.js).
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { state, errors, passed, record, axeCheck, noHorizontalScroll, openApp, shotter, settle, allFlags, startServer, launchBrowser } = require('./support/mock-app.cjs');
const { populated, ID } = require('./support/cabinet-fixtures.cjs');

const output = path.join(__dirname, 'artifacts', 'cabinet');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const flags = { ...allFlags, discoveries: true };
const prefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('audioestudo-ui-preferences') || '{}'));
const focused = (page) => page.evaluate(() => document.activeElement?.dataset.drawer || document.activeElement?.dataset.collectible || document.activeElement?.dataset.discovery || document.activeElement?.tagName);

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    // ---------- 1. The cabinet, populated ------------------------------------------------------
    {
      const data = populated(state());
      const { context, page } = await openApp(browser, base, flags, data, { width: 1440, height: 1000 });
      await page.goto(base + '/gabinete.html');
      const stamps = page.locator('[data-drawer="stamp"]');
      await stamps.waitFor();
      // Shelves show what the drawers hold; the cabinet is lit once it has something.
      assert.equal(await page.locator('[data-curio-cabinet]').getAttribute('data-fill'), 'some');
      assert.deepEqual(await page.locator('[data-shelf-row="objects"] [data-found="true"] .curio-shelf-name').allTextContents(), ['Lupa', 'Globo']);
      assert.equal(await page.locator('[data-shelf-row="objects"] [data-found="false"]').count(), 3, 'faint outlines of what is still to find');
      assert.equal(await page.locator('[data-drawer="stamp"]').getAttribute('data-fill'), 'full');
      assert.equal(await page.locator('[data-drawer="cover"]').getAttribute('data-fill'), 'empty');
      assert.match(await page.locator('[data-drawer="specimen"]').textContent(), /4 descobertas/);
      assert(await page.locator('[data-cabinet-guide]').isHidden(), 'the guide is for an empty cabinet');
      assert.equal(await page.locator('[data-desk-section], [data-desk-form]').count(), 0, 'no leftover desk form');
      assert.equal(await page.locator('a[href="./painel.html"]', { hasText: 'Arrumar a mesa no Início' }).count(), 1);
      // Mouse: open, close.
      await stamps.click();
      await page.locator('#curio-tray[data-tray="stamp"]').waitFor();
      assert.equal(await stamps.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#curio-tray .cabinet-item[data-state="unlocked"]').count(), 6);
      await stamps.click();
      assert.equal(await page.locator('#curio-tray').count(), 0);
      // Keyboard: roving focus between drawers with the arrows; Enter opens; arrows between
      // compartments; Esc closes and gives the focus back to the drawer.
      await stamps.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await focused(page), 'object');
      await page.keyboard.press('ArrowDown');
      assert.equal(await focused(page), 'specimen');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await focused(page), 'cover');
      await page.keyboard.press('ArrowUp');
      assert.equal(await focused(page), 'stamp');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page.locator('#curio-tray[data-tray="object"]').waitFor();
      assert.equal(await page.locator('[data-drawer="object"]').getAttribute('tabindex'), '0');
      await page.keyboard.press('Tab');
      assert.equal(await focused(page), 'object.magnifying-glass');
      await page.keyboard.press('ArrowRight');
      assert.equal(await focused(page), 'object.desk-lamp');
      const lamp = page.locator('.cabinet-item[data-collectible="object.desk-lamp"]');
      assert.equal(await lamp.getAttribute('data-state'), 'locked');
      assert.match(await lamp.textContent(), /Aparece depois de cinco investigações registradas/);
      // Inspect a locked item: it says how it is found.
      await page.keyboard.press('Enter');
      const dialog = page.locator('[data-specimen-dialog]');
      await dialog.locator('[data-specimen-title]', { hasText: 'Luminária de mesa' }).waitFor();
      assert.match(await dialog.locator('[data-specimen-kind]').textContent(), /ainda não encontrado/);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await focused(page), 'object.desk-lamp', 'focus returns to the compartment');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#curio-tray').count(), 0);
      assert.equal(await focused(page), 'object', 'Esc closes the drawer and focuses it');
      // Inspect a found object: museum label with date, lesson, discovery and "Colocar na mesa".
      await page.keyboard.press('Enter');
      await page.locator('.cabinet-item[data-collectible="object.globe"]').click();
      await dialog.locator('[data-specimen-title]', { hasText: 'Globo' }).waitFor();
      const facts = await dialog.locator('[data-specimen-facts]').textContent();
      assert.match(facts, /Ondas e som/);
      assert.match(facts, /O som precisa de ar para viajar\?/);
      assert.equal(await dialog.locator('a[href^="./descobertas.html?id="]').count(), 1);
      assert.equal(await dialog.locator('a[href^="./material.html?id=l-ondas"]').count(), 1);
      await settle(page);
      await axeCheck(page, '[data-specimen-dialog]', 'Gabinete: etiqueta');
      await shot(page, 'etiqueta-1440', false);
      await dialog.getByRole('button', { name: 'Colocar na mesa' }).click();
      await page.locator('[data-cabinet-status]', { hasText: 'Colocado na mesa' }).waitFor();
      assert.equal(data.discoveryState.layout.items.length, 1);
      await dialog.getByRole('button', { name: 'Fechar' }).click();
      // Specimens: discoveries as cards whose state is said in words.
      await page.locator('[data-drawer="specimen"]').click();
      const leaf = page.locator(`.curio-specimen[data-discovery="${ID(1)}"]`);
      assert.equal(await leaf.getAttribute('data-traits'), 'inked stamped bound pressed');
      assert.match(await leaf.textContent(), /Passado a tinta, carimbado, costurado com linha e flor prensada/);
      await leaf.click();
      await dialog.locator('.specimen-why-list li[data-trait="pressed"][data-reached="true"]').waitFor();
      await page.keyboard.press('Escape');
      await settle(page);
      await axeCheck(page, 'main', 'Gabinete 1440');
      await shot(page, 'gabinete-1440');
      record('Gabinete (API simulada): prateleiras mostram o que as gavetas guardam e contornos do que falta; gaveta abre com mouse e com Enter; setas entre gavetas e compartimentos; Esc fecha e devolve o foco; etiqueta de museu com data, aula e descoberta; "Colocar na mesa"; espécimes com estado em palavras; axe');

      // Reduced motion: the drawer opens instantly.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('[data-drawer="cover"]').click();
      assert.equal(await page.locator('#curio-tray').evaluate((n) => [n.dataset.opening, getComputedStyle(n).animationName].join('|')), '|none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('[data-drawer="stamp"]').click();
      assert.equal(await page.locator('#curio-tray').evaluate((n) => getComputedStyle(n).animationName), 'curio-slide', 'and slides out otherwise');
      record('Gabinete: com movimento reduzido a gaveta abre sem animação; sem ele, desliza');

      // 390: drawers stacked, the tray right under its drawer, no horizontal scroll.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base + '/gabinete.html?gaveta=object');
      await page.locator('#curio-tray').waitFor();
      const boxes = await page.locator('[data-curio-drawers] > *').evaluateAll((nodes) => nodes.map((n) => [n.dataset.drawer || n.id, Math.round(n.getBoundingClientRect().left)]));
      assert.deepEqual(boxes.map((b) => b[0]), ['stamp', 'object', 'curio-tray', 'cover', 'specimen']);
      assert.equal(new Set(boxes.map((b) => b[1])).size, 1, 'one column');
      await settle(page);
      await noHorizontalScroll(page, 'Gabinete 390');
      await axeCheck(page, 'main', 'Gabinete 390');
      await shot(page, 'gabinete-390');
      record('Gabinete 390 px: gavetas empilhadas, a gaveta aberta logo abaixo da sua frente, sem rolagem horizontal, axe');
      await context.close();
    }

    // ---------- 2. The empty cabinet and archive ------------------------------------------------
    for (const width of [1440, 390]) {
      const data = Object.assign(state(), { seedUnlocks: [] });
      const { context, page } = await openApp(browser, base, flags, data, { width, height: width < 700 ? 844 : 1000 });
      await page.goto(base + '/gabinete.html');
      await page.locator('[data-cabinet-guide]:not([hidden])').waitFor();
      assert.equal(await page.locator('[data-curio-cabinet]').getAttribute('data-fill'), 'empty');
      assert.equal(await page.locator('[data-drawer]').count(), 4, 'the structure is there');
      assert.equal(await page.locator('[data-shelf-row] [data-found="true"]').count(), 0, 'no fake items');
      assert.match(await page.locator('[data-cabinet-guide]').textContent(), /Investigar uma pergunta/);
      await page.locator('[data-drawer="specimen"]').click();
      await page.locator('.curio-empty-slot', { hasText: 'A sua primeira descoberta fica neste compartimento.' }).waitFor();
      await settle(page);
      await noHorizontalScroll(page, `Gabinete vazio ${width}`);
      await axeCheck(page, 'main', `Gabinete vazio ${width}`);
      await page.goto(base + '/descobertas.html');
      await page.locator('[data-art-slot="empty"][data-art-id="empty.discoveries"]').waitFor();
      assert(await page.locator('[data-archive-toolbar]').isHidden());
      assert(await page.locator('[data-archive-legend]').isVisible(), 'how a card grows, explained before the first one');
      await noHorizontalScroll(page, `Arquivo vazio ${width}`);
      await axeCheck(page, 'main', `Arquivo vazio ${width}`);
      await context.close();
    }
    record('Vazio (1440 e 390): o gabinete mostra a estrutura, contornos e o guia "Como encher o gabinete", sem itens falsos; o Arquivo explica como um cartão muda; axe; sem rolagem horizontal');

    // ---------- 3. The archive: evolving cards, threads, collections, milestones ---------------
    {
      const data = populated(state());
      const { context, page } = await openApp(browser, base, flags, data, { width: 1440, height: 1000 });
      await page.goto(base + '/descobertas.html');
      const card = (id) => page.locator(`[data-archive-panel="subjects"] .specimen-card[data-discovery="${id}"]`);
      await card(ID(1)).waitFor();
      assert.deepEqual(await page.locator('.archive-group-head h3').allTextContents(), ['Biologia', 'Física', 'História']);
      assert.equal(await card(ID(1)).getAttribute('data-traits'), 'inked stamped bound pressed');
      assert.equal(await card(ID(2)).getAttribute('data-traits'), 'inked stamped bound');
      assert.equal(await card(ID(3)).getAttribute('data-traits'), 'inked bound');
      assert.equal(await card(ID(4)).getAttribute('data-traits'), 'inked');
      assert.equal(await card(ID(4)).locator('.specimen-postmark, .specimen-thread, .specimen-flower').count(), 0);
      assert.equal(await card(ID(1)).locator('.specimen-postmark').count(), 1);
      // "Por que este cartão está assim": one sentence per mark, and what would add the others.
      await card(ID(4)).locator('.specimen-why > summary').click();
      const why = card(ID(4)).locator('.specimen-why-list');
      assert.match(await why.locator('[data-trait="inked"]').textContent(), /Você explicou com as suas palavras e guardou 1 evidência conferida/);
      assert.match(await why.locator('[data-trait="stamped"]').textContent(), /Recebe o carimbo quando você escreve uma reflexão/);
      await card(ID(1)).locator('.specimen-why > summary').click();
      assert.match(await card(ID(1)).locator('[data-trait="bound"]').textContent(), /Você a ligou a 2 outras descobertas\.Uma delas é de outra disciplina\./);
      assert.match(await card(ID(1)).locator('[data-trait="pressed"]').textContent(), /voltou a ela num outro dia/);
      assert.doesNotMatch(await page.locator('main').textContent(), /\b(XP|pontos|sequências?|domina|dominou|mestre)\b/i, "no points, streaks or mastery");
      // Milestones from the unlock rows, oldest first.
      const milestones = await page.locator('.archive-milestone strong').allTextContents();
      assert.equal(milestones[0], 'Primeira evidência conferida');
      assert(milestones.includes('Primeira ponte entre disciplinas'));
      await settle(page);
      await axeCheck(page, 'main', 'Arquivo 1440');
      await shot(page, 'arquivo-1440');
      // Threads: one per pair; red across subjects.
      await page.getByRole('tab', { name: 'Por disciplina' }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab', { name: 'Ligações' }).getAttribute('aria-selected'), 'true');
      const pairs = page.locator('.archive-pair');
      assert.equal(await pairs.count(), 2);
      assert.deepEqual((await pairs.evaluateAll((n) => n.map((x) => x.dataset.across))).sort(), ['false', 'true']);
      await axeCheck(page, 'main', 'Arquivo: ligações');
      // Collections (account preferences, no migration): create, add, survives a reload.
      await page.keyboard.press('ArrowRight');
      await page.getByLabel('Nova coleção').fill('Energia na natureza');
      await page.getByRole('button', { name: 'Criar a coleção' }).click();
      await page.locator('[data-discoveries-status]', { hasText: 'Coleção criada: Energia na natureza.' }).waitFor();
      const collection = page.locator('.archive-collection');
      await collection.getByLabel('Por que a folha é verde?').check();
      await collection.getByLabel('De onde vinha a energia das fábricas?').check();
      assert.equal(await collection.locator('.specimen-card').count(), 2);
      const saved = (await prefs(page)).discoveryCollections;
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].ids.sort(), [ID(1), ID(2)]);
      await page.reload();
      await page.locator('.archive-collection .specimen-card').nth(1).waitFor();
      assert.equal(await page.getByRole('tab', { name: 'Coleções' }).getAttribute('aria-selected'), 'true', 'the view is remembered');
      await settle(page);
      await axeCheck(page, 'main', 'Arquivo: coleções');
      await shot(page, 'colecoes-1440');
      record('Arquivo (API simulada): cartões por disciplina que mudam com reflexão, ligações e revisitas, cada marca com "por que"; marcos dos desbloqueios; fios entre descobertas (vermelhos entre disciplinas); coleção criada e guardada nas preferências da conta; axe');

      // The discovery page: its card, with the date of each change.
      await page.goto(`${base}/descobertas.html?id=${ID(1)}`);
      const own = page.locator('[data-discovery-card] .specimen-card');
      await own.waitFor();
      assert.equal(await own.getAttribute('data-traits'), 'inked stamped bound pressed');
      assert.equal(await own.locator('.specimen-why').getAttribute('open'), '');
      assert.equal(await own.locator('.specimen-why-list time').count(), 4);
      await axeCheck(page, 'main', 'Página da descoberta com o cartão');

      // 390.
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [url, label] of [['/descobertas.html', 'Arquivo 390'], [`/descobertas.html?id=${ID(1)}`, 'Descoberta 390'], [`/investigar.html?id=${ID(4)}&etapa=evidencias`, 'Investigação 390']]) {
        await page.goto(base + url);
        await page.locator('main .specimen-card:visible').first().waitFor();
        await settle(page);
        await noHorizontalScroll(page, label);
        await axeCheck(page, 'main', label);
      }
      await shot(page, 'investigacao-390');
      record('Página da descoberta com o cartão e as datas de cada mudança; Arquivo, descoberta e investigação (cartão do esboço) a 390 px sem rolagem horizontal; axe');
      await context.close();
    }

    // ---------- 4. Before the archive migration: no new list fields -----------------------------
    {
      const data = populated(state());
      data.archiveFieldsMissing = true;
      const { context, page } = await openApp(browser, base, flags, data);
      await page.goto(base + '/descobertas.html');
      await page.locator(`.specimen-card[data-discovery="${ID(1)}"]`).first().waitFor();
      assert.equal(await page.locator(`[data-archive-panel="subjects"] .specimen-card[data-discovery="${ID(1)}"]`).getAttribute('data-traits'), 'inked stamped bound pressed', 'counts and stamps still give the state');
      await page.getByRole('tab', { name: 'Ligações' }).click();
      await page.locator('.archive-empty-note', { hasText: 'Abra uma descoberta para ver' }).waitFor();
      await context.close();
    }
    record('Sem a migration do Arquivo (campos novos ausentes): os cartões usam as contagens e os selos; a vista de ligações pede para abrir a descoberta');
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
