// Profile cards ("Meus cards", 3.7): the templates offered when creating a card, strict link
// validation for the YouTube and Spotify embeds, a small safe text format and the checklist state.
// Pure module (no DOM, no network): rendering lives in profile-card-view.js.
//
// Storage shape: cards keep living in `profile-blocks` (profile_state) with the fields older
// versions of the app read (`type`, `title`, `content`, `url`, `templateId`/`templateValues` for
// checklists), so an older app still shows something sensible. New optional fields: `card` (the
// template the card was made with), `format: 'rich'`, `tone`, `media`, `alt`, `caption`, `fit`,
// `source`. Cards of retired kinds (`widget` = decorative 3D cards, HTML/CSS and the old quote
// template; `code`) are never deleted or rewritten: they render read-only (see docs/PERFIL_CARDS.md).

/** Templates offered in "Novo card", in order. Decorative 3D cards and code are not offered. */
export const CARD_TEMPLATES = Object.freeze([
  {
    id: 'text',
    label: 'Texto',
    description: 'Notas com títulos, listas, destaques e cor de fundo.',
  },
  { id: 'checklist', label: 'Checklist', description: 'Passos para marcar.' },
  { id: 'image', label: 'Imagem', description: 'Uma foto ou ilustração sua, com legenda.' },
  {
    id: 'gif',
    label: 'GIF',
    description: 'Uma animação curta; fica parada quando você pede menos movimento.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    description: 'Um vídeo, no modo de privacidade reforçada do YouTube.',
  },
  { id: 'spotify', label: 'Spotify', description: 'Uma música, álbum, playlist ou podcast.' },
]);
export const CARD_TEMPLATE_IDS = Object.freeze(CARD_TEMPLATES.map((template) => template.id));

/** Background tones (CSS classes `card-tone-<id>`, mixed with the theme's surface). */
export const CARD_TONES = Object.freeze([
  ['', 'Sem cor'],
  ['sun', 'Sol'],
  ['mint', 'Menta'],
  ['sky', 'Céu'],
  ['lavender', 'Lavanda'],
  ['rose', 'Rosa'],
  ['sand', 'Areia'],
]);
const TONE_IDS = new Set(CARD_TONES.map(([id]) => id));
export const normalizeTone = (tone) => (TONE_IDS.has(tone) ? tone : '');

export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT = 6000;
export const MAX_CHECKLIST_ITEMS = 30;

/** Kinds kept only for compatibility: shown read-only, never offered, never rewritten. */
export const LEGACY_TYPES = Object.freeze(['widget', 'code']);

// ---- Links ---------------------------------------------------------------------------------

function toUrl(raw, service) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error(`Cole o link do ${service}.`);
  if (text.length > 600) throw new Error('Esse link é longo demais.');
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Cole um link válido do ${service}.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`Use um link do ${service} que comece com https://.`);
  if (url.username || url.password || (url.port && url.port !== '443'))
    throw new Error(`Cole um link válido do ${service}.`);
  return url;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function startSeconds(value) {
  if (!value) return 0;
  if (/^\d{1,6}s?$/.test(value)) return Number.parseInt(value, 10);
  const match = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/.exec(value);
  if (!match || !value) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

/**
 * A YouTube link (watch, youtu.be, shorts, live, embed) → the youtube-nocookie embed address.
 * Anything else (other hosts, javascript:, data:, look-alike domains, malformed ids) throws.
 */
export function parseYouTube(raw) {
  const url = toUrl(raw, 'YouTube');
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) throw new Error('Esse link não é do YouTube.');
  const parts = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (host === 'youtu.be') id = parts[0];
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
  if (!id || !YOUTUBE_ID.test(id))
    throw new Error('Esse link do YouTube não aponta para um vídeo.');
  const start = Math.min(
    startSeconds(url.searchParams.get('t') || url.searchParams.get('start')),
    999999,
  );
  return {
    provider: 'youtube',
    id,
    start,
    src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
    link: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
  };
}

const SPOTIFY_KINDS = ['track', 'album', 'playlist', 'episode', 'show', 'artist'];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const spotifyHeight = (kind) => (kind === 'track' || kind === 'episode' ? 152 : 352);

/** An open.spotify.com link (or a spotify: URI) → the open.spotify.com/embed address. */
export function parseSpotify(raw) {
  const text = String(raw ?? '').trim();
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(text);
  let kind;
  let id;
  if (uri) [, kind, id] = uri;
  else {
    const url = toUrl(text, 'Spotify');
    if (url.hostname.toLowerCase() !== 'open.spotify.com')
      throw new Error('Esse link não é do Spotify (open.spotify.com).');
    const parts = url.pathname.split('/').filter(Boolean);
    if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0] || '')) parts.shift();
    if (parts[0] === 'embed') parts.shift();
    [kind, id] = parts;
  }
  if (!SPOTIFY_KINDS.includes(kind) || !id || !SPOTIFY_ID.test(id))
    throw new Error(
      'Use um link de música, álbum, playlist, artista, episódio ou podcast do Spotify.',
    );
  return {
    provider: 'spotify',
    kind,
    id,
    height: spotifyHeight(kind),
    src: `https://open.spotify.com/embed/${kind}/${id}`,
    link: `https://open.spotify.com/${kind}/${id}`,
  };
}

const EMBED_PATTERNS = [
  [
    'youtube',
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(?:\?start=\d{1,6})?$/,
  ],
  [
    'spotify',
    /^https:\/\/open\.spotify\.com\/embed\/(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{22}$/,
  ],
];

/**
 * Checked again at render time (the stored address could come from an older version or be edited
 * by hand): only the two exact embed shapes pass. Returns {provider, src, height} or null.
 */
export function embedFrame(url) {
  const text = String(url ?? '');
  for (const [provider, pattern] of EMBED_PATTERNS) {
    const match = pattern.exec(text);
    if (match)
      return {
        provider,
        src: text,
        height: provider === 'spotify' ? spotifyHeight(match[1]) : null,
      };
  }
  return null;
}

/** Attributes of an embed iframe: as little as each player needs. */
export const EMBED_ATTRIBUTES = Object.freeze({
  youtube: {
    sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
    allow: 'encrypted-media; picture-in-picture; fullscreen',
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  spotify: {
    sandbox: 'allow-scripts allow-same-origin allow-popups',
    allow: 'encrypted-media; clipboard-write; fullscreen',
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
});

/** Links inside formatted text: http(s) only. */
export function safeLink(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// ---- Formatted text ------------------------------------------------------------------------
// A small, predictable markup (a subset of Markdown) parsed into a tree; the view builds DOM nodes
// from it with textContent, so no user string is ever parsed as HTML.
//   # Título · ## Subtítulo · - item · 1. item · > citação · --- · **negrito** · *itálico*
//   ==destaque== · [texto](https://…)

const INLINE =
  /\*\*(.+?)\*\*|==(.+?)==|\[([^\]\n]{1,200})\]\(([^)\s]{1,600})\)|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g;

export function parseInline(text, depth = 0) {
  const out = [];
  const source = String(text);
  if (depth > 3) return [{ t: 'text', v: source }];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) out.push({ t: 'text', v: source.slice(last, match.index) });
    const [whole, bold, mark, linkText, linkHref, star, under] = match;
    if (bold !== undefined) out.push({ t: 'b', c: parseInline(bold, depth + 1) });
    else if (mark !== undefined) out.push({ t: 'mark', c: parseInline(mark, depth + 1) });
    else if (linkText !== undefined) {
      const href = safeLink(linkHref);
      out.push(
        href ? { t: 'a', href, c: parseInline(linkText, depth + 1) } : { t: 'text', v: whole },
      );
    } else out.push({ t: 'i', c: parseInline(star ?? under, depth + 1) });
    last = match.index + whole.length;
  }
  if (last < source.length) out.push({ t: 'text', v: source.slice(last) });
  return out;
}

/** Text → [{t:'h', level, c} | {t:'p', lines} | {t:'ul'|'ol', items} | {t:'quote', lines} | {t:'hr'}]. */
export function parseRichText(source) {
  const blocks = [];
  let current = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of String(source ?? '')
    .slice(0, MAX_TEXT)
    .split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let match;
    if (!line.trim()) flush();
    else if ((match = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ t: 'h', level: Math.min(2, match[1].length), c: parseInline(match[2]) });
    } else if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ t: 'hr' });
    } else if ((match = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      if (current?.t !== 'ul') flush();
      current ||= { t: 'ul', items: [] };
      current.items.push(parseInline(match[1]));
    } else if ((match = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line))) {
      if (current?.t !== 'ol') flush();
      current ||= { t: 'ol', items: [] };
      current.items.push(parseInline(match[1]));
    } else if ((match = /^\s*>\s?(.*)$/.exec(line))) {
      if (current?.t !== 'quote') flush();
      current ||= { t: 'quote', lines: [] };
      current.lines.push(parseInline(match[1]));
    } else {
      if (current?.t !== 'p') flush();
      current ||= { t: 'p', lines: [] };
      current.lines.push(parseInline(line.trim()));
    }
  }
  flush();
  return blocks;
}

/** Plain text of a formatted text (for an older app, screen-reader labels and search). */
export function plainText(source) {
  const flat = (nodes) => nodes.map((node) => (node.t === 'text' ? node.v : flat(node.c))).join('');
  return parseRichText(source)
    .map((block) => {
      if (block.t === 'h') return flat(block.c);
      if (block.t === 'hr') return '';
      if (block.t === 'ul' || block.t === 'ol')
        return block.items.map((item) => `• ${flat(item)}`).join('\n');
      return block.lines.map(flat).join('\n');
    })
    .join('\n\n');
}

/**
 * The toolbar of the text editor: wraps the selection (or a placeholder) in markup, or prefixes
 * the selected lines. Returns the new value and selection.
 */
export function formatSelection(value, start, end, kind) {
  const text = String(value);
  const selected = text.slice(start, end);
  const wraps = {
    bold: ['**', '**', 'negrito'],
    italic: ['*', '*', 'itálico'],
    mark: ['==', '==', 'destaque'],
  };
  if (wraps[kind]) {
    const [open, close, placeholder] = wraps[kind];
    const inner = selected || placeholder;
    return {
      value: text.slice(0, start) + open + inner + close + text.slice(end),
      start: start + open.length,
      end: start + open.length + inner.length,
    };
  }
  if (kind === 'link') {
    const inner = selected || 'texto do link';
    const insert = `[${inner}](https://)`;
    const urlStart = start + inner.length + 3;
    return {
      value: text.slice(0, start) + insert + text.slice(end),
      start: urlStart,
      end: urlStart + 8,
    };
  }
  const prefixes = { heading: '## ', list: '- ', numbered: '1. ', quote: '> ' };
  const prefix = prefixes[kind];
  if (!prefix) return { value: text, start, end };
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = text.indexOf('\n', Math.max(start, end - 1));
  const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const strip = /^(#{1,3}\s+|[-*•]\s+|\d{1,3}[.)]\s+|>\s?)/;
  const own = {
    heading: /^#{1,3}\s+/,
    list: /^[-*•]\s+/,
    numbered: /^\d{1,3}[.)]\s+/,
    quote: /^>\s?/,
  }[kind];
  const allHave = lines.every((line) => own.test(line));
  const next = lines
    .map((line, index) => {
      const bare = line.replace(strip, '');
      if (allHave) return bare;
      return (kind === 'numbered' ? `${index + 1}. ` : prefix) + bare;
    })
    .join('\n');
  return {
    value: text.slice(0, lineStart) + next + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + next.length,
  };
}

// ---- Checklist -----------------------------------------------------------------------------

/** [{text, done}] of a checklist card (also the checklist template of older versions). */
export function checklistItems(block) {
  return String(block?.templateValues?.items ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_CHECKLIST_ITEMS)
    .map((text, index) => ({ text, done: Boolean(block?.checkedItems?.[index]) }));
}

/** Marks one item; the list is copied (the original array and card are untouched). */
export function toggleChecklistItem(blocks, id, index, done) {
  return blocks.map((block) =>
    block.id === id
      ? { ...block, checkedItems: { ...(block.checkedItems || {}), [index]: Boolean(done) } }
      : block,
  );
}

/** Ticks follow their text when the list is edited (a renamed item starts unticked). */
function carryChecks(previous, lines) {
  const done = new Map();
  for (const item of checklistItems(previous)) if (item.done) done.set(item.text, true);
  return Object.fromEntries(
    lines.map((text, index) => [index, done.has(text)]).filter(([, value]) => value),
  );
}

// ---- Templates → stored cards --------------------------------------------------------------

/** Which editor a stored card opens in, or null when it is a read-only legacy card. */
export function cardTemplateOf(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'data') return 'data';
  if (block.templateId === 'checklist' || block.type === 'checklist') return 'checklist';
  if (block.type === 'text') return 'text';
  if (block.type === 'image') return block.card === 'gif' ? 'gif' : 'image';
  if (block.type === 'embed') return embedFrame(block.url)?.provider || null;
  return null;
}

export const isLegacyCard = (block) => cardTemplateOf(block) === null;

/** Default content for a new card of each template. */
export function templateDefaults(id) {
  return (
    {
      text: {
        title: 'Minhas notas',
        text: '## O que aprendi hoje\nUma ideia **importante** da aula.\n\n- Revisar o resumo\n- Fazer 3 questões',
        tone: '',
      },
      checklist: {
        title: 'Pequenos passos',
        items: 'Revisar minhas notas\nPraticar uma questão\nFazer uma pausa',
        tone: '',
      },
      image: { title: 'Minha imagem', alt: '', caption: '', fit: 'cover' },
      gif: { title: 'Meu GIF', alt: '', caption: '', fit: 'contain' },
      youtube: { title: 'Vídeo para estudar', url: '' },
      spotify: { title: 'Trilha de estudo', url: '' },
    }[id] || null
  );
}

const clip = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

/**
 * Builds the stored fields of a card from the editor values (without id/layout/hidden, which the
 * page keeps). Throws a readable error for invalid input. `previous` is the card being edited.
 */
export function buildCard(id, values = {}, previous = null) {
  const title = clip(values.title, 80);
  if (!title) throw new Error('Dê um título ao card.');
  const base = { title, card: id, templateId: null, templateValues: null };
  if (id === 'text') {
    const text = String(values.text ?? '').slice(0, MAX_TEXT);
    if (!text.trim()) throw new Error('Escreva algum texto.');
    return {
      ...base,
      type: 'text',
      format: 'rich',
      content: text,
      tone: normalizeTone(values.tone),
    };
  }
  if (id === 'checklist') {
    const lines = String(values.items ?? '')
      .split('\n')
      .map((line) => line.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, MAX_CHECKLIST_ITEMS);
    if (!lines.length) throw new Error('Escreva pelo menos um passo.');
    return {
      ...base,
      type: 'checklist',
      // Older versions render checklists from these two fields.
      templateId: 'checklist',
      templateValues: { items: lines.join('\n') },
      checkedItems: carryChecks(previous, lines),
      content: lines.join('\n'),
      tone: normalizeTone(values.tone),
    };
  }
  if (id === 'image' || id === 'gif') {
    if (!values.media) throw new Error(id === 'gif' ? 'Escolha um GIF.' : 'Escolha uma imagem.');
    const alt = clip(values.alt, 200);
    const caption = clip(values.caption, 200);
    return {
      ...base,
      type: 'image',
      media: String(values.media),
      alt,
      caption,
      fit: values.fit === 'contain' ? 'contain' : 'cover',
      content: caption || alt || title,
    };
  }
  if (id === 'youtube' || id === 'spotify') {
    const parsed = id === 'youtube' ? parseYouTube(values.url) : parseSpotify(values.url);
    return { ...base, type: 'embed', url: parsed.src, source: parsed.link, content: '' };
  }
  throw new Error('Escolha um tipo de card.');
}

/** Editor values for an existing card (the inverse of buildCard). */
export function cardValues(block) {
  const id = cardTemplateOf(block);
  const values = { title: block?.title || '', tone: normalizeTone(block?.tone) };
  if (id === 'text') values.text = block.content || '';
  else if (id === 'checklist')
    values.items = checklistItems(block)
      .map((item) => item.text)
      .join('\n');
  else if (id === 'image' || id === 'gif')
    Object.assign(values, {
      media: block.media,
      alt: block.alt || '',
      caption: block.caption || '',
      fit: block.fit || 'cover',
    });
  else if (id === 'youtube' || id === 'spotify') values.url = block.source || block.url || '';
  return values;
}

/** Readable text of a legacy HTML card, for "Copiar como texto" (a new card; the old one stays). */
export function legacyPlainText(block, parseHtml) {
  if (block?.type === 'code') return String(block.content || '');
  const text = parseHtml ? parseHtml(String(block?.content || '')) : String(block?.content || '');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_TEXT);
}
