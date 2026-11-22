import { iconMarkup } from './icons.js';
// Shared icon set (frontend/js/utils/icons.js). The skip buttons add a small "10" beside the icon.
const svg = (name) =>
  name === 'rewind' || name === 'forward'
    ? `${iconMarkup(name)}<small class="player-skip-amount" aria-hidden="true">10</small>`
    : iconMarkup(name);
export function timeLabel(seconds = 0, precision = false) {
  const value = precision
    ? Math.round(Math.max(0, Number(seconds) || 0) * 100) / 100
    : Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600),
    minutes = Math.floor((value % 3600) / 60),
    secs = Math.floor(value % 60);
  const fraction = precision ? `,${String(Math.round((value % 1) * 100)).padStart(2, '0')}` : '';
  return `${hours ? hours + ':' : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${fraction}`;
}

export class MediaPlayer {
  constructor(container, { trim = false, onRangeChange = () => {}, onError = () => {} } = {}) {
    this.root = container;
    this.trim = trim;
    this.onRangeChange = onRangeChange;
    this.onError = onError;
    this.duration = 0;
    this.start = 0;
    this.end = 0;
    this.previewSelection = false;
    this.peaks = [];
    this.timelineStart = 0;
    this.timelineDuration = 0;
    this.pendingPosition = null;
    container.classList.add('media-player');
    container.tabIndex = 0;
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Player de mídia. Espaço reproduz ou pausa; setas avançam ou voltam dez segundos.');
    container.innerHTML = `<div class="player-heading"><span class="player-cover" aria-hidden="true">♫</span><div><strong data-player-title>Gravação da aula</strong><span data-player-type>Áudio</span></div><span class="player-format" data-player-format></span></div>
      <div class="video-preview" hidden><video playsinline preload="metadata"></video></div><audio preload="metadata"></audio>
      <div class="waveform-shell"><canvas aria-hidden="true"></canvas><div class="waveform-selection" hidden></div><input type="range" class="player-seek" min="0" max="0" step="0.01" value="0" aria-label="Posição da reprodução"><span class="waveform-note">Linha do tempo</span></div>
      <div class="player-controls"><div class="transport"><button type="button" class="player-icon" data-rewind aria-label="Voltar 10 segundos">${svg('rewind')}</button><button type="button" class="player-play" aria-label="Reproduzir">${svg('play')}</button><button type="button" class="player-icon" data-forward aria-label="Avançar 10 segundos">${svg('forward')}</button></div><span class="player-time"><span data-current-time>00:00</span> / <span data-duration>00:00</span></span><label class="player-speed"><span class="sr-only">Velocidade</span><select aria-label="Velocidade de reprodução"><option value="0.75">0,75×</option><option selected value="1">1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></label><label class="player-volume"><span aria-hidden="true">♪</span><input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></label></div>
      <div class="trim-editor" ${trim ? '' : 'hidden'}><div class="trim-title"><div><strong>Escolha o trecho</strong></div><span class="trim-badge" data-trim-duration>Arquivo inteiro</span></div><div class="trim-ranges"><label><span>Início</span><input type="range" min="0" max="0" step="0.1" value="0" data-trim-start-range aria-label="Início do recorte"></label><label><span>Fim</span><input type="range" min="0" max="0" step="0.1" value="0" data-trim-end-range aria-label="Fim do recorte"></label></div><div class="trim-fields"><label><span>Início</span><input type="text" inputmode="numeric" data-trim-start aria-label="Início em minutos e segundos" value="00:00"></label><label><span>Fim</span><input type="text" inputmode="numeric" data-trim-end aria-label="Fim em minutos e segundos" value="00:00"></label><button type="button" class="secondary-action" data-preview-trim>Ouvir trecho</button><button type="button" class="text-action" data-reset-trim>Usar arquivo inteiro</button></div></div><p class="player-message" role="status" aria-live="polite"></p>`;
    this.audio = container.querySelector('audio');
    this.video = container.querySelector('video');
    this.media = this.audio;
    this.seek = container.querySelector('.player-seek');
    this.playButton = container.querySelector('.player-play');
    this.canvas = container.querySelector('canvas');
    for (const media of [this.audio, this.video]) {
      media.addEventListener('loadedmetadata', () => {
        if (media !== this.media || !Number.isFinite(media.duration)) return;
        this.setDuration(this.timelineDuration ? Math.min(this.timelineDuration, media.duration - this.timelineStart) : media.duration, !this.duration);
        if (this.pendingPosition !== null) { this.seekTo(this.pendingPosition, false); this.pendingPosition = null; }
        if (this.resumeOnLoad) { this.resumeOnLoad = false; void this.play(); }
      });
      media.addEventListener('timeupdate', () => { if (media === this.media) this.updateTime(); });
      media.addEventListener('play', () => this.updatePlay()); media.addEventListener('pause', () => this.updatePlay()); media.addEventListener('ended', () => this.updatePlay());
      media.addEventListener('error', () => {
        if (media !== this.media || !this.source) return;
        this.message(this.trim ? 'A prévia deste formato não está disponível no navegador. O recorte pelo servidor continua disponível.' : 'Não foi possível carregar a mídia. Renove o acesso ou tente o outro formato disponível.');
        this.onError();
      });
    }
    this.playButton.addEventListener('click', () => {
      this.previewSelection = false;
      if (this.media.paused) this.play();
      else this.media.pause();
    });
    container.querySelector('[data-rewind]').addEventListener('click', () => this.jump(-10));
    container.querySelector('[data-forward]').addEventListener('click', () => this.jump(10));
    this.seek.addEventListener('input', () => this.seekTo(Number(this.seek.value), false));
    const speed = container.querySelector('.player-speed select');
    speed.insertBefore(new Option('0,5×', '0.5'), speed.firstChild);
    speed.append(new Option('2,5×', '2.5'), new Option('3×', '3'));
    speed.addEventListener('change', (e) => this.setPlaybackRate(Number(e.target.value)));
    container.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
          event.target.closest('input,textarea,select,button,a,[contenteditable]')) return;
      if ([' ', 'k', 'K'].includes(event.key)) {
        event.preventDefault(); if (this.media.paused) void this.play(); else this.media.pause();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); this.jump(event.key === 'ArrowLeft' ? -10 : 10);
      }
    });
    container.querySelector('.player-volume input').addEventListener('input', (e) => {
      this.media.volume = Number(e.target.value);
    });
    const rangeFields = [
      ['[data-trim-start-range]', 'start'],
      ['[data-trim-end-range]', 'end'],
      ['[data-trim-start]', 'start'],
      ['[data-trim-end]', 'end'],
    ];
    for (const [selector, edge] of rangeFields)
      container
        .querySelector(selector)
        .addEventListener('input', (e) =>
          this.setEdge(
            edge,
            e.target.type === 'text'
              ? e.target.value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
              : e.target.value,
          ),
        );
    container.querySelector('[data-preview-trim]').addEventListener('click', () => {
      this.seekTo(this.start, false);
      this.previewSelection = true;
      void this.play();
    });
    container.querySelector('[data-reset-trim]').addEventListener('click', () => {
      this.start = 0;
      this.end = this.duration;
      this.updateRange();
    });
    if (trim) {
      for (const edge of ['start', 'end']) {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'waveform-handle';
        handle.dataset.edge = edge;
        handle.setAttribute('role', 'slider');
        handle.setAttribute(
          'aria-label',
          edge === 'start' ? 'Início do recorte' : 'Fim do recorte',
        );
        handle.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', (event) => {
          if (!handle.hasPointerCapture(event.pointerId)) return;
          const bounds = this.canvas.parentElement.getBoundingClientRect();
          this.setEdge(edge, ((event.clientX - bounds.left) / bounds.width) * this.duration);
        });
        handle.addEventListener('keydown', (event) => {
          const change = event.shiftKey ? 10 : 1;
          if (
            ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)
          ) {
            event.preventDefault();
            this.setEdge(
              edge,
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? this.duration
                  : this[edge] +
                    (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -change : change),
            );
          }
        });
        this.canvas.parentElement.append(handle);
      }
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(container);
    }
  }
  setSource({ src, title = 'Gravação da aula', video = false, format = '', duration = 0, peaks = [], timelineStart = 0, timelineDuration = 0, preservePosition = false }) {
    if (this.source !== src) {
      this.pendingPosition = preservePosition ? this.currentTime : 0;
      this.resumeOnLoad = preservePosition && !this.media.paused;
      this.media.pause(); this.audio.removeAttribute('src'); this.video.removeAttribute('src');
      this.timelineStart = Math.max(0, timelineStart); this.timelineDuration = Math.max(0, timelineDuration);
      this.source = src; this.media = video ? this.video : this.audio; this.media.src = src;
      this.media.playbackRate = Number(this.root.querySelector('.player-speed select').value); this.media.volume = Number(this.root.querySelector('.player-volume input').value);
      this.root.querySelector('.video-preview').hidden = !video; this.duration = 0; this.start = 0; this.end = 0; this.previewSelection = false; this.peaks = [];
      this.message('');
    }
    this.root.querySelector('[data-player-title]').textContent = title;
    this.root.querySelector('[data-player-title]').title = title;
    this.root.querySelector('[data-player-type]').textContent = video ? 'Vídeo com áudio' : 'Áudio';
    this.root.querySelector('[data-player-format]').textContent = format.toUpperCase();
    if (duration) this.setDuration(duration, !this.duration);
    if (peaks.length) this.setPeaks(peaks);
    this.updatePlay();
  }
  setDuration(seconds, reset = false) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.duration = seconds;
    this.seek.max = String(seconds);
    for (const field of this.root.querySelectorAll(
      '[data-trim-start-range],[data-trim-end-range],[data-trim-start],[data-trim-end]',
    ))
      field.max = String(seconds);
    if (reset || !this.end) {
      this.start = 0;
      this.end = seconds;
    } else this.end = Math.min(this.end, seconds);
    this.root.querySelector('[data-duration]').textContent = timeLabel(seconds);
    this.updateRange();
    this.draw();
  }
  setPeaks(peaks) {
    this.peaks = peaks;
    this.root.querySelector('.waveform-note').hidden = Boolean(peaks.length);
    this.draw();
  }
  setEdge(edge, value) {
    const number = Number(value);
    if (!Number.isFinite(number) || !this.duration) return;
    this.previewSelection = false;
    this.media.pause();
    if (edge === 'start') this.start = Math.max(0, Math.min(number, this.end - 0.1));
    else this.end = Math.max(this.start + 0.1, Math.min(number, this.duration));
    this.updateRange();
  }
  updateRange() {
    const values = {
      '[data-trim-start]': this.start,
      '[data-trim-start-range]': this.start,
      '[data-trim-end]': this.end,
      '[data-trim-end-range]': this.end,
    };
    for (const [selector, value] of Object.entries(values))
      this.root.querySelector(selector).value = selector.endsWith('-range]')
        ? String(Math.round(value * 100) / 100)
        : timeLabel(value);
    const selection = this.root.querySelector('.waveform-selection');
    selection.hidden = !this.trim || !this.duration;
    selection.style.left = `${(100 * this.start) / (this.duration || 1)}%`;
    selection.style.width = `${(100 * (this.end - this.start)) / (this.duration || 1)}%`;
    this.root.querySelector('[data-trim-duration]').textContent =
      `${timeLabel(this.start)} → ${timeLabel(this.end)} · ${timeLabel(this.end - this.start)}`;
    for (const handle of this.root.querySelectorAll('.waveform-handle')) {
      const value = this[handle.dataset.edge];
      handle.style.left = `${(100 * value) / (this.duration || 1)}%`;
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(this.duration));
      handle.setAttribute('aria-valuenow', String(value));
      handle.setAttribute('aria-valuetext', timeLabel(value));
    }
    this.onRangeChange(this.getRange());
    this.draw();
  }
  getRange() { return { start: this.start, end: this.end }; }
  async play() { try {
    if (this.timelineDuration && this.currentTime >= this.duration - .05) this.seekTo(0, false);
    await this.media.play(); this.message('');
  } catch { this.message(this.trim ? 'Não foi possível reproduzir a prévia neste navegador. O recorte continua disponível.' : 'Não foi possível reproduzir. Tente renovar o acesso à mídia.'); } }
  get currentTime() { return Math.max(0, (this.media.currentTime || 0) - this.timelineStart); }
  setPlaybackRate(value) {
    const speed = this.root.querySelector('.player-speed select');
    const safe = [...speed.options].some((option) => Number(option.value) === value) ? value : 1;
    speed.value = String(safe); this.media.playbackRate = safe;
  }
  jump(delta) { this.seekTo(this.currentTime + delta, false); }
  seekTo(seconds, play = true) {
    if (!Number.isFinite(Number(seconds))) return;
    this.previewSelection = false;
    const position = Math.max(0, Math.min(this.duration || Infinity, Number(seconds)));
    if (this.media.readyState < 1) this.pendingPosition = position;
    else this.media.currentTime = this.timelineStart + position;
    this.updateTime(); if (play) void this.play();
  }
  updateTime() {
    if (this.previewSelection && this.currentTime >= this.end) { this.media.pause(); this.previewSelection = false; this.media.currentTime = this.timelineStart + this.end; }
    if (this.timelineDuration && this.currentTime >= this.duration && !this.media.paused) {
      this.media.pause(); this.media.currentTime = this.timelineStart + this.duration;
    }
    this.seek.value = String(this.currentTime); this.seek.setAttribute('aria-valuetext', `${timeLabel(this.currentTime)} de ${timeLabel(this.duration)}`);
    this.root.querySelector('[data-current-time]').textContent = timeLabel(this.currentTime); this.draw();
  }
  updatePlay() {
    const playing = !this.media.paused;
    this.playButton.innerHTML = svg(playing ? 'pause' : 'play');
    this.playButton.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
  }
  message(text) {
    this.root.querySelector('.player-message').textContent = text;
  }
  draw() {
    const width = this.canvas.parentElement.clientWidth || 600,
      height = 78,
      ratio = window.devicePixelRatio || 1;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    const style = getComputedStyle(this.root),
      accent = style.getPropertyValue('--accent').trim(),
      muted = style.getPropertyValue('--border').trim();
    if (!this.peaks.length) {
      context.fillStyle = muted;
      context.fillRect(0, height / 2, width, 2);
      return;
    }
    const count = Math.min(this.peaks.length, Math.floor(width / 4)),
      max = Math.max(0.05, ...this.peaks);
    for (let i = 0; i < count; i++) {
      const peak = this.peaks[Math.floor((i * this.peaks.length) / count)],
        x = (i * width) / count,
        h = Math.max(3, (peak / max) * 60),
        second = (i / count) * this.duration;
      context.fillStyle = second <= this.currentTime ? accent : muted;
      context.globalAlpha = this.trim && (second < this.start || second > this.end) ? 0.25 : 1;
      context.fillRect(x, (height - h) / 2, Math.max(2, width / count - 2), h);
    }
  }
  destroy() {
    this.observer?.disconnect();
    for (const m of [this.audio, this.video]) {
      m.pause();
      m.removeAttribute('src');
      m.load();
    }
  }
}

