import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAmbient, createAmbientPlayer, SOUNDS } from '../js/utils/ambient-sound.js';

/** Minimal Web Audio stand-in that records the target gain. */
function fakeAudio() {
  const gains = [];
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime(v) { gains.push(v); }, setTargetAtTime(v) { gains.push(v); } });
  const node = () => ({ connect: (next) => next || node(), start() {}, stop() {}, frequency: param(), gain: param() });
  class Context {
    sampleRate = 8000;
    currentTime = 0;
    destination = {};
    createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (i) => data[i] }; }
    createGain() { return node(); }
    createBufferSource() { return { ...node(), buffer: null, loop: false }; }
    createBiquadFilter() { return { ...node(), type: '' }; }
    createOscillator() { return node(); }
    resume() { return Promise.resolve(); }
  }
  return { Context, gains };
}

test('settings are normalised and never resume playing by themselves', () => {
  assert.deepEqual(normalizeAmbient({ kind: 'jazz', volume: 7, duck: 'no' }), { kind: 'brown', volume: 1, duck: true, playing: false });
  assert.equal(SOUNDS.length, 3);
  const player = createAmbientPlayer({ initial: { kind: 'rain', playing: true } });
  assert.equal(player.state().playing, false, 'browsers need a click to start audio');
});

test('a lesson recording lowers the sound and restores it afterwards; ducking can be turned off', async () => {
  const audio = fakeAudio();
  globalThis.AudioContext = audio.Context;
  try {
    const player = createAmbientPlayer({ initial: { kind: 'waves', volume: 0.5 } });
    await player.play();
    assert.equal(player.state().playing, true);
    player.duck(true);
    const ducked = audio.gains.at(-1);
    player.duck(false);
    const restored = audio.gains.at(-1);
    assert(ducked < restored / 3, `ducked ${ducked} vs ${restored}`);
    player.setDuck(false);
    player.duck(true);
    assert.equal(audio.gains.at(-1), restored, 'no ducking when turned off');
    player.pause();
    assert.equal(player.state().playing, false);
  } finally {
    delete globalThis.AudioContext;
  }
});
