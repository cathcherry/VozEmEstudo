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
// Voice speed from the reading preferences (Aparência → Leitura e foco).
const RATES = { slow: 0.8, normal: 1, fast: 1.2, faster: 1.4 };
const preferredRate = (win) => RATES[win.document?.documentElement?.dataset?.speechRate] || 1;

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
    utterance.rate = preferredRate(win);
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
const ICONS = {
  idle: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  speaking: '<path d="M8 5v14M16 5v14"/>',
  paused: '<path d="M7 5l12 7-12 7V5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
};
const icon = (doc, name) => {
  const span = doc.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
};
/**
 * Play/pause button plus a stop button that appears while reading. Null when unsupported.
 * `icon: true` renders compact icon buttons (name kept in aria-label and tooltip). Students can
 * hide every reader in Aparência → Leitura e foco; the speed also comes from there.
 */
export function speakControls({ blocks, lang, label = 'Ouvir', win = window, icon: compact = false }) {
  if (!speechSupported(win)) return null;
  const doc = win.document;
  const wrap = doc.createElement('span');
  wrap.className = `speak-controls${compact ? ' speak-compact' : ''}`;
  const play = doc.createElement('button');
  play.type = 'button';
  play.className = compact ? 'icon-action speak-button' : 'secondary-action speak-button';
  const stop = doc.createElement('button');
  stop.type = 'button';
  stop.className = compact ? 'icon-action speak-stop' : 'text-action speak-stop';
  stop.hidden = true;
  const show = (button, text, iconName) => {
    if (!compact) {
      button.textContent = text;
      return;
    }
    button.replaceChildren(icon(doc, iconName));
    button.setAttribute('aria-label', text);
    button.title = text;
  };
  show(stop, 'Parar', 'stop');
  const speaker = createSpeaker({
    blocks,
    lang,
    win,
    onState: (state) => {
      show(play, state === 'idle' ? label : LABELS[state], state);
      play.setAttribute('aria-pressed', String(state !== 'idle'));
      stop.hidden = state === 'idle';
    },
  });
  show(play, label, 'idle');
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
