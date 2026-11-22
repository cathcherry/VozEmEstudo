// 3.6: the discipline emblem picker in Biblioteca ("Nova disciplina" / "Editar") and the
// Phosphor icon sprite in the app shell. Keyboard only, axe (WCAG 2.2 A/AA) on the dialog,
// emblem inferred from the folder name, a chosen emblem shown on the folder after saving.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const express = require(path.resolve(root, '../backend/node_modules/express'));
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const output = path.join(__dirname, 'artifacts');
const user = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'aluno@example.test',
  user_metadata: {},
};
const sdk = `export function createClient(){const user=${JSON.stringify(user)};return {auth:{
getSession:async()=>({data:{session:{user,access_token:'mock-token'}},error:null}),
getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
signOut:async()=>({error:null})},storage:{from:()=>({download:async()=>({data:null,error:{message:'missing'}}),upload:async()=>({error:null})})}}}`;

async function axe(page, selector, label) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(
    async (target) =>
       
      (
        await axe.run(document.querySelector(target), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        })
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    selector,
  );
  assert.deepEqual(violations, [], `${label}: axe violations`);
}

(async () => {
  const state = {
    subjects: [
      { id: 'sub-bio', name: 'Biologia', sort_order: 0 },
      { id: 'sub-x', name: 'Projeto pessoal', sort_order: 1 },
    ],
    units: [],
    materials: [],
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
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.route(base + '/js/vendor/supabase.min.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: sdk }),
    );
    await context.route('https://mock.supabase.co/**', (route) =>
      route.fulfill({ status: 404, json: {} }),
    );
    await context.route(base + '/api/**', async (route) => {
      const request = route.request();
      const p = new URL(request.url()).pathname;
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
      if (p === '/api/catalog/subjects' && method === 'POST') {
        const { name } = request.postDataJSON();
        const created = {
          id: `sub-${state.subjects.length + 1}`,
          name,
          sort_order: state.subjects.length,
        };
        state.subjects.push(created);
        return route.fulfill({ json: created });
      }
      if (p === '/api/catalog/resources') return route.fulfill({ json: {} });
      if (p === '/api/materials' && method === 'GET')
        return route.fulfill({ json: state.materials });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/historico.html');
    const folder = (name) =>
      page.locator('.library-folder-group', {
        has: page.locator('summary strong', { hasText: name }),
      });
    await folder('Biologia').waitFor();

    // Shell icons come from the Phosphor sprite, and the sprite really has each symbol.
    const shell = await page.evaluate(async () => {
      const uses = [...document.querySelectorAll('.side-navigation use, .site-header use')].map(
        (use) => use.getAttribute('href'),
      );
      const sprite = await (await fetch('/assets/icons/sprite.svg')).text();
      const missing = uses.filter((href) => !sprite.includes(`id="${href.split('#')[1]}"`));
      const legacy = document.querySelectorAll('.side-navigation svg:not(.ui-icon)').length;
      return { count: uses.length, missing, legacy };
    });
    assert(shell.count >= 8, `${shell.count} sprite icons in the shell`);
    assert.deepEqual(shell.missing, [], 'every shell icon exists in the sprite');
    assert.equal(shell.legacy, 0, 'no hand-drawn legacy icon left in the sidebar');

    // A folder never customised wears the emblem its name suggests; an unknown name stays plain.
    assert.equal(
      await folder('Biologia').locator('.library-folder-icon').getAttribute('data-emblem'),
      'emblem.biologia',
    );
    assert.equal(await folder('Projeto pessoal').locator('.folder-emblem').count(), 0);

    // Keyboard only: open "Nova disciplina", type a name, the matching emblem is preselected.
    await page.locator('[data-open-new-subject]').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[data-subject-dialog]');
    await dialog.waitFor();
    await page.keyboard.type('Química orgânica');
    const checked = () => dialog.locator('.emblem-radio:checked').getAttribute('value');
    assert.equal(await checked(), 'emblem.quimica', 'the name suggests the flask');
    const radios = await dialog.locator('.emblem-radio').count();
    assert.equal(radios, 25, 'plain folder + 24 emblems');
    // Every option has a visible name and the group is named for assistive technology.
    const names = await dialog.locator('.emblem-option .emblem-name').allTextContents();
    assert(names.includes('Química') && names.includes('Pasta simples'), 'visible names');
    assert.equal(
      (await dialog.locator('.emblem-picker legend').textContent()).trim(),
      'Emblema da pasta',
    );

    // Tab reaches the radio group (the checked radio), arrows move the choice.
    for (let i = 0; i < 6; i += 1) {
      if (await page.evaluate(() => document.activeElement?.classList.contains('emblem-radio')))
        break;
      await page.keyboard.press('Tab');
    }
    assert.equal(
      await page.evaluate(() => document.activeElement?.value),
      'emblem.quimica',
      'Tab lands on the chosen emblem',
    );
    await page.keyboard.press('ArrowRight');
    assert.equal(await checked(), 'emblem.fisica', 'ArrowRight picks the next emblem');
    const ring = await page.evaluate(
      () => getComputedStyle(document.activeElement.closest('.emblem-option')).outlineStyle,
    );
    assert.equal(ring, 'solid', 'visible focus ring on the option');
    await axe(page, '[data-subject-dialog]', 'emblem picker');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'emblem-picker.png') });

    // Typing more does not override a choice the person made.
    await dialog.locator('[name="name"]').focus();
    await page.keyboard.type(' II');
    assert.equal(await checked(), 'emblem.fisica');
    await page.keyboard.press('Enter');
    await folder('Química orgânica II').waitFor();
    assert.equal(
      await folder('Química orgânica II')
        .locator('.library-folder-icon')
        .getAttribute('data-emblem'),
      'emblem.fisica',
      'the chosen emblem is stored and shown on the new folder',
    );
    const stored = await page.evaluate(
      () => Object.entries(localStorage).find(([key]) => key.includes('catalog-icons'))?.[1] || '',
    );
    assert.match(stored, /emblem\.fisica/, 'saved in the existing catalog-icons state');
    assert.deepEqual(errors, []);
    console.log(
      'PASS Seletor de emblemas: teclado, axe, sugestão pelo nome e escolha salva; ícones do shell no sprite Phosphor',
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
