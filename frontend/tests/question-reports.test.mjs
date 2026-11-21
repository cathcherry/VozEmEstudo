import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReports, normalizeReport } from '../js/utils/question-reports.js';

test('reports merge per question: newest wins, a removal is kept so it is not revived', () => {
  const remote = { q1: { reason: 'unclear', at: 10 }, q2: { reason: 'repeated', at: 50 } };
  const local = { q1: { reason: 'wrong_answer', at: 20 }, q2: { removed: true, at: 40 }, q3: { removed: true, at: 60 } };
  const merged = mergeReports(remote, local);
  assert.equal(merged.q1.reason, 'wrong_answer');
  assert.equal(merged.q2.reason, 'repeated', 'an older removal does not undo a newer report');
  assert.equal(merged.q3.removed, true);
  assert.deepEqual(mergeReports(merged, remote), merged, 'merging again changes nothing');
  assert.deepEqual(mergeReports(null, { bad: 'x', q: { reason: 'other' } }), {}, 'entries without a time are ignored');
});

test('report input: known reasons only; note and ids trimmed', () => {
  assert.throws(() => normalizeReport({ reason: 'spam' }), /motivo/);
  const r = normalizeReport({ reason: 'other', note: `  ${'x'.repeat(600)} `, materialId: 'l1', batchId: null });
  assert.equal(r.note.length, 500);
  assert.equal(r.materialId, 'l1');
  assert.equal(r.batchId, null);
});

test('at most 500 entries, removals dropped first', () => {
  const many = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`q${i}`, i < 30 ? { removed: true, at: 1000 + i } : { reason: 'other', at: i }]));
  const merged = mergeReports({}, many);
  assert.equal(Object.keys(merged).length, 500);
  assert.equal(Object.values(merged).filter((e) => e.removed).length, 10);
});
