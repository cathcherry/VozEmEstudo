import { icon as uiIcon } from './icons.js';
/**
 * Text-to-speech with the browser's built-in voices (Web Speech API). Runs locally or through
 * the operating system's voice service: no app server, no AI provider and no tokens.
 * Reads one block at a time (paragraph, list item, question, alternative) and marks the block
 * being read with .is-speaking, so students can follow along. Long blocks are spoken in short
 * passages (by sentence, then by clause): Chrome's network voices drop or cut off utterances
 * longer than a few hundred characters or about 15 seconds, which used to skip whole paragraphs
 * while short headings were still read.
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
// About 10–15 s of speech at the slowest rate; well under the length at which Chrome fails.
export const MAX_PASSAGE = 180;

export function speechSupported(win = window) {
  return Boolean(win.speechSynthesis && win.SpeechSynthesisUtterance);
}
export function speechLang(code) {
  const base = String(code || 'pt')
    .toLowerCase()
    .split(/[-_]/)[0];
  return LANGS[base] || base;
}

const SPLITS = [/(?<=[.!?…]+["'”’»)\]]*)\s+/, /(?<=[,;:—–])\s+/, /\s+/];
function pack(parts, max) {
  const out = [];
  let passage = '';
  for (const part of parts) {
    if (!passage) passage = part;
    else if (passage.length + 1 + part.length <= max) passage += ` ${part}`;
    else {
      out.push(passage);
      passage = part;
    }
  }
  if (passage) out.push(passage);
  return out;
}
function pieces(text, max, level = 0) {
  if (text.length <= max) return [text];
  for (let n = level; n < SPLITS.length; n += 1) {
    const parts = text.split(SPLITS[n]).filter(Boolean);
    if (parts.length > 1) return parts.flatMap((part) => pieces(part, max, n + 1));
  }
  const out = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}
/**
 * Splits a block into passages of at most `max` characters: whole sentences when they fit,
 * otherwise clauses (commas, semicolons, dashes), and words as a last resort. Short sentences are
 * joined so the voice keeps a natural rhythm.
 */
export function splitSpeech(text, max = MAX_PASSAGE) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  return clean.length <= max ? [clean] : pack(pieces(clean, max), max);
}

/**
 * A voice for the language: exact locale first (pt-BR), then the same language (pt-PT), or none
 * (the browser then chooses by `lang`). Local voices come first: network voices need a
 * connection and are the ones that cut off long text.
 */
export function pickVoice(synth, lang) {
  const voices = synth.getVoices?.() || [];
  const norm = (voice) =>
    String(voice.lang || '')
      .replace('_', '-')
      .toLowerCase();
  const wanted = String(lang || '').toLowerCase();
  const exact = voices.filter((voice) => norm(voice) === wanted);
  const near = exact.length
    ? exact
    : voices.filter((voice) => norm(voice).split('-')[0] === wanted.split('-')[0]);
  return (
    near.find((voice) => voice.localService) ||
    near.find((voice) => voice.default) ||
    near[0] ||
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
  const resolveLang = () => (typeof langOption === 'function' ? langOption() : langOption);
  let lang = resolveLang();
  let state = 'idle',
    queue = [],
    current = null,
    token = 0,
    // Where to resume inside the current passage (last word boundary the voice reported).
    offset = 0,
    retried = false,
    marked = null,
    // Chrome may garbage-collect an utterance nobody references and then never fire onend.
    utterance = null;
  const set = (value) => {
    state = value;
    onState(value);
  };
  function highlight(element) {
    if (marked === element) return;
    marked?.classList?.remove('is-speaking');
    marked = element?.classList ? element : null;
    if (!marked) return;
    marked.classList.add('is-speaking');
    // Keeps the passage being read on screen, without moving when it is already visible.
    const rect = marked.getBoundingClientRect?.();
    const height = win.innerHeight;
    if (!rect || !height || (rect.top >= 0 && rect.bottom <= height)) return;
    const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    marked.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }
  function finish() {
    highlight(null);
    current = null;
    queue = [];
    utterance = null;
    if (active === api) active = null;
    set('idle');
  }
  function advance(run) {
    if (run !== token) return;
    current = queue.shift() || null;
    offset = 0;
    retried = false;
    if (!current) return finish();
    speak(run);
  }
  function speak(run) {
    const from = offset;
    const text = current.text.slice(from);
    const u = new win.SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = preferredRate(win);
    const voice = retried ? null : pickVoice(synth, lang);
    if (voice) u.voice = voice;
    u.onstart = () => {
      if (run === token) highlight(current?.element);
    };
    u.onboundary = (event) => {
      if (run === token && (!event?.name || event.name === 'word') && event?.charIndex >= 0)
        offset = from + event.charIndex;
    };
    u.onend = () => advance(run);
    u.onerror = (event) => {
      if (run !== token) return;
      const error = event?.error;
      if (error === 'interrupted' || error === 'canceled') return;
      // Blocked without a click (autoplay policy): nothing else would play either.
      if (error === 'not-allowed') return api.stop();
      // A network voice that fails: the same passage once more with the browser's default voice.
      if (voice && !retried) {
        retried = true;
        offset = from;
        return speak(run);
      }
      advance(run);
    };
    utterance = u;
    synth.speak(u);
  }
  const api = {
    get state() {
      return state;
    },
    start() {
      if (active && active !== api) active.stop();
      token += 1;
      synth.cancel();
      if (synth.paused) synth.resume?.();
      highlight(null);
      lang = resolveLang();
      queue = blocks().flatMap((block) =>
        splitSpeech(block.text).map((text) => ({ element: block.element, text })),
      );
      current = null;
      if (!queue.length) return finish();
      active = api;
      set('speaking');
      advance(token);
    },
    /**
     * Pausing cancels and resuming speaks again from the last word reached: Chrome loses a
     * paused network voice after about 15 s and Android ignores pause(), so resume() is unreliable.
     */
    pause() {
      if (state !== 'speaking') return;
      token += 1;
      synth.cancel();
      set('paused');
    },
    resume() {
      if (state !== 'paused' || !current) return;
      if (active && active !== api) active.stop();
      active = api;
      token += 1;
      set('speaking');
      speak(token);
    },
    toggle() {
      if (state === 'idle') api.start();
      else if (state === 'speaking') api.pause();
      else api.resume();
    },
    stop() {
      token += 1;
      synth.cancel();
      finish();
    },
    /** The utterance being spoken (kept referenced on purpose). */
    get utterance() {
      return utterance;
    },
  };
  return api;
}

const LABELS = { idle: 'Ouvir', speaking: 'Pausar leitura', paused: 'Continuar leitura' };
// Shared icon set (frontend/js/utils/icons.js).
const ICONS = { idle: 'speak', speaking: 'pause', paused: 'play', stop: 'stop' };
const icon = (doc, name) => {
  const span = doc.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.append(uiIcon(ICONS[name], { document: doc }));
  return span;
};
/**
 * Play/pause button plus a stop button that appears while reading. Null when unsupported.
 * `icon: true` renders compact icon buttons (name kept in aria-label and tooltip). Students can
 * hide every reader in Aparência → Leitura e foco; the speed also comes from there.
 */
export function speakControls({
  blocks,
  lang,
  label = 'Ouvir',
  win = window,
  icon: compact = false,
}) {
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
