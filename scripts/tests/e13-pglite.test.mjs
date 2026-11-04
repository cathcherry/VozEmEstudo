import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../database/migrations/20261104234500_flashcards.sql'),
  'utf8',
);
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const material = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherMaterial = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('E13 migration executes with ownership, grants and idempotent review RPC in PostgreSQL', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select null::uuid';
      create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at := now(); return new; end $$;
      create table public.materials (
        id uuid primary key, user_id uuid not null references auth.users(id),
        constraint materials_id_user_planning_unique unique (id, user_id)
      );
      create table public.study_tasks (id uuid primary key);
    `);
    for (const id of [owner, foreign])
      await db.query('insert into auth.users(id) values ($1::uuid)', [id]);
    for (const [id, userId] of [[material, owner], [otherMaterial, foreign]])
      await db.query('insert into public.materials(id,user_id) values ($1::uuid,$2::uuid)',
        [id, userId]);
    await db.exec(migration);

    const grants = await db.query(`
      select
        has_table_privilege('anon','public.study_flashcards','SELECT') as anon_read,
        has_table_privilege('authenticated','public.study_flashcard_reviews','SELECT') as authenticated_history,
        has_function_privilege('anon',
          'public.study_review_flashcard_admin(uuid,uuid,integer,uuid)','EXECUTE') as anon_rpc,
        has_function_privilege('service_role',
          'public.study_review_flashcard_admin(uuid,uuid,integer,uuid)','EXECUTE') as server_rpc
    `);
    assert.deepEqual(grants.rows[0], {
      anon_read: false,
      authenticated_history: false,
      anon_rpc: false,
      server_rpc: true,
    });

    const created = await db.query(`
      insert into public.study_flashcards(user_id,material_id,front_text,back_text)
      values ($1::uuid,$2::uuid,'Pergunta','Resposta') returning id, interval_days
    `, [owner, material]);
    const cardId = created.rows[0].id;
    assert.equal(created.rows[0].interval_days, 0);
    await assert.rejects(db.query(`
      insert into public.study_flashcards(user_id,material_id,front_text,back_text)
      values ($1::uuid,$2::uuid,'Outra','Outra')
    `, [owner, otherMaterial]));

    const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const reviewSql = `select public.study_review_flashcard_admin(
      $1::uuid, $2::uuid, $3::integer, $4::uuid
    ) as review`;
    const first = (await db.query(reviewSql, [owner, cardId, 2, requestId])).rows[0].review;
    assert.equal(first.intervalDays, 1);
    assert.equal(first.repetitions, 1);
    assert.equal(first.replayed, false);

    const repeated = (await db.query(reviewSql, [owner, cardId, 2, requestId])).rows[0].review;
    assert.equal(repeated.replayed, true);
    assert.equal(repeated.dueAt, first.dueAt);
    const count = await db.query(
      'select count(*)::integer as count from public.study_flashcard_reviews where card_id=$1::uuid',
      [cardId],
    );
    assert.equal(count.rows[0].count, 1);
    await assert.rejects(db.query(reviewSql, [owner, cardId, 3, requestId]));
    await assert.rejects(db.query(reviewSql, [foreign, cardId, 2,
      'ffffffff-ffff-4fff-8fff-ffffffffffff']));

    const again = (await db.query(reviewSql, [owner, cardId, 0,
      '11111111-1111-4111-8111-111111111111'])).rows[0].review;
    assert.equal(again.intervalDays, 0);
    assert.equal(again.repetitions, 0);
    const due = new Date(again.dueAt).getTime() - new Date(again.reviewedAt).getTime();
    assert(due >= 9 * 60 * 1000 && due <= 11 * 60 * 1000);

    await db.query('update public.study_flashcards set status=$2 where id=$1::uuid',
      [cardId, 'archived']);
    await assert.rejects(db.query(reviewSql, [owner, cardId, 1,
      '22222222-2222-4222-8222-222222222222']));
  } finally {
    await db.close();
  }
});
