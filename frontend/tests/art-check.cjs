// Art review page (arte.html) and the companion in a real browser: every manifest entry renders,
// axe finds nothing (WCAG 2.2 A/AA) on light and dark surfaces, page hooks work, a missing id
// draws nothing, and Lume stops moving under every reduced-motion setting.
const assert = require('node:assert/strict');
const {
  errors,
  record,
  axeCheck,
  startServer,
  launchBrowser,
  noHorizontalScroll,
} = require('./support/mock-app.cjs');

async function open(browser, base, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion || 'no-preference',
  });
  if (options.prefs)
    await context.addInitScript(
      (value) => localStorage.setItem('audioestudo-ui-preferences', value),
      JSON.stringify(options.prefs),
    );
  const page = await context.newPage();
  const warnings = [];
  page.on('pageerror', (e) => errors.push(`${page.url()} ${e.stack || e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.goto(`${base}/arte.html`);
  await page.waitForSelector('#arte[aria-busy="false"]');
  await page.waitForFunction(() =>
    [...document.images].every((img) => img.complete || img.loading === 'lazy'),
  );
  return { context, page, warnings };
}

/** Running CSS animations inside companions (the entry fade is allowed to finish first). */
const companionAnimations = (page, selector = '.lume-companion') =>
  page.evaluate(async (target) => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return [...document.querySelectorAll(target)]
      .flatMap((el) => el.getAnimations({ subtree: true }))
      .filter((animation) => animation.playState === 'running').length;
  }, selector);

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    {
      const { context, page, warnings } = await open(browser, base);
      const summary = await page.evaluate(async () => {
        const { ART } = await import('/js/art/manifest.js');
        const shown = [...document.querySelectorAll('[data-review-id]')].map(
          (el) => el.dataset.reviewId,
        );
        return {
          ids: Object.keys(ART).sort(),
          shown: [...new Set(shown)].sort(),
          broken: [...document.images]
            .filter((img) => img.loading !== 'lazy' && !img.naturalWidth)
            .map((img) => img.src),
          inlineLume: document.querySelectorAll('.lume-companion svg .lume-figure').length,
          dressed: document.querySelectorAll('.lume-companion[data-outfit] .lume-outfit-slot > *')
            .length,
        };
      });
      assert.deepEqual(summary.shown, summary.ids, 'every manifest entry is on the review page');
      assert.deepEqual(summary.broken, [], 'every image loads');
      assert(summary.inlineLume >= 21, `${summary.inlineLume} inline companions`);
      assert(summary.dressed > 0, 'outfits are layered into the slots');
      await axeCheck(page, 'body', 'arte.html (papel)');
      await page.locator('[data-surface="night"]').click();
      await axeCheck(page, 'body', 'arte.html (noite)');
      record(
        `Revisão de arte: ${summary.ids.length} peças do manifesto carregadas; axe sem violações no papel e na noite`,
      );

      assert(
        (await companionAnimations(page, '[data-lume-state="idle"] .lume-companion')) > 0,
        'idle moves',
      );
      assert.equal(
        await companionAnimations(page, '[data-lume-state="reading"] .lume-companion'),
        0,
        'nothing moves while reading',
      );
      await page.locator('[data-motion-choice="off"]').click();
      assert.equal(await companionAnimations(page), 0, 'motion off in the page');
      record('Lume se mexe em repouso, fica parada lendo, e para com "Movimento desligado"');

      // Page hooks: the state follows data-art-state; a missing id draws nothing and warns.
      await page.locator('[data-slot-state="thinking"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-review-slot="companion"] .lume-companion')?.dataset
            .state === 'thinking',
      );
      assert.equal(await page.locator('[data-review-slot="missing"] > *').count(), 0);
      assert(
        warnings.some((text) => text.includes('empty.does-not-exist')),
        'missing id warns in dev',
      );
      const states = await page.evaluate(async () => {
        const art = await import('/js/art/art.js');
        if (art.renderArt('object.nope') !== null) return ['a missing id rendered something'];
        await art.setCompanionState('celebrating');
        return [
          ...new Set(
            [...document.querySelectorAll('.lume-companion')].map((el) => el.dataset.state),
          ),
        ];
      });
      assert.deepEqual(states, ['celebrating']);
      await page.evaluate(() => {
        document.documentElement.dataset.experience = 'quiet';
      });
      assert.equal(
        await page
          .locator('[data-review-slot="companion"]')
          .evaluate((el) => getComputedStyle(el).display),
        'none',
        'Lume is hidden in "Estudo silencioso"',
      );
      record(
        'Ganchos data-art-slot: estado por atributo, setCompanionState, id inexistente sem desenho, Lume some no Estudo silencioso',
      );
      await context.close();
    }
    {
      const { context, page } = await open(browser, base, { reducedMotion: 'reduce' });
      assert.equal(await companionAnimations(page), 0, 'prefers-reduced-motion');
      await context.close();
    }
    for (const prefs of [{ reducedMotion: true }, { lowStimulation: true }]) {
      const { context, page } = await open(browser, base, { prefs });
      assert.equal(await companionAnimations(page), 0, `app setting ${JSON.stringify(prefs)}`);
      await context.close();
    }
    record(
      'Lume parada com prefers-reduced-motion, "Reduzir animações" e "Baixa estimulação" do app',
    );
    {
      const { context, page } = await open(browser, base, {
        viewport: { width: 390, height: 844 },
      });
      await noHorizontalScroll(page, 'arte.html (390 px)');
      await axeCheck(page, 'body', 'arte.html (390 px)');
      await context.close();
    }
    record('Revisão de arte em 390 px: sem rolagem horizontal e sem violações do axe');
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  console.log('art checks passed');
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
