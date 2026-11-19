import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSpeaker, speakControls, speechLang, speechSupported } from '../js/utils/speech.js';

function fakeWindow() {
  const dom = new JSDOM('<p id="a">Primeiro.</p><p id="b">Segundo.</p>');
  const win = dom.window;
  const spoken = [];
  const synth = {
    paused: false,
    getVoices: () => [
      { lang: 'en-US', name: 'en' },
      { lang: 'pt-BR', name: 'Luciana' },
    ],
    speak(u) {
      spoken.push(u);
      u.onstart?.();
    },
    cancel() {
      const last = spoken.at(-1);
      last?.onerror?.({ error: 'canceled' });
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
  };
  win.speechSynthesis = synth;
  win.SpeechSynthesisUtterance = function (text) {
    this.text = text;
  };
  const finish = () => spoken.at(-1).onend();
  return { dom, win, synth, spoken, finish };
}

test('language codes map to voice locales and support is detected', () => {
  assert.equal(speechLang('pt'), 'pt-BR');
  assert.equal(speechLang('es'), 'es-ES');
  assert.equal(speechLang(undefined), 'pt-BR');
  assert.equal(speechSupported({}), false);
  assert.equal(speechSupported(fakeWindow().win), true);
});

test('reads block by block in the lesson language and marks the block being read', () => {
  const { win, spoken, finish } = fakeWindow();
  const doc = win.document;
  const states = [];
  const speaker = createSpeaker({
    win,
    lang: () => speechLang('pt'),
    blocks: () =>
      ['#a', '#b'].map((id) => ({
        element: doc.querySelector(id),
        text: doc.querySelector(id).textContent,
      })),
    onState: (s) => states.push(s),
  });
  speaker.start();
  assert.equal(spoken[0].text, 'Primeiro.');
  assert.equal(spoken[0].lang, 'pt-BR');
  assert.equal(spoken[0].voice.name, 'Luciana');
  assert(doc.querySelector('#a').classList.contains('is-speaking'));
  finish();
  assert.equal(spoken[1].text, 'Segundo.');
  assert(!doc.querySelector('#a').classList.contains('is-speaking'));
  assert(doc.querySelector('#b').classList.contains('is-speaking'));
  speaker.toggle();
  assert.equal(speaker.state, 'paused');
  speaker.toggle();
  assert.equal(speaker.state, 'speaking');
  finish();
  assert.equal(speaker.state, 'idle');
  assert(!doc.querySelector('#b').classList.contains('is-speaking'));
  assert.deepEqual(states, ['speaking', 'paused', 'speaking', 'idle']);
});

test('controls toggle labels, stop clears highlight, and only one reader is active', () => {
  const { win, spoken } = fakeWindow();
  const doc = win.document;
  const block = () => [{ element: doc.querySelector('#a'), text: 'Primeiro.' }];
  const one = speakControls({ win, blocks: block, label: 'Ouvir resumo' });
  const two = speakControls({
    win,
    blocks: () => [{ text: 'Outro texto.' }],
    label: 'Ouvir questão',
  });
  const [play, stop] = one.element.querySelectorAll('button');
  assert.equal(play.textContent, 'Ouvir resumo');
  assert.equal(stop.hidden, true);
  play.click();
  assert.equal(play.textContent, 'Pausar leitura');
  assert.equal(stop.hidden, false);
  two.element.querySelector('button').click();
  assert.equal(one.speaker.state, 'idle', 'starting another reader stops the first');
  assert.equal(spoken.at(-1).text, 'Outro texto.');
  assert(!doc.querySelector('#a').classList.contains('is-speaking'));
  assert.equal(
    speakControls({ win: { document: doc }, blocks: block }),
    null,
    'hidden without support',
  );
});
