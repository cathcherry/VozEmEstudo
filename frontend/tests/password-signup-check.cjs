// Sign-up: live password rules, weak and leaked passwords blocked before Supabase, Portuguese errors.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const express = require(path.resolve(root, '../backend/node_modules/express'));
const output = path.join(__dirname, 'artifacts');
const LEAKED = 'P@ssw0rd2024';
const sdk = `export function createClient(){return {auth:{
getSession:async()=>({data:{session:null},error:null}),
getUser:async()=>({data:{user:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
signUp:async(body)=>{await fetch('/__signup',{method:'POST',body:JSON.stringify(body)});return {data:{session:null},error:null}},
signInWithOAuth:async()=>({data:{},error:null})}}}`;
const sha1 = (value) => crypto.createHash('sha1').update(value).digest('hex').toUpperCase();

(async () => {
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
  const signups = [],
    lookups = [],
    errors = [];
  let pwnedOnline = true;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await context.route(base + '/js/vendor/supabase.min.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: sdk }),
    );
    await context.route(base + '/api/config', (route) =>
      route.fulfill({ json: { supabaseUrl: 'https://mock.supabase.co', supabasePublishableKey: 'k', oauthProviders: [] } }),
    );
    await context.route(base + '/__signup', (route) => {
      signups.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    });
    await context.route('https://api.pwnedpasswords.com/range/*', (route) => {
      const prefix = route.request().url().split('/').pop();
      lookups.push({ prefix, padding: route.request().headers()['add-padding'] });
      if (!pwnedOnline) return route.abort('internetdisconnected');
      const leaked = sha1(LEAKED);
      const body = prefix === leaked.slice(0, 5) ? `${leaked.slice(5)}:1532\r\nAAAA:0` : 'BBBB:0';
      return route.fulfill({ body, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/cadastro.html');
    const password = page.locator('#register-password');
    const rules = page.locator('#register-password-rules li');
    await rules.first().waitFor();
    assert.equal(await rules.count(), 5);
    assert.match(await password.getAttribute('aria-describedby'), /register-password-rules/);
    await password.fill('abcdefg1');
    assert.deepEqual(
      await rules.evaluateAll((items) => items.map((item) => `${item.dataset.rule}:${item.dataset.ok}`)),
      ['length:true', 'lower:true', 'upper:false', 'digit:true', 'symbol:false'],
    );
    fs.mkdirSync(output, { recursive: true });
    await page.locator('.login-box').screenshot({ path: path.join(output, 'password-rules-signup.png') });

    const submit = async (value) => {
      await page.locator('#register-email').fill('aluno@example.test');
      await password.fill(value);
      await page.locator('#register-confirm').fill(value);
      await page.locator('.login-submit').click();
    };
    // Weak: blocked locally, before any lookup or account request.
    await submit('abcdefg1');
    await page.getByText(/A senha precisa ter: uma letra maiúscula, um símbolo/).waitFor();
    assert.equal(lookups.length, 0);
    assert.equal(signups.length, 0);
    // Strong but leaked: blocked after the k-anonymity lookup (only the 5-char prefix sent).
    await submit(LEAKED);
    await page.getByText(/já apareceu em vazamentos de dados/).waitFor();
    assert.deepEqual(lookups.at(-1), { prefix: sha1(LEAKED).slice(0, 5), padding: 'true' });
    assert.equal(signups.length, 0);
    // Strong and not leaked: the account request goes out.
    await submit('Vegetação#Caatinga7');
    await page.getByText(/Solicitação recebida/).waitFor();
    assert.equal(signups.length, 1);
    assert.equal(signups[0].password, 'Vegetação#Caatinga7');
    // Lookup service down: never blocks sign-up.
    pwnedOnline = false;
    await submit('Cerrado!Ipê2026');
    await page.waitForFunction(() => document.body.textContent.includes('Solicitação recebida'));
    await page.waitForTimeout(300);
    assert.equal(signups.length, 2);
    assert.deepEqual(errors, []);

    // Recovery page carries the same rules.
    await page.goto(base + '/recuperar-senha.html');
    assert.equal(await page.locator('#new-password-rules li').count(), 5);
    // Phone width: rules wrap without horizontal scroll.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(base + '/cadastro.html');
    await page.locator('#register-password').fill('Ab1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 0, `horizontal overflow ${overflow}px`);
    console.log('PASS password rules and leaked-password check on sign-up and recovery');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
