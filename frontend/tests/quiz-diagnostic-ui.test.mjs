import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const panel = readFileSync(resolve(dir, 'js/pages/quiz-diagnostic-panel.js'), 'utf8');
const quiz = readFileSync(resolve(dir, 'js/pages/quiz-v2.page.js'), 'utf8');
const api = readFileSync(resolve(dir, 'js/api/quiz-session.api.js'), 'utf8');

test('diagnostic is requested only for completed attempts and never computed in the browser', () => {
  assert.match(panel, /session\.status !== 'completed'/);
  assert.match(panel, /loadDiagnostic\(session\.id\)/);
  assert.match(panel, /fetcher = getQuizDiagnostic/);
  assert.match(panel, /diagnostic\.interpretation/);
  assert.match(quiz, /renderQuizDiagnosticPanel/);
  assert.doesNotMatch(panel, /innerHTML/);
});

test('review action is gated and uses a source session, not client-supplied wrong IDs', () => {
  assert.match(panel, /isFeatureEnabled\('quiz_review'\)/);
  assert.match(panel, /createQuizReviewSession\(session\.id, 'deferred'\)/);
  assert.match(api, /\/diagnostic/);
  assert.match(api, /\/review/);
  assert.doesNotMatch(panel, /correctIndex.*fetch/);
});

test('a completed attempt is diagnosed once per page; a failure is retried', async () => {
  const { loadDiagnostic } = await import('../js/pages/quiz-diagnostic-panel.js');
  let calls = 0;
  const fetcher = async (id) => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return { sessionId: id };
  };
  await assert.rejects(loadDiagnostic('s-1', fetcher));
  assert.equal((await loadDiagnostic('s-1', fetcher)).sessionId, 's-1');
  await loadDiagnostic('s-1', fetcher);
  assert.equal(calls, 2, 'cached after success, not after failure');
  assert.equal((await loadDiagnostic('s-2', fetcher)).sessionId, 's-2', 'per attempt');
});

test('results show letter and text, icon and word, and no long disclaimer', () => {
  assert.match(panel, /answerLine\('Sua resposta', item\.selectedIndex, item\.selectedText\)/);
  assert.match(panel, /answerLine\('Resposta correta', item\.correctIndex, item\.correctText\)/);
  assert.match(panel, /mark\('close', 'Errou'/);
  assert.match(panel, /Trecho da aula/);
  assert.doesNotMatch(panel + quiz, /clínica|diagnóstica/);
  assert.doesNotMatch(panel, /Gabarito: \$\{/, 'letter-only line replaced');
});
