import test from 'node:test';
import assert from 'node:assert/strict';
import { assertQuestionCount, isDerivedOutputStale, assertAudioMetadata } from '../src/domain/rules.js';

test('aceita somente as quantidades de questões definidas', () => {
  for (const value of [3, 5, 10, 20]) assert.equal(assertQuestionCount(value), value);
  assert.throws(() => assertQuestionCount(4));
});

test('detecta derivação desatualizada pela revisão', () => {
  assert.equal(isDerivedOutputStale(1, 2), true);
  assert.equal(isDerivedOutputStale(2, 2), false);
});

test('valida formato e limite do áudio', () => {
  assert.deepEqual(assertAudioMetadata({ extension: 'MP3', sizeBytes: 1024 }), { extension: 'mp3', sizeBytes: 1024 });
  assert.throws(() => assertAudioMetadata({ extension: 'ogg', sizeBytes: 1024 }));
  assert.throws(() => assertAudioMetadata({ extension: 'wav', sizeBytes: 101 * 1024 * 1024 }));
});
