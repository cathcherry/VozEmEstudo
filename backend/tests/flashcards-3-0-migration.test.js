import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';

const read = (path) => readFileSync(new URL('../../database/' + path, import.meta.url), 'utf8');
const migration = read('migrations/20261121150000_flashcards_3_0.sql');

test('Flashcards 3.0 migration is guarded, additive and server-only', () => {
  assert.match(migration, /FLASHCARDS_3_0_ABORT: aplicar E13/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(
    migration,
    /\b(drop table|drop column|drop constraint|drop function|drop index|truncate|create or replace|delete from)\b/i,
  );
  assert.match(migration, /alter table public\.study_card_templates enable row level security/);
  assert.match(migration, /revoke all on table public\.study_card_templates from public, anon, authenticated/);
});

async function prepared() {
  const f = await createAcademicDatabase();
  await migrateStudyAuthoring(f.db, { flashcards: true });
  const a = identities.a.id;
  // Data that exists BEFORE the migration: a typed legacy card with a review.
  const setId = randomUUID();
  await f.db.query(
    "insert into public.study_flashcard_sets(id,user_id,name) values($1,$2,'Antigo')",
    [setId, a],
  );
  const term = (
    await f.db.query(
      "insert into public.study_flashcards(user_id,set_id,front_text,back_text,card_style) values($1,$2,'Entropia','Medida da desordem','term_definition') returning *",
      [a, setId],
    )
  ).rows[0];
  const plain = (
    await f.db.query(
      "insert into public.study_flashcards(user_id,front_text,back_text) values($1,'Antigo?','Sim') returning *",
      [a],
    )
  ).rows[0];
  await f.call('study_review_flashcard_admin', [a, plain.id, 2, randomUUID()]);
  const before = {
    plain: (await f.db.query('select * from public.study_flashcards where id=$1', [plain.id])).rows[0],
    reviews: (await f.db.query('select * from public.study_flashcard_reviews order by id')).rows,
  };
  const preflight = await f.db.exec(read('checks/flashcards-3-0-preflight.sql'));
  await f.db.exec(migration);
  const postflight = await f.db.exec(read('checks/flashcards-3-0-postflight.sql'));
  return { ...f, a, b: identities.b.id, setId, term, plain, before, preflight, postflight };
}

test('existing cards keep content, schedule and history; types are backfilled', async () => {
  const f = await prepared();
  try {
    const rows = Object.fromEntries(
      (await f.db.query('select * from public.study_flashcards')).rows.map((r) => [r.id, r]),
    );
    assert.equal(rows[f.term.id].note_type, 'term', 'term_definition becomes the term type');
    assert.equal(rows[f.plain.id].note_type, 'basic');
    for (const key of ['front_text', 'back_text', 'due_at', 'interval_days', 'repetitions', 'ease_factor', 'last_reviewed_at'])
      assert.deepEqual(rows[f.plain.id][key], f.before.plain[key], `${key} unchanged`);
    assert.deepEqual((await f.db.query('select * from public.study_flashcard_reviews order by id')).rows, f.before.reviews);
    // Postflight reports the backfill and finds no inconsistent row.
    const report = f.postflight.at(-1).rows[0];
    assert.equal(Number(report.term_cards), 1);
    assert.equal(Number(report.untyped_term_cards), 0);
    // Re-applying is refused instead of duplicating objects.
    await assert.rejects(f.db.exec(migration), /FLASHCARDS_3_0_ABORT/);
  } finally {
    await f.db.close();
  }
});

test('typed decks: atomic creation, provenance, skipped duplicates reported, ownership', async () => {
  const f = await prepared();
  try {
    const deck = randomUUID();
    const hash = (n) => String(n).repeat(64).slice(0, 64);
    const body = {
      name: 'Mesclado: Ana + Bruno',
      config: { origin: { kind: 'merge' } },
      templateBase: 'sticky',
      cards: [
        { front: 'A […] absorve luz.', back: 'A clorofila absorve luz.', noteType: 'cloze', fields: { text: 'A {{c1::clorofila}} absorve luz.' }, contentHash: hash(1), originKind: 'merge', originCardId: randomUUID(), originSetId: randomUUID(), originUserId: f.b, originLabel: 'Bruno' },
        { front: 'O que é ATP?', back: 'Moeda de energia', contentHash: hash(2), originKind: 'merge', originLabel: 'Ana' },
        { front: '  o que é atp? ', back: 'Outra', contentHash: hash(3) },
      ],
    };
    const created = await f.call('study_create_flashcard_deck_admin', [f.a, deck, JSON.stringify(body)]);
    assert.equal(created.added, 2);
    assert.deepEqual(created.skipped, [2], 'the third card repeats a question and is reported');
    assert.equal(created.material_id, null);
    assert.equal(created.template_base, 'sticky');
    const cards = (await f.db.query('select * from public.study_flashcards where set_id=$1 order by created_at, front_text', [deck])).rows;
    const cloze = cards.find((c) => c.note_type === 'cloze');
    assert.deepEqual(cloze.note_fields, { text: 'A {{c1::clorofila}} absorve luz.' });
    assert.equal(cloze.origin_label, 'Bruno');
    assert.equal(cloze.origin_user_id, f.b, 'authorship of the source is kept');
    assert.equal(cloze.user_id, f.a, 'the copy belongs to the student who merged');
    assert(new Date(cloze.due_at) <= new Date(), 'a fresh personal schedule');
    assert.equal(cloze.repetitions, 0);
    // Replay is idempotent; another account cannot reuse the id.
    assert.equal((await f.call('study_create_flashcard_deck_admin', [f.a, deck, JSON.stringify(body)])).replayed, true);
    await assert.rejects(f.call('study_create_flashcard_deck_admin', [f.b, deck, JSON.stringify(body)]), /FLASHCARD_NOT_FOUND/);
    await assert.rejects(
      f.call('study_create_flashcard_deck_admin', [f.a, randomUUID(), JSON.stringify({ ...body, cards: [{ front: 'x', back: 'y', noteType: 'poem' }] })]),
      /check constraint|violates/,
      'unknown note types are refused by the database',
    );
    await assert.rejects(
      f.call('study_add_flashcard_notes_admin', [f.b, deck, JSON.stringify([{ front: 'x', back: 'y' }])]),
      /FLASHCARD_NOT_FOUND/,
    );
    // The 500-card rule of a set still holds.
    const many = Array.from({ length: 499 }, (_, i) => ({ front: `Q${i}`, back: 'A' }));
    await assert.rejects(f.call('study_add_flashcard_notes_admin', [f.a, deck, JSON.stringify(many)]), /FLASHCARD_SET_LIMIT/);
  } finally {
    await f.db.close();
  }
});

test('templates: versioned, private, limited; applying one changes only the set row', async () => {
  const f = await prepared();
  try {
    const id = randomUUID();
    const body = { name: 'Matcha', base: 'notebook', tokens: { accent: '#7aae62', font: 'rounded', radius: 18 }, variants: { cloze: { layout: 'left' } } };
    const request = randomUUID();
    const saved = await f.call('study_save_card_template_admin', [f.a, id, 0, request, JSON.stringify(body)]);
    assert.equal(saved.version, 1);
    assert.equal((await f.call('study_save_card_template_admin', [f.a, id, 0, request, JSON.stringify(body)])).version, 1, 'idempotent retry');
    await assert.rejects(f.call('study_save_card_template_admin', [f.a, id, 0, request, JSON.stringify({ ...body, name: 'x' })]), /CARD_TEMPLATE_REQUEST_CONFLICT/);
    await assert.rejects(f.call('study_save_card_template_admin', [f.a, id, 5, randomUUID(), JSON.stringify({ name: 'Outro' })]), /CARD_TEMPLATE_VERSION_CONFLICT/);
    await assert.rejects(f.call('study_save_card_template_admin', [f.b, id, 1, randomUUID(), JSON.stringify({ name: 'Roubado' })]), /CARD_TEMPLATE_NOT_FOUND/);
    await assert.rejects(f.call('study_save_card_template_admin', [f.a, randomUUID(), 0, randomUUID(), JSON.stringify({ ...body, base: 'neon' })]), /check constraint|violates/);

    const cardsBefore = (await f.db.query('select * from public.study_flashcards where set_id=$1', [f.setId])).rows;
    const reviewsBefore = (await f.db.query('select * from public.study_flashcard_reviews')).rows;
    const applied = await f.call('study_set_flashcard_set_template_admin', [f.a, f.setId, id, null]);
    assert.equal(applied.template_id, id);
    assert.deepEqual((await f.db.query('select * from public.study_flashcards where set_id=$1', [f.setId])).rows, cardsBefore, 'cards untouched');
    assert.deepEqual((await f.db.query('select * from public.study_flashcard_reviews')).rows, reviewsBefore, 'history untouched');
    await assert.rejects(f.call('study_set_flashcard_set_template_admin', [f.b, f.setId, null, 'classic']), /FLASHCARD_NOT_FOUND/);
    // Another account's template cannot be applied.
    const other = randomUUID();
    await f.call('study_save_card_template_admin', [f.b, other, 0, randomUUID(), JSON.stringify({ name: 'B', base: 'classic' })]);
    await assert.rejects(f.call('study_set_flashcard_set_template_admin', [f.a, f.setId, other, null]), /CARD_TEMPLATE_NOT_FOUND/);
    // Deleting a template (soft) leaves the set without a custom look instead of failing.
    await f.call('study_save_card_template_admin', [f.a, id, 1, randomUUID(), JSON.stringify({ deleted: true })]);
    await assert.rejects(f.call('study_set_flashcard_set_template_admin', [f.a, f.setId, id, null]), /CARD_TEMPLATE_NOT_FOUND/);
    // RLS: browsers (anon/authenticated) cannot read templates directly.
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select * from public.study_card_templates');
      }),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test('two writers on the same template version: one wins, the other gets a conflict', async () => {
  const f = await prepared();
  try {
    const id = randomUUID();
    await f.call('study_save_card_template_admin', [f.a, id, 0, randomUUID(), JSON.stringify({ name: 'T', base: 'classic' })]);
    const results = await Promise.allSettled([
      f.call('study_save_card_template_admin', [f.a, id, 1, randomUUID(), JSON.stringify({ name: 'Um' })]),
      f.call('study_save_card_template_admin', [f.a, id, 1, randomUUID(), JSON.stringify({ name: 'Dois' })]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /CARD_TEMPLATE_VERSION_CONFLICT/);
  } finally {
    await f.db.close();
  }
});
