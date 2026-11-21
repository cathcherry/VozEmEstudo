import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockTranscript } from '../src/integrations/asr/huggingface-whisper.client.js';

test('simulated transcript: one demo segment by default', () => {
  const result = mockTranscript(4000, '');
  assert.equal(result.segments.length, 1);
  assert.deepEqual([result.segments[0].startMs, result.segments[0].endMs], [0, 4000]);
});

test('simulated transcript: MOCK_ASR_SEGMENTS_FILE spreads realistic segments over the audio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asr-'));
  const file = join(dir, 'segments.json');
  writeFileSync(file, JSON.stringify(['Primeira frase.', ' Segunda frase. ', 'Terceira frase.']));
  const result = mockTranscript(9000, file);
  assert.deepEqual(result.segments.map((s) => [s.position, s.startMs, s.endMs, s.text]), [
    [0, 0, 3000, 'Primeira frase.'],
    [1, 3000, 6000, 'Segunda frase.'],
    [2, 6000, 9000, 'Terceira frase.'],
  ]);
  assert.equal(result.text, 'Primeira frase. Segunda frase. Terceira frase.');
  writeFileSync(file, JSON.stringify([]));
  assert.throws(() => mockTranscript(9000, file), /MOCK_ASR_SEGMENTS_FILE/);
});
