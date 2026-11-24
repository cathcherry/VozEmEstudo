// Loads every page of the real API app with NODE_ENV=production (CSP enforced by default) and
// fails on any Content-Security-Policy violation or uncaught page error. No account: private pages
// redirect to the login, which is the state an unauthenticated visitor sees.
// Run: node frontend/tests/csp-enforce-check.cjs (BROWSER_EXECUTABLE=… to pick a Chromium).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const pages = fs.readdirSync(path.join(root, 'frontend/pages')).filter((f) => f.endsWith('.html'));

function startApi() {
  const script = `
    const { app } = await import(${JSON.stringify(path.join(root, 'backend/src/app.js'))});
    const server = app.listen(0, '127.0.0.1', () => console.log('PORT ' + server.address().port));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.join(root, 'backend'),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      SERVE_FRONTEND: 'true',
      APP_ORIGIN: 'http://127.0.0.1',
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_csp_fixture',
      SUPABASE_SECRET_KEY: 'csp-fixture-server-key',
      FEATURE_SHARING: 'true',
    },
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/PORT (\d+)/);
      if (match) resolve({ child, base: `http://127.0.0.1:${match[1]}` });
    });
    child.on('exit', (code) => reject(new Error(`API exited ${code}`)));
  });
}

(async () => {
  const { child, base } = await startApi();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || chromium.executablePath(),
    args: ['--no-sandbox'],
  });
  const problems = [];
  try {
    const context = await browser.newContext();
    // The fake Supabase host is unreachable on purpose; only CSP and script errors matter here.
    await context.route('http://127.0.0.1:9/**', (route) => route.abort());
    for (const name of pages) {
      const page = await context.newPage();
      page.on('console', (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text()))
          problems.push(`${name}: ${message.text()}`);
      });
      page.on('pageerror', (error) => {
        if (!/fetch|network|Failed to fetch|AUTH_REQUIRED/i.test(error.message))
          problems.push(`${name}: pageerror ${error.message}`);
      });
      const response = await page.goto(`${base}/${name}`, { waitUntil: 'load' });
      if (!response.headers()['content-security-policy']) problems.push(`${name}: no CSP header`);
      await page.waitForTimeout(400);
      await page.close();
      console.log(`checked ${name}`);
    }
  } finally {
    await browser.close();
    child.kill();
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`PASS CSP enforce: ${pages.length} pages without violations`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
