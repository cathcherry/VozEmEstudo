import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonProgress, lessonMode } from '../js/utils/lesson-steps.js';

const base = { ready: true, summaries: 0, lists: 0, answered: false, flashcards: null };

test('before confirmation only the transcript step is open and later steps are locked', () => {
  const p = lessonProgress({ ...base, ready: false });
  assert.equal(p.next.id, 'transcription');
  assert.deepEqual(
    p.steps.map((s) => [s.id, s.state, s.locked]),
    [
      ['transcription', 'current', false],
      ['summary', 'todo', true],
      ['questions', 'todo', true],
    ],
  );
});

test('the next action follows the study path one step at a time', () => {
  assert.equal(lessonProgress(base).next.label, 'Gerar resumo');
  assert.equal(lessonProgress({ ...base, summaries: 1 }).next.label, 'Criar questões');
  assert.equal(lessonProgress({ ...base, summaries: 1, lists: 1 }).next.label, 'Responder a lista');
  assert.equal(
    lessonProgress({ ...base, summaries: 1, lists: 1, answered: true, flashcards: false }).next
      .label,
    'Criar flashcards',
  );
  assert.equal(
    lessonProgress({ ...base, summaries: 1, lists: 1, answered: true, flashcards: true }).next,
    null,
  );
});

test('flashcards appear as a step only when the feature is on', () => {
  assert.equal(lessonProgress(base).steps.length, 3);
  assert.equal(lessonProgress({ ...base, flashcards: false }).steps.at(-1).id, 'flashcards');
});

test('exactly one step is current and completed steps are marked done', () => {
  const p = lessonProgress({ ...base, summaries: 2, lists: 1, answered: false, flashcards: false });
  assert.deepEqual(
    p.steps.map((s) => s.state),
    ['done', 'done', 'current', 'todo'],
  );
});

test('the lesson opens in preparation only while it is being prepared', () => {
  const fresh = { ready: true, summaries: 0, lists: 0, answered: false, studied: false, dismissed: false };
  assert.equal(lessonMode({ ...fresh, ready: false, summaries: 2 }), 'preparation', 'unconfirmed transcript');
  assert.equal(lessonMode(fresh), 'preparation', 'just confirmed, nothing generated or studied');
  assert.equal(lessonMode({ ...fresh, summaries: 1 }), 'study');
  assert.equal(lessonMode({ ...fresh, lists: 1 }), 'study');
  assert.equal(lessonMode({ ...fresh, answered: true }), 'study');
  assert.equal(lessonMode({ ...fresh, studied: true }), 'study', 'listened or marked as studied');
  assert.equal(lessonMode({ ...fresh, dismissed: true }), 'study', '"Começar a estudar" chosen');
});
