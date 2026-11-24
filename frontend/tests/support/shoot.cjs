// Ad-hoc visual review helper: node tests/support/shoot.cjs <outdir> <path>[@width][#theme] ...
// Serves the static front end with the simulated API (all flags on) and saves full-page shots.
const path = require('node:path');
const fs = require('node:fs');
const m = require('./mock-app.cjs');
(async () => {
  const [out, ...targets] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const { server, base } = await m.startServer();
  const browser = await m.launchBrowser();
  const flags = {
    ...m.allFlags,
    flashcards_v3: true,
    multi_lesson: true,
    discoveries: true,
    journal: true,
  };
  try {
    for (const t of targets) {
      const [, p, w = '1440', theme = ''] = t.match(/^([^@#]+)(?:@(\d+))?(?:#(.+))?$/);
      const data = m.state();
      // `#tester` / `#admin`: the public testing program on, with that account policy.
      const policy = theme.split(',').find((x) => x === 'tester' || x === 'admin');
      if (policy) data.testing = require('./mock-testing.cjs').testingState(policy);
      const { context, page } = await m.openApp(browser, base, { ...flags, public_testing: Boolean(policy) }, data, {
        width: +w,
        height: 900,
      });
      const opts = theme.split(',');
      await context.addInitScript((o) => {
        try {
          for (const x of o) {
            if (x === 'tester' || x === 'admin') continue;
            if (x === 'out') localStorage.setItem('mock-signed-out', '1');
            else if (x === 'big')
              localStorage.setItem(
                'audioestudo-ui-preferences',
                JSON.stringify({ textSize: 'maximum' }),
              );
            else if (x) localStorage.setItem('audioestudo-theme', x);
          }
        } catch {
          // storage blocked: shoot with defaults
        }
      }, opts);
      await page.goto(base + p);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(900);
      const name = `${p.replace(/[^a-z0-9]+/gi, '_')}-${w}${theme ? '-' + theme : ''}`;
      await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
      console.log('shot', name);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    if (m.errors.length) console.log('ERRORS\n' + m.errors.slice(0, 20).join('\n'));
  }
})();
