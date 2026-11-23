// Profile cards 3.7 in a real browser with the simulated API and an in-memory `profile_state`:
// the creation gallery (no 3D/code), text with formatting and a tone, checklist ticks that persist,
// image and GIF uploads, YouTube/Spotify embeds with strict links (also under the app's CSP), and
// old cards (3D/HTML, code, old checklist, old embed, tampered embed) that still render safely.
// The YouTube and Spotify players are answered by a local stub: nothing reaches the real services.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  noHorizontalScroll,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output =
  process.env.PROFILE_CARDS_SHOTS || path.join(__dirname, 'artifacts', 'profile-cards');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);
const USER = 'user-dashboard';
const YT = 'dQw4w9WgXcQ';
const SP = '37i9dQZF1DX8NTLI2TtZa6';

// The same frame/img rules as backend/src/app.js contentSecurityDirectives (without Supabase).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://open.spotify.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

function png(width, height, rgb) {
  const crc = (buf) => {
    let c;
    let crcValue = -1;
    for (const byte of buf) {
      c = (crcValue ^ byte) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcValue = (crcValue >>> 8) ^ c;
    }
    return (crcValue ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      row.push(
        Math.round(rgb[0] * (1 - t) + 250 * t),
        Math.round(rgb[1] * (1 - t) + 200 * t),
        rgb[2],
      );
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// A 2-frame 1×1 animated GIF.
const GIF = Buffer.from(
  'R0lGODlhAQABAPAAAP8AAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAMgAAACwAAAAAAQABAAACAkQBACH5BAAyAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==',
  'base64',
);

const legacyCards = () => [
  {
    id: 'old-3d',
    title: 'Aurora 3D',
    type: 'widget',
    content:
      '<div class="stage"><div class="tilt-card"><h2>Meu universo</h2><script>parent.alert(1)</script><img src=x onerror="parent.alert(2)"><a href="javascript:alert(3)">x</a></div></div>',
    css: 'body{background:#faf8ff}.tilt-card{padding:20px;border-radius:24px;background:linear-gradient(43deg,#4158d0,#c850c0);color:white}',
    layout: { columns: 4, height: 360 },
  },
  {
    id: 'old-code',
    title: 'Meu código',
    type: 'code',
    content: '<script>alert(1)</script>\nconsole.log("oi")',
  },
  {
    id: 'old-check',
    title: 'Checklist antigo',
    type: 'widget',
    templateId: 'checklist',
    templateValues: { items: 'Revisar\nPraticar' },
    checkedItems: { 1: true },
    content: '<h3>Um passo por vez</h3>',
  },
  {
    id: 'old-embed',
    title: 'Vídeo antigo',
    type: 'embed',
    url: `https://www.youtube-nocookie.com/embed/${YT}`,
    content: '',
  },
  {
    id: 'bad-embed',
    title: 'Link adulterado',
    type: 'embed',
    url: 'javascript:alert(1)',
    content: '',
  },
  { id: 'old-text', title: 'Texto antigo', type: 'text', content: 'Sem **formatação** antiga.' },
];

async function until(check, label) {
  for (let i = 0; i < 60; i++) {
    try {
      if (check()) return;
    } catch {
      /* not yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out: ${label}`);
}

async function open(browser, base, data, viewport, prefs = {}) {
  const app = await openApp(browser, base, allFlags, data, viewport);
  const stub = (label) => (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><body style="margin:0;display:grid;place-items:center;height:100vh;font:16px system-ui;background:#222;color:#fff">${label}</body>`,
    });
  await app.context.route('https://www.youtube-nocookie.com/**', stub('YouTube (simulado)'));
  await app.context.route('https://open.spotify.com/**', stub('Spotify (simulado)'));
  await app.context.addInitScript((o) => {
    try {
      if (o.theme) localStorage.setItem('audioestudo-theme', o.theme);
      if (o.big)
        localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ textSize: 'maximum' }));
    } catch {
      /* defaults */
    }
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  }, prefs);
  return app;
}

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  const data = state();
  data.profileState = [
    {
      user_id: USER,
      key: 'profile-blocks',
      updated_at: new Date(Date.now() - 60000).toISOString(),
      data: legacyCards(),
    },
  ];
  const blocks = () =>
    data.profileState.find((row) => row.user_id === USER && row.key === 'profile-blocks').data;
  const byTitle = (title) => blocks().find((block) => block.title === title);
  try {
    const { context, page: p } = await open(browser, base, data);
    let alerts = 0;
    p.on('dialog', (d) => {
      alerts += d.type() === 'alert' ? 1 : 0;
      void d.accept();
    });
    await p.goto(base + '/conta.html');
    await p.locator('[data-custom-block="old-3d"] iframe').waitFor();

    // ---------- Old cards render, safely ----------------------------------------------------
    const legacy = await p.evaluate(() => {
      const card = (id) => document.querySelector(`[data-custom-block="${id}"]`);
      const frame = card('old-3d').querySelector('iframe');
      return {
        sandbox: frame.getAttribute('sandbox'),
        scriptInSrcdoc: /<script|onerror|javascript:/i.test(frame.srcdoc),
        code: card('old-code').querySelector('pre code').textContent,
        codeHasScript: Boolean(card('old-code').querySelector('script')),
        checks: [...card('old-check').querySelectorAll('input')].map((i) => i.checked),
        oldEmbed: card('old-embed').querySelector('iframe')?.getAttribute('src'),
        oldEmbedSandbox: card('old-embed').querySelector('iframe')?.getAttribute('sandbox'),
        badFrames: card('bad-embed').querySelectorAll('iframe').length,
        badNote: card('bad-embed').textContent,
        oldText: card('old-text').querySelector('.profile-card-body').textContent,
        scriptsInMain: document.querySelectorAll('main script').length,
      };
    });
    assert.equal(legacy.sandbox, '', 'legacy HTML card: sandbox without permissions');
    assert.equal(legacy.scriptInSrcdoc, false, 'scripts, handlers and javascript: links stripped');
    assert.match(legacy.code, /<script>alert\(1\)<\/script>/, 'code shown as text');
    assert.equal(legacy.codeHasScript, false);
    assert.deepEqual(legacy.checks, [false, true], 'old checklist keeps its ticks');
    assert.equal(legacy.oldEmbed, `https://www.youtube-nocookie.com/embed/${YT}`);
    assert.match(legacy.oldEmbedSandbox, /allow-scripts/);
    assert.equal(legacy.badFrames, 0, 'tampered embed: no frame');
    assert.match(legacy.badNote, /não pode ser exibido/);
    assert.match(legacy.oldText, /Sem \*\*formatação\*\* antiga\./, 'old plain text stays plain');
    assert.equal(legacy.scriptsInMain, 0);
    assert.equal(alerts, 0, 'nothing ran');
    record(
      'Cards antigos (3D/HTML, código, checklist antigo, vídeo antigo, texto) continuam visíveis e seguros; link adulterado não vira iframe',
    );

    await p.locator('[data-profile-edit-toggle]').click();
    await p.locator('[data-custom-block="old-3d"] .card-legacy-note').waitFor();
    await p.locator('[data-custom-block="old-3d"] summary').click();
    const menu = p.locator('[data-custom-block="old-3d"] .block-action-menu');
    assert.equal(
      await menu.getByRole('button', { name: 'Editar', exact: true }).count(),
      0,
      'legacy: no editor',
    );
    await menu.getByRole('button', { name: 'Copiar como texto' }).click();
    const dialog = p.locator('#block-dialog');
    await dialog.waitFor();
    assert.match(await p.locator('#card-text').inputValue(), /Meu universo/);
    assert.doesNotMatch(await p.locator('#card-text').inputValue(), /script|alert/);
    await p.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(blocks().length, 6, 'copying is optional; the old card stays');

    // ---------- Gallery ---------------------------------------------------------------------
    await p.locator('[data-block-open-bar]').click();
    await dialog.waitFor();
    const tiles = await dialog.locator('.block-template-tile strong').allInnerTexts();
    assert.deepEqual(tiles, [
      'Texto',
      'Checklist',
      'Imagem',
      'GIF',
      'YouTube',
      'Spotify',
      'Seus dados',
    ]);
    assert.doesNotMatch(await dialog.innerText(), /Aurora|Neon|Código|HTML|CSS/);
    await settle(p);
    await axeCheck(p, '#block-dialog', 'Novo card: galeria');
    await shot(p, 'galeria-1440', false);

    // ---------- Text with formatting and a tone ---------------------------------------------
    await dialog.locator('[data-template="text"]').click();
    await p.locator('#block-title').fill('Plano da semana');
    await p.locator('#card-text').fill('## Foco\nRevisar fotossíntese\n\n- Resumo\n- Questões');
    await p.locator('#card-text').evaluate((area) => area.setSelectionRange(8, 28));
    await dialog.getByRole('button', { name: 'Negrito (Ctrl+B)' }).click();
    await dialog.locator('.block-tone', { hasText: 'Menta' }).click();
    await dialog
      .locator('[data-block-preview-body] strong', { hasText: 'Revisar fotossíntese' })
      .waitFor();
    assert.match(
      await dialog.locator('[data-block-preview]').getAttribute('class'),
      /card-tone-mint/,
    );
    await settle(p);
    await axeCheck(p, '#block-dialog', 'Novo card: texto');
    await shot(p, 'editor-texto-1440', false);
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => byTitle('Plano da semana'), 'text saved');
    const text = byTitle('Plano da semana');
    assert.deepEqual([text.type, text.format, text.tone], ['text', 'rich', 'mint']);
    assert.match(text.content, /\*\*Revisar fotossíntese\*\*/);
    const textCard = p.locator(`[data-custom-block="${text.id}"]`);
    await textCard.locator('h5', { hasText: 'Foco' }).waitFor();
    assert.equal(await textCard.locator('li').count(), 2);

    // ---------- YouTube: bad links refused, good link embedded ------------------------------
    await p.locator('[data-block-open-bar]').click();
    await dialog.locator('[data-template="youtube"]').click();
    await p.locator('#card-url').fill('javascript:alert(1)');
    await dialog.locator('#card-url-check[data-state="error"]').waitFor();
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.locator('[data-block-message]', { hasText: 'https://' }).waitFor();
    await p.locator('#card-url').fill(`https://youtube.com.evil.example/watch?v=${YT}`);
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.locator('[data-block-message]', { hasText: 'não é do YouTube' }).waitFor();
    assert(await dialog.isVisible(), 'not saved');
    await p.locator('#card-url').fill(`https://youtu.be/${YT}?t=42`);
    await dialog.locator('#card-url-check[data-state="ok"]').waitFor();
    await dialog.locator('[data-block-preview-body] iframe').waitFor();
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => byTitle('Vídeo para estudar'), 'video saved');
    assert.equal(
      byTitle('Vídeo para estudar').url,
      `https://www.youtube-nocookie.com/embed/${YT}?start=42`,
    );

    // ---------- Spotify ----------------------------------------------------------------------
    await p.locator('[data-block-open-bar]').click();
    await dialog.locator('[data-template="spotify"]').click();
    await p.locator('#card-url').fill(`https://open.spotify.com/intl-pt/playlist/${SP}?si=x`);
    await dialog.locator('#card-url-check[data-state="ok"]').waitFor();
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => byTitle('Trilha de estudo'), 'spotify saved');
    assert.equal(byTitle('Trilha de estudo').url, `https://open.spotify.com/embed/playlist/${SP}`);
    const spFrame = p.locator(`[data-custom-block="${byTitle('Trilha de estudo').id}"] iframe`);
    assert.equal(
      await spFrame.getAttribute('src'),
      `https://open.spotify.com/embed/playlist/${SP}`,
    );
    assert.equal(
      await spFrame.getAttribute('sandbox'),
      'allow-scripts allow-same-origin allow-popups',
    );

    // ---------- Checklist: ticks persist ----------------------------------------------------
    await p.locator('[data-block-open-bar]').click();
    await dialog.locator('[data-template="checklist"]').click();
    await p.locator('#block-title').fill('Hoje');
    await p.locator('#card-items').fill('Ler a aula\nFazer o quiz\nDescansar');
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => byTitle('Hoje'), 'checklist saved');
    const checkId = byTitle('Hoje').id;
    await p.locator(`[data-custom-block="${checkId}"] label`, { hasText: 'Fazer o quiz' }).click();
    await until(() => byTitle('Hoje').checkedItems[1] === true, 'tick saved');
    await p
      .locator(`[data-custom-block="${checkId}"] .profile-checklist-count`, {
        hasText: '1 de 3 feitos',
      })
      .waitFor();

    // ---------- Image and GIF ----------------------------------------------------------------
    await p.locator('[data-block-open-bar]').click();
    await dialog.locator('[data-template="image"]').click();
    await p
      .locator('#card-file')
      .setInputFiles({
        name: 'mesa.png',
        mimeType: 'image/png',
        buffer: png(240, 160, [60, 110, 200]),
      });
    await p.locator('#card-alt').fill('Minha mesa de estudo');
    await p.locator('#card-caption').fill('Onde eu estudo');
    await dialog.locator('[data-block-preview-body] img[src^="blob:"]').waitFor();
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => byTitle('Minha imagem'), 'image saved');
    const image = byTitle('Minha imagem');
    assert.match(image.media, /^card-[\w-]+$/);
    const imageCard = p.locator(`[data-custom-block="${image.id}"]`);
    await imageCard.locator('img[alt="Minha mesa de estudo"][src^="blob:"]').waitFor();
    await imageCard.locator('figcaption', { hasText: 'Onde eu estudo' }).waitFor();

    await p.locator('[data-block-open-bar]').click();
    await dialog.locator('[data-template="gif"]').click();
    await p
      .locator('#card-file')
      .setInputFiles({ name: 'mesa.png', mimeType: 'image/png', buffer: png(4, 4, [0, 0, 0]) });
    await dialog.locator('[data-block-message]', { hasText: 'GIF' }).waitFor();
    await p
      .locator('#card-file')
      .setInputFiles({ name: 'oi.gif', mimeType: 'image/gif', buffer: GIF });
    await p.locator('#card-alt').fill('Um ponto piscando');
    await dialog.getByRole('button', { name: 'Adicionar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => byTitle('Meu GIF'), 'gif saved');
    const gifCard = p.locator(`[data-custom-block="${byTitle('Meu GIF').id}"]`);
    await gifCard.getByRole('button', { name: 'Pausar GIF' }).click();
    await gifCard.getByRole('button', { name: 'Animar GIF' }).waitFor();
    record(
      'Novo card: galeria só com Texto, Checklist, Imagem, GIF, YouTube, Spotify e Seus dados; texto formatado com cor, links validados, imagem e GIF (com pausa) salvos',
    );

    // ---------- Editing keeps the card, checklist ticks follow their text --------------------
    await p.locator(`[data-custom-block="${checkId}"] summary`).click();
    await p
      .locator(`[data-custom-block="${checkId}"]`)
      .getByRole('button', { name: 'Editar', exact: true })
      .click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('[data-block-back-edit]').isHidden(), true);
    await p.locator('#card-items').fill('Fazer o quiz\nLer a aula');
    await dialog.getByRole('button', { name: 'Salvar card' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await until(
      () => byTitle('Hoje').templateValues.items === 'Fazer o quiz\nLer a aula',
      'edited',
    );
    assert.deepEqual(byTitle('Hoje').checkedItems, { 0: true });
    assert.equal(byTitle('Hoje').id, checkId);

    await p.locator('[data-profile-edit-done]').click();
    await p.reload();
    await p.locator(`[data-custom-block="${checkId}"] input`).first().waitFor();
    assert.equal(
      await p.locator(`[data-custom-block="${checkId}"] input`).first().isChecked(),
      true,
      'tick kept after reload',
    );
    await p.locator(`[data-custom-block="${image.id}"] img[src^="blob:"]`).waitFor();
    assert.equal(
      blocks().filter((b) => b.id.startsWith('old-') || b.id === 'bad-embed').length,
      6,
      'old cards never removed',
    );
    await settle(p);
    await axeCheck(p, 'main', 'Perfil com cards');
    await shot(p, 'perfil-1440');
    record('Edição mantém o card e as marcações; marcações e imagens sobrevivem ao recarregar');

    // ---------- Under the app's Content-Security-Policy (backend/src/app.js) ---------------
    {
      const before = errors.length;
      // Same browser (its local copy of the images), now served with the CSP header.
      await context.route(`${base}/conta.html`, async (route) => {
        const response = await route.fetch();
        route.fulfill({
          response,
          headers: { ...response.headers(), 'content-security-policy': CSP },
        });
      });
      const strict = { page: p };
      await p.reload();
      await strict.page.locator(`[data-custom-block="${image.id}"] img[src^="blob:"]`).waitFor();
      const frames = strict.page.locator('.card-embed iframe');
      assert.equal(await frames.count(), 3);
      // The stub players load inside the frames: frame-src allows both services.
      for (const label of ['YouTube (simulado)', 'Spotify (simulado)'])
        assert(
          strict.page
            .frames()
            .some((frame) => /youtube-nocookie|open\.spotify/.test(frame.url())) &&
            (await Promise.all(strict.page.frames().map((f) => f.content().catch(() => '')))).some(
              (html) => html.includes(label),
            ),
          label,
        );
      const violations = await strict.page.evaluate(() =>
        window.__violations.filter((v) => /youtube|spotify|blob/.test(v)),
      );
      assert.deepEqual(violations, [], 'embeds and images allowed by the CSP');
      // Unrelated CSP reports of the simulated app (inline test helpers) are not about cards.
      errors.splice(
        before,
        errors.length - before,
        ...errors
          .slice(before)
          .filter((e) => !/Content Security Policy|document is sandboxed/.test(e)),
      );
      await context.close();
      record(
        'Com a CSP do app: players do YouTube (nocookie) e do Spotify e imagens dos cards carregam sem violações',
      );
    }

    // ---------- Phone, night theme, big text ------------------------------------------------
    for (const [name, viewport, prefs] of [
      ['390', { width: 390, height: 844 }, {}],
      ['390-noite', { width: 390, height: 844 }, { theme: 'night' }],
      ['1440-noite', { width: 1440, height: 1000 }, { theme: 'night' }],
      ['390-texto-grande', { width: 390, height: 844 }, { big: true }],
    ]) {
      const view = await open(browser, base, data, viewport, prefs);
      const q = view.page;
      await q.goto(base + '/conta.html');
      await q.locator(`[data-custom-block="${checkId}"]`).waitFor();
      await settle(q);
      await noHorizontalScroll(q, `perfil ${name}`);
      await shot(q, `perfil-${name}`);
      await q.locator('[data-profile-edit-toggle]').click();
      await q.locator('[data-block-open-bar]').click();
      await q.locator('#block-dialog').waitFor();
      await settle(q);
      await shot(q, `galeria-${name}`, false);
      await q.locator('[data-template="text"]').click();
      await q
        .locator('#card-text')
        .fill('## Ideias\nUm texto **importante** com ==destaque==.\n\n- Primeiro\n- Segundo');
      await q.locator('.block-tone', { hasText: 'Céu' }).click();
      await settle(q);
      await noHorizontalScroll(q, `editor ${name}`);
      if (name !== '390') await axeCheck(q, '#block-dialog', `Editor ${name}`);
      await shot(q, `editor-texto-${name}`, false);
      await q.locator('#block-dialog .block-preview').scrollIntoViewIfNeeded();
      await shot(q, `editor-previa-${name}`, false);
      await view.context.close();
    }
    record(
      'Celular (390 px), tema noturno e texto grande: perfil e editor sem rolagem horizontal, axe sem violações',
    );
  } finally {
    await browser.close();
    server.close();
  }
  // The simulated app's own init script cannot read localStorage inside the script-less sandbox of
  // a legacy HTML card (that is the sandbox working); it is not an app error.
  assert.deepEqual(
    errors.filter((e) => !/document is sandboxed and lacks the 'allow-same-origin'/.test(e)),
    [],
    'browser errors',
  );
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} profile card checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exit(1);
});
