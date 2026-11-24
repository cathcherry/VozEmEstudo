import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

const read = (file) =>
  readFileSync(new URL('../../database/migrations/' + file, import.meta.url), 'utf8');
const migration = read('20261125090000_security_hardening_public.sql');

const asUser = (db, identity, fn) =>
  db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [identity.id]);
    return fn(tx);
  });

const videoPath = (identity, materialId) => `original/${identity.id}/${materialId}/source.mp4`;

async function uploadVideo(db, identity, materialId) {
  try {
    await asUser(db, identity, (tx) =>
      tx.query(
        "insert into storage.objects(bucket_id, name, owner_id) values ('study-videos', $1, $2)",
        [videoPath(identity, materialId), identity.id],
      ),
    );
    return true;
  } catch (error) {
    if (/row-level security|permission denied/.test(error.message)) return false;
    throw error;
  }
}

const visibleVideos = (db, identity) =>
  asUser(db, identity, async (tx) =>
    Number(
      (await tx.query("select count(*) n from storage.objects where bucket_id = 'study-videos'"))
        .rows[0].n,
    ),
  );

test('public hardening migration: same storage/RLS answers, helper off the API schema, re-runnable', async () => {
  assert.doesNotMatch(
    migration,
    /\b(truncate\s+(table\s+)?public|delete from|insert into|update public)\b/i,
  );
  // The only drops are the two policies it recreates and the public copy of the helper.
  for (const statement of migration.match(/\bdrop\s+\w+[^;]*/gi) || [])
    assert.match(
      statement,
      /study_video_(upload|read)_own|function if exists public\.storage_owns_material/i,
      statement,
    );

  const f = await createAcademicDatabase();
  try {
    await f.db.exec(read('20261119130000_security_hardening.sql'));
    await f.db.exec(read('20261120090000_player_video_storage_owner_fix.sql'));
    // Production state found in the audit: anon/authenticated hold TRUNCATE/REFERENCES/TRIGGER.
    await f.db.exec(
      'grant select on public.materials to authenticated;' +
        'grant truncate, references, trigger on public.materials, public.questions to anon, authenticated;' +
        'grant usage on schema storage, auth to authenticated;' +
        'grant select, insert on storage.objects to authenticated;',
    );
    const before = {
      ownUpload: await uploadVideo(f.db, identities.a, resourceIds.materialA),
      foreignUpload: await uploadVideo(f.db, identities.a, resourceIds.materialB),
      aSees: await visibleVideos(f.db, identities.a),
      bSees: await visibleVideos(f.db, identities.b),
    };
    assert.deepEqual(before, { ownUpload: true, foreignUpload: false, aSees: 1, bSees: 0 });
    await f.db.query("delete from storage.objects where bucket_id = 'study-videos'");

    await f.db.exec(migration);
    await f.db.exec(migration);

    const after = {
      ownUpload: await uploadVideo(f.db, identities.a, resourceIds.materialA),
      foreignUpload: await uploadVideo(f.db, identities.a, resourceIds.materialB),
      aSees: await visibleVideos(f.db, identities.a),
      bSees: await visibleVideos(f.db, identities.b),
    };
    assert.deepEqual(after, before);
    // B's own lesson still works for B, never for A.
    assert.equal(await uploadVideo(f.db, identities.b, resourceIds.materialB), true);
    assert.equal(await visibleVideos(f.db, identities.a), 1);

    // The helper is gone from the exposed schema and lives in "private", for authenticated only.
    const helper = (
      await f.db.query(
        "select to_regprocedure('public.storage_owns_material(text)') is null as gone," +
          " has_function_privilege('authenticated', 'private.storage_owns_material(text)', 'EXECUTE') as auth_x," +
          " has_function_privilege('anon', 'private.storage_owns_material(text)', 'EXECUTE') as anon_x," +
          " has_schema_privilege('anon', 'private', 'USAGE') as anon_usage",
      )
    ).rows[0];
    assert.deepEqual(helper, { gone: true, auth_x: true, anon_x: false, anon_usage: false });
    const policies = (
      await f.db.query(
        "select policyname, coalesce(qual, '') || coalesce(with_check, '') as text from pg_policies where schemaname = 'storage'",
      )
    ).rows;
    assert.equal(policies.filter((p) => /private\.storage_owns_material/.test(p.text)).length, 2);

    // 001_initial policies apply to authenticated only; the owner keeps reading their lesson.
    const roles = (
      await f.db.query(
        "select distinct roles::text r from pg_policies where schemaname = 'public' and policyname = any($1)",
        [['materials_select_own', 'questions_select_own', 'processing_job_events_select_own']],
      )
    ).rows.map((row) => row.r);
    assert.deepEqual(roles, ['{authenticated}']);
    const own = await asUser(f.db, identities.a, async (tx) =>
      (await tx.query('select id from public.materials')).rows.map((r) => r.id),
    );
    assert.deepEqual(own, [resourceIds.materialA]);

    // Unused privileges are gone, also for tables created later by the same owner.
    await f.db.exec('create table public.after_hardening(id int primary key)');
    const privileges = (
      await f.db.query(
        "select has_table_privilege('anon', 'public.materials', 'TRUNCATE') a," +
          " has_table_privilege('authenticated', 'public.questions', 'TRUNCATE') b," +
          " has_table_privilege('authenticated', 'public.questions', 'TRIGGER') c," +
          " has_table_privilege('anon', 'public.after_hardening', 'TRUNCATE') d," +
          " has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE') e",
      )
    ).rows[0];
    assert.deepEqual(privileges, { a: false, b: false, c: false, d: false, e: false });
    // The trigger that calls set_updated_at() still fires.
    await f.db.query("update public.materials set title = 'Renomeada' where id = $1", [
      resourceIds.materialA,
    ]);
  } finally {
    await f.db.close();
  }
});
