import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// An unknown page address gets the friendly 404 page; API routes keep their JSON 404.
const appUrl = new URL('../src/app.js', import.meta.url).href;

function probe() {
  const script = `
    const { app } = await import(${JSON.stringify(appUrl)});
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const page = await fetch(base + '/pagina-que-nao-existe.html', { headers: { accept: 'text/html' } });
    const api = await fetch(base + '/api/nao-existe', { headers: { accept: 'text/html' } });
    const asset = await fetch(base + '/js/nao-existe.js', { headers: { accept: '*/*' } });
    console.log(JSON.stringify({
      page: { status: page.status, type: page.headers.get('content-type'), body: await page.text() },
      api: { status: api.status, body: await api.json().catch(() => null) },
      asset: { status: asset.status, type: asset.headers.get('content-type') },
    }));
    server.close();`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        SUPABASE_URL: 'http://127.0.0.1:9',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_flags_fixture',
        SUPABASE_SECRET_KEY: 'flags-fixture-server-key',
        MOCK_EXTERNAL_SERVICES: 'true',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
      } catch {
        reject(new Error(`exit ${code}: ${stderr || stdout}`));
      }
    });
  });
}

test('unknown pages get the friendly 404 page, API and assets keep plain 404s', async () => {
  const result = await probe();
  assert.equal(result.page.status, 404);
  assert.match(result.page.type, /text\/html/);
  assert.match(result.page.body, /Página não encontrada/);
  assert.equal(result.api.status, 404);
  assert.equal(result.api.body.error.code, 'NOT_FOUND');
  assert.equal(result.asset.status, 404);
  assert.doesNotMatch(String(result.asset.type), /text\/html/);
});
