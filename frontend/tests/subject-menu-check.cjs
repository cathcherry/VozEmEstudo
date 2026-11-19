// Library subject folders: discreet "⋯" menu with Editar and Remover (catalog_units on).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const express = require(path.resolve(root, '../backend/node_modules/express'));
const output = path.join(__dirname, 'artifacts');
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'aluno@example.test', user_metadata: {} };
const sdk = `export function createClient(){const user=${JSON.stringify(user)};return {auth:{
getSession:async()=>({data:{session:{user,access_token:'mock-token'}},error:null}),
getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
signOut:async()=>({error:null})},storage:{from:()=>({download:async()=>({data:null,error:{message:'missing'}}),upload:async()=>({error:null})})}}}`;

const GEO = '11111111-1111-4111-8111-111111111111';
const HIS = '22222222-2222-4222-8222-222222222222';
const UNIT = '33333333-3333-4333-8333-333333333333';
const material = (id, title, subjectId, subject, unitId = null) => ({
  id, title, subject, subject_id: subjectId, unit_id: unitId, status: 'CONCLUIDO',
  current_stage: 'completed', created_at: '2026-11-19T10:00:00Z', updated_at: '2026-11-19T10:00:00Z',
  audio_files: [{ duration_ms: 600000, extension: 'mp3' }],
});

(async () => {
  const state = {
    subjects: [
      { id: GEO, name: 'Geografia', sort_order: 0 },
      { id: HIS, name: 'História', sort_order: 0 },
    ],
    units: [{ id: UNIT, subject_id: GEO, title: 'Vegetação', sort_order: 0 }],
    materials: [
      material('m1', 'Formações vegetais', GEO, 'Geografia', UNIT),
      material('m2', 'Clima e relevo', GEO, 'Geografia'),
      material('m3', 'Revolução Francesa', HIS, 'História'),
    ],
    calls: [],
  };
  const app = express();
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.use('/js', express.static(path.join(root, 'js')));
  app.use('/css', express.static(path.join(root, 'css')));
  app.use(express.static(path.join(root, 'pages')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || chromium.executablePath(),
    args: ['--no-sandbox'],
  });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await context.route(base + '/js/vendor/supabase.min.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: sdk }),
    );
    await context.route('https://mock.supabase.co/**', (route) => route.fulfill({ status: 404, json: {} }));
    await context.route(base + '/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const p = url.pathname;
      const method = request.method();
      if (p === '/api/config')
        return route.fulfill({
          json: {
            supabaseUrl: 'https://mock.supabase.co',
            supabasePublishableKey: 'mock-publishable-key',
            audioBucket: 'audios',
            featureFlags: { catalog_units: true },
          },
        });
      if (p === '/api/catalog' && method === 'GET')
        return route.fulfill({ json: { subjects: state.subjects, units: state.units } });
      if (p === '/api/catalog/resources') return route.fulfill({ json: {} });
      const subject = p.match(/^\/api\/catalog\/subjects\/([^/]+)$/);
      if (subject && method === 'PATCH') {
        const { name } = request.postDataJSON();
        state.calls.push(['PATCH', subject[1], name]);
        const entry = state.subjects.find((item) => item.id === subject[1]);
        entry.name = name;
        return route.fulfill({ json: entry });
      }
      if (subject && method === 'DELETE') {
        state.calls.push(['DELETE', subject[1]]);
        return route.fulfill({ json: { id: subject[1], unassignedMaterials: 2, deletedUnits: 1 } });
      }
      if (p === '/api/materials' && method === 'GET') return route.fulfill({ json: state.materials });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/historico.html');
    const geoCard = page.locator('.library-folder-group', { has: page.locator('summary strong', { hasText: 'Geografia' }) });
    await geoCard.waitFor();
    const trigger = geoCard.getByRole('button', { name: 'Opções da disciplina Geografia' }).or(
      geoCard.locator('summary[aria-label="Opções da disciplina Geografia"]'),
    );
    await trigger.waitFor();
    // Discreet: dimmed until hover, no larger than the card's corner.
    const box = await trigger.boundingBox();
    assert(box.width <= 34 && box.height <= 34, `menu trigger ${box.width}x${box.height}`);
    const cardBox = await geoCard.boundingBox();
    assert(box.x > cardBox.x + cardBox.width - 60 && box.y < cardBox.y + 30, 'trigger sits in the top-right corner');
    // Opening the menu must not navigate into the folder.
    await trigger.click();
    assert.equal(new URL(page.url()).searchParams.get('folder'), null);
    const menu = geoCard.locator('.subject-menu .row-menu-content');
    assert.deepEqual(
      (await menu.locator('button').allTextContents()).map((text) => text.trim()),
      ['Editar', 'Remover'],
    );
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'subject-menu-open.png') });
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false, 'Escape closes the menu');

    // Editar: same dialog, prefilled, saves the new name everywhere on the page.
    await trigger.click();
    await menu.getByRole('button', { name: 'Editar' }).click();
    const dialog = page.locator('[data-subject-dialog]');
    await dialog.waitFor();
    assert.equal(await dialog.locator('h2').textContent(), 'Editar disciplina');
    assert.equal(await dialog.locator('[name="name"]').inputValue(), 'Geografia');
    assert.equal((await dialog.locator('[type="submit"]').textContent()).trim(), 'Salvar');
    await dialog.locator('[name="name"]').fill('Geografia do Brasil');
    await dialog.locator('[type="submit"]').click();
    await page.locator('.library-folder-group summary strong', { hasText: 'Geografia do Brasil' }).waitFor();
    assert.deepEqual(state.calls.at(-1), ['PATCH', GEO, 'Geografia do Brasil']);
    assert.equal(await dialog.isVisible(), false);
    // "Nova disciplina" still opens the create mode afterwards.
    await page.locator('[data-open-new-subject]').click();
    assert.equal(await dialog.locator('h2').textContent(), 'Nova disciplina');
    assert.equal(await dialog.locator('[name="name"]').inputValue(), '');
    await dialog.locator('.dialog-close').click();

    // Remover: confirmation explains the lessons are kept; cancelling changes nothing.
    const geo = page.locator('.library-folder-group', { has: page.locator('summary strong', { hasText: 'Geografia do Brasil' }) });
    const messages = [];
    page.once('dialog', (confirm) => { messages.push(confirm.message()); return confirm.dismiss(); });
    await geo.locator('.subject-menu > summary').click();
    await geo.locator('.subject-menu').getByRole('button', { name: 'Remover' }).click();
    assert.match(messages[0], /Remover a disciplina “Geografia do Brasil”\?/);
    assert.match(messages[0], /2 aulas não serão apagadas: elas vão para “Sem disciplina”/);
    assert.match(messages[0], /A unidade desta disciplina também será removida/);
    assert.equal(state.calls.filter((call) => call[0] === 'DELETE').length, 0);
    page.once('dialog', (confirm) => confirm.accept());
    await geo.locator('.subject-menu > summary').click();
    await geo.locator('.subject-menu').getByRole('button', { name: 'Remover' }).click();
    await page.locator('.library-folder-group summary strong', { hasText: 'Sem disciplina' }).waitFor();
    assert.equal(await page.locator('.library-folder-group summary strong', { hasText: 'Geografia do Brasil' }).count(), 0);
    assert.deepEqual(state.calls.at(-1), ['DELETE', GEO]);
    assert.match(await page.locator('[data-library-view-status]').textContent(), /2 aulas foram para “Sem disciplina”/);
    // The lessons are still listed; "Sem disciplina" is not a real subject and has no menu.
    const loose = page.locator('.library-folder-group', { has: page.locator('summary strong', { hasText: 'Sem disciplina' }) });
    assert.match(await loose.textContent(), /2 aulas/);
    assert.equal(await loose.locator('.subject-menu').count(), 0);

    // Folder page: the menu sits in the toolbar next to the breadcrumb.
    await page.locator('.library-folder-group summary', { hasText: 'História' }).click();
    await page.waitForURL(/folder=/);
    const toolbarMenu = page.locator('[data-library-folder-toolbar] .subject-menu');
    await toolbarMenu.waitFor();
    assert.equal(await page.locator('.subject-menu').count(), 1);
    await toolbarMenu.locator('summary').click();
    await page.screenshot({ path: path.join(output, 'subject-menu-folder-page.png') });

    // Phone width: no horizontal scroll, menu still reachable.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/historico.html');
    await page.locator('.library-folder-group .subject-menu > summary').first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 0, `horizontal overflow ${overflow}px`);
    const open = await page.locator('.subject-menu[open] .row-menu-content').boundingBox();
    assert(open.x >= 0 && open.x + open.width <= 390, 'menu stays on screen');
    await page.screenshot({ path: path.join(output, 'subject-menu-phone.png') });
    assert.deepEqual(errors, []);
    console.log('PASS subject menu: Editar/Remover, confirmation, folder page, phone');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
