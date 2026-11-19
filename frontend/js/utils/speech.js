/**
 * Text-to-speech with the browser's built-in voices (Web Speech API). Runs locally or through
 * the operating system's voice service: no app server, no AI provider and no tokens.
 * Reads one block at a time (paragraph, list item, question, alternative) and marks the block
 * being read with .is-speaking, so students can follow along.
 */
const LANGS = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  zh: 'zh-CN',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
};
let active = null;

export function speechSupported(win = window) {
  return Boolean(win.speechSynthesis && win.SpeechSynthesisUtterance);
}
export function speechLang(code) {
  const base = String(code || 'pt')
    .toLowerCase()
    .split(/[-_]/)[0];
  return LANGS[base] || base;
}
function pickVoice(synth, lang) {
  const voices = synth.getVoices?.() || [];
  const base = lang.split('-')[0];
  return (
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang?.replace('_', '-').toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(base)) ||
    null
  );
}

/**
 * @param {{ blocks: () => Array<{ element?: Element, text: string }>, lang?: string,
 *   onState?: (state: 'idle'|'speaking'|'paused') => void, win?: Window }} options
 */
export function createSpeaker({
  blocks,
  lang: langOption = 'pt-BR',
  onState = () => {},
  win = window,
}) {
  const synth = win.speechSynthesis;
  let lang = typeof langOption === 'function' ? langOption() : langOption;
  let state = 'idle',
    queue = [],
    current = null,
    token = 0;
  const set = (value) => {
    state = value;
    onState(value);
  };
  const mark = (element, on) => element?.classList?.toggle('is-speaking', on);
  function finish() {
    mark(current?.element, false);
    current = null;
    queue = [];
    if (active === api) active = null;
    set('idle');
  }
  function next(run) {
    if (run !== token) return;
    mark(current?.element, false);
    current = queue.shift() || null;
    if (!current) return finish();
    const utterance = new win.SpeechSynthesisUtterance(current.text);
    utterance.lang = lang;
    const voice = pickVoice(synth, lang);
    if (voice) utterance.voice = voice;
    utterance.onstart = () => mark(current?.element, true);
    utterance.onend = () => next(run);
    utterance.onerror = (event) => {
      if (event?.error !== 'interrupted' && event?.error !== 'canceled') next(run);
    };
    synth.speak(utterance);
  }
  const api = {
    get state() {
      return state;
    },
    start() {
      if (active && active !== api) active.stop();
      synth.cancel();
      token += 1;
      lang = typeof langOption === 'function' ? langOption() : langOption;
      queue = blocks()
        .map((b) => ({
          ...b,
          text: String(b.text || '')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
        .filter((b) => b.text);
      if (!queue.length) return;
      active = api;
      set('speaking');
      next(token);
    },
    toggle() {
      if (state === 'idle') api.start();
      else if (state === 'speaking') {
        synth.pause();
        set('paused');
      } else {
        synth.resume();
        set('speaking');
      }
    },
    stop() {
      token += 1;
      synth.cancel();
      finish();
    },
  };
  return api;
}

const LABELS = { idle: 'Ouvir', speaking: 'Pausar leitura', paused: 'Continuar leitura' };
/** Play/pause button plus a stop button that appears while reading. Null when unsupported. */
export function speakControls({ blocks, lang, label = 'Ouvir', win = window }) {
  if (!speechSupported(win)) return null;
  const doc = win.document;
  const wrap = doc.createElement('span');
  wrap.className = 'speak-controls';
  const play = doc.createElement('button');
  play.type = 'button';
  play.className = 'secondary-action speak-button';
  const stop = doc.createElement('button');
  stop.type = 'button';
  stop.className = 'text-action speak-stop';
  stop.textContent = 'Parar';
  stop.hidden = true;
  const speaker = createSpeaker({
    blocks,
    lang,
    win,
    onState: (state) => {
      play.textContent = state === 'idle' ? label : LABELS[state];
      play.setAttribute('aria-pressed', String(state !== 'idle'));
      stop.hidden = state === 'idle';
    },
  });
  play.textContent = label;
  play.setAttribute('aria-pressed', 'false');
  play.addEventListener('click', () => speaker.toggle());
  stop.addEventListener('click', () => {
    speaker.stop();
    play.focus();
  });
  win.addEventListener('pagehide', () => speaker.stop());
  wrap.append(play, stop);
  return { element: wrap, speaker };
}
