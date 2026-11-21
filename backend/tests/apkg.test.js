import test from 'node:test';
import assert from 'node:assert/strict';
import { readApkg, fieldText, ApkgError } from '../src/domain/apkg.js';
import { legacyApkg, modernApkg, zip, PNG } from './fixtures/apkg.fixture.js';

test('legacy package: basic and cloze notes, HTML to text, scripts dropped, images kept', async () => {
  const result = await readApkg(legacyApkg());
  assert.equal(result.deckName, 'Biologia::Energia');
  assert.deepEqual(
    result.notes.map((n) => [n.noteType, n.fields]),
    [
      ['basic', { front: 'O que é ATP?', back: 'Moeda de energia\nda célula' }],
      ['cloze', { text: 'A {{c1::clorofila}} absorve {{c2::luz::radiação}}.', extra: 'Extra' }],
      ['basic', { front: 'Ouça', back: 'Resposta' }],
    ],
  );
  assert.deepEqual(result.notes[0].images, ['atp.png']);
  assert.deepEqual([...result.images.keys()], ['atp.png']);
  assert.equal(result.images.get('atp.png').mime, 'image/png');
  assert.deepEqual(result.skipped, { empty: 1, unsupported: 1, overLimit: 0, audio: 1, imagesSkipped: 0 });
});

test('current package (anki21b, zstd, protobuf notetypes and media list)', async () => {
  const result = await readApkg(modernApkg());
  assert.equal(result.deckName, 'Química::Orgânica');
  assert.deepEqual(result.notes.map((n) => n.noteType), ['basic', 'cloze']);
  assert.equal(result.notes[0].fields.back, 'CH4');
  assert.deepEqual(result.notes[0].images, ['metano.png']);
  assert(result.images.get('metano.png').bytes.equals(PNG));
});

test('hostile or broken files are refused with a clear error', async () => {
  await assert.rejects(readApkg(Buffer.from('not a zip at all, sorry')), ApkgError);
  await assert.rejects(readApkg(zip([['readme.txt', 'hi']])), /não é um pacote do Anki/);
  // A disguised executable named like an image is not stored.
  const fake = zip([...[['collection.anki2', Buffer.alloc(0)]]]);
  await assert.rejects(readApkg(fake), ApkgError);
  assert.equal(fieldText('<style>x{}</style>a&amp;b&#33; <img src="x.png" onerror="alert(1)">', []), 'a&b!');
});
