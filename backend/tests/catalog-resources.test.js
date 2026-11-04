import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOwnedResources } from '../src/repositories/catalog.repository.js';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const foreign = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

test('resource availability exposes only boolean flags for owned materials', () => {
  const available = summarizeOwnedResources([a, b], {
    audio: [
      { material_id: a, storage_path: 'retained/own/fixture.wav', retain_original: true },
      { material_id: b, storage_path: 'retained/own/fixture.wav', retain_original: false },
      { material_id: foreign, storage_path: 'retained/foreign/fixture.wav', retain_original: true },
    ],
    transcription: [{ material_id: a }, { material_id: foreign }],
    summary: [{ material_id: a }, { material_id: a }, { material_id: foreign }],
    questions: [{ material_id: b }, { material_id: foreign }],
  });
  assert.deepEqual(available, {
    [a]: { audio: true, transcription: true, summary: true, questions: false },
    [b]: { audio: false, transcription: false, summary: false, questions: true },
  });
  assert.equal(JSON.stringify(available).includes('retained/'), false);
  assert.equal(JSON.stringify(available).includes(foreign), false);
});

test('no audio is advertised unless retention AND storage path are confirmed', () => {
  const available = summarizeOwnedResources([a], {
    audio: [
      { material_id: a, retain_original: true, storage_path: null },
      { material_id: foreign, retain_original: true, storage_path: 'path' },
    ],
    invalid_kind: [{ material_id: a }],
  });
  assert.equal(available[a].audio, false);
});
