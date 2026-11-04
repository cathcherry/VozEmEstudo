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
  assert.match(panel, /getQuizDiagnostic\(session\.id\)/);
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
