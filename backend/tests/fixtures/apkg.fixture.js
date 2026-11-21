import { deflateRawSync, crc32, zstdCompressSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Builds small synthetic Anki packages (legacy and current formats) for tests. No real deck data.

export function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function collection(build) {
  const dir = mkdtempSync(join(tmpdir(), 'apkg-fixture-'));
  const file = join(dir, 'c.sqlite');
  const db = new DatabaseSync(file);
  build(db);
  db.close();
  const bytes = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

// 1×1 PNG.
export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

const notes = [
  ['O que é <b>ATP</b>?', 'Moeda de energia<br>da célula <img src="atp.png">'],
  ['Sem verso', ''],
];

/** Legacy package: collection.anki2, JSON models/decks in `col`, JSON media map. */
export function legacyApkg() {
  const bytes = collection((db) => {
    db.exec('create table col (id integer primary key, models text, decks text)');
    db.exec('create table notes (id integer primary key, mid integer, flds text, tags text)');
    db.prepare('insert into col values (1, ?, ?)').run(
      JSON.stringify({
        10: { name: 'Basic', type: 0, flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }] },
        20: { name: 'Cloze', type: 1, flds: [{ name: 'Text', ord: 0 }, { name: 'Back Extra', ord: 1 }] },
      }),
      JSON.stringify({ 1: { id: 1, name: 'Default' }, 99: { id: 99, name: 'Biologia::Energia' } }),
    );
    const insert = db.prepare('insert into notes values (?, ?, ?, ?)');
    insert.run(1, 10, notes[0].join('\u001f'), '');
    insert.run(2, 10, notes[1].join('\u001f'), '');
    insert.run(3, 20, ['A {{c1::clorofila}} absorve {{c2::luz::radiação}}.<script>alert(1)</script>', 'Extra'].join('\u001f'), '');
    insert.run(4, 777, 'x\u001fy', ''); // unknown model
    insert.run(5, 10, ['Ouça [sound:som.mp3]', 'Resposta'].join('\u001f'), '');
  });
  return zip([
    ['collection.anki2', bytes],
    ['media', JSON.stringify({ 0: 'atp.png', 1: 'som.mp3' })],
    ['0', PNG],
    ['1', Buffer.from('ID3fake')],
  ]);
}

const pbVarint = (n) => {
  const out = [];
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Buffer.from(out);
};
const pbString = (field, value) => {
  const bytes = Buffer.from(value);
  return Buffer.concat([pbVarint(field * 8 + 2), pbVarint(bytes.length), bytes]);
};

/** Current package: zstd collection.anki21b with notetypes/fields tables and protobuf media list. */
export function modernApkg() {
  const bytes = collection((db) => {
    db.exec('create table col (id integer primary key, models text, decks text)');
    db.exec('create table notetypes (id integer primary key, name text, config blob)');
    db.exec('create table fields (ntid integer, ord integer, name text)');
    db.exec('create table decks (id integer primary key, name text)');
    db.exec('create table notes (id integer primary key, mid integer, flds text, tags text)');
    db.prepare("insert into col values (1, '{}', '{}')").run();
    db.prepare('insert into notetypes values (1, ?, ?)').run('Básico', Buffer.from([]));
    db.prepare('insert into notetypes values (2, ?, ?)').run('Omissão', Buffer.from([0x08, 0x01])); // kind = cloze
    for (const [ntid, ord, name] of [[1, 0, 'Frente'], [1, 1, 'Verso'], [2, 0, 'Texto']])
      db.prepare('insert into fields values (?, ?, ?)').run(ntid, ord, name);
    db.prepare('insert into decks values (1, ?)').run('Default');
    db.prepare('insert into decks values (5, ?)').run('Química\u001fOrgânica');
    db.prepare('insert into notes values (1, 1, ?, ?)').run('Fórmula do metano?\u001fCH<sub>4</sub> <img src="metano.png">', '');
    db.prepare('insert into notes values (2, 2, ?, ?)').run('O carbono faz {{c1::4}} ligações.', '');
  });
  // MediaEntries { repeated MediaEntry entries = 1 }, MediaEntry { string name = 1 }.
  const entry = pbString(1, 'metano.png');
  const media = zstdCompressSync(Buffer.concat([pbVarint((1 << 3) | 2), pbVarint(entry.length), entry]));
  return zip([
    ['collection.anki2', Buffer.from('placeholder: please update Anki')],
    ['collection.anki21b', zstdCompressSync(bytes)],
    ['media', media],
    ['0', zstdCompressSync(PNG)],
  ]);
}
