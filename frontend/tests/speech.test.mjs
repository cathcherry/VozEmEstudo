import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MAX_PASSAGE,
  createSpeaker,
  pickVoice,
  speakControls,
  speechLang,
  speechSupported,
  splitSpeech,
} from '../js/utils/speech.js';

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

test('compact icon controls keep accessible names and follow the speed preference', () => {
  const { win, spoken } = fakeWindow();
  const doc = win.document;
  doc.documentElement.dataset.speechRate = 'slow';
  const controls = speakControls({
    win,
    blocks: () => [{ text: 'Texto.' }],
    label: 'Ouvir resumo',
    icon: true,
  });
  const [play, stop] = controls.element.querySelectorAll('button');
  assert(controls.element.classList.contains('speak-compact'));
  assert.equal(play.getAttribute('aria-label'), 'Ouvir resumo');
  assert.equal(play.title, 'Ouvir resumo');
  assert.equal(play.textContent, '');
  assert(play.querySelector('svg'));
  assert.equal(stop.getAttribute('aria-label'), 'Parar');
  play.click();
  assert.equal(play.getAttribute('aria-label'), 'Pausar leitura');
  assert.equal(spoken.at(-1).rate, 0.8);
  doc.documentElement.dataset.speechRate = 'invalid';
  controls.speaker.stop();
  play.click();
  assert.equal(spoken.at(-1).rate, 1);
});

test('page reader reads visible main-content blocks, or only the selection', async () => {
  const { readableBlocks, selectedBlocks } = await import('../js/utils/page-reader.js');
  const dom = new JSDOM(`<main>
    <h1>Título</h1><p>Parágrafo um.</p>
    <nav><p>Menu</p></nav><p hidden>Oculto</p><div aria-hidden="true"><p>Decorativo</p></div>
    <ul><li><p>Item com parágrafo</p></li><li>Item simples</li></ul>
    <button><p>Botão</p></button><span class="sr-only"><p>Só leitor</p></span>
    <dialog><p>Diálogo fechado</p></dialog><p>   </p>
  </main>`);
  const texts = readableBlocks(dom.window.document.querySelector('main')).map((b) => b.text);
  assert.deepEqual(texts, ['Título', 'Parágrafo um.', 'Item com parágrafo', 'Item simples']);
  assert.equal(selectedBlocks({ getSelection: () => '' }), null);
  assert.deepEqual(selectedBlocks({ getSelection: () => '  trecho   escolhido ' }), [
    { text: 'trecho escolhido' },
  ]);
});

test('page reader: paragraphs in plain divs, list items, controls and collapsed parts', async () => {
  const { readableBlocks } = await import('../js/utils/page-reader.js');
  const dom = new JSDOM(`<main>
    <h2>Etapas</h2>
    <div class="card"><div class="body">Texto solto num div, sem parágrafo.</div></div>
    <p>A <strong>fotossíntese</strong> ocorre no <em>cloroplasto</em>.</p>
    <ol><li><span>Onde ocorre?</span><span class="result">– Não respondida</span><button>Reportar problema</button></li></ol>
    <details><summary>Ver mais</summary><p>Fechado</p></details>
    <details open><summary>Ver detalhes</summary><p>Aberto</p></details>
    <a class="secondary-action" href="#">Responder</a>
    <p>Leia <a href="#">o capítulo</a> antes.</p>
    <div role="toolbar"><span>00:00</span></div>
    <label class="quiz-answer-card"><input type="radio" /><span>A</span> <span>Cloroplasto</span></label>
  </main>`);
  const texts = readableBlocks(dom.window.document.querySelector('main')).map((b) => b.text);
  assert.deepEqual(texts, [
    'Etapas',
    'Texto solto num div, sem parágrafo.',
    'A fotossíntese ocorre no cloroplasto.',
    'Onde ocorre? – Não respondida',
    'Aberto',
    'Leia o capítulo antes.',
    'A Cloroplasto',
  ]);
});

test('long blocks are split into short passages at sentence, then clause, boundaries', () => {
  assert.deepEqual(splitSpeech('  Curto.  '), ['Curto.']);
  assert.deepEqual(splitSpeech(''), []);
  const sentences = Array.from(
    { length: 8 },
    (_, n) => `Esta é a frase número ${n + 1}, que explica um ponto da aula.`,
  );
  const text = sentences.join(' ');
  const parts = splitSpeech(text);
  assert(parts.length > 1);
  assert(parts.every((p) => p.length <= MAX_PASSAGE));
  assert.equal(parts.join(' '), text, 'nothing lost or reordered');
  assert(
    parts.every((p) => p.endsWith('.')),
    'cuts at sentence ends',
  );
  // Decimal numbers do not end a sentence.
  assert.deepEqual(splitSpeech('O valor é 3.5 mols. Depois vem outro.', 20), [
    'O valor é 3.5 mols.',
    'Depois vem outro.',
  ]);
  // One sentence too long: cut at commas, then words.
  const clause = 'primeira parte da frase muito longa, '.repeat(8) + 'fim';
  const clauses = splitSpeech(clause);
  assert(clauses.every((p) => p.length <= MAX_PASSAGE));
  assert.equal(clauses.join(' '), clause.replace(/\s+/g, ' ').trim());
  const words = splitSpeech('palavra '.repeat(60), 50);
  assert(words.every((p) => p.length <= 50));
  assert.deepEqual(splitSpeech('x'.repeat(25), 10), ['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx']);
});

test('voice choice: exact locale, local voices first, then the language, else none', () => {
  const synth = (voices) => ({ getVoices: () => voices });
  const remote = { name: 'Rede', lang: 'pt-BR', localService: false };
  const local = { name: 'Local', lang: 'pt_BR', localService: true };
  const portugal = { name: 'Portugal', lang: 'pt-PT', localService: true };
  assert.equal(pickVoice(synth([remote, local, portugal]), 'pt-BR'), local);
  assert.equal(pickVoice(synth([portugal, remote]), 'pt-BR'), remote, 'pt-BR before pt-PT');
  assert.equal(
    pickVoice(synth([{ lang: 'en-US' }, portugal]), 'pt-BR'),
    portugal,
    'same language fallback',
  );
  assert.equal(pickVoice(synth([{ lang: 'en-US' }]), 'pt-BR'), null);
  assert.equal(
    pickVoice(synth([]), 'pt-BR'),
    null,
    'voices not loaded yet: the browser picks by lang',
  );
  assert.equal(pickVoice({}, 'pt-BR'), null);
});

test('long paragraph is spoken in passages with one highlight; pause resumes at the last word', () => {
  const { win, spoken, finish } = fakeWindow();
  const doc = win.document;
  const long = Array.from(
    { length: 6 },
    (_, n) => `Frase ${n + 1} do parágrafo longo sobre a respiração celular nas mitocôndrias.`,
  ).join(' ');
  const speaker = createSpeaker({
    win,
    blocks: () => [
      { element: doc.querySelector('#a'), text: long },
      { element: doc.querySelector('#b'), text: 'Segundo.' },
    ],
  });
  speaker.start();
  assert(spoken[0].text.length <= MAX_PASSAGE);
  assert(doc.querySelector('#a').classList.contains('is-speaking'));
  const first = spoken[0].text;
  const at = first.indexOf('Frase 2');
  spoken[0].onboundary({ name: 'word', charIndex: at });
  speaker.toggle();
  assert.equal(speaker.state, 'paused');
  assert(doc.querySelector('#a').classList.contains('is-speaking'), 'highlight kept while paused');
  speaker.toggle();
  assert.equal(spoken.at(-1).text, first.slice(at), 'resumes from the last word reached');
  const texts = [first];
  while (speaker.state !== 'idle') {
    const last = spoken.at(-1);
    if (last.text !== first.slice(at)) texts.push(last.text);
    finish();
  }
  assert.equal(texts.slice(0, -1).join(' '), long);
  assert.equal(texts.at(-1), 'Segundo.');
  assert.equal(doc.querySelectorAll('.is-speaking').length, 0);
});

test('a failing voice is retried once with the default voice, then the reader moves on', () => {
  const { win, spoken } = fakeWindow();
  const speaker = createSpeaker({ win, blocks: () => [{ text: 'Um.' }, { text: 'Dois.' }] });
  speaker.start();
  assert.equal(spoken[0].voice.name, 'Luciana');
  spoken[0].onerror({ error: 'synthesis-failed' });
  assert.equal(spoken[1].text, 'Um.');
  assert.equal(spoken[1].voice, undefined);
  spoken[1].onerror({ error: 'synthesis-failed' });
  assert.equal(spoken[2].text, 'Dois.');
  assert.equal(speaker.utterance, spoken[2], 'the utterance stays referenced');
  spoken[2].onerror({ error: 'not-allowed' });
  assert.equal(speaker.state, 'idle', 'blocked by the browser: stop instead of looping');
});
