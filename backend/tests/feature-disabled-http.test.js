import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each flag is read when the app module loads, so every configuration runs in its own process.
const appUrl = new URL('../src/app.js', import.meta.url).href;
const FLAGGED = {
  planning: '/api/planning',
  quiz_v2: '/api/quiz-sessions',
  flashcards: '/api/flashcards',
  study_tracking: '/api/study/overview',
  annotations: '/api/annotations',
  calendar: '/api/calendar',
  catalog_units: '/api/catalog',
  classrooms: '/api/classrooms',
  notebooks: '/api/notebooks/x',
  multi_lesson: '/api/multi-lesson',
  discoveries: '/api/discoveries',
};

function probe(env) {
  const script = `
    const { app } = await import(${JSON.stringify(appUrl)});
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const paths = ${JSON.stringify(Object.values(FLAGGED))}.concat(['/api/sharing/x', '/api/config']);
    const out = {};
    for (const path of paths) {
      const response = await fetch(base + path);
      out[path] = { status: response.status, body: await response.json().catch(() => null) };
    }
    console.log(JSON.stringify(out));
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
        ...env,
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

test('with every feature flag off, the flagged APIs do not exist (404, not 401) and config says so', async () => {
  const result = await probe({});
  for (const path of [...Object.values(FLAGGED), '/api/sharing/x'])
    assert.equal(result[path].status, 404, `${path} must not be mounted`);
  assert.equal(result['/api/config'].status, 200);
  for (const name of Object.keys(FLAGGED))
    assert.equal(result['/api/config'].body.featureFlags[name], false, name);
});

test('turning one flag on mounts only that API, behind authentication', async () => {
  const result = await probe({ FEATURE_PLANNING: 'true' });
  assert.equal(result['/api/planning'].status, 401, 'planning exists and needs a session');
  assert.equal(result['/api/flashcards'].status, 404, 'other tools stay off');
  assert.equal(result['/api/config'].body.featureFlags.planning, true);
});
