import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

const migration = readFileSync(
  new URL('../../database/migrations/20261119121000_flashcard_sets.sql', import.meta.url),
  'utf8',
);

test('flashcard sets migration is guarded, additive and server-only', () => {
  assert.match(migration, /FLASHCARD_SETS_ABORT: aplicar e verificar E02 e E13/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(
    migration,
    /\b(drop table|drop constraint|drop function|truncate|create or replace|alter table public\.study_flashcard_reviews)\b/i,
  );
  assert.match(migration, /alter table public\.study_flashcard_sets enable row level security/);
  assert.match(
    migration,
    /revoke all on table public\.study_flashcard_sets from public, anon, authenticated/,
  );
});

test('sets: atomic creation, dedupe, ownership, archive, delete and preserved history', async () => {
  const f = await createAcademicDatabase();
  try {
    await migrateStudyAuthoring(f.db, { flashcards: true });
    const { call, db } = f;
    const a = identities.a.id,
      b = identities.b.id;
    // Generated cards may only cite a revision the owner confirmed.
    await f.permit(identities.a, resourceIds.materialA);
    // A card created before the migration keeps its schedule and review history.
    const legacy = (
      await db.query(
        "insert into public.study_flashcards(user_id,front_text,back_text) values($1,'Antigo?','Sim') returning id",
        [a],
      )
    ).rows[0].id;
    await call('study_review_flashcard_admin', [a, legacy, 2, randomUUID()]);
    const card = (i, extra = {}) => ({
      front: `Pergunta ${i}?`,
      back: `Resposta ${i}.`,
      evidence: 'Energia é conservada.',
      sourceSegments: [{ position: 0, startMs: 0, endMs: 3000 }],
      style: 'question_answer',
      difficulty: 'basic',
      focus: 'concepts',
      ...extra,
    });
    const setId = randomUUID();
    const body = {
      name: 'Física — conceitos',
      materialId: resourceIds.materialA,
      sourceRevisionId: revisionIds.a,
      config: { count: 3, difficulties: ['basic'] },
      cards: [card(1), card(2), card(1, { front: '  PERGUNTA 1? ' })],
    };
    await assert.rejects(
      call('study_create_flashcard_set_admin', [a, setId, JSON.stringify(body)]),
      /TRANSCRIPTION_CONFIRMATION_REQUIRED/,
      'a direct call cannot save generated cards from an unconfirmed revision',
    );
    await f.confirm(identities.a, resourceIds.materialA, revisionIds.a);
    const created = await call('study_create_flashcard_set_admin', [
      a,
      setId,
      JSON.stringify(body),
    ]);
    assert.equal(created.added, 2, 'exact duplicate front skipped');
    assert.equal(created.name, 'Física — conceitos');
    const retry = await call('study_create_flashcard_set_admin', [a, setId, JSON.stringify(body)]);
    assert.equal(retry.replayed, true);
    await assert.rejects(
      call('study_create_flashcard_set_admin', [b, setId, JSON.stringify(body)]),
      /FLASHCARD_NOT_FOUND/,
    );
    await assert.rejects(
      call('study_create_flashcard_set_admin', [
        b,
        randomUUID(),
        JSON.stringify({ ...body, materialId: resourceIds.materialA }),
      ]),
      /FLASHCARD_NOT_FOUND/,
      'cannot attach a set to another account material',
    );
    await assert.rejects(
      call('study_create_flashcard_set_admin', [
        a,
        randomUUID(),
        JSON.stringify({ ...body, sourceRevisionId: revisionIds.b }),
      ]),
      /FLASHCARD_NOT_FOUND/,
      'source revision must belong to the material',
    );
    await assert.rejects(
      call('study_create_flashcard_set_admin', [
        a,
        randomUUID(),
        JSON.stringify({ ...body, cards: [] }),
      ]),
      /FLASHCARD_INVALID_SET/,
    );
    const rows = (
      await db.query('select * from public.study_flashcards where set_id=$1 order by front_text', [
        setId,
      ])
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].material_id, resourceIds.materialA);
    assert.equal(rows[0].source_revision_id, revisionIds.a);
    assert.equal(rows[0].evidence, 'Energia é conservada.');
    assert.deepEqual(rows[0].source_segments, [{ position: 0, startMs: 0, endMs: 3000 }]);
    assert.equal(rows[0].status, 'active');
    // New set cards enter the existing review schedule (due now).
    assert(new Date(rows[0].due_at) <= new Date());
    assert.equal(
      await call('study_add_flashcards_admin', [a, setId, JSON.stringify([card(2), card(3)])]),
      1,
    );
    await assert.rejects(
      call('study_add_flashcards_admin', [b, setId, JSON.stringify([card(9)])]),
      /FLASHCARD_NOT_FOUND/,
    );
    await assert.rejects(
      call('study_add_flashcards_admin', [a, setId, JSON.stringify([card(9, { back: ' ' })])]),
      /FLASHCARD_INVALID_SET/,
    );

    const reviewed = rows[0].id;
    await call('study_review_flashcard_admin', [a, reviewed, 3, randomUUID()]);
    // A card archived on its own must stay archived when the set is archived and restored.
    const alone = rows[1].id;
    await db.query("update public.study_flashcards set status = 'archived' where id = $1", [alone]);
    const archived = await call('study_update_flashcard_set_admin', [a, setId, null, 'archived']);
    assert.equal(archived.status, 'archived');
    assert.deepEqual(
      (
        await db.query('select distinct status from public.study_flashcards where set_id=$1', [
          setId,
        ])
      ).rows,
      [{ status: 'archived' }],
    );
    await assert.rejects(
      call('study_review_flashcard_admin', [a, reviewed, 2, randomUUID()]),
      /FLASHCARD_ARCHIVED/,
    );
    await call('study_update_flashcard_set_admin', [a, setId, ' Física — revisão ', 'active']);
    assert.equal(
      (await db.query('select status from public.study_flashcards where id = $1', [reviewed]))
        .rows[0].status,
      'active',
    );
    assert.equal(
      (await db.query('select status from public.study_flashcards where id = $1', [alone])).rows[0]
        .status,
      'archived',
    );
    assert.equal(
      (await db.query('select name from public.study_flashcard_sets where id=$1', [setId])).rows[0]
        .name,
      'Física — revisão',
    );
    assert.equal(
      Number(
        (
          await db.query('select count(*) n from public.study_flashcard_reviews where card_id=$1', [
            reviewed,
          ])
        ).rows[0].n,
      ),
      1,
    );
    await assert.rejects(
      call('study_update_flashcard_set_admin', [b, setId, 'X', null]),
      /FLASHCARD_NOT_FOUND/,
    );
    await assert.rejects(
      call('study_update_flashcard_set_admin', [a, setId, '', null]),
      /FLASHCARD_INVALID_SET/,
    );

    const single = (
      await db.query('select id from public.study_flashcards where set_id=$1 limit 1', [setId])
    ).rows[0].id;
    await assert.rejects(call('study_delete_flashcard_admin', [b, single]), /FLASHCARD_NOT_FOUND/);
    await call('study_delete_flashcard_admin', [a, single]);
    await assert.rejects(
      call('study_delete_flashcard_set_admin', [b, setId]),
      /FLASHCARD_NOT_FOUND/,
    );
    const removed = await call('study_delete_flashcard_set_admin', [a, setId]);
    assert.equal(removed.deletedCards, 2);
    assert.equal(
      Number(
        (await db.query('select count(*) n from public.study_flashcards where set_id=$1', [setId]))
          .rows[0].n,
      ),
      0,
    );
    // The pre-existing card and its history are untouched.
    assert.equal(
      Number(
        (
          await db.query('select count(*) n from public.study_flashcard_reviews where card_id=$1', [
            legacy,
          ])
        ).rows[0].n,
      ),
      1,
    );
    assert.equal(
      (await db.query('select set_id from public.study_flashcards where id=$1', [legacy])).rows[0]
        .set_id,
      null,
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select public.study_delete_flashcard_set_admin($1,$2)', [a, randomUUID()]);
      }),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
