// Sons ambientes (3.5) with a simulated API: the top-bar popover mixer opens, nothing touches
// audio before a click, presets and layers, ducking under the lesson recording, one-tap resume
// after changing pages, music links (official embeds only, loaded on request), the mini-player
// window, axe on the popover and no horizontal scroll at 390px.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  record,
  axeCheck,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
  noHorizontalScroll,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'soundscape');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

/** Counts the soundscape's AudioContexts, proving none is created before a click. */
function instrumentAudio() {
  const Original = window.AudioContext;
  window.__audioContexts = 0;
  if (!Original) return;
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      // Lesson pages have their own audio (waveform); count only the soundscape engine.
      if (/soundscape-engine/.test(new Error().stack || '')) window.__audioContexts += 1;
    }
  };
}
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const mixerState = (page, value) =>
  page
    .locator(`#soundscape-popover .soundscape-mixer[data-state="${value}"]`)
    .waitFor({ state: 'attached' });

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const data = state();
    const { context, page } = await openApp(browser, base, allFlags, data, {
      width: 1440,
      height: 900,
    });
    await context.addInitScript(instrumentAudio);
    // Third-party players are never reached in tests: answer their frames locally.
    await context.route(/^https:\/\/(www\.youtube-nocookie\.com|open\.spotify\.com)\//, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><title>player</title></html>',
      }),
    );

    // ---------- Popover opens; nothing plays or even creates audio before a click ----------
    await page.goto(base + '/painel.html');
    const trigger = page.locator('[data-soundscape-trigger]');
    await trigger.waitFor();
    await settle(page);
    assert.equal(await contexts(page), 0, 'no audio before a click');
    assert.equal(await trigger.getAttribute('aria-label'), 'Sons ambientes');
    await trigger.click();
    const popover = page.locator('#soundscape-popover:not([hidden])');
    await popover.waitFor();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'soundscape-popover-title');
    const toggles = popover.locator('.soundscape-layer-toggle');
    assert.equal(await toggles.count(), 10);
    for (let i = 0; i < 10; i += 1) {
      const toggle = toggles.nth(i);
      assert(await toggle.getAttribute('title'), 'icon-only toggles have a tooltip');
      assert.equal(await toggle.getAttribute('title'), await toggle.getAttribute('aria-label'));
    }
    assert.equal(await popover.locator('.soundscape-segment').count(), 8);
    assert.equal(
      await popover.locator('input[type=checkbox][role=switch]').count(),
      0,
      'no toggle switches',
    );
    await popover.getByText('Estudo à beira-mar').click();
    assert(await popover.getByLabel('Estudo à beira-mar').isChecked());
    assert.equal(await contexts(page), 0, 'choosing a preset does not start the sound');
    await settle(page);
    await axeCheck(page, '#soundscape-popover', 'Sons ambientes › popover');
    await popover.locator('[data-soundscape-play]').click();
    await mixerState(page, 'playing');
    assert.equal(await contexts(page), 1);
    assert.equal(
      await page.evaluate(() => new Promise((r) => setTimeout(() => r(true), 300))),
      true,
    );
    await popover.locator('[data-soundscape-layer="rain"]').click();
    assert.equal(
      await popover.locator('[data-soundscape-layer="rain"]').getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await popover.getByLabel('Estudo à beira-mar').isChecked(),
      false,
      'edited mix is personal',
    );
    await popover.getByLabel('Volume da chuva').fill('80');
    await popover.getByLabel('Volume geral').fill('40');
    const saved = await page.evaluate(() =>
      JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('voz-soundscape-v1:'))[1]),
    );
    assert.equal(saved.layers.rain.volume, 0.8);
    assert.equal(saved.master, 0.4);
    assert.equal(saved.playing, true);
    await shot(page, 'popover-tocando', false);
    await page.keyboard.press('Escape');
    await popover.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.soundscapeTrigger), '');
    assert.equal(await trigger.getAttribute('data-state'), 'playing');
    record(
      'Sons ambientes: popover pelo ícone da barra; nada de áudio antes do clique; atmosferas, camadas, volumes; Esc devolve o foco; axe sem violações',
    );

    // ---------- Next page: one-tap resume; ducking under the lesson recording --------------
    await page.goto(base + '/material.html?id=l-foto');
    await page
      .locator('.app-toast:not([hidden])', { hasText: 'Seus sons ambientes estavam tocando.' })
      .waitFor();
    await settle(page);
    assert.equal(await contexts(page), 0, 'restored, not auto-played');
    assert.equal(await trigger.getAttribute('data-state'), 'resumable');
    await page.getByRole('button', { name: 'Retomar som' }).click();
    await mixerState(page, 'playing');
    await page.evaluate(() =>
      document.querySelector('audio, video')?.dispatchEvent(new Event('play')),
    );
    await mixerState(page, 'ducked');
    await page.evaluate(() =>
      document.querySelector('audio, video')?.dispatchEvent(new Event('pause')),
    );
    await mixerState(page, 'playing');
    await trigger.click();
    await page.getByLabel('Abaixar durante a aula').uncheck();
    await page.evaluate(() =>
      document.querySelector('audio, video')?.dispatchEvent(new Event('play')),
    );
    await page.waitForTimeout(150);
    await mixerState(page, 'playing');
    await page.getByLabel('Abaixar durante a aula').check();
    await mixerState(page, 'ducked');
    await page.evaluate(() =>
      document.querySelector('audio, video')?.dispatchEvent(new Event('pause')),
    );
    record(
      'Sons ambientes: na página seguinte o som é restaurado com um toque (não toca sozinho); abaixa durante a gravação da aula e a opção pode ser desligada',
    );

    // ---------- Music: strict links, official embed loaded only on request -----------------
    await page.locator('.soundscape-music summary').click();
    const url = page.getByLabel('Link de playlist, álbum ou vídeo');
    await url.fill('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Usar link' }).click();
    await page.locator('.soundscape-error', { hasText: 'Só aceitamos links' }).waitFor();
    assert.equal(await url.getAttribute('aria-invalid'), 'true');
    await url.fill('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    await page.getByRole('button', { name: 'Usar link' }).click();
    const frame = page.locator('#soundscape-popover iframe.soundscape-frame');
    await frame.waitFor();
    const src = await frame.getAttribute('src');
    assert.match(src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/videoseries\?/);
    assert.doesNotMatch(src, /autoplay=1/);
    assert.equal(await frame.getAttribute('title'), 'Player do YouTube');
    // The lesson page keeps loading its recording, so wait for the (local) frame, not idleness.
    await page.waitForFunction(() => document.querySelector('#soundscape-popover iframe')?.contentDocument !== undefined);
    await page.waitForTimeout(400);
    await axeCheck(page, '#soundscape-popover', 'Sons ambientes › música');
    await page.reload();
    await trigger.click();
    await page.locator('.soundscape-music summary').click();
    assert.equal(
      await page.locator('#soundscape-popover iframe').count(),
      0,
      'no third-party request before a click',
    );
    await page.getByRole('button', { name: 'Carregar player' }).click();
    await frame.waitFor();
    await page.getByRole('button', { name: 'Remover música' }).click();
    assert.equal(await page.locator('#soundscape-popover iframe').count(), 0);
    record(
      'Música: só links do YouTube/Spotify, player oficial (youtube-nocookie) carregado sob pedido e sem autoplay',
    );

    // ---------- Mini-player window keeps playing across pages ------------------------------
    const [mini] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('[data-soundscape-mini]').click(),
    ]);
    await mini.locator('.soundscape-mixer').waitFor();
    await page
      .locator('#soundscape-popover .soundscape-status', { hasText: /mini-player/i })
      .waitFor({ state: 'attached' });
    await mini.locator('[data-soundscape-play]').click();
    await mini.locator('.soundscape-mixer[data-state="playing"]').waitFor();
    await settle(mini);
    await axeCheck(mini, 'body', 'Mini-player');
    await page.goto(base + '/historico.html');
    await page
      .locator('[data-soundscape-trigger][data-state="playing"]')
      .waitFor({ state: 'attached' });
    assert.equal(await contexts(page), 0, 'pages do not play while the mini-player does');
    // Pausing from the page pauses the mini-player.
    await trigger.click();
    await page.locator('#soundscape-popover [data-soundscape-play]').click();
    await mini.locator('.soundscape-mixer[data-state="off"]').waitFor();
    await mini.close();
    record(
      'Mini-player: janela própria que continua tocando enquanto a aba troca de página; a página controla o mini-player',
    );
    await context.close();

    // ---------- Phone width ------------------------------------------------------------------
    const phone = await openApp(browser, base, allFlags, state(), { width: 390, height: 844 });
    await phone.context.addInitScript(instrumentAudio);
    await phone.page.goto(base + '/painel.html');
    await phone.page.locator('[data-soundscape-trigger]').click();
    const small = phone.page.locator('#soundscape-popover:not([hidden])');
    await small.waitFor();
    await settle(phone.page);
    const box = await small.boundingBox();
    assert(
      box.x >= 0 && box.x + box.width <= 390,
      `popover inside the screen (${box.x}+${box.width})`,
    );
    await noHorizontalScroll(phone.page, 'Sons ambientes 390px');
    await axeCheck(phone.page, '#soundscape-popover', 'Sons ambientes 390px');
    assert.equal(await contexts(phone.page), 0);
    await shot(phone.page, 'popover-390', false);
    await phone.context.close();
    record(
      'Sons ambientes a 390px: popover cabe na tela, sem rolagem horizontal, axe sem violações',
    );
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(
    errors.filter((e) => !/Sem simulação|404/.test(e)),
    [],
    'browser errors',
  );
  console.log('soundscape checks passed');
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
