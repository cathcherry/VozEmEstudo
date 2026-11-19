/**
 * In-player captions for the lesson recording.
 *
 * Modes: 'off' | 'segment' | 'word'. Cues come from the saved transcript segments (the recognized
 * and reviewed text, never a cleaned or translated copy). Word highlighting uses only real word
 * timings served by /captions for the current revision; without them it falls back to segments.
 * Times are relative to the transcribed clip, which is exactly MediaPlayer.currentTime (the
 * player already subtracts the original-MP4 offset), so playback speed and seeking need no
 * special handling. The DOM is touched only when the active cue or word changes.
 */
export const CAPTION_MODES = Object.freeze(['off', 'segment', 'word']);
export const CAPTION_SIZES = Object.freeze(['small', 'medium', 'large']);
const PREF_KEY = 'voz-caption-preferences';
const MAX_SEGMENT_MS = 45000;

export function loadCaptionPrefs(storage = window.VozAppearance?.storage) {
  let saved = {};
  try {
    saved = JSON.parse(storage?.get(PREF_KEY, '{}') || '{}') || {};
  } catch {
    /* Invalid preferences fall back to defaults. */
  }
  return {
    mode: CAPTION_MODES.includes(saved.mode) ? saved.mode : 'off',
    size: CAPTION_SIZES.includes(saved.size) ? saved.size : 'medium',
  };
}
export function saveCaptionPrefs(prefs, storage = window.VozAppearance?.storage) {
  storage?.set(PREF_KEY, JSON.stringify(prefs));
}

/** Builds ordered cues; returns [] when segment timing is too coarse to caption honestly. */
export function buildCues(segments = [], words = []) {
  // Real word timings make any segmentation usable. Without them, a single segment spanning the
  // whole recording (text-only ASR fallback) or very long segments would caption the wrong time.
  const usable =
    segments.length > 0 &&
    segments.every((s) => s.end_ms > s.start_ms) &&
    (words.length > 0 ||
      (segments.length > 1 && segments.every((s) => s.end_ms - s.start_ms < MAX_SEGMENT_MS)));
  if (!usable) return [];
  const byPosition = new Map();
  for (const word of words) {
    if (!byPosition.has(word.segment)) byPosition.set(word.segment, []);
    byPosition.get(word.segment).push(word);
  }
  const speakers = new Set(words.map((w) => w.speaker).filter(Boolean));
  return segments.map((segment, index) => {
    const own = byPosition.get(segment.position ?? index) || [];
    return {
      startMs: Number(segment.start_ms),
      endMs: Number(segment.end_ms),
      text: segment.current_text,
      words: own.length ? own : null,
      speaker: speakers.size > 1 ? own[0]?.speaker || null : null,
    };
  });
}

/** Binary search for the cue containing `ms` (half-open ranges); -1 in gaps. */
export function cueAt(cues, ms) {
  let low = 0,
    high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ms < cues[mid].startMs) high = mid - 1;
    else if (ms >= cues[mid].endMs) low = mid + 1;
    else return mid;
  }
  return -1;
}
/** Index of the last word that has started at `ms` within a cue (or -1 before the first). */
export function wordAt(words, ms) {
  let found = -1;
  for (let i = 0; i < words.length && words[i].startMs <= ms; i += 1) found = i;
  return found;
}

const MODE_LABELS = { off: 'Desligadas', segment: 'Por trecho', word: 'Palavra a palavra' };
const SIZE_LABELS = { small: 'P', medium: 'M', large: 'G' };

export class PlayerCaptions {
  constructor(player, { storage } = {}) {
    this.player = player;
    this.storage = storage;
    this.prefs = loadCaptionPrefs(storage);
    this.cues = [];
    this.hasWords = false;
    this.cueIndex = -2;
    this.wordIndex = -2;
    this.frame = 0;
    const root = player.root;
    root.classList.add('has-captions');
    // Video: overlay near the bottom of the image. Audio: a band between waveform and controls.
    this.layer = document.createElement('div');
    this.layer.className = 'caption-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    this.line = document.createElement('p');
    this.line.className = 'caption-line';
    this.layer.append(this.line);
    this.band = document.createElement('div');
    this.band.className = 'caption-band';
    // Assistive tech already has the full transcript; the visual caption is not announced.
    this.band.setAttribute('aria-hidden', 'true');
    // Words go in an inline-flow paragraph: a flex container would drop the spaces between them.
    this.bandText = document.createElement('p');
    this.bandText.className = 'caption-band-text';
    this.band.append(this.bandText);
    root.querySelector('.video-preview').append(this.layer);
    root.querySelector('.waveform-shell').after(this.band);
    this.buildMenu(root);
    this.tick = this.tick.bind(this);
    this.onTime = () => this.render();
    for (const media of [player.audio, player.video]) {
      media.addEventListener('play', this.tick);
      media.addEventListener('seeked', this.onTime);
      media.addEventListener('timeupdate', this.onTime);
    }
    this.apply();
  }
  buildMenu(root) {
    const wrap = document.createElement('div');
    wrap.className = 'caption-control';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'player-icon caption-toggle';
    this.button.textContent = 'CC';
    this.button.setAttribute('aria-haspopup', 'true');
    this.button.setAttribute('aria-expanded', 'false');
    this.menu = document.createElement('div');
    this.menu.className = 'caption-menu';
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'group');
    this.menu.setAttribute('aria-label', 'Legendas');
    const modeGroup = document.createElement('fieldset');
    const modeLegend = document.createElement('legend');
    modeLegend.textContent = 'Legendas';
    modeGroup.append(modeLegend);
    this.modeInputs = {};
    for (const mode of CAPTION_MODES) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `caption-mode-${Math.random().toString(36).slice(2, 8)}`;
      input.value = mode;
      input.addEventListener('change', () => this.setPrefs({ mode }));
      this.modeInputs[mode] = { input, label };
      label.append(input, ` ${MODE_LABELS[mode]}`);
      modeGroup.append(label);
    }
    for (const { input } of Object.values(this.modeInputs))
      input.name = this.modeInputs.off.input.name;
    this.wordNote = document.createElement('small');
    this.wordNote.className = 'caption-note';
    modeGroup.append(this.wordNote);
    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'caption-sizes';
    sizeGroup.setAttribute('role', 'group');
    sizeGroup.setAttribute('aria-label', 'Tamanho da legenda');
    this.sizeButtons = CAPTION_SIZES.map((size) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = SIZE_LABELS[size];
      b.dataset.size = size;
      b.setAttribute(
        'aria-label',
        `Legenda ${{ small: 'pequena', medium: 'média', large: 'grande' }[size]}`,
      );
      b.addEventListener('click', () => this.setPrefs({ size }));
      sizeGroup.append(b);
      return b;
    });
    this.menu.append(modeGroup, sizeGroup);
    wrap.append(this.button, this.menu);
    root.querySelector('.player-controls').insertBefore(wrap, root.querySelector('.player-speed'));
    const close = (restore) => {
      if (this.menu.hidden) return;
      this.menu.hidden = true;
      this.button.setAttribute('aria-expanded', 'false');
      if (restore) this.button.focus();
    };
    this.button.addEventListener('click', () => {
      const open = this.menu.hidden;
      this.menu.hidden = !open;
      this.button.setAttribute('aria-expanded', String(open));
      if (open) this.menu.querySelector('input:checked, input:not(:disabled)')?.focus();
    });
    this.onKey = (event) => {
      if (event.key === 'Escape' && !this.menu.hidden && wrap.contains(document.activeElement)) {
        event.stopPropagation();
        close(true);
      }
    };
    this.onPointer = (event) => {
      if (!wrap.contains(event.target)) close(false);
    };
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onPointer);
  }
  /** New transcript data (after load, save or restore). */
  setTranscript(segments, words = []) {
    this.cues = buildCues(segments, words);
    this.hasWords = this.cues.some((cue) => cue.words);
    this.cueIndex = this.wordIndex = -2;
    this.apply();
  }
  setPrefs(change) {
    this.prefs = { ...this.prefs, ...change };
    saveCaptionPrefs(this.prefs, this.storage);
    this.apply();
  }
  get effectiveMode() {
    if (!this.cues.length) return 'off';
    if (this.prefs.mode === 'word' && !this.hasWords) return 'segment';
    return this.prefs.mode;
  }
  apply() {
    const available = this.cues.length > 0;
    const mode = this.effectiveMode;
    this.button.disabled = !available;
    this.button.title = available ? 'Legendas' : 'Legendas indisponíveis para esta gravação';
    this.button.setAttribute(
      'aria-label',
      available ? `Legendas: ${MODE_LABELS[mode]}` : 'Legendas indisponíveis',
    );
    this.button.setAttribute('aria-pressed', String(mode !== 'off'));
    for (const [value, { input }] of Object.entries(this.modeInputs)) {
      input.checked =
        value === (this.prefs.mode === 'word' && !this.hasWords ? 'segment' : this.prefs.mode);
      input.disabled = value === 'word' && !this.hasWords;
    }
    this.wordNote.textContent = this.hasWords
      ? ''
      : 'Destaque por palavra indisponível: sem tempos de palavra válidos para esta revisão.';
    this.wordNote.hidden = this.hasWords;
    for (const b of this.sizeButtons)
      b.setAttribute('aria-pressed', String(b.dataset.size === this.prefs.size));
    this.player.root.dataset.captions = mode;
    this.player.root.dataset.captionSize = this.prefs.size;
    this.cueIndex = this.wordIndex = -2;
    this.render();
  }
  tick() {
    cancelAnimationFrame(this.frame);
    const loop = () => {
      this.render();
      if (!this.player.media.paused && this.effectiveMode === 'word')
        this.frame = requestAnimationFrame(loop);
    };
    loop();
  }
  render() {
    const mode = this.effectiveMode;
    const host = this.player.media === this.player.video ? this.line : this.bandText;
    const other = host === this.line ? this.bandText : this.line;
    if (other.childNodes.length) other.replaceChildren();
    if (mode === 'off') {
      if (host.childNodes.length) host.replaceChildren();
      this.cueIndex = -1;
      return;
    }
    const ms = this.player.currentTime * 1000;
    const index = cueAt(this.cues, ms);
    if (index !== this.cueIndex || host.dataset.mode !== mode || !host.isConnected) {
      this.cueIndex = index;
      this.wordIndex = -2;
      host.dataset.mode = mode;
      const cue = this.cues[index];
      host.replaceChildren();
      if (cue) {
        if (cue.speaker) {
          const speaker = document.createElement('span');
          speaker.className = 'caption-speaker';
          speaker.textContent = `${cue.speaker}:`;
          host.append(speaker, ' ');
        }
        if (mode === 'word' && cue.words)
          cue.words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'caption-word';
            span.textContent = word.text;
            host.append(span, i < cue.words.length - 1 ? ' ' : '');
          });
        else host.append(cue.text);
      }
    }
    const cue = this.cues[index];
    if (mode !== 'word' || !cue?.words) return;
    const active = wordAt(cue.words, ms);
    if (active === this.wordIndex) return;
    this.wordIndex = active;
    host.querySelectorAll('.caption-word').forEach((span, i) => {
      span.classList.toggle('is-spoken', i === active && ms < cue.words[i].endMs + 250);
      span.classList.toggle(
        'is-past',
        i < active || (i === active && ms >= cue.words[i].endMs + 250),
      );
    });
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onPointer);
    for (const media of [this.player.audio, this.player.video]) {
      media.removeEventListener('play', this.tick);
      media.removeEventListener('seeked', this.onTime);
      media.removeEventListener('timeupdate', this.onTime);
    }
  }
}
