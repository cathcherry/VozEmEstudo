// Runs the actual local presentation server; no route interception or remote login.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');

(async () => {
  const { createPresentationServer } = await import(
    pathToFileURL(path.resolve(__dirname, '../../scripts/presentation/server.mjs'))
  );
  const server = createPresentationServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE || chromium.executablePath(),
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [],
      remoteRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(base + '/'))
        remoteRequests.push(request.url());
    });
    const output = path.resolve(__dirname, 'artifacts/presentation');
    fs.mkdirSync(output, { recursive: true });
    for (const route of [
      'painel.html',
      'historico.html',
      'conta.html',
      'aparencia.html',
      'nova-transcricao.html',
      'ajuda.html',
    ]) {
      await page.goto(base + '/' + route);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.presentation-banner').count(), 1);
      assert.equal(await page.locator('.app-error').count(), 0);
      if (route === 'painel.html') {
        assert.match(await page.locator('main').innerText(), /Revisão ativa/);
        await page.screenshot({ path: path.join(output, 'painel.png'), fullPage: true });
      }
    }
    const materials = await page.evaluate(async () =>
      (
        await fetch('/api/materials', { headers: { Authorization: 'Bearer presentation-local' } })
      ).json(),
    );
    const material = materials[1];
    await page.goto(base + '/material.html?id=' + material.id);
    await page.waitForLoadState('networkidle');
    await page.locator('[data-confirm-transcription]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-review-state]').textContent === 'Pronto para gerar',
    );
    const textarea = page.locator('.transcription-segment textarea').first();
    await textarea.fill('Texto editado para a apresentação.');
    await page.locator('[data-save-transcription]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-transcription-revision]').textContent === '2',
    );
    assert.equal(await page.locator('[data-generate-summary]').isDisabled(), true);
    await page.locator('[data-confirm-transcription]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-review-state]').textContent === 'Pronto para gerar',
    );
    await page.locator('[data-generate-summary]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-summary-text]').textContent.includes('Texto editado'),
    );
    await page.locator('[data-more-questions-form] [type=submit]').click();
    await page.waitForSelector('.question-batch-card a');
    await page.locator('.question-batch-card a').first().click();
    await page.locator('input[name=quiz-answer]').first().check();
    await page.locator('[data-next-question]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-quiz-message]').textContent.includes('Resposta correta'),
    );
    await page.goto(base + '/conta.html');
    await page.locator('#display-name').fill('Perfil de apresentação');
    await page.locator('[data-account-form] [type=submit]').click();
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('#display-name').value === 'Perfil de apresentação',
    );
    await page.locator('[data-logout]').click();
    await page.waitForURL('**/login.html');
    await page.getByRole('button', { name: 'Entrar na demonstração' }).click();
    await page.waitForURL('**/painel.html');
    await page.goto(base + '/nova-transcricao.html');
    const wav = await (await page.request.get(base + '/presentation/tone.wav')).body();
    await page
      .locator('#audio-file')
      .setInputFiles({ name: 'teste.wav', mimeType: 'audio/wav', buffer: wav });
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
    await page.locator('[data-wizard-next]').click();
    await page.locator('#class-title').fill('Envio local de teste');
    await page.locator('#keep-original-audio').check();
    assert.equal(await page.locator('#permission-declaration').isChecked(), false);
    await page.locator('#permission-declaration').check();
    await page.locator('[data-review-upload]').click();
    await page.locator('.transcription-form [type=submit]').click();
    await page.waitForURL('**/material.html?**');
    await page.waitForSelector('.transcription-segment textarea');
    assert.match(await page.locator('.transcription-segment textarea').inputValue(), /fictício/);
    assert.equal(await page.locator('[data-audio-section]').isVisible(), true);
    assert.equal(await page.locator('[data-review-state]').innerText(), 'Aguardando confirmação');
    await page.locator('[data-focus-toggle]').click();
    assert.equal(await page.locator('[data-focus-toggle]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-focus-toggle]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/historico.html');
    await page.waitForLoadState('networkidle');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await page.screenshot({ path: path.join(output, 'biblioteca-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    console.log(
      'PASS: 6 páginas, revisão/confirmar/gerar/responder, perfil, sair/entrar, upload/conversão WAV, foco, mobile; 0 erros JS e 0 pedidos remotos.',
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
