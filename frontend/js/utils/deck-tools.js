// Flashcards 3.0 without new tables: merge your own sets into a new personal set, and import
// cards from a text file (Anki "Notes in Plain Text", our own CSV export, or any two-column
// CSV/TSV). Everything here is pure; the panel sends the result through the existing set API.

export const FRONT_MAX = 1000;
export const BACK_MAX = 2000;
export const IMPORT_MAX = 1000; // cards per import or merge (10 requests of 100 at most)
export const CHUNK = 100; // cards per request accepted by the server

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Anki fields may hold HTML: keep the text and line breaks, drop tags (and scripts with them). */
export function htmlToText(value) {
  return String(value ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+|#39);/gi, (match, code) => {
      if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return match;
    })
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Undoes the apostrophe our CSV export adds before formula-like cells. */
const unguard = (text) => (/^'[=+\-@]/.test(text) ? text.slice(1) : text);

/** Anki cloze text: the front hides each deletion (or shows its hint), the back reveals it. */
export function clozeCard(text) {
  if (!/\{\{c\d+::/.test(text)) return null;
  const front = text.replace(/\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, _answer, hint) =>
    hint ? `[${hint}]` : '[…]',
  );
  const back = text.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1');
  return { front, back };
}

/** RFC 4180 rows with a given separator (quotes may span lines). */
export function splitRows(text, separator) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const SEPARATORS = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };

function guessSeparator(lines) {
  if (/^"?front"?,/i.test(lines[0] || '')) return ',';
  const sample = lines.slice(0, 20);
  for (const sep of ['\t', ';', ','])
    if (sample.length && sample.every((line) => line.includes(sep))) return sep;
  return '\t';
}

/**
 * Reads a text file into cards. Returns { cards: [{front, back}], skipped: [{line, reason}],
 * format }. Reasons: 'empty' (a side is missing), 'too_long', 'limit'.
 */
export function parseCardFile(raw) {
  let text = String(raw ?? '').replace(/^\uFEFF/, '');
  const headers = {};
  // Anki 2.1.55+ writes "#key:value" header lines.
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && /^#[a-z ]+:/i.test(lines[start])) {
    const [, key, value] = lines[start].match(/^#([a-z ]+):(.*)$/i);
    headers[key.trim().toLowerCase()] = value.trim();
    start += 1;
  }
  text = lines.slice(start).join('\n');
  const separator =
    SEPARATORS[headers.separator?.toLowerCase()] ||
    (headers.separator?.length === 1 ? headers.separator : null) ||
    guessSeparator(lines.slice(start).filter((line) => line.trim()));
  const html = headers.html ? headers.html.toLowerCase() === 'true' : /<[a-z][^>]*>/i.test(text);
  let rows = splitRows(text, separator);
  // Columns: Anki's "#columns:" header, or a header row such as our own CSV export.
  let frontAt = 0;
  let backAt = 1;
  const named = headers.columns ? headers.columns.split(separator).map((c) => c.trim().toLowerCase()) : null;
  const first = rows[0]?.map((c) => c.trim().toLowerCase());
  const columns = named || (first && first.includes('front') && first.includes('back') ? first : null);
  if (columns) {
    if (!named) rows = rows.slice(1);
    const pick = (names, fallback) => {
      const at = columns.findIndex((c) => names.includes(c));
      return at >= 0 ? at : fallback;
    };
    frontAt = pick(['front', 'frente', 'pergunta', 'text', 'texto'], 0);
    backAt = pick(['back', 'verso', 'resposta', 'back extra', 'extra'], frontAt === 0 ? 1 : 0);
  }
  const format = headers.separator || headers.html || headers.columns ? 'anki' : columns ? 'csv' : 'text';
  const cards = [];
  const skipped = [];
  rows.forEach((row, index) => {
    const line = index + 1;
    const clean = (value) => {
      const plain = unguard(String(value ?? '').trim());
      return html ? htmlToText(plain) : plain;
    };
    let front = clean(row[frontAt]);
    let back = clean(row[backAt]);
    const cloze = clozeCard(front);
    if (cloze) {
      // The "Back Extra" column, if present, is appended to the answer.
      back = back ? `${cloze.back}\n\n${back}` : cloze.back;
      front = cloze.front;
    }
    if (!front || !back) return skipped.push({ line, reason: 'empty' });
    if (front.length > FRONT_MAX || back.length > BACK_MAX) return skipped.push({ line, reason: 'too_long' });
    if (cards.length >= IMPORT_MAX) return skipped.push({ line, reason: 'limit' });
    cards.push({ front, back });
  });
  return { cards, skipped, format };
}

/** Key for "the same card": case, accents, punctuation and spacing do not matter. */
export function cardKey(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Combines cards from several sources. Exact duplicates (same question and answer) are kept
 * once; cards with the same question and a different answer are kept and reported, so the
 * student can decide later. Returns { cards, duplicates, sameQuestion, overLimit }.
 */
export function mergeCards(sources, { limit = IMPORT_MAX } = {}) {
  const seen = new Set();
  const fronts = new Map();
  const cards = [];
  let duplicates = 0;
  let overLimit = 0;
  const sameQuestion = [];
  for (const source of sources)
    for (const card of source.cards || []) {
      const front = card.front ?? card.front_text;
      const back = card.back ?? card.back_text;
      const key = `${cardKey(front)}\u0000${cardKey(back)}`;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      if (cards.length >= limit) {
        overLimit += 1;
        continue;
      }
      seen.add(key);
      const frontKey = cardKey(front);
      if (fronts.has(frontKey)) sameQuestion.push({ front, sources: [fronts.get(frontKey), source.name] });
      else fronts.set(frontKey, source.name);
      const copy = { front, back };
      // Optional metadata the server accepts and validates.
      const evidence = card.evidence;
      if (evidence && evidence.length <= 1500) copy.evidence = evidence;
      if (card.card_style || card.style) copy.style = card.card_style || card.style;
      if (card.difficulty) copy.difficulty = card.difficulty;
      if (card.focus) copy.focus = card.focus;
      cards.push(copy);
    }
  return { cards, duplicates, sameQuestion, overLimit };
}

export function chunk(list, size = CHUNK) {
  const parts = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
}
