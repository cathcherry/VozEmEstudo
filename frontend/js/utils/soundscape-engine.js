// Procedural soundscape engine (Web Audio). Every layer is generated in the browser — filtered
// noise, short textures rendered once into buffers, slowly drifting filters and gains, and rare
// randomized events — so there are no recordings and no licences, and nothing is downloaded.
//
// CPU budget: buffers are rendered once per page and reused by every layer that needs them;
// layers that are switched off are torn down after their fade; short events (birds, page turns,
// cup clinks, thunder) are capped at MAX_VOICES at a time; one timer drives all modulation.
// The AudioContext is created only inside start(), which the interface calls from a click.
import { LAYER_IDS, layerGains, masterGain } from './soundscape-mix.js';

export const MAX_VOICES = 12;
const TICK_MS = 250;
const FADE = 0.35; // time constant of volume changes (s)

/** Small deterministic-friendly helpers around a random source. */
function randomKit(random) {
  const between = (min, max) => min + random() * (max - min);
  return {
    random,
    between,
    pick: (list) => list[Math.floor(random() * list.length) % list.length],
  };
}

// ---- textures rendered once ------------------------------------------------------------------

function renderNoise(ctx, kind, seconds, rnd) {
  const length = Math.floor(ctx.sampleRate * seconds);
  // Rendered a little longer, then the extra tail is crossfaded into the head: seamless loop.
  const fade = Math.min(length >> 3, Math.floor(ctx.sampleRate * 0.05));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const temp = new Float32Array(length + fade);
  for (let channel = 0; channel < 2; channel += 1) {
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      last = 0;
    for (let i = 0; i < temp.length; i += 1) {
      const white = rnd.random() * 2 - 1;
      if (kind === 'pink') {
        // Paul Kellet's economy pink filter.
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        temp[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
      } else if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        temp[i] = last * 3.3;
      } else temp[i] = white * 0.5;
    }
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      if (i < fade) {
        const w = i / fade;
        data[i] = temp[i] * w + temp[length + i] * (1 - w);
      } else data[i] = temp[i];
    }
  }
  return buffer;
}

/** Adds a decaying event to a channel (noise burst or damped sine). */
function addEvent(data, start, { samples, decay, amp, freq = 0, sweep = 0, noise = 1, rate, rnd }) {
  let phase = 0;
  for (let i = 0; i < samples; i += 1) {
    const index = (start + i) % data.length;
    const t = i / rate;
    const envelope = Math.exp(-t / decay) * Math.min(1, i / 24);
    let value = 0;
    if (noise) value += (rnd.random() * 2 - 1) * noise;
    if (freq) {
      phase += (2 * Math.PI * (freq + sweep * t)) / rate;
      value += Math.sin(phase) * (1 - noise);
    }
    data[index] += value * envelope * amp;
  }
}

function renderTexture(ctx, kind, rnd) {
  const rate = ctx.sampleRate;
  const seconds = { drops: 7.3, crackle: 9.1, bubbles: 8.3, crickets: 6.4, murmur: 9.7 }[kind];
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const both = (start, options) => {
    const pan = options.pan ?? rnd.between(-0.8, 0.8);
    const temp = new Float32Array(options.samples);
    addEvent(temp, 0, { ...options, rate, rnd });
    const l = Math.sqrt((1 - pan) / 2),
      r = Math.sqrt((1 + pan) / 2);
    for (let i = 0; i < temp.length; i += 1) {
      const index = (start + i) % length;
      left[index] += temp[i] * l;
      right[index] += temp[i] * r;
    }
  };
  if (kind === 'drops') {
    // Fine patter plus some heavier, slightly resonant drops.
    for (let n = 0; n < seconds * 150; n += 1)
      both(Math.floor(rnd.random() * length), {
        samples: Math.floor(rate * 0.012),
        decay: rnd.between(0.0015, 0.005),
        amp: rnd.random() ** 2 * 0.22,
      });
    for (let n = 0; n < seconds * 9; n += 1)
      both(Math.floor(rnd.random() * length), {
        samples: Math.floor(rate * 0.03),
        decay: rnd.between(0.004, 0.009),
        amp: rnd.between(0.08, 0.2),
        freq: rnd.between(1800, 4200),
        sweep: rnd.between(-9000, -3000),
        noise: 0.35,
      });
  } else if (kind === 'crackle') {
    let t = 0;
    while (t < seconds) {
      // Crackles come in little clusters, with quiet gaps.
      const cluster = rnd.random() < 0.3 ? Math.floor(rnd.between(3, 9)) : 1;
      for (let k = 0; k < cluster; k += 1) {
        const at = Math.floor((t + k * rnd.between(0.005, 0.04)) * rate);
        both(at, {
          samples: Math.floor(rate * 0.01),
          decay: rnd.between(0.0004, 0.0025),
          amp: rnd.random() ** 1.5 * 0.7,
        });
      }
      if (rnd.random() < 0.06)
        both(Math.floor(t * rate), {
          samples: Math.floor(rate * 0.06),
          decay: 0.012,
          amp: 0.35,
          freq: rnd.between(110, 190),
          noise: 0.4,
        });
      t += rnd.between(0.05, 0.45);
    }
  } else if (kind === 'bubbles') {
    for (let n = 0; n < seconds * 5; n += 1)
      both(Math.floor(rnd.random() * length), {
        samples: Math.floor(rate * 0.05),
        decay: rnd.between(0.008, 0.02),
        amp: rnd.between(0.04, 0.12),
        freq: rnd.between(450, 1300),
        sweep: rnd.between(4000, 14000),
        noise: 0,
      });
  } else if (kind === 'crickets') {
    for (const [freq, period, pan] of [
      [4300, 0.92, -0.6],
      [4750, 1.13, 0.5],
      [5150, 1.37, 0.05],
    ]) {
      let t = rnd.between(0, period);
      const amp = rnd.between(0.05, 0.09);
      while (t < seconds) {
        const pulses = rnd.random() < 0.5 ? 3 : 4;
        for (let p = 0; p < pulses; p += 1) {
          const start = Math.floor((t + p * 0.032) * rate);
          const samples = Math.floor(rate * 0.019);
          const l = Math.sqrt((1 - pan) / 2),
            r = Math.sqrt((1 + pan) / 2);
          for (let i = 0; i < samples; i += 1) {
            const envelope = Math.sin((Math.PI * i) / samples) ** 2;
            const value = Math.sin((2 * Math.PI * freq * i) / rate) * envelope * amp;
            left[(start + i) % length] += value * l;
            right[(start + i) % length] += value * r;
          }
        }
        t += period * rnd.between(0.9, 1.1);
      }
    }
  } else if (kind === 'murmur') {
    // Distant conversations: noise through moving vowel-like resonances, in syllables and phrases.
    for (let voice = 0; voice < 6; voice += 1) {
      const pan = rnd.between(-0.7, 0.7);
      const l = Math.sqrt((1 - pan) / 2),
        r = Math.sqrt((1 + pan) / 2);
      const pitch = rnd.between(0.8, 1.25);
      let i = Math.floor(rnd.between(0, 1.5) * rate);
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0;
      while (i < length) {
        const phrase = Math.floor(rnd.between(1, 3.2) * rate);
        const end = Math.min(length, i + phrase);
        while (i < end) {
          const syllable = Math.floor(rnd.between(0.11, 0.26) * rate);
          // A syllable cut by the loop point would click: leave the tail silent instead.
          if (i + syllable >= length) {
            i = length;
            break;
          }
          const f = rnd.between(320, 950) * pitch;
          const q = 2.2;
          const w = (2 * Math.PI * f) / rate;
          const alpha = Math.sin(w) / (2 * q);
          const a0 = 1 + alpha;
          const b0 = alpha / a0,
            a1 = (-2 * Math.cos(w)) / a0,
            a2 = (1 - alpha) / a0;
          const amp = rnd.between(0.25, 0.55);
          for (let k = 0; k < syllable && i < length; k += 1, i += 1) {
            const x0 = rnd.random() * 2 - 1;
            const y0 = b0 * x0 - b0 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
            const envelope = Math.sin((Math.PI * k) / syllable) ** 1.5 * amp * 0.5;
            left[i] += y0 * envelope * l;
            right[i] += y0 * envelope * r;
          }
        }
        i += Math.floor(rnd.between(0.4, 2.2) * rate);
      }
    }
  }
  return buffer;
}

// ---- engine -------------------------------------------------------------------------------------

/**
 * @param {{ AudioContextClass?: typeof AudioContext, random?: () => number,
 *   setTimer?: typeof setInterval, clearTimer?: typeof clearInterval }} [options]
 */
export function createSoundscapeEngine({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  random = Math.random,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
} = {}) {
  const rnd = randomKit(random);
  let ctx = null;
  let master = null;
  let bus = null;
  let timer = null;
  let mix = null;
  let ducked = false;
  let running = false;
  let voices = 0;
  let stopTimeout = null;
  const buffers = new Map();
  const layers = new Map(); // id -> { out, sources, nodes, tick, teardown }

  const now = () => ctx.currentTime;
  const buffer = (name) => {
    if (!buffers.has(name)) {
      const [type, kind] = name.split(':');
      buffers.set(
        name,
        type === 'noise' ? renderNoise(ctx, kind, 8, rnd) : renderTexture(ctx, kind, rnd),
      );
    }
    return buffers.get(name);
  };

  /** Builder kit handed to each layer: every node it makes is tracked for teardown. */
  function kit(layer) {
    const track = (node) => {
      layer.nodes.push(node);
      return node;
    };
    const chain = (...nodes) => {
      for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
      return nodes[nodes.length - 1];
    };
    return {
      ...rnd,
      now,
      chain,
      loop(name, { rate = 1 } = {}) {
        const source = track(ctx.createBufferSource());
        source.buffer = buffer(name);
        source.loop = true;
        source.playbackRate.value = rate;
        // Each use starts at its own point so shared buffers never sound in unison.
        source.start(now(), rnd.between(0, (source.buffer.duration || 1) * 0.9));
        layer.sources.push(source);
        return source;
      },
      filter(type, frequency, q = 0.7) {
        const node = track(ctx.createBiquadFilter());
        node.type = type;
        node.frequency.value = frequency;
        node.Q.value = q;
        return node;
      },
      gain(value = 1) {
        const node = track(ctx.createGain());
        node.gain.value = value;
        return node;
      },
      pan(value = 0) {
        if (!ctx.createStereoPanner) return this.gain(1);
        const node = track(ctx.createStereoPanner());
        node.pan.value = value;
        return node;
      },
      delay(seconds) {
        const node = track(ctx.createDelay(1));
        node.delayTime.value = seconds;
        return node;
      },
      /** Moves a parameter toward a random value, smoothly. */
      drift(param, min, max, timeConstant) {
        param.setTargetAtTime(rnd.between(min, max), now(), timeConstant);
      },
      /**
       * A short event outside the layer's permanent nodes. `build(output, end)` creates and
       * starts its sources; they are disconnected after `seconds`. Skipped at the voice cap.
       */
      event(seconds, build) {
        if (voices >= MAX_VOICES || !running) return false;
        voices += 1;
        const out = ctx.createGain();
        out.connect(layer.out);
        const made = [];
        const make = (node) => {
          made.push(node);
          return node;
        };
        build({ out, make, at: now() + 0.02, end: now() + seconds });
        setTimeout(
          () => {
            voices = Math.max(0, voices - 1);
            for (const node of made) {
              try {
                node.stop?.();
              } catch {
                /* already stopped */
              }
              node.disconnect?.();
            }
            out.disconnect?.();
          },
          (seconds + 0.3) * 1000,
        );
        return true;
      },
      noiseBurst(make, at, duration) {
        const source = make(ctx.createBufferSource());
        source.buffer = buffer('noise:white');
        source.start(at, rnd.between(0, 6));
        source.stop(at + duration + 0.05);
        return source;
      },
      osc(make, type, frequency, at, stopAt) {
        const node = make(ctx.createOscillator());
        node.type = type;
        node.frequency.value = frequency;
        node.start(at);
        node.stop(stopAt);
        return node;
      },
      envGain(make, at, attack, peak, release) {
        const node = make(ctx.createGain());
        node.gain.setValueAtTime(0.0001, at);
        node.gain.linearRampToValueAtTime(peak, at + attack);
        node.gain.setTargetAtTime(0.0001, at + attack, release / 4);
        return node;
      },
      filterFor(make, type, frequency, q = 0.7) {
        const node = make(ctx.createBiquadFilter());
        node.type = type;
        node.frequency.value = frequency;
        node.Q.value = q;
        return node;
      },
      panFor(make, value) {
        if (!ctx.createStereoPanner) return make(ctx.createGain());
        const node = make(ctx.createStereoPanner());
        node.pan.value = value;
        return node;
      },
    };
  }

  // Each builder wires its permanent nodes into `out` and returns tick(time) for modulation.
  const BUILDERS = {
    rain(k, out) {
      const bed = k.gain(0.9);
      k.chain(k.loop('noise:pink'), k.filter('highpass', 420), k.filter('lowpass', 6500), bed, out);
      const drops = k.gain(0.8);
      k.chain(k.loop('tex:drops'), k.filter('highpass', 900), drops, out);
      k.chain(k.loop('tex:drops', { rate: 0.93 }), k.filter('lowpass', 5200), k.gain(0.45), out);
      let next = 0;
      return (t) => {
        if (t < next) return;
        next = t + k.between(3, 8);
        k.drift(bed.gain, 0.65, 1, 2.5);
        k.drift(drops.gain, 0.55, 1, 2);
      };
    },
    ocean(k, out) {
      const swell = k.gain(0.3);
      const body = k.filter('lowpass', 400);
      k.chain(k.loop('noise:brown'), body, swell, out);
      const foam = k.gain(0);
      k.chain(
        k.loop('noise:white'),
        k.filter('highpass', 2600),
        k.filter('lowpass', 9000),
        foam,
        out,
      );
      let next = 0;
      return (t) => {
        if (t < next) return;
        // One wave: rises, breaks (foam just after the crest), draws back.
        const period = k.between(7, 12);
        const rise = period * k.between(0.35, 0.45);
        const peak = k.between(0.75, 1);
        next = t + period;
        swell.gain.setTargetAtTime(peak, t, rise / 3);
        swell.gain.setTargetAtTime(k.between(0.2, 0.35), t + rise, (period - rise) / 3);
        body.frequency.setTargetAtTime(k.between(900, 1500), t, rise / 3);
        body.frequency.setTargetAtTime(k.between(300, 450), t + rise, (period - rise) / 3);
        foam.gain.setTargetAtTime(peak * 0.18, t + rise * 0.85, 0.5);
        foam.gain.setTargetAtTime(0, t + rise * 1.3, 1.4);
      };
    },
    wind(k, out) {
      const band = k.filter('bandpass', 450, 0.9);
      const gust = k.gain(0.6);
      k.chain(k.loop('noise:pink'), band, gust, out);
      const whistle = k.filter('bandpass', 900, 7);
      const whistleGain = k.gain(0.05);
      k.chain(k.loop('noise:pink', { rate: 0.97 }), whistle, whistleGain, out);
      let next = 0;
      return (t) => {
        if (t < next) return;
        next = t + k.between(2, 5);
        k.drift(band.frequency, 260, 800, 1.6);
        k.drift(gust.gain, 0.3, 1, 1.8);
        k.drift(whistle.frequency, 600, 1400, 2.5);
        k.drift(whistleGain.gain, 0, 0.12, 2.5);
      };
    },
    forest(k, out) {
      // Leaves: a soft, moving rustle. Birds: short chirp phrases with a little space (echo).
      const leaves = k.gain(0.25);
      k.chain(k.loop('noise:pink'), k.filter('bandpass', 3200, 0.6), leaves, out);
      const space = k.gain(1);
      const echo = k.delay(0.13);
      const feedback = k.gain(0.28);
      const echoTone = k.filter('lowpass', 3500);
      space.connect(out);
      space.connect(echo);
      k.chain(echo, echoTone, feedback, echo);
      echoTone.connect(out);
      const layerOut = space;
      let nextRustle = 0;
      let nextBird = k.now() + k.between(1, 4);
      return (t) => {
        if (t >= nextRustle) {
          nextRustle = t + k.between(1.5, 4);
          k.drift(leaves.gain, 0.08, 0.35, 1);
        }
        if (t < nextBird) return;
        nextBird = t + k.between(2.5, 9);
        const notes = Math.floor(k.between(2, 7));
        const base = k.between(2300, 4300);
        const shape = k.pick(['down', 'up', 'trill']);
        const length = notes * 0.18 + 0.3;
        k.event(length, ({ make, at }) => {
          const bird = k.osc(make, 'sine', base, at, at + length);
          const amp = make(ctxGain());
          amp.gain.setValueAtTime(0, at);
          const panner = k.panFor(make, k.between(-0.75, 0.75));
          bird.connect(amp).connect(panner).connect(layerOut);
          let time = at;
          for (let n = 0; n < notes; n += 1) {
            const dur = k.between(0.05, 0.13);
            const from = base * k.between(0.92, 1.08);
            const to =
              shape === 'down'
                ? from * k.between(0.6, 0.8)
                : shape === 'up'
                  ? from * k.between(1.15, 1.4)
                  : from * 1.05;
            bird.frequency.setValueAtTime(from, time);
            bird.frequency.exponentialRampToValueAtTime(to, time + dur);
            const loud = k.between(0.05, 0.12);
            amp.gain.setValueAtTime(0, time);
            amp.gain.linearRampToValueAtTime(loud, time + 0.012);
            amp.gain.setTargetAtTime(0, time + dur * 0.6, dur / 4);
            time += dur + k.between(0.04, 0.12);
          }
        });
      };
    },
    fireplace(k, out) {
      const roar = k.gain(0.55);
      k.chain(k.loop('noise:brown'), k.filter('lowpass', 380), roar, out);
      const crackle = k.gain(0.7);
      k.chain(k.loop('tex:crackle'), k.filter('highpass', 700), crackle, out);
      k.chain(
        k.loop('tex:crackle', { rate: 0.86 }),
        k.filter('bandpass', 1800, 0.8),
        k.gain(0.35),
        out,
      );
      let next = 0;
      return (t) => {
        if (t < next) return;
        next = t + k.between(0.4, 1.4);
        k.drift(roar.gain, 0.35, 0.7, 0.5);
        k.drift(crackle.gain, 0.45, 0.9, 0.8);
      };
    },
    thunder(k, out) {
      // Silence most of the time; a soft, distant rumble now and then.
      let next = k.now() + k.between(12, 35);
      return (t) => {
        if (t < next) return;
        next = t + k.between(50, 140);
        const length = k.between(7, 11);
        k.event(length, ({ make, at }) => {
          const source = make(ctxBufferSource());
          source.buffer = buffer('noise:brown');
          source.loop = true;
          source.start(at, k.between(0, 6));
          source.stop(at + length);
          const low = k.filterFor(make, 'lowpass', k.between(110, 220), 0.6);
          const low2 = k.filterFor(make, 'lowpass', 400, 0.5);
          const amp = make(ctxGain());
          amp.gain.setValueAtTime(0.0001, at);
          const attack = k.between(0.8, 2.2);
          amp.gain.linearRampToValueAtTime(k.between(0.6, 0.9), at + attack);
          // A couple of secondary rolls before it fades away.
          let time = at + attack;
          for (let roll = 0; roll < 2; roll += 1) {
            time += k.between(0.6, 1.6);
            amp.gain.setTargetAtTime(k.between(0.35, 0.8), time, 0.4);
          }
          amp.gain.setTargetAtTime(0.0001, time + 0.5, (length - (time - at)) / 4);
          const panner = k.panFor(make, k.between(-0.5, 0.5));
          source.connect(low).connect(low2).connect(amp).connect(panner).connect(out);
        });
      };
    },
    stream(k, out) {
      const bandA = k.filter('bandpass', 1400, 1.2);
      const bandB = k.filter('bandpass', 2400, 1.6);
      const flow = k.gain(0.75);
      const source = k.loop('noise:white');
      source.connect(bandA);
      source.connect(bandB);
      bandA.connect(flow);
      bandB.connect(flow);
      flow.connect(out);
      k.chain(k.loop('tex:bubbles'), k.filter('lowpass', 4000), k.gain(0.9), out);
      let next = 0;
      return (t) => {
        if (t < next) return;
        next = t + k.between(1, 3);
        k.drift(bandA.frequency, 900, 1800, 0.8);
        k.drift(bandB.frequency, 1900, 3000, 0.8);
        k.drift(flow.gain, 0.55, 0.85, 1);
      };
    },
    crickets(k, out) {
      k.chain(k.loop('tex:crickets'), k.filter('lowpass', 7500), k.gain(0.9), out);
      const far = k.gain(0.4);
      k.chain(k.loop('tex:crickets', { rate: 0.94 }), k.filter('lowpass', 4500), far, out);
      k.chain(k.loop('noise:brown'), k.filter('lowpass', 260), k.gain(0.25), out);
      let next = 0;
      return (t) => {
        if (t < next) return;
        next = t + k.between(4, 9);
        k.drift(far.gain, 0.15, 0.5, 3);
      };
    },
    library(k, out) {
      // Room tone (ventilation, distant building) and a page turned now and then.
      k.chain(k.loop('noise:brown'), k.filter('lowpass', 320), k.gain(0.55), out);
      const air = k.gain(0.12);
      k.chain(k.loop('noise:pink'), k.filter('lowpass', 900), air, out);
      let next = k.now() + k.between(6, 18);
      let nextAir = 0;
      return (t) => {
        if (t >= nextAir) {
          nextAir = t + k.between(6, 14);
          k.drift(air.gain, 0.06, 0.16, 4);
        }
        if (t < next) return;
        next = t + k.between(20, 60);
        k.event(1.1, ({ make, at }) => {
          const panner = k.panFor(make, k.between(-0.6, 0.6));
          // Lift (a soft swish) then the page settling (a shorter flap).
          for (const [offset, attack, peak, release, freq] of [
            [0, 0.16, 0.22, 0.25, 2600],
            [k.between(0.22, 0.32), 0.02, 0.16, 0.08, 1700],
          ]) {
            const burst = k.noiseBurst(make, at + offset, attack + release * 2);
            const band = k.filterFor(make, 'bandpass', freq, 0.7);
            const amp = k.envGain(make, at + offset, attack, peak, release);
            burst.connect(band).connect(amp).connect(panner);
          }
          panner.connect(out);
        });
      };
    },
    cafe(k, out) {
      k.chain(k.loop('tex:murmur'), k.filter('lowpass', 2200), k.gain(0.9), out);
      k.chain(k.loop('tex:murmur', { rate: 0.9 }), k.filter('lowpass', 1400), k.gain(0.5), out);
      k.chain(k.loop('noise:brown'), k.filter('lowpass', 500), k.gain(0.35), out);
      let next = k.now() + k.between(3, 8);
      return (t) => {
        if (t < next) return;
        next = t + k.between(5, 16);
        const clinks = k.random() < 0.3 ? 2 : 1;
        k.event(1.4, ({ make, at }) => {
          const panner = k.panFor(make, k.between(-0.7, 0.7));
          panner.connect(out);
          for (let c = 0; c < clinks; c += 1) {
            const start = at + c * k.between(0.12, 0.3);
            const f = k.between(1800, 2700);
            for (const [ratio, decay, peak] of [
              [1, 0.45, 0.05],
              [2.76, 0.25, 0.03],
              [5.4, 0.12, 0.015],
            ]) {
              const tone = k.osc(make, 'sine', f * ratio, start, start + 1.2);
              const amp = k.envGain(make, start, 0.003, peak, decay);
              tone.connect(amp).connect(panner);
            }
          }
        });
      };
    },
  };
  const ctxGain = () => ctx.createGain();
  const ctxBufferSource = () => ctx.createBufferSource();

  function buildLayer(id) {
    const layer = { out: ctx.createGain(), sources: [], nodes: [], tick: () => {}, teardown: null };
    layer.out.gain.value = 0;
    layer.out.connect(bus);
    layer.tick = BUILDERS[id](kit(layer), layer.out) || (() => {});
    layers.set(id, layer);
    return layer;
  }
  function destroyLayer(id) {
    const layer = layers.get(id);
    if (!layer) return;
    clearTimeout(layer.teardown);
    for (const source of layer.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const node of layer.nodes) node.disconnect?.();
    layer.out.disconnect?.();
    layers.delete(id);
  }

  function applyMix() {
    if (!ctx || !mix || !running) return;
    const gains = layerGains(mix);
    for (const id of LAYER_IDS) {
      const target = gains[id];
      let layer = layers.get(id);
      if (target > 0) {
        if (!layer) layer = buildLayer(id);
        clearTimeout(layer.teardown);
        layer.teardown = null;
        layer.out.gain.setTargetAtTime(target, now(), FADE);
      } else if (layer && !layer.teardown) {
        layer.out.gain.setTargetAtTime(0, now(), FADE);
        // Silent layers cost nothing: tear down after the fade.
        layer.teardown = setTimeout(() => destroyLayer(id), FADE * 5 * 1000);
      }
    }
    master.gain.setTargetAtTime(masterGain(mix, ducked), now(), ducked ? 0.6 : FADE);
  }

  function tick() {
    if (!ctx || !running) return;
    const t = now();
    for (const [id, layer] of layers) {
      if (layer.teardown) continue;
      try {
        layer.tick(t);
      } catch {
        destroyLayer(id);
      }
    }
  }

  return {
    /** Starts (or restarts) the sound. Call from a click: browsers require a user gesture. */
    async start(nextMix) {
      if (!AudioContextClass) throw new Error('Este navegador não toca sons gerados.');
      mix = nextMix;
      clearTimeout(stopTimeout);
      if (!ctx) {
        ctx = new AudioContextClass({ latencyHint: 'playback' });
        const compressor = ctx.createDynamicsCompressor?.();
        master = ctx.createGain();
        master.gain.value = 0;
        bus = ctx.createGain();
        bus.connect(master);
        if (compressor) {
          compressor.threshold.value = -14;
          compressor.ratio.value = 3;
          master.connect(compressor);
          compressor.connect(ctx.destination);
        } else master.connect(ctx.destination);
      }
      running = true;
      const resumed = Promise.resolve(ctx.resume?.()).catch(() => {});
      applyMix();
      tick();
      if (!timer) timer = setTimer(tick, TICK_MS);
      // Without a click the browser keeps the context suspended (and resume() never settles).
      await Promise.race([resumed, new Promise((resolve) => setTimeout(resolve, 1200))]);
      if (ctx.state === 'suspended') {
        this.stop();
        const blocked = new Error('Toque em tocar para começar o som.');
        blocked.code = 'AUTOPLAY_BLOCKED';
        throw blocked;
      }
    },
    /** Applies a new mix to the sound that is playing (no effect while stopped). */
    update(nextMix) {
      mix = nextMix;
      applyMix();
    },
    /** Lesson audio/video started (true) or stopped (false). */
    setDucked(on) {
      ducked = Boolean(on);
      if (ctx && running && mix)
        master.gain.setTargetAtTime(masterGain(mix, ducked), now(), ducked ? 0.6 : 1.2);
    },
    /** Fades out and releases every source; the rendered buffers are kept for a quick restart. */
    stop() {
      running = false;
      if (timer) clearTimer(timer);
      timer = null;
      if (!ctx) return;
      master.gain.setTargetAtTime(0, now(), 0.12);
      clearTimeout(stopTimeout);
      stopTimeout = setTimeout(() => {
        if (running || !ctx) return;
        for (const id of [...layers.keys()]) destroyLayer(id);
        void ctx.suspend?.().catch(() => {});
      }, 500);
    },
    /** After a tab comes back or the system interrupted audio: resume if we should be playing. */
    async ensureRunning() {
      if (running && ctx && ctx.state !== 'running') await ctx.resume?.();
    },
    /** Closes the audio context (page is going away). */
    dispose() {
      running = false;
      clearTimeout(stopTimeout);
      if (timer) clearTimer(timer);
      timer = null;
      for (const id of [...layers.keys()]) destroyLayer(id);
      void ctx?.close?.().catch(() => {});
      ctx = null;
      buffers.clear();
    },
    state: () => ({
      running,
      context: ctx ? ctx.state : 'none',
      layers: [...layers.keys()].filter((id) => !layers.get(id).teardown),
      voices,
      ducked,
    }),
  };
}
