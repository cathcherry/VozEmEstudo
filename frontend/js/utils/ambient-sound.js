// Ambient sound for studying, generated in the browser with Web Audio (no recordings, so no
// licensing or downloads). Independent from the focus timer. While a lesson recording plays,
// the volume can drop automatically ("ducking") and come back when it pauses.
//
// Separate HTML pages mean the sound stops on navigation; browsers also forbid starting audio
// without a click, so the next page offers "Retomar som" instead of resuming by itself.

export const SOUNDS = [
  ['brown', 'Ruído marrom', 'Grave e constante, ajuda a abafar conversas.'],
  ['rain', 'Chuva suave', 'Chiado leve que sobe e desce devagar.'],
  ['waves', 'Ondas', 'Ruído grave que vem e vai em ciclos longos.'],
];
const KINDS = SOUNDS.map(([key]) => key);

export function normalizeAmbient(value = {}) {
  const volume = Number(value.volume);
  return {
    kind: KINDS.includes(value.kind) ? value.kind : 'brown',
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.4,
    duck: value.duck !== false,
    // Follow the focus timer: play when a focus block starts, pause when it pauses or ends.
    withFocus: value.withFocus === true,
    playing: value.playing === true,
  };
}

function noiseBuffer(context, kind) {
  const seconds = 4;
  const buffer = context.createBuffer(2, context.sampleRate * seconds, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (kind === 'rain') {
        // Pink-ish noise (Paul Kellet's economy filter).
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
      } else {
        // Brown noise: integrated white noise.
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2;
      }
    }
  }
  return buffer;
}

/** A player bound to one page. `onChange(state)` reports every change. */
export function createAmbientPlayer({ initial = {}, onChange = () => {} } = {}) {
  const state = normalizeAmbient(initial);
  state.playing = false; // never resumes by itself (browser autoplay rules)
  let context = null,
    source = null,
    gain = null,
    lfo = null,
    ducked = false;

  const target = () => state.volume * (ducked && state.duck ? 0.2 : 1) * 0.6;
  const emit = () => onChange({ ...state, ducked });

  function stopNodes() {
    for (const node of [source, lfo]) {
      try {
        node?.stop();
      } catch {
        /* already stopped */
      }
    }
    source = lfo = null;
  }
  function build() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error('Este navegador não toca sons gerados.');
    context ||= new Context();
    stopNodes();
    gain ||= context.createGain();
    gain.connect(context.destination);
    source = context.createBufferSource();
    source.buffer = noiseBuffer(context, state.kind === 'rain' ? 'rain' : 'brown');
    source.loop = true;
    let node = source;
    if (state.kind === 'rain') {
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 400;
      node.connect(filter);
      node = filter;
    } else {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = state.kind === 'waves' ? 700 : 1000;
      node.connect(filter);
      node = filter;
    }
    // Slow swell for rain and waves.
    if (state.kind !== 'brown') {
      const swell = context.createGain();
      swell.gain.value = 0.75;
      lfo = context.createOscillator();
      lfo.frequency.value = state.kind === 'waves' ? 1 / 9 : 1 / 23;
      const depth = context.createGain();
      depth.gain.value = state.kind === 'waves' ? 0.6 : 0.2;
      lfo.connect(depth).connect(swell.gain);
      lfo.start();
      node.connect(swell);
      node = swell;
    }
    node.connect(gain);
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(target(), context.currentTime + 1.2);
    source.start();
  }
  function ramp() {
    if (gain && context) gain.gain.setTargetAtTime(target(), context.currentTime, 0.25);
  }

  return {
    state: () => ({ ...state, ducked }),
    async play() {
      build();
      await context.resume?.();
      state.playing = true;
      emit();
    },
    pause() {
      if (gain && context) gain.gain.setTargetAtTime(0, context.currentTime, 0.15);
      setTimeout(stopNodes, 400);
      state.playing = false;
      emit();
    },
    async setKind(kind) {
      if (!KINDS.includes(kind)) return;
      state.kind = kind;
      if (state.playing) build();
      emit();
    },
    setVolume(volume) {
      state.volume = normalizeAmbient({ volume }).volume;
      ramp();
      emit();
    },
    setDuck(on) {
      state.duck = Boolean(on);
      ramp();
      emit();
    },
    setWithFocus(on) {
      state.withFocus = Boolean(on);
      emit();
    },
    /** A lesson recording started (true) or stopped (false). */
    duck(on) {
      ducked = Boolean(on);
      ramp();
      emit();
    },
  };
}
