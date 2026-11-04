import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const read = p => readFileSync(resolve(root,p), 'utf8');
test('Windows launcher starts the persistent Supabase API and worker', () => {
  const main = read('INICIAR.cmd');
  assert.match(main, /node scripts\\full\\start\.mjs/);
  assert.match(main, /backend\\\.env/);
  assert.doesNotMatch(main, /presentation\\server|live\\server/);

  const unified = read('scripts/full/start.mjs');
  assert.match(unified, /src\/server\.js/);
  assert.match(unified, /src\/worker\.js/);
  assert.doesNotMatch(unified, /presentation\/server|live\/server/);
});
test('runtime verifies E02 and audio bucket before starting workers', () => {
  const checker=read('backend/src/diagnostics/check-runtime.js');
  for (const target of ['material_permissions', 'transcription_confirmations','content_warnings','current_permission_version','getBucket'])
    assert.ok(checker.includes(target));
  assert.doesNotMatch(checker, /\.insert\(|\.update\(|\.delete\(/);
});
test('actual frontend does not contain demo banner', () => {
  for(const page of ['painel.html','nova-transcricao.html','material.html']) {
    const html=read(`frontend/pages/${page}`);
    assert.doesNotMatch(html,/Login e biblioteca temporários|IA REAL · transcrição/);
  }
});
