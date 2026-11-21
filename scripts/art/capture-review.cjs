/* global document */
// Captures the art review page (pages/arte.html) into docs/art/*.png at 1x, one image per
// section, with motion off so the pictures are stable. Needs `npm ci --prefix frontend` and
// `npm ci --prefix backend` (for the static server). Usage:
//   BROWSER_EXECUTABLE=/path/to/chrome node scripts/art/capture-review.cjs
const path = require('node:path');
const fs = require('node:fs');
const { startServer, launchBrowser } = require('../../frontend/tests/support/mock-app.cjs');

const output = path.resolve(__dirname, '../../docs/art');
const SECTIONS = {
  lume: 'lume-estados-e-trajes',
  stamps: 'selos',
  objects: 'objetos',
  covers: 'capas',
  wallpapers: 'papeis-de-parede',
  empty: 'estados-vazios',
  icons: 'icones',
  hooks: 'ganchos',
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(`${base}/arte.html`);
    await page.waitForSelector('#arte[aria-busy="false"]');
    await page.waitForFunction(() =>
      [...document.images].every((img) => img.complete || img.loading === 'lazy'),
    );
    await page.screenshot({ path: path.join(output, 'arte-topo.png') });
    for (const [key, name] of Object.entries(SECTIONS)) {
      const section = page.locator(`section[aria-labelledby="sec-${key}"]`);
      await section.screenshot({ path: path.join(output, `${name}.png`) });
    }
    await page.locator('[data-surface="night"]').click();
    await page
      .locator('section[aria-labelledby="sec-stamps"]')
      .screenshot({ path: path.join(output, 'selos-fundo-noite.png') });
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`screenshots in ${path.relative(process.cwd(), output)}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
