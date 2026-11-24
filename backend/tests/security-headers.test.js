import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cspMode, trustProxy, productionConfigWarnings } from '../src/config/env.js';
import { contentSecurityDirectives } from '../src/app.js';
import { limitPerAddress } from '../src/middleware/public-rate-limit.middleware.js';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';
import { redact } from '../src/utils/logger.js';

const appUrl = new URL('../src/app.js', import.meta.url).href;

/** Starts the real app in a child process with `env` and runs `body` (module code) against it. */
function probe(env, body) {
  const script = `
    const { app } = await import(${JSON.stringify(appUrl)});
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
    server.close();`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        PATH: process.env.PATH,
        SUPABASE_URL: 'http://127.0.0.1:9',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_headers_fixture',
        SUPABASE_SECRET_KEY: 'headers-fixture-server-key',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `exit ${code}`));
      resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
    });
  });
}

test('CSP mode: explicit values win; unset means enforce in production, off elsewhere', () => {
  assert.equal(cspMode(undefined, 'production'), 'enforce');
  assert.equal(cspMode('bogus', 'production'), 'enforce');
  assert.equal(cspMode('off', 'production'), 'off');
  assert.equal(cspMode('report-only', 'production'), 'report-only');
  assert.equal(cspMode(undefined, 'development'), 'off');
  assert.equal(cspMode('enforce', 'test'), 'enforce');
});

test('CSP lets the page reach Supabase and the HIBP range API, nothing else', () => {
  const directives = contentSecurityDirectives('https://example.supabase.co');
  assert.deepEqual(directives.connectSrc, [
    "'self'",
    'https://example.supabase.co',
    'wss://example.supabase.co',
    'https://api.pwnedpasswords.com',
  ]);
  assert.deepEqual(directives.scriptSrc, ["'self'"]);
  assert.deepEqual(directives.objectSrc, ["'none'"]);
});

test('trust proxy parsing accepts only true or a positive hop count', () => {
  assert.equal(trustProxy(undefined), false);
  assert.equal(trustProxy('false'), false);
  assert.equal(trustProxy('0'), false);
  assert.equal(trustProxy('abc'), false);
  assert.equal(trustProxy('true'), true);
  assert.equal(trustProxy('1'), 1);
});

test('production warnings flag mock services, CSP off and a non-https origin', () => {
  assert.deepEqual(
    productionConfigWarnings({ nodeEnv: 'development', mockExternalServices: true }),
    [],
  );
  const warnings = productionConfigWarnings({
    nodeEnv: 'production',
    mockExternalServices: true,
    contentSecurityPolicy: 'off',
    appOrigin: 'http://localhost:3000',
    mockAsrSegmentsFile: '',
  });
  assert.equal(warnings.length, 4);
  assert.deepEqual(
    productionConfigWarnings({
      nodeEnv: 'production',
      mockExternalServices: false,
      contentSecurityPolicy: 'enforce',
      appOrigin: 'https://voz.example.org',
      mockAsrSegmentsFile: '',
    }),
    [],
  );
});

test('public share limit counts per address and answers 429 with Retry-After', () => {
  let time = 0;
  const limit = limitPerAddress({ max: 2, windowMs: 60000, now: () => time });
  const call = (ip) => {
    const headers = {};
    let failure = null;
    limit({ ip }, { set: (k, v) => (headers[k] = v) }, (error) => (failure = error || null));
    return { failure, headers };
  };
  assert.equal(call('1.1.1.1').failure, null);
  assert.equal(call('1.1.1.1').failure, null);
  const third = call('1.1.1.1');
  assert.equal(third.failure.status, 429);
  assert.equal(third.headers['Retry-After'], '60');
  assert.equal(call('2.2.2.2').failure, null);
  time = 60001;
  assert.equal(call('1.1.1.1').failure, null);
  assert.equal(
    limitPerAddress({ max: 0, windowMs: 1 })({}, {}, (e) => e),
    undefined,
  );
});

test('request ids from the client are kept only when short and plain', () => {
  const run = (value) => {
    const req = { get: () => value };
    const headers = {};
    requestIdMiddleware(req, { setHeader: (k, v) => (headers[k] = v) }, () => {});
    return req.requestId;
  };
  assert.equal(run('abc-123'), 'abc-123');
  assert.match(run('x'.repeat(65)), /^[0-9a-f-]{36}$/);
  assert.match(run('a"}\n{"level":"forged'), /^[0-9a-f-]{36}$/);
  assert.match(run(undefined), /^[0-9a-f-]{36}$/);
});

test('logger redacts tokens, keys, passwords and e-mails but keeps usage counters', () => {
  const out = redact({
    accessToken: 'eyJ.fake.jwt',
    authorization: 'Bearer x',
    password: 'p',
    apiKey: 'k',
    email: 'pessoa@example.test',
    nested: { refresh_token: 'r', signedUrl: 'https://x/sign?token=1', ok: 1 },
    promptTokens: 812,
    totalTokens: 1052,
    long: 'a'.repeat(600),
    error: Object.assign(new Error('select * from secret_table'), { code: '42P01' }),
  });
  for (const key of ['accessToken', 'authorization', 'password', 'apiKey', 'email'])
    assert.equal(out[key], '[REDACTED]', key);
  assert.equal(out.nested.refresh_token, '[REDACTED]');
  assert.equal(out.nested.signedUrl, '[REDACTED]');
  assert.equal(out.nested.ok, 1);
  assert.equal(out.promptTokens, 812);
  assert.equal(out.totalTokens, 1052);
  assert(out.long.length < 520);
  assert.deepEqual(out.error, { name: 'Error', code: '42P01' });
});

test('production app: CSP enforced by default, safe request id, public share endpoint capped', async () => {
  const result = await probe(
    {
      NODE_ENV: 'production',
      FEATURE_SHARING: 'true',
      RATE_LIMIT_PUBLIC_SHARES_PER_MINUTE: '2',
    },
    `
    const health = await fetch(base + '/api/health', { headers: { 'x-request-id': 'bad id with spaces' } });
    out.csp = health.headers.get('content-security-policy');
    out.cspReportOnly = health.headers.get('content-security-policy-report-only');
    out.requestId = health.headers.get('x-request-id');
    out.frameOptions = health.headers.get('x-frame-options');
    out.nosniff = health.headers.get('x-content-type-options');
    out.poweredBy = health.headers.get('x-powered-by');
    out.share = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(base + '/api/shared-material', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-token' }),
      });
      out.share.push(r.status);
    }
    `,
  );
  assert.match(result.csp, /default-src 'self'/);
  assert.match(result.csp, /script-src 'self'/);
  assert.match(result.csp, /frame-ancestors 'self'/);
  assert.match(result.csp, /https:\/\/api\.pwnedpasswords\.com/);
  assert.equal(result.cspReportOnly, null);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(result.frameOptions, 'SAMEORIGIN');
  assert.equal(result.nosniff, 'nosniff');
  assert.equal(result.poweredBy, null);
  // Two malformed tokens are rejected by validation; the third request is refused by the limit.
  assert.deepEqual(result.share, [400, 400, 429]);
});

test('development app keeps CSP off unless configured', async () => {
  const result = await probe(
    { NODE_ENV: 'development' },
    `const r = await fetch(base + '/api/health'); out.csp = r.headers.get('content-security-policy');`,
  );
  assert.equal(result.csp, null);
});

test('media uploads in flight are bounded and the slot is released when the response ends', async () => {
  const { limitInflight } = await import('../src/routes/media.routes.js');
  const { EventEmitter } = await import('node:events');
  const limit = limitInflight(2);
  const response = () => Object.assign(new EventEmitter(), { set() {} });
  const call = (res) => {
    let result = 'pending';
    limit({}, res, (error) => (result = error ? error.status : 'ok'));
    return result;
  };
  const first = response();
  assert.equal(call(first), 'ok');
  assert.equal(call(response()), 'ok');
  assert.equal(call(response()), 429);
  first.emit('finish');
  first.emit('close');
  assert.equal(call(response()), 'ok');
  assert.equal(call(response()), 429);
});
