import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';
import { legacyApkg } from './fixtures/apkg.fixture.js';

const migration = readFileSync(
  new URL('../../database/migrations/20261121150000_flashcards_3_0.sql', import.meta.url),
  'utf8',
);

test('Flashcards 3.0 over HTTP: typed decks, templates, merge with decisions, Anki package, isolation', async (t) => {
  const fixture = createSupabaseHttpFixture();
  const nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_v3_fixture',
    SUPABASE_SECRET_KEY: 'v3-fixture-server-key',
    FEATURE_FLASHCARDS: 'true',
    FEATURE_FLASHCARD_SETS: 'true',
    FEATURE_FLASHCARDS_V3: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const { db } = await fixture.getDatabase();
  await migrateStudyAuthoring(db, { flashcards: true });
  await db.exec(migration);
  for (const name of ['study_flashcards', 'study_flashcard_sets', 'study_flashcard_reviews', 'study_card_templates'])
    fixture.state.tables[name] = [];
  for (const name of Object.keys(fixture.state.tables))
    fixture.state.tables[name] = (await db.query('select * from public.' + name)).rows;
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload, user = 'a', raw = null) => {
    const res = await fetch(origin + path, {
      method,
      headers: {
        'Content-Type': raw ? 'application/octet-stream' : 'application/json',
        ...(user ? { Authorization: `Bearer ${identities[user].token}` } : {}),
      },
      ...(raw ? { body: raw } : payload ? { body: JSON.stringify(payload) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const deckA = randomUUID();
    const deckB = randomUUID();
    await t.test('typed decks are rendered on the server; bad fields are refused', async () => {
      const created = await request('/api/flashcards/decks', 'POST', {
        id: deckA,
        name: 'Meu baralho',
        cards: [
          { noteType: 'cloze', fields: { text: 'A {{c1::clorofila}} absorve luz.' } },
          { noteType: 'term', fields: { term: 'ATP', definition: 'Moeda de energia' } },
          { noteType: 'basic', fields: { front: 'Onde ocorre a fotossíntese?', back: 'No cloroplasto' } },
        ],
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.added, 3);
      const bad = await request('/api/flashcards/decks', 'POST', {
        id: randomUUID(),
        name: 'x',
        cards: [{ noteType: 'cloze', fields: { text: 'sem lacuna' } }],
      });
      assert.equal(bad.status, 400);
      const other = await request('/api/flashcards/decks', 'POST', {
        id: deckB,
        name: 'Baralho 2',
        cards: [
          { noteType: 'basic', fields: { front: 'Onde ocorre a fotossíntese?', back: 'Nas folhas' } },
          { noteType: 'basic', fields: { front: 'o que é ATP', back: 'moeda de energia.' } },
        ],
      });
      assert.equal(other.body.added, 2);
      const full = await request('/api/flashcards/sets/' + deckA);
      const cloze = full.body.cards.find((c) => c.note_type === 'cloze');
      assert.equal(cloze.front_text, 'A […] absorve luz.');
      assert.deepEqual(cloze.note_fields, { text: 'A {{c1::clorofila}} absorve luz.' });
    });

    await t.test('merge: preview shows the conflict; the decision is applied; sources untouched', async () => {
      const sources = [{ setId: deckA }, { setId: deckB }];
      assert.equal((await request('/api/flashcards/merge/preview', 'POST', { sources }, 'b')).status, 404, 'cannot read another account set');
      const preview = await request('/api/flashcards/merge/preview', 'POST', { sources });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.total, 5);
      assert.equal(preview.body.conflicts.length, 1);
      const conflict = preview.body.conflicts[0];
      assert.equal(conflict.front, 'Onde ocorre a fotossíntese?');
      // "o que é ATP / moeda de energia." differs from the term card's back: not an exact repeat.
      const pick = conflict.options.find((o) => o.back === 'Nas folhas').cardId;
      const merged = await request('/api/flashcards/merge', 'POST', {
        id: randomUUID(),
        name: 'Mesclado',
        sources,
        decisions: { [conflict.key]: `keep:${pick}` },
        templateBase: 'polaroid',
      });
      assert.equal(merged.status, 201, JSON.stringify(merged.body));
      assert.equal(merged.body.template_base, 'polaroid');
      const full = await request('/api/flashcards/sets/' + merged.body.id);
      const photo = full.body.cards.find((c) => c.front_text === 'Onde ocorre a fotossíntese?');
      assert.equal(photo.back_text, 'Nas folhas');
      assert.equal(photo.origin_kind, 'merge');
      assert.equal(photo.origin_label, 'Baralho 2');
      assert.equal((await request('/api/flashcards/sets/' + deckA)).body.cards.length, 3, 'source unchanged');
    });

    await t.test('templates: save, apply to a whole set, private per account', async () => {
      const templateId = randomUUID();
      const saved = await request('/api/flashcards/templates/' + templateId, 'PUT', {
        version: 0,
        requestId: randomUUID(),
        body: { name: 'Matcha', base: 'notebook', tokens: { accent: '#7aae62', font: 'rounded', radius: 16 }, variants: { cloze: { layout: 'left' } } },
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const hostile = await request('/api/flashcards/templates/' + randomUUID(), 'PUT', {
        version: 0,
        requestId: randomUUID(),
        body: { name: 'X', base: 'classic', tokens: { css: 'body{display:none}' } },
      });
      assert.equal(hostile.status, 400, 'no free CSS in a template');
      const twin = await request('/api/flashcards/templates/' + randomUUID(), 'PUT', {
        version: 0,
        requestId: randomUUID(),
        body: { name: '  matcha ', base: 'classic' },
      });
      assert.equal(twin.status, 409, 'a second template with the same name (case and spaces aside) is refused');
      assert.equal(twin.body.error.code, 'FLASHCARD_TEMPLATE_NAME_TAKEN');
      const resave = await request('/api/flashcards/templates/' + templateId, 'PUT', { version: 1, requestId: randomUUID(), body: { name: 'Matcha', base: 'sticky' } });
      assert.equal(resave.status, 200, 'the template itself keeps its name');
      const otherAccount = await request('/api/flashcards/templates/' + randomUUID(), 'PUT', { version: 0, requestId: randomUUID(), body: { name: 'Matcha', base: 'classic' } }, 'b');
      assert.equal(otherAccount.status, 200, 'names are unique per account only');
      assert.equal((await request('/api/flashcards/templates')).body.length, 1);
      assert.equal((await request('/api/flashcards/templates', 'GET', null, 'b')).body.length, 1, 'b sees only its own template');
      const applied = await request(`/api/flashcards/sets/${deckA}/template`, 'PUT', { templateId });
      assert.equal(applied.body.template_id, templateId);
      assert.equal((await request(`/api/flashcards/sets/${deckA}/template`, 'PUT', { templateId }, 'b')).status, 404);
    });

    await t.test('Anki package: preview reports, create stores the deck and its image', async () => {
      const bytes = legacyApkg();
      const preview = await request('/api/flashcards/import/apkg?mode=preview', 'POST', null, 'a', bytes);
      assert.equal(preview.status, 200, 'a preview creates nothing: ' + JSON.stringify(preview.body));
      assert.equal(preview.body.notes, 3);
      assert.deepEqual(preview.body.types, { basic: 2, cloze: 1 });
      assert.equal(preview.body.images, 1);
      assert.equal(preview.body.skipped.audio, 1);
      const id = randomUUID();
      const created = await request(`/api/flashcards/import/apkg?mode=create&id=${id}&templateBase=sticky`, 'POST', null, 'a', bytes);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.added, 3);
      assert.equal(created.body.name, 'Biologia::Energia');
      const row = (await db.query("select * from public.study_flashcards where set_id=$1 and front_text='O que é ATP?'", [id])).rows[0];
      assert.equal(row.origin_kind, 'apkg');
      assert.equal(row.media.length, 1);
      assert.match(row.media[0].path, new RegExp(`^${identities.a.id}/${id}/[0-9a-f]{32}\\.png$`));
      // One of the student's templates for the whole imported deck (a template or a base, not both).
      const templateId = randomUUID();
      const template = await request('/api/flashcards/templates/' + templateId, 'PUT', { version: 0, requestId: randomUUID(), body: { name: 'Anki', base: 'window' } });
      assert.equal(template.status, 200, JSON.stringify(template.body));
      const styled = randomUUID();
      const withTemplate = await request(`/api/flashcards/import/apkg?mode=create&id=${styled}&templateId=${templateId}`, 'POST', null, 'a', bytes);
      assert.equal(withTemplate.status, 201, JSON.stringify(withTemplate.body));
      assert.equal(withTemplate.body.template_id, templateId);
      const both = await request(`/api/flashcards/import/apkg?mode=create&id=${randomUUID()}&templateId=${templateId}&templateBase=sticky`, 'POST', null, 'a', bytes);
      assert.equal(both.status, 400);
      const foreign = await request(`/api/flashcards/import/apkg?mode=create&id=${randomUUID()}&templateId=${templateId}`, 'POST', null, 'b', bytes);
      assert.notEqual(foreign.status, 201, "another account's template cannot be used");
      const broken = await request('/api/flashcards/import/apkg?mode=preview', 'POST', null, 'a', Buffer.from('nope'));
      assert.equal(broken.status, 400);
    });
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
  }
});
