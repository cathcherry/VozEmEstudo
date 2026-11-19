import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedWords, buildCaptionService } from '../src/services/caption.service.js';

const segments = [
  { position: 0, start_ms: 0, end_ms: 1200, current_text: 'Olá turma.' },
  { position: 1, start_ms: 1300, end_ms: 2600, current_text: 'Hoje: energia.' },
];
const words = [
  { startMs: 0, endMs: 400, text: 'Olá', speaker: 'A', segment: 0 },
  { startMs: 450, endMs: 1200, text: 'turma.', speaker: 'A', segment: 0 },
  { startMs: 1300, endMs: 1700, text: 'Hoje:', speaker: 'B', segment: 1 },
  { startMs: 1750, endMs: 2600, text: 'energia.', speaker: 'B', segment: 1 },
];

test('real word timings are returned when they match the displayed segments exactly', () => {
  const result = alignedWords(segments, words);
  assert.equal(result.length, 4);
  assert.deepEqual(result[2], {
    startMs: 1300,
    endMs: 1700,
    text: 'Hoje:',
    speaker: 'B',
    segment: 1,
  });
});

test('edited text, partial, unordered or out-of-range alignments fall back to segments', () => {
  const edited = [segments[0], { ...segments[1], current_text: 'Hoje falamos de energia.' }];
  assert.deepEqual(alignedWords(edited, words), []);
  assert.deepEqual(alignedWords(segments, words.slice(0, 3)), []);
  assert.deepEqual(alignedWords(segments, [words[1], words[0], words[2], words[3]]), []);
  assert.deepEqual(
    alignedWords(
      segments,
      words.map((w, i) => (i === 3 ? { ...w, endMs: 9000 } : w)),
    ),
    [],
  );
  assert.deepEqual(alignedWords(segments, null), []);
  assert.deepEqual(alignedWords(segments, [{ text: 'x' }]), []);
});

test('caption service checks ownership first and reports the granularity it can honour', async () => {
  const calls = [];
  const store = {
    getByMaterial: async () => ({
      id: 't1',
      current_revision: 1,
      transcription_segments: segments,
    }),
    getCurrentAlignment: async (t) => (calls.push(t.current_revision), words),
  };
  let owned = true;
  const getMaterial = async () => {
    if (!owned) throw Object.assign(new Error('not found'), { status: 404 });
  };
  const service = buildCaptionService(store, getMaterial);
  const result = await service.captions('user-a', 'm1');
  assert.equal(result.granularity, 'word');
  assert.equal(result.words.length, 4);
  assert.deepEqual(calls, [1]);
  store.getCurrentAlignment = async () => null; // e.g. revision 2 after an edit: no alignment row
  assert.deepEqual(await service.captions('user-a', 'm1'), {
    revision: 1,
    granularity: 'segment',
    words: [],
  });
  owned = false;
  await assert.rejects(service.captions('user-b', 'm1'), /not found/);
});
