// Soundscape mix: the pure state behind the ambient mixer (layers, presets, persistence shape and
// music links). No Web Audio here, so it is shared by the page popover, the mini-player and the
// unit tests. The engine that turns a mix into sound lives in soundscape-engine.js.

/** Layers of the mixer. `level` is the loudness of the layer at full slider. */
export const LAYERS = [
  { id: 'rain', label: 'Chuva', level: 0.55 },
  { id: 'ocean', label: 'Ondas do mar', level: 0.6 },
  { id: 'wind', label: 'Vento', level: 0.5 },
  { id: 'forest', label: 'Floresta', level: 0.5 },
  { id: 'fireplace', label: 'Lareira', level: 0.6 },
  { id: 'thunder', label: 'Trovão distante', level: 0.7 },
  { id: 'stream', label: 'Riacho', level: 0.45 },
  { id: 'crickets', label: 'Grilos', level: 0.35 },
  { id: 'library', label: 'Biblioteca', level: 0.6 },
  { id: 'cafe', label: 'Café', level: 0.5 },
];
export const LAYER_IDS = LAYERS.map((layer) => layer.id);

/** One mix per atmosphere of the 3.5 vision (docs/EXPERIENCE_VISION_3_5.md, section 7). */
export const PRESETS = [
  {
    id: 'rainy-library',
    label: 'Biblioteca chuvosa',
    layers: { rain: 0.65, library: 0.45, thunder: 0.3 },
  },
  {
    id: 'lavender-desk',
    label: 'Escrivaninha lavanda',
    layers: { forest: 0.35, wind: 0.2, library: 0.3 },
  },
  {
    id: 'matcha-afternoon',
    label: 'Tarde de matcha',
    layers: { cafe: 0.45, stream: 0.3, forest: 0.2 },
  },
  {
    id: 'cozy-winter',
    label: 'Inverno aconchegante',
    layers: { fireplace: 0.7, wind: 0.35, library: 0.2 },
  },
  { id: 'seaside', label: 'Estudo à beira-mar', layers: { ocean: 0.7, wind: 0.25 } },
  {
    id: 'night-garden',
    label: 'Jardim noturno',
    layers: { crickets: 0.6, stream: 0.3, wind: 0.15 },
  },
  {
    id: 'old-notebook',
    label: 'Caderno acadêmico antigo',
    layers: { library: 0.6, fireplace: 0.3, rain: 0.2 },
  },
  {
    id: 'dreamy-pastel',
    label: 'Pastel sonhador',
    layers: { wind: 0.2, forest: 0.3, stream: 0.3 },
  },
];

/** While lesson audio or video plays, the ambience drops to this share of its volume. */
export const DUCK_LEVEL = 0.22;

export const storageKey = (userId) => `voz-soundscape-v1:${userId}`;
export const miniPlayerKey = (userId) => `voz-soundscape-mini-v1:${userId}`;
/** The 3.4 ambient sound kept its settings here; read once to carry the choice over. */
export const legacyKey = (userId) => `voz-ambient-v1:${userId}`;

const clamp01 = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
};
const round = (value) => Math.round(value * 100) / 100;

function emptyLayers() {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, { on: false, volume: 0.5 }]));
}

/** A complete, valid mix from anything stored (unknown layers and values are dropped). */
export function normalizeMix(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const layers = emptyLayers();
  for (const id of LAYER_IDS) {
    const stored = source.layers?.[id];
    if (!stored || typeof stored !== 'object') continue;
    layers[id] = { on: stored.on === true, volume: round(clamp01(stored.volume, 0.5)) };
  }
  let music = null;
  if (source.music?.url) {
    try {
      music = parseMusicUrl(source.music.url);
    } catch {
      music = null;
    }
  }
  const mix = {
    version: 1,
    layers,
    master: round(clamp01(source.master, 0.6)),
    duck: source.duck !== false,
    withFocus: source.withFocus === true,
    preset: null,
    // "It was playing": the next page offers a one-tap resume; it never starts by itself.
    playing: source.playing === true,
    music: music ? { url: music.url } : null,
  };
  mix.preset = matchPreset(mix);
  return mix;
}

/** True when at least one layer is on with some volume. */
export const hasSound = (mix) =>
  LAYER_IDS.some((id) => mix.layers[id].on && mix.layers[id].volume > 0);

/** The preset whose layers this mix reproduces exactly, or null ("personalizado"). */
export function matchPreset(mix) {
  for (const preset of PRESETS) {
    const same = LAYER_IDS.every((id) => {
      const wanted = preset.layers[id];
      const layer = mix.layers[id];
      return wanted === undefined ? !layer.on : layer.on && Math.abs(layer.volume - wanted) < 0.005;
    });
    if (same) return preset.id;
  }
  return null;
}

/** The mix with a preset's layers (other settings are kept). Unknown presets change nothing. */
export function applyPreset(mix, presetId) {
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) return normalizeMix(mix);
  const layers = Object.fromEntries(
    LAYER_IDS.map((id) => [
      id,
      preset.layers[id] === undefined
        ? { on: false, volume: mix.layers[id]?.volume ?? 0.5 }
        : { on: true, volume: preset.layers[id] },
    ]),
  );
  return normalizeMix({ ...mix, layers });
}

/** The mix with one layer changed ({on} and/or {volume}). */
export function setLayer(mix, id, patch = {}) {
  if (!LAYER_IDS.includes(id)) return normalizeMix(mix);
  const current = mix.layers[id];
  const next = { ...current, ...patch };
  // Raising a slider of a silent layer turns it on; that is what the student meant.
  if (patch.volume !== undefined && patch.on === undefined && !current.on && patch.volume > 0)
    next.on = true;
  return normalizeMix({ ...mix, layers: { ...mix.layers, [id]: next } });
}

/** Carries the 3.4 single-sound choice ("brown", "rain", "waves") into a mix. */
export function migrateLegacy(old) {
  if (!old || typeof old !== 'object') return null;
  const layer = { rain: 'rain', waves: 'ocean', brown: 'library' }[old.kind] || 'library';
  const mix = normalizeMix({
    master: old.volume,
    duck: old.duck,
    withFocus: old.withFocus,
    layers: { [layer]: { on: true, volume: 0.6 } },
  });
  return mix;
}

/** Linear gain of each layer for a mix (the engine applies these; perceptual curve). */
export function layerGains(mix) {
  return Object.fromEntries(
    LAYERS.map(({ id, level }) => {
      const layer = mix.layers[id];
      return [id, layer.on ? Math.round(layer.volume * layer.volume * level * 1000) / 1000 : 0];
    }),
  );
}

/** Gain of the master stage, with ducking applied when lesson media plays. */
export function masterGain(mix, ducked = false) {
  const base = mix.master * mix.master;
  return Math.round((ducked && mix.duck ? base * DUCK_LEVEL : base) * 1000) / 1000;
}

// ---- music links (official embeds only) -------------------------------------------------------

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);
const SPOTIFY_TYPES = new Set(['playlist', 'album', 'track', 'episode', 'show', 'artist']);
const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_LIST = /^[\w-]{10,64}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/**
 * Validates a pasted YouTube or Spotify link and returns the official embed for it.
 * Only https links on youtube.com / youtu.be / open.spotify.com are accepted; the result is
 * rebuilt from the parsed id (nothing of the pasted text is placed in the page as is).
 * YouTube plays through youtube-nocookie.com (privacy-enhanced mode).
 */
export function parseMusicUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 500) throw new Error('Cole um link do YouTube ou do Spotify.');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Cole um link do YouTube ou do Spotify.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('Use um link https do YouTube ou do Spotify.');
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    const list = url.searchParams.get('list');
    let video =
      host === 'youtu.be'
        ? url.pathname.split('/').filter(Boolean)[0]
        : url.pathname === '/watch'
          ? url.searchParams.get('v')
          : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (video && !YOUTUBE_ID.test(video)) video = null;
    const params = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' });
    if (list && YOUTUBE_LIST.test(list)) {
      params.set('list', list);
      const embedUrl = `https://www.youtube-nocookie.com/embed/${video || 'videoseries'}?${params}`;
      const canonical = `https://www.youtube.com/playlist?list=${list}`;
      return {
        provider: 'youtube',
        kind: 'playlist',
        id: list,
        video,
        embedUrl,
        url: video ? `https://www.youtube.com/watch?v=${video}&list=${list}` : canonical,
      };
    }
    if (!video) throw new Error('Esse link do YouTube não tem um vídeo ou uma playlist.');
    return {
      provider: 'youtube',
      kind: 'video',
      id: video,
      video,
      embedUrl: `https://www.youtube-nocookie.com/embed/${video}?${params}`,
      url: `https://www.youtube.com/watch?v=${video}`,
    };
  }
  if (host === 'open.spotify.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed') parts.shift();
    // Localised links: open.spotify.com/intl-pt/playlist/…
    if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0] || '')) parts.shift();
    const [type, id] = parts;
    if (!SPOTIFY_TYPES.has(type) || !SPOTIFY_ID.test(id || ''))
      throw new Error('Use um link de playlist, álbum, música, artista ou podcast do Spotify.');
    return {
      provider: 'spotify',
      kind: type,
      id,
      embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
      url: `https://open.spotify.com/${type}/${id}`,
    };
  }
  throw new Error(
    'Só aceitamos links do YouTube (youtube.com, youtu.be) e do Spotify (open.spotify.com).',
  );
}
