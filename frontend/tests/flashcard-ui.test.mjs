import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  FLASHCARD_RATINGS, formatFlashcardDue, flashcardSummary,
} from '../js/utils/flashcard-view.js';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(frontend, 'pages/painel.html'), 'utf8');
const code = readFileSync(resolve(frontend, 'js/pages/flashcards-panel.js'), 'utf8');
const dashboard = readFileSync(resolve(frontend, 'js/pages/dashboard.page.js'), 'utf8');
const css = readFileSync(resolve(frontend, 'css/flashcards.css'), 'utf8');

test('flashcards are hidden until the feature is explicitly enabled', () => {
  assert.match(html, /data-flashcards-panel hidden/);
  assert.match(code, /isFeatureEnabled\('flashcards'\)/);
  assert.match(dashboard, /initFlashcardsPanel/);
  assert.match(html, /\/css\/flashcards\.css/);
  assert.match(css, /body\[data-page='dashboard'\]/);
});

test('create, reveal, rate, edit, and archive controls have labels and statuses', () => {
  for (const marker of [
    'data-flashcard-create-form',
    'data-flashcard-create-status role="status" aria-live="polite"',
    'data-flashcard-review-status role="status" aria-live="polite"',
    'data-flashcard-manage-form',
    'data-flashcard-manage-status role="status" aria-live="polite"',
    'data-flashcard-due-area',
  ]) assert(html.includes(marker), marker);
  assert.match(code, /Revelar resposta/);
  assert.match(code, /reviewFlashcard/);
  assert.match(code, /crypto\.randomUUID\(\)/);
  assert.match(code, /pendingReview/);
  assert.match(code, /updateFlashcard/);
  assert.doesNotMatch(code, /innerHTML/);
});

test('review choices and dates are grounded and formatting is deterministic', () => {
  assert.deepEqual(FLASHCARD_RATINGS.map((rating) => rating.value), [0, 1, 2, 3]);
  assert.deepEqual(FLASHCARD_RATINGS.map((rating) => rating.label),
    ['De novo', 'Difícil', 'Bom', 'Fácil']);
  assert.equal(flashcardSummary(0), '0 cartões para revisar');
  assert.equal(flashcardSummary(1), '1 cartão para revisar');
  assert.equal(formatFlashcardDue('not a date'), 'Data indisponível');
  assert.match(formatFlashcardDue('2026-11-05T14:00:00Z'), /2026/);
});
