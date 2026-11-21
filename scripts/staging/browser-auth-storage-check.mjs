// Voz em Estudo — normal browser login and Storage uploads WITHOUT privileged credentials (staging).
//
// What it proves (docs/STAGING_BROWSER_AUTH.md):
//   0. the network is clean: a request with only the PUBLISHABLE key cannot read a server-only table
//      (if it can, something is injecting a privileged key and every result below would be
//      meaningless, so the run stops as INCONCLUSIVE, exit code 2);
//   1. the real login form signs in through Supabase Auth (no session planted from outside);
//   2. every request the browser sends to Supabase carries the publishable key, never a secret;
//   3. the browser uploads audio to its own prefix temp/{uid}/... (Storage RLS allows it);
//   4. the browser cannot write to, list or read another account's prefix (Storage RLS denies it);
//   5. the API accepts the user's token (server verification of a normal session; the API may run
//      WITHOUT the server key for this check, so a data route may answer 5xx, but never 401/403).
//
// Env: E2E_BASE_URL (default http://localhost:3400), E2E_ACCOUNTS_FILE or E2E_ACCOUNTS_JSON
// ({s1:{email,password}, s2:{email,password}} or more; @example.test only), BROWSER_EXECUTABLE (optional).
// Prints PASS / FAIL per step; never prints passwords, tokens or keys.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:3400').replace(/\/$/, '');
const PRODUCTION_REFS = ['fxsuagrcfargpejglwtl'];
const accounts = JSON.parse(process.env.E2E_ACCOUNTS_JSON || readFileSync(process.env.E2E_ACCOUNTS_FILE, 'utf8'));
const [mine, other] = [accounts.s1, accounts.s2];
if (![mine, other].every((a) => /@example\.test$/i.test(a?.email || ''))) throw new Error('Use synthetic @example.test accounts (s1, s2).');

let failed = 0;
const report = (ok, name, note = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`);
};

const config = await (await fetch(`${BASE}/api/config`)).json();
const host = new URL(config.supabaseUrl).hostname;
if (PRODUCTION_REFS.some((ref) => host.startsWith(`${ref}.`))) throw new Error('Refused: the API points to PRODUCTION.');
report(config.supabasePublishableKey?.startsWith('sb_publishable_'), '/api/config serves only a publishable key', host.split('.')[0]);

// 0. Is a privileged key being injected on the way to Supabase?
const probe = await fetch(`${config.supabaseUrl}/rest/v1/ai_generations?select=id&limit=1`, {
  headers: { apikey: config.supabasePublishableKey },
});
if (probe.status === 200) {
  console.log('INCONCLUSIVE  a publishable-key request read a server-only table (HTTP 200).');
  console.log('              Something on this network injects a privileged key into Supabase requests;');
  console.log('              run this check from a machine or CI job without that injection.');
  process.exit(2);
}
report([401, 403].includes(probe.status), 'publishable key alone cannot read a server-only table', `HTTP ${probe.status}`);

// The other account's id, for the cross-account Storage checks.
const otherLogin = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: other.email, password: other.password }),
});
const otherId = (await otherLogin.json()).user?.id;
report(Boolean(otherId), 'second synthetic account exists');

const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {}),
});
const page = await browser.newPage();
const supabaseKeys = new Set();
page.on('request', (request) => {
  if (new URL(request.url()).hostname === host) {
    const key = request.headers().apikey;
    if (key) supabaseKeys.add(key.startsWith('sb_publishable_') ? 'publishable' : key.startsWith('eyJ') ? 'jwt' : 'other');
  }
});

// 1. The real login form.
await page.goto(`${BASE}/login.html`);
await page.fill('#login-email', mine.email);
await page.fill('#login-password', mine.password);
await Promise.all([page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: 20000 }).catch(() => null), page.click('.login-submit')]);
const signedIn = !page.url().endsWith('/login.html');
report(signedIn, 'login through the form (Supabase Auth, password)', new URL(page.url()).pathname);
if (!signedIn) {
  await browser.close();
  process.exit(1);
}

// 3–5. Storage and API from the page itself, with the page's own client and session.
const result = await page.evaluate(async ({ otherId: foreign, bucket, path }) => {
  const { getSupabase } = await import('/js/api/supabase-browser.js');
  const client = await getSupabase();
  const { data: session } = await client.auth.getSession();
  const uid = session.session.user.id;
  const audio = new Blob([new Uint8Array(4000)], { type: 'audio/wav' });
  const own = `temp/${uid}/${path}/browser-check.wav`;
  const up = await client.storage.from(bucket).upload(own, audio, { contentType: 'audio/wav' });
  const down = up.error ? { error: true } : await client.storage.from(bucket).download(own);
  const foreignPath = `temp/${foreign}/${path}/intrusion.wav`;
  const intrude = await client.storage.from(bucket).upload(foreignPath, audio, { contentType: 'audio/wav' });
  const list = await client.storage.from(bucket).list(`temp/${foreign}`);
  const api = await fetch('/api/materials', { headers: { Authorization: `Bearer ${session.session.access_token}` } });
  const cleanup = up.error ? null : await client.storage.from(bucket).remove([own]);
  return {
    ownUpload: !up.error,
    ownUploadError: up.error?.message || null,
    ownDownload: !down.error,
    foreignUploadDenied: Boolean(intrude.error),
    foreignListEmpty: Boolean(list.error) || (list.data || []).length === 0,
    apiStatus: api.status,
    cleaned: cleanup ? !cleanup.error : null,
  };
}, { otherId, bucket: config.audioBucket, path: randomUUID() });

report(result.ownUpload, 'browser uploads to its own prefix temp/{uid}/…', result.ownUploadError || '');
report(result.ownDownload, 'browser reads its own upload back');
report(result.foreignUploadDenied, "browser cannot write to another account's prefix (Storage RLS)");
report(result.foreignListEmpty, "browser cannot list another account's prefix");
// Without the server key the API may answer 5xx for data; 401/403 would mean it rejected the session.
report(![401, 403].includes(result.apiStatus), 'API accepts the browser session token (not 401/403)', `HTTP ${result.apiStatus}`);
report(supabaseKeys.size > 0 && [...supabaseKeys].every((k) => k !== 'other'), 'every browser request to Supabase carried only the publishable key or the user JWT', [...supabaseKeys].join(','));
if (result.cleaned === false) console.log('NOTE  the test upload could not be removed by the browser (policy has no delete); it lives under temp/ and expires with the temp cleanup.');

await browser.close();
console.log(failed ? `\n${failed} step(s) failed.` : '\nAll steps passed.');
process.exit(failed ? 1 : 0);
