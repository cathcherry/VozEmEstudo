import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const playerSource = readFileSync(
  new URL('../js/utils/media-player.js', import.meta.url),
  'utf8',
).replace(/export /gu, '');
const captionSource = readFileSync(
  new URL('../js/utils/captions.js', import.meta.url),
  'utf8',
).replace(/export /gu, '');

function harness() {
  const dom = new JSDOM('<div id="player"></div>', { url: 'https://test.invalid' });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  for (const name of ['play', 'pause', 'load'])
    window.HTMLMediaElement.prototype[name] = function () {
      if (name === 'load') return;
      this._paused = name === 'pause';
      this.dispatchEvent(new window.Event(name));
      return name === 'play' ? Promise.resolve() : undefined;
    };
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    get() {
      return this._paused !== false;
    },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', {
    get() {
      return 1;
    },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    get() {
      return this._t || 0;
    },
    set(v) {
      this._t = v;
    },
  });
  const Player = new Function(
    'window',
    'document',
    'Option',
    'getComputedStyle',
    `${playerSource}; return MediaPlayer;`,
  )(window, window.document, window.Option, window.getComputedStyle);
  const lib = new Function(
    'window',
    'document',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    `${captionSource}; return { PlayerCaptions, buildCues, cueAt, wordAt };`,
  )(window, window.document, window.requestAnimationFrame, window.cancelAnimationFrame);
  const store = new Map();
  const storage = { get: (k, f) => store.get(k) ?? f, set: (k, v) => store.set(k, v) };
  const player = new Player(window.document.querySelector('#player'));
  const at = (seconds) => {
    player.media.currentTime = player.timelineStart + seconds;
    player.media.dispatchEvent(new window.Event('timeupdate'));
  };
  return { dom, window, player, lib, storage, store, at, close: () => dom.window.close() };
}

const segments = [
  { position: 0, start_ms: 0, end_ms: 2000, current_text: 'Olá turma.' },
  { position: 1, start_ms: 2500, end_ms: 5000, current_text: 'Hoje: energia.' },
];
const words = [
  { startMs: 0, endMs: 600, text: 'Olá', speaker: 'A', segment: 0 },
  { startMs: 700, endMs: 2000, text: 'turma.', speaker: 'A', segment: 0 },
  { startMs: 2500, endMs: 3200, text: 'Hoje:', speaker: 'B', segment: 1 },
  { startMs: 3300, endMs: 5000, text: 'energia.', speaker: 'B', segment: 1 },
];

test('cue lookup uses half-open ranges and leaves gaps empty', () => {
  const h = harness();
  try {
    const cues = h.lib.buildCues(segments, words);
    assert.equal(h.lib.cueAt(cues, 0), 0);
    assert.equal(h.lib.cueAt(cues, 2000), -1);
    assert.equal(h.lib.cueAt(cues, 2500), 1);
    assert.equal(h.lib.wordAt(cues[1].words, 3250), 0);
    assert.equal(cues[1].speaker, 'B', 'speaker shown only when several speakers exist');
    // Text-only fallback (one segment over the whole recording) is not captioned without words.
    assert.deepEqual(
      h.lib.buildCues([{ position: 0, start_ms: 0, end_ms: 600000, current_text: 'x' }]),
      [],
    );
  } finally {
    h.close();
  }
});

test('segment mode shows the active segment in the audio band; off clears it', () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/a', duration: 5 });
    const captions = new h.lib.PlayerCaptions(h.player, { storage: h.storage });
    captions.setTranscript(segments, []);
    captions.setPrefs({ mode: 'segment' });
    h.at(3);
    const band = h.player.root.querySelector('.caption-band');
    assert.equal(band.textContent, 'Hoje: energia.');
    assert.equal(band.querySelector('.caption-word'), null);
    h.at(2.2);
    assert.equal(band.textContent, '', 'no caption in the gap between segments');
    captions.setPrefs({ mode: 'off' });
    h.at(3);
    assert.equal(band.textContent, '');
    assert.equal(JSON.parse(h.store.get('voz-caption-preferences')).mode, 'off');
  } finally {
    h.close();
  }
});

test('word mode highlights the real spoken word and falls back without timings', () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/a', duration: 5 });
    const captions = new h.lib.PlayerCaptions(h.player, { storage: h.storage });
    captions.setTranscript(segments, words);
    captions.setPrefs({ mode: 'word' });
    h.at(3.4);
    const band = h.player.root.querySelector('.caption-band');
    assert.equal(band.querySelector('.is-spoken').textContent, 'energia.');
    assert.equal(band.querySelector('.is-past').textContent, 'Hoje:');
    assert.equal(band.textContent, 'B: Hoje: energia.', 'word spans keep their spaces');
    // An edited revision arrives without valid words: same preference, segment rendering.
    captions.setTranscript(
      [segments[0], { ...segments[1], current_text: 'Hoje falamos de energia.' }],
      [],
    );
    h.at(3.4);
    assert.equal(band.textContent, 'Hoje falamos de energia.');
    assert.equal(band.querySelector('.caption-word'), null);
    const wordInput = [...h.player.root.querySelectorAll('.caption-menu input')].find(
      (i) => i.value === 'word',
    );
    assert.equal(wordInput.disabled, true);
  } finally {
    h.close();
  }
});

test('original MP4 uses clip-relative time and renders captions over the video', () => {
  const h = harness();
  try {
    // The original video starts 30 s before the transcribed clip.
    h.player.setSource({
      src: 'https://test.invalid/v.mp4',
      video: true,
      duration: 5,
      timelineStart: 30,
      timelineDuration: 5,
    });
    const captions = new h.lib.PlayerCaptions(h.player, { storage: h.storage });
    captions.setTranscript(segments, words);
    captions.setPrefs({ mode: 'word' });
    h.at(0.8); // media time 30.8 s
    captions.setPrefs({ color: 'yellow', background: 'none' });
    assert.equal(h.player.root.dataset.captionColor, 'yellow');
    assert.equal(h.player.root.dataset.captionBackground, 'none');
    const saved = JSON.parse(h.store.get('voz-caption-preferences'));
    assert.deepEqual([saved.color, saved.background], ['yellow', 'none']);
    const pressed = [...h.player.root.querySelectorAll('.caption-menu [aria-pressed="true"]')].map(
      (b) => b.textContent,
    );
    assert.deepEqual(pressed, ['M', 'Amarelo', 'Sem fundo']);
    const line = h.player.root.querySelector('.video-preview .caption-line');
    assert.equal(line.querySelector('.is-spoken').textContent, 'turma.');
    assert.equal(h.player.root.querySelector('.caption-band').textContent, '');
  } finally {
    h.close();
  }
});
