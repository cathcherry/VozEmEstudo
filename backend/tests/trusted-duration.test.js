import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDurationSeconds } from '../src/services/media.service.js';
import { quotaError, USAGE_KIND } from '../src/services/testing.service.js';

// The transcription allowance is charged from the duration measured on the server with ffprobe,
// never from the number the browser declares.
function wav(seconds, rate = 8000) {
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

test('duration is measured from the media itself', async () => {
  const seconds = await probeDurationSeconds(wav(7.5), 'wav');
  assert(Math.abs(seconds - 7.5) < 0.05, String(seconds));
});

test('malformed media is refused instead of being charged as zero', async () => {
  await assert.rejects(probeDurationSeconds(Buffer.from('not audio at all'), 'mp3'));
});

test('quota messages are friendly and never mention billing', () => {
  const exhausted = quotaError(USAGE_KIND.TRANSCRIPTION, { reason: 'user_quota', limit: 300, used: 300, remaining: 0 });
  assert.equal(exhausted.status, 403);
  assert.match(exhausted.message, /5 min de transcrição/);
  const partial = quotaError(USAGE_KIND.TRANSCRIPTION, { reason: 'user_quota', limit: 300, used: 120, remaining: 180 });
  assert.match(partial.message, /Restam 3 min de 5 min/);
  const global = quotaError(USAGE_KIND.SUMMARY, { reason: 'global_cap', window: 'day' });
  assert.equal(global.status, 503);
  assert.doesNotMatch(global.message, /US\$|token|custo|cobran/i);
  const off = quotaError(USAGE_KIND.MULTI_LESSON, { reason: 'user_quota', limit: 0, used: 0, remaining: 0 });
  assert.match(off.message, /não está disponível para contas de participante/);
});
