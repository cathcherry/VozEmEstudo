import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYERS,
  LAYER_IDS,
  PRESETS,
  DUCK_LEVEL,
  normalizeMix,
  applyPreset,
  setLayer,
  hasSound,
  layerGains,
  masterGain,
  migrateLegacy,
  parseMusicUrl,
  storageKey,
  miniPlayerKey,
} from '../js/utils/soundscape-mix.js';
import { createSoundscapeController, loadMix } from '../js/utils/soundscape-controller.js';
import { createSoundscapeEngine, MAX_VOICES } from '../js/utils/soundscape-engine.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}
function fakeEngine() {
  const calls = [];
  return {
    calls,
    async start(mix) {
      calls.push(['start', mix]);
    },
    update: (mix) => calls.push(['update', mix]),
    stop: () => calls.push(['stop']),
    setDucked: (on) => calls.push(['duck', on]),
    ensureRunning: async () => calls.push(['wake']),
    dispose: () => calls.push(['dispose']),
  };
}

test('ten layers and one mix for each of the eight atmospheres', () => {
  assert.deepEqual(LAYER_IDS, [
    'rain',
    'ocean',
    'wind',
    'forest',
    'fireplace',
    'thunder',
    'stream',
    'crickets',
    'library',
    'cafe',
  ]);
  assert.deepEqual(
    PRESETS.map((preset) => preset.label),
    [
      'Biblioteca chuvosa',
      'Escrivaninha lavanda',
      'Tarde de matcha',
      'Inverno aconchegante',
      'Estudo à beira-mar',
      'Jardim noturno',
      'Caderno acadêmico antigo',
      'Pastel sonhador',
    ],
  );
  for (const preset of PRESETS) {
    assert(Object.keys(preset.layers).length >= 2, preset.id);
    for (const [id, volume] of Object.entries(preset.layers)) {
      assert(LAYER_IDS.includes(id), `${preset.id}: ${id}`);
      assert(volume > 0 && volume <= 1);
    }
    const mix = applyPreset(normalizeMix(), preset.id);
    assert.equal(mix.preset, preset.id, 'a preset is recognised after applying it');
    assert(hasSound(mix));
  }
  assert.equal(
    new Set(PRESETS.map((preset) => JSON.stringify(preset.layers))).size,
    PRESETS.length,
    'every mix is distinct',
  );
});

test('mixes are normalised; editing a layer makes the mix personal', () => {
  const mix = normalizeMix({
    layers: { rain: { on: true, volume: 7 }, jazz: { on: true } },
    master: -1,
    duck: 'no',
    playing: 'yes',
    music: { url: 'https://evil.example/x' },
  });
  assert.equal(mix.layers.rain.volume, 1);
  assert.equal(mix.layers.jazz, undefined);
  assert.equal(mix.master, 0);
  assert.equal(mix.duck, true, 'ducking is on by default');
  assert.equal(mix.playing, false);
  assert.equal(mix.music, null, 'unsafe music links are dropped');
  const preset = applyPreset(mix, 'seaside');
  assert.equal(preset.master, 0, 'presets keep the master volume');
  const edited = setLayer(preset, 'ocean', { volume: 0.4 });
  assert.equal(edited.preset, null);
  assert.equal(setLayer(edited, 'ocean', { volume: 0.7 }).preset, 'seaside');
  // Raising the slider of a silent layer turns it on; turning off keeps its volume.
  const raised = setLayer(normalizeMix(), 'cafe', { volume: 0.3 });
  assert.deepEqual(raised.layers.cafe, { on: true, volume: 0.3 });
  assert.deepEqual(setLayer(raised, 'cafe', { on: false }).layers.cafe, { on: false, volume: 0.3 });
  assert.equal(hasSound(normalizeMix()), false);
});

test('gains follow a perceptual curve, and ducking lowers only the master', () => {
  const mix = applyPreset(normalizeMix({ master: 0.8 }), 'rainy-library');
  const gains = layerGains(mix);
  assert.equal(gains.ocean, 0);
  const rain = LAYERS.find((layer) => layer.id === 'rain');
  assert.equal(gains.rain, Math.round(0.65 * 0.65 * rain.level * 1000) / 1000);
  assert.equal(masterGain(mix), 0.64);
  assert.equal(masterGain(mix, true), Math.round(0.64 * DUCK_LEVEL * 1000) / 1000);
  assert.equal(masterGain({ ...mix, duck: false }, true), 0.64, 'ducking can be turned off');
});

test('the 3.4 single ambient sound carries over into a mix', () => {
  const mix = migrateLegacy({ kind: 'waves', volume: 0.3, duck: false, withFocus: true });
  assert.equal(mix.layers.ocean.on, true);
  assert.equal(mix.master, 0.3);
  assert.equal(mix.duck, false);
  assert.equal(mix.withFocus, true);
  assert.equal(migrateLegacy(null), null);
  const storage = memoryStorage({ 'voz-ambient-v1:u1': JSON.stringify({ kind: 'rain' }) });
  assert.equal(loadMix('u1', storage).layers.rain.on, true);
  assert.equal(
    loadMix('u2', storage).preset,
    PRESETS[0].id,
    'first visit: first atmosphere, silent',
  );
});

test('music links: only official YouTube and Spotify embeds, rebuilt from the parsed id', () => {
  const video = parseMusicUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s');
  assert.equal(video.provider, 'youtube');
  assert.match(video.embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.doesNotMatch(video.embedUrl, /autoplay/);
  assert.equal(parseMusicUrl('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseMusicUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ').provider, 'youtube');
  assert.equal(parseMusicUrl('https://m.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  const list = parseMusicUrl(
    'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
  );
  assert.equal(list.kind, 'playlist');
  assert.match(list.embedUrl, /\/embed\/videoseries\?.*list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG/);
  const spotify = parseMusicUrl(
    ' https://open.spotify.com/intl-pt/playlist/37i9dQZF1DX8NTLI2TtZa6?si=abc ',
  );
  assert.equal(spotify.embedUrl, 'https://open.spotify.com/embed/playlist/37i9dQZF1DX8NTLI2TtZa6');
  assert.equal(
    parseMusicUrl('https://open.spotify.com/embed/album/4aawyAB9vmqN3uQ7FjRGTy').kind,
    'album',
  );
  for (const bad of [
    '',
    'not a url',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/https://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=<script>',
    'https://www.youtube.com/channel/UC123',
    'https://open.spotify.com/user/someone',
    'https://open.spotify.com/playlist/../../evil',
    'https://spotify.com/playlist/37i9dQZF1DX8NTLI2TtZa6',
    'https://soundcloud.com/x/y',
    `https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=${'a'.repeat(600)}`,
  ])
    assert.throws(() => parseMusicUrl(bad), Error, bad);
});

test('controller: never plays by itself; resume, pause, ducking and persistence per account', async () => {
  const storage = memoryStorage({
    [storageKey('u1')]: JSON.stringify(applyPreset(normalizeMix({ playing: true }), 'cozy-winter')),
  });
  const engine = fakeEngine();
  const controller = createSoundscapeController({ userId: 'u1', storage, engine, channel: null });
  assert.equal(controller.state().playing, false, 'browsers need a click to start audio');
  assert.equal(controller.state().resumable, true, 'the next page offers a one-tap resume');
  assert.equal(engine.calls.length, 0, 'nothing touches audio before a click');
  await controller.play();
  assert.equal(engine.calls[0][0], 'start');
  assert.equal(controller.state().playing, true);
  assert.equal(JSON.parse(storage.getItem(storageKey('u1'))).playing, true);
  controller.setDucked(true);
  assert.deepEqual(engine.calls.at(-1), ['duck', true]);
  controller.setLayer('rain', { on: true });
  assert.equal(engine.calls.at(-1)[0], 'update');
  assert.equal(controller.state().mix.preset, null);
  controller.setPreset('night-garden');
  assert.equal(JSON.parse(storage.getItem(storageKey('u1'))).preset, 'night-garden');
  controller.pause();
  assert.equal(controller.state().playing, false);
  assert.equal(JSON.parse(storage.getItem(storageKey('u1'))).playing, false);
  assert.throws(() => controller.setMusic('https://evil.example'));
  assert.equal(controller.setMusic('https://youtu.be/dQw4w9WgXcQ').provider, 'youtube');
  assert.equal(
    JSON.parse(storage.getItem(storageKey('u1'))).music.url,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(storage.getItem(storageKey('u2')), null, 'other accounts untouched');
  controller.dispose();
});

test('controller: while the mini-player is open, pages command it instead of playing', async () => {
  let clock = 10_000;
  const storage = memoryStorage({
    [miniPlayerKey('u1')]: JSON.stringify({ at: clock, playing: false }),
  });
  const engine = fakeEngine();
  const messages = [];
  const channel = { postMessage: (message) => messages.push(message), close() {} };
  const page = createSoundscapeController({
    userId: 'u1',
    storage,
    engine,
    channel,
    now: () => clock,
  });
  assert.equal(page.state().mini, true);
  await page.play();
  assert.deepEqual(messages, [{ type: 'play' }]);
  assert.equal(engine.calls.filter(([name]) => name === 'start').length, 0);
  page.setDucked(true);
  assert.deepEqual(messages.at(-1), { type: 'duck', on: true });
  clock += 60_000; // heartbeat stopped: the mini-player was closed
  assert.equal(page.state().mini, false);
  await page.play();
  assert.equal(engine.calls.filter(([name]) => name === 'start').length, 1);
});

test('controller: focus blocks start and pause the sound only when asked', async () => {
  const engine = fakeEngine();
  const controller = createSoundscapeController({
    userId: 'u3',
    storage: memoryStorage(),
    engine,
    channel: null,
  });
  controller.followFocus(true);
  assert.equal(engine.calls.length, 0);
  controller.setWithFocus(true);
  controller.followFocus(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.state().playing, true);
  controller.followFocus(false);
  assert.equal(controller.state().playing, false);
});

/** Minimal Web Audio stand-in: counts contexts and the nodes created. */
function fakeAudio() {
  const stats = { contexts: 0, nodes: 0, started: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime(v) {
      this.value = v;
    },
  });
  const node = (extra = {}) => {
    stats.nodes += 1;
    return {
      connect: (next) => next,
      disconnect() {},
      start() {
        stats.started += 1;
      },
      stop() {},
      frequency: param(),
      gain: param(),
      Q: param(),
      pan: param(),
      delayTime: param(),
      playbackRate: param(),
      threshold: param(),
      ratio: param(),
      ...extra,
    };
  };
  class Context {
    constructor() {
      stats.contexts += 1;
    }
    sampleRate = 3000;
    currentTime = 0;
    state = 'running';
    destination = {};
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / 3000, getChannelData: (i) => data[i] };
    }
    createGain() {
      return node();
    }
    createBufferSource() {
      return node({ buffer: null, loop: false });
    }
    createBiquadFilter() {
      return node({ type: '' });
    }
    createOscillator() {
      return node({ type: '' });
    }
    createStereoPanner() {
      return node();
    }
    createDelay() {
      return node();
    }
    createDynamicsCompressor() {
      return node();
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  return { Context, stats };
}

test('engine: no audio context before start; only the layers that are on are built', async () => {
  const audio = fakeAudio();
  let ticker = null;
  const engine = createSoundscapeEngine({
    AudioContextClass: audio.Context,
    setTimer: (fn) => (ticker = fn),
    clearTimer: () => (ticker = null),
  });
  assert.equal(audio.stats.contexts, 0);
  const mix = applyPreset(normalizeMix(), 'cozy-winter');
  await engine.start(mix);
  assert.equal(audio.stats.contexts, 1);
  assert.deepEqual(engine.state().layers.sort(), ['fireplace', 'library', 'wind']);
  // Every layer can be built and ticked (events included) without errors.
  const all = normalizeMix({
    layers: Object.fromEntries(LAYER_IDS.map((id) => [id, { on: true, volume: 0.5 }])),
  });
  engine.update(all);
  for (let i = 0; i < 400; i += 1) ticker?.();
  assert.equal(engine.state().layers.length, LAYER_IDS.length);
  assert(engine.state().voices <= MAX_VOICES);
  engine.setDucked(true);
  assert.equal(engine.state().ducked, true);
  engine.stop();
  assert.equal(engine.state().running, false);
  assert.equal(ticker, null, 'the modulation timer stops with the sound');
  await engine.start(mix);
  assert.equal(audio.stats.contexts, 1, 'the context and buffers are reused');
  engine.dispose();
});

test('engine: a blocked context (no click) reports it instead of hanging', async () => {
  const audio = fakeAudio();
  class Blocked extends audio.Context {
    state = 'suspended';
    resume() {
      return new Promise(() => {});
    }
  }
  const engine = createSoundscapeEngine({
    AudioContextClass: Blocked,
    setTimer: () => 1,
    clearTimer: () => {},
  });
  await assert.rejects(
    engine.start(applyPreset(normalizeMix(), 'seaside')),
    (error) => error.code === 'AUTOPLAY_BLOCKED',
  );
  assert.equal(engine.state().running, false);
  engine.dispose();
});
