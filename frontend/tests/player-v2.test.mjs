import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { activeSegmentIndex } from '../js/utils/transcript-player.js';

const playerSource = readFileSync(new URL('../js/utils/media-player.js', import.meta.url), 'utf8').replace(/export /gu, '');
const transcriptSource = readFileSync(new URL('../js/utils/transcript-player.js', import.meta.url), 'utf8').replace(/export /gu, '');
const studySource = readFileSync(new URL('../js/utils/study-store.js', import.meta.url), 'utf8').replace(/export /gu, '');
function harness() {
  const dom = new JSDOM('<div id="player"></div><div id="toolbar"></div><div id="segments"></div>', { url: 'https://test.invalid' });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  for (const name of ['play', 'pause', 'load']) window.HTMLMediaElement.prototype[name] = function () {
    if (name === 'load') return;
    this._paused = name === 'pause'; this.dispatchEvent(new window.Event(name));
    return name === 'play' ? Promise.resolve() : undefined;
  };
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return this._paused !== false; } });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', { get() { return this._ready || 0; } });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', { get() { return this._duration || 0; } });
  const Player = new Function('window', 'document', 'Option', 'getComputedStyle', `${playerSource}; return MediaPlayer;`)(window, window.document, window.Option, window.getComputedStyle);
  const player = new Player(window.document.querySelector('#player'));
  const metadata = (duration) => {
    player.media._ready = 1; player.media._duration = duration;
    player.media.dispatchEvent(new window.Event('loadedmetadata'));
  };
  const sync = new Function('document', `${transcriptSource}; return initTranscriptPlayer;`)(window.document);
  return { dom, window, document: window.document, player, metadata, sync, close: () => dom.window.close() };
}

test('audio seeks clamp bounds and playback speeds support 0.5 to 3x', () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/audio', duration: 60 }); h.metadata(60);
    h.player.seekTo(999, false); assert.equal(h.player.currentTime, 60);
    h.player.jump(-100); assert.equal(h.player.currentTime, 0);
    h.player.seekTo('invalid', false); assert.equal(h.player.currentTime, 0);
    h.player.setPlaybackRate(3); assert.equal(h.player.media.playbackRate, 3);
    h.player.setPlaybackRate(9); assert.equal(h.player.media.playbackRate, 1);
  } finally { h.close(); }
});
test('MP4 maps transcript seconds to original offset and stops at the selected clip end', async () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/video', video: true, duration: 20, timelineStart: 30, timelineDuration: 20 }); h.metadata(120);
    assert.equal(h.player.duration, 20); assert.equal(h.player.media.currentTime, 30);
    h.player.seekTo(5, false); assert.equal(h.player.media.currentTime, 35);
    await h.player.play(); h.player.media.currentTime = 50.2;
    h.player.media.dispatchEvent(new h.window.Event('timeupdate'));
    assert.equal(h.player.media.paused, true); assert.equal(h.player.currentTime, 20);
    await h.player.play(); assert.equal(h.player.media.currentTime, 30);
  } finally { h.close(); }
});
test('renewing a source preserves relative position, rate and playback state', async () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/old', duration: 60 }); h.metadata(60);
    h.player.seekTo(12, false); h.player.setPlaybackRate(2.5); await h.player.play();
    h.player.setSource({ src: 'https://test.invalid/new', duration: 60, preservePosition: true }); h.metadata(60);
    assert.equal(h.player.currentTime, 12); assert.equal(h.player.media.playbackRate, 2.5);
    assert.equal(h.player.media.paused, false);
    h.player.setSource({ src: 'https://test.invalid/mp4', video: true, duration: 60, timelineStart: 30, timelineDuration: 60, preservePosition: true }); h.metadata(120);
    assert.equal(h.player.media.currentTime, 42); assert.equal(h.player.currentTime, 12);
  } finally { h.close(); }
});
test('player shortcuts are scoped to focused player and leave text inputs and buttons alone', () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/audio', duration: 60 }); h.metadata(60);
    const root = h.document.querySelector('#player');
    root.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(h.player.currentTime, 10);
    const input = root.querySelector('input');
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(h.player.currentTime, 10);
  } finally { h.close(); }
});
test('active transcript segments use half-open time ranges and leave gaps inactive', () => {
  const segments = [{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 3000 }];
  assert.equal(activeSegmentIndex(segments, 0), 0);
  assert.equal(activeSegmentIndex(segments, 1), -1);
  assert.equal(activeSegmentIndex(segments, 1.5), 1);
  assert.equal(activeSegmentIndex(segments, NaN), -1);
});
test('transcript search respects accents, uses draft text and navigates without autoplay or HTML', () => {
  const h = harness();
  try {
    h.player.setSource({ src: 'https://test.invalid/audio', duration: 60 }); h.metadata(60);
    const container = h.document.querySelector('#segments');
    for (const [start, text] of [[0, 'Introdução'], [10000, 'Órgãos: minha edição <img src=x>']]) {
      const article = h.document.createElement('article'); article.className = 'transcription-segment';
      article.dataset.startMs = start; article.dataset.endMs = start + 5000;
      const field = h.document.createElement('textarea'); field.value = text;
      article.append(h.document.createElement('button'), field); container.append(article);
    }
    const toolbar = h.document.querySelector('#toolbar');
    const sync = h.sync({ container, toolbar, player: h.player }); sync.refresh();
    const search = toolbar.querySelector('input[type="search"]');
    search.value = 'orgaos'; search.dispatchEvent(new h.window.Event('input'));
    assert.match(toolbar.textContent, /1 trechos encontrados/);
    toolbar.querySelectorAll('button')[1].click();
    assert.equal(h.player.currentTime, 10); assert.equal(h.player.media.paused, true);
    assert.equal(container.querySelector('img'), null);
    assert.equal(container.querySelectorAll('textarea')[1].value, 'Órgãos: minha edição <img src=x>');
    h.player.media.dispatchEvent(new h.window.Event('timeupdate'));
    assert.equal(container.querySelectorAll('article')[1].getAttribute('aria-current'), 'true');
    sync.destroy();
  } finally { h.close(); }
});
test('study history stores video-relative position and restores position and speed per account', () => {
  const h = harness();
  try {
    const store = new Function('window', 'localStorage', `${studySource}; return {setStudyUser, studyFor, updateStudy, trackPlayback};`)(h.window, h.window.localStorage);
    store.setStudyUser('a'); store.updateStudy('lesson', { position: 6, playbackRate: 2 });
    h.player.setSource({ src: 'https://test.invalid/video', video: true, duration: 20, timelineStart: 30, timelineDuration: 20 });
    const stop = store.trackPlayback(h.player, 'lesson'); h.metadata(100);
    assert.equal(h.player.media.currentTime, 36); assert.equal(h.player.media.playbackRate, 2);
    h.player.seekTo(9, false); stop();
    assert.equal(store.studyFor('lesson').position, 9);
    store.setStudyUser('b'); assert.equal(store.studyFor('lesson').position, 0);
  } finally { h.close(); }
});
