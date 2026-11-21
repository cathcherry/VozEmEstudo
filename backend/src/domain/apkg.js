import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Flashcards 3.0 — reads an Anki package (.apkg / .colpkg) without third-party code:
// a zip (read here) holding a SQLite collection (node:sqlite) and numbered media files.
// Supports the legacy collection (collection.anki2 / .anki21, JSON models and media map) and the
// current one (collection.anki21b compressed with zstd, protobuf notetypes and media list).
// Templates, CSS and scripts of the deck are discarded: only the educational fields are kept,
// converted to plain text; images referenced by the fields are returned for the caller to store.

export const APKG_LIMITS = Object.freeze({
  bytes: 40 * 1024 * 1024, // uploaded package
  unpacked: 200 * 1024 * 1024, // all entries uncompressed
  entries: 6000,
  notes: 500, // one set holds at most 500 cards
  imageBytes: 2 * 1024 * 1024,
  images: 300,
});

export class ApkgError extends Error {
  constructor(message, code = 'APKG_INVALID') {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

// ---- zip -------------------------------------------------------------------------------------
function readZip(buffer) {
  if (buffer.length < 22) throw new ApkgError('O arquivo não é um pacote do Anki.');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new ApkgError('O arquivo não é um pacote do Anki.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > APKG_LIMITS.entries) throw new ApkgError('O pacote tem arquivos demais.');
  const entries = new Map();
  let unpacked = 0;
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new ApkgError('Pacote corrompido.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    unpacked += size;
    if (unpacked > APKG_LIMITS.unpacked) throw new ApkgError('O pacote é grande demais depois de aberto.');
    entries.set(name, () => {
      if (buffer.readUInt32LE(local) !== 0x04034b50) throw new ApkgError('Pacote corrompido.');
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        const out = inflateRawSync(data, { maxOutputLength: Math.max(size, 1) });
        if (out.length !== size) throw new ApkgError('Pacote corrompido.');
        return out;
      }
      throw new ApkgError('Compressão do pacote não suportada.');
    });
  }
  return entries;
}

const ZSTD_MAGIC = 0xfd2fb528;
const maybeZstd = (data, limit) =>
  data.length >= 4 && data.readUInt32LE(0) === ZSTD_MAGIC
    ? zstdDecompressSync(data, { maxOutputLength: limit })
    : data;

// ---- minimal protobuf reader (only what notetype config and the media list need) ----------------
function varint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new ApkgError('Pacote corrompido.');
    const byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, pos];
    shift += 7;
    if (shift > 63) throw new ApkgError('Pacote corrompido.');
  }
}
function* protoFields(buf) {
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = varint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      let value;
      [value, pos] = varint(buf, pos);
      yield [field, value];
    } else if (wire === 2) {
      let length;
      [length, pos] = varint(buf, pos);
      yield [field, buf.subarray(pos, pos + length)];
      pos += length;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new ApkgError('Pacote corrompido.');
  }
}

// ---- text --------------------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Field HTML → plain text, collecting image names. Scripts and styles are dropped. */
export function fieldText(html, images = []) {
  const withImages = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'>\s]+)[^>]*>/gi, (_, src) => {
      images.push(decodeURIComponent(src));
      return ' ';
    });
  return withImages
    .replace(/<br\s*\/?>|<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, code) => {
      const key = code.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key[0] === '#') {
        const n = key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return match;
    })
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const IMAGE_TYPES = [
  ['image/png', (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
  ['image/jpeg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8'],
  ['image/webp', (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
];
export const imageType = (bytes) => IMAGE_TYPES.find(([, test]) => test(bytes))?.[0] || null;

// ---- collection --------------------------------------------------------------------------------
async function openCollection(bytes) {
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    throw new ApkgError('Este servidor não consegue ler pacotes do Anki (Node 22.5 ou mais novo é necessário).', 'APKG_UNSUPPORTED');
  }
  const dir = mkdtempSync(join(tmpdir(), 'apkg-'));
  const file = join(dir, 'collection.sqlite');
  writeFileSync(file, bytes);
  try {
    const db = new sqlite.DatabaseSync(file, { readOnly: true });
    return {
      db,
      close() {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    throw new ApkgError('A coleção dentro do pacote não pôde ser lida.');
  }
}

const hasTable = (db, name) =>
  Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name));

/** Note types of the collection: id → {name, cloze, fields:[names]}. */
function readModels(db) {
  const models = new Map();
  if (hasTable(db, 'notetypes') && db.prepare('select count(*) as n from notetypes').get().n > 0) {
    for (const row of db.prepare('select id, name, config from notetypes').all()) {
      let cloze = false;
      for (const [field, value] of protoFields(Buffer.from(row.config || []))) if (field === 1 && value === 1) cloze = true;
      const fields = db
        .prepare('select name from fields where ntid = ? order by ord')
        .all(row.id)
        .map((f) => f.name);
      models.set(String(row.id), { name: row.name, cloze, fields });
    }
    return models;
  }
  const raw = db.prepare('select models from col').get()?.models;
  for (const [id, model] of Object.entries(JSON.parse(raw || '{}')))
    models.set(String(id), {
      name: model.name,
      cloze: model.type === 1,
      fields: (model.flds || []).sort((a, b) => a.ord - b.ord).map((f) => f.name),
    });
  return models;
}

function deckName(db) {
  try {
    if (hasTable(db, 'decks')) {
      const rows = db.prepare('select name from decks where id <> 1').all();
      if (rows.length) return String(rows[0].name).split('\u001f').join('::');
    }
    const raw = db.prepare('select decks from col').get()?.decks;
    const decks = Object.values(JSON.parse(raw || '{}')).filter((d) => d.id !== 1);
    if (decks.length) return decks[0].name;
  } catch {
    /* the name is optional */
  }
  return 'Baralho do Anki';
}

function mediaNames(entries) {
  const file = entries.get('media');
  if (!file) return new Map();
  const data = maybeZstd(file(), 10 * 1024 * 1024);
  const names = new Map();
  if (data[0] === 0x7b) {
    // Legacy: {"0": "image.jpg"}
    for (const [index, name] of Object.entries(JSON.parse(data.toString('utf8')))) names.set(name, String(index));
    return names;
  }
  // Current: MediaEntries { repeated MediaEntry entries = 1 { string name = 1; ... } }; index = order.
  let index = 0;
  for (const [field, entry] of protoFields(data)) {
    if (field !== 1) continue;
    for (const [inner, value] of protoFields(entry)) if (inner === 1) names.set(value.toString('utf8'), String(index));
    index += 1;
  }
  return names;
}

/**
 * Reads a package. Returns {deckName, notes:[{noteType, fields, images:[name]}], images: Map(name →
 * {bytes, mime}), skipped: {empty, unsupported, overLimit, audio, imagesSkipped}}.
 */
export async function readApkg(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > APKG_LIMITS.bytes)
    throw new ApkgError('O pacote passa de 40 MB.', 'APKG_TOO_LARGE');
  const entries = readZip(buffer);
  const pick = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((name) => entries.has(name));
  if (!pick) throw new ApkgError('O arquivo não é um pacote do Anki.');
  const collection = maybeZstd(entries.get(pick)(), APKG_LIMITS.unpacked);
  const { db, close } = await openCollection(collection);
  const skipped = { empty: 0, unsupported: 0, overLimit: 0, audio: 0, imagesSkipped: 0 };
  const notes = [];
  let name;
  try {
    let models;
    try {
      models = readModels(db);
    } catch (error) {
      if (error instanceof ApkgError) throw error;
      throw new ApkgError('A coleção dentro do pacote não pôde ser lida.');
    }
    name = deckName(db);
    let rows;
    try {
      rows = db.prepare('select id, mid, flds from notes order by id limit ?').all(APKG_LIMITS.notes * 4);
    } catch {
      throw new ApkgError('A coleção dentro do pacote não pôde ser lida.');
    }
    for (const row of rows) {
      const model = models.get(String(row.mid));
      const raw = String(row.flds).split('\u001f');
      skipped.audio += raw.join(' ').match(/\[sound:[^\]]*\]/g)?.length || 0;
      if (!model) {
        skipped.unsupported += 1;
        continue;
      }
      const images = [];
      const values = raw.map((value) => fieldText(value, images));
      let note;
      if (model.cloze) {
        const text = values[0] || '';
        note = /\{\{c\d+::/.test(text)
          ? { noteType: 'cloze', fields: { text, ...(values[1] ? { extra: values[1] } : {}) } }
          : null;
      } else if (values[0] && values[1]) note = { noteType: 'basic', fields: { front: values[0], back: values[1] } };
      if (!note) {
        skipped.empty += 1;
        continue;
      }
      if (notes.length >= APKG_LIMITS.notes) {
        skipped.overLimit += 1;
        continue;
      }
      notes.push({ ...note, images: [...new Set(images)].slice(0, 10) });
    }
  } finally {
    close();
  }
  // Images actually used by the kept notes.
  const wanted = new Set(notes.flatMap((n) => n.images));
  const index = mediaNames(entries);
  const images = new Map();
  for (const file of wanted) {
    const entry = index.has(file) ? entries.get(index.get(file)) : null;
    if (!entry || images.size >= APKG_LIMITS.images) {
      skipped.imagesSkipped += 1;
      continue;
    }
    const bytes = maybeZstd(entry(), APKG_LIMITS.imageBytes + 1);
    const mime = imageType(bytes);
    if (!mime || bytes.length > APKG_LIMITS.imageBytes) {
      skipped.imagesSkipped += 1;
      continue;
    }
    images.set(file, { bytes, mime });
  }
  for (const note of notes) note.images = note.images.filter((file) => images.has(file));
  return { deckName: name, notes, images, skipped };
}
