import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id integer generated always as identity,bucket_id text,name text);
    create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage,public to anon, authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant usage on sequence storage.objects_id_seq to authenticated;
  `);
  await db.query('insert into auth.users values ($1),($2)', [A, B]);
  // Production state: the profile proposal plus Supabase's default table grants.
  await db.exec(read('../../database/proposals/profile-gamification.sql'));
  await db.exec('grant all on public.profile_state to anon, authenticated');
  return db;
}

/** Runs `sql` as the browser role for `user`; returns rows or throws the database error. */
async function as(db, user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(
      `set local role authenticated; select set_config('test.user_id', '${user}', true);`,
    );
    return (await tx.query(sql, params)).rows;
  });
}

test('profile_state RLS: each account sees and writes only its own rows', async () => {
  const db = await setup();
  try {
    await as(
      db,
      A,
      'insert into public.profile_state(user_id,key,data) values($1,\'preferences\',\'{"t":"a"}\')',
      [A],
    );
    await as(
      db,
      B,
      'insert into public.profile_state(user_id,key,data) values($1,\'preferences\',\'{"t":"b"}\')',
      [B],
    );
    assert.deepEqual(await as(db, A, 'select user_id from public.profile_state'), [{ user_id: A }]);
    await assert.rejects(
      as(db, A, "insert into public.profile_state(user_id,key,data) values($1,'milestones','{}')", [
        B,
      ]),
      /row-level security/,
      'cannot create rows for another account',
    );
    const changed = await as(
      db,
      A,
      'update public.profile_state set data=\'{"t":"evil"}\' where user_id=$1 returning key',
      [B],
    );
    assert.deepEqual(changed, [], "cannot modify another account's preferences");
    await assert.rejects(
      as(db, A, 'update public.profile_state set user_id=$1 where user_id=$2', [B, A]),
      /row-level security/,
      'cannot move own rows to another account',
    );
    const bRow = (await db.query('select data from public.profile_state where user_id=$1', [B]))
      .rows[0];
    assert.deepEqual(bRow.data, { t: 'b' });
  } finally {
    await db.close();
  }
});

test('hardening migration: no TRUNCATE/DELETE for the browser, key format, per-account limit', async () => {
  const db = await setup();
  try {
    // Before: Supabase default grants let the browser role TRUNCATE (which ignores RLS).
    await as(
      db,
      A,
      "insert into public.profile_state(user_id,key,data) values($1,'preferences','{}')",
      [A],
    );
    await db.exec(read('../../database/migrations/20261120120000_profile_state_hardening.sql'));
    // Idempotent.
    await db.exec(read('../../database/migrations/20261120120000_profile_state_hardening.sql'));

    await assert.rejects(as(db, A, 'truncate public.profile_state'), /permission denied/);
    await assert.rejects(as(db, A, 'delete from public.profile_state'), /permission denied/);
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query('select * from public.profile_state');
      }),
      /permission denied/,
    );
    // The app's operations still work.
    await as(
      db,
      A,
      "update public.profile_state set data='{\"x\":1}' where user_id=$1 and key='preferences'",
      [A],
    );
    await as(
      db,
      A,
      "insert into public.profile_state(user_id,key,data) values($1,'media-folder-subject-11111111-1111-4111-8111-111111111111','{}')",
      [A],
    );
    for (const bad of ['', 'Preferences', '../x', 'chave com espaço', 'x'.repeat(151)])
      await assert.rejects(
        as(db, A, "insert into public.profile_state(user_id,key,data) values($1,$2,'{}')", [
          A,
          bad,
        ]),
        /profile_state_key_format|violates check constraint/,
        JSON.stringify(bad),
      );
    // Limit: 300 keys per account.
    await db.query(
      "insert into public.profile_state(user_id,key,data) select $1, 'k' || g, '{}' from generate_series(1, 298) g",
      [A],
    );
    await assert.rejects(
      as(
        db,
        A,
        "insert into public.profile_state(user_id,key,data) values($1,'one-too-many','{}')",
        [A],
      ),
      /PROFILE_STATE_LIMIT/,
    );
    // Another account is not affected by A's limit.
    await as(
      db,
      B,
      "insert into public.profile_state(user_id,key,data) values($1,'preferences','{}')",
      [B],
    );
  } finally {
    await db.close();
  }
});

test('hardening migration refuses to run over keys that would break the new rule', async () => {
  const db = await setup();
  try {
    await db.query("insert into public.profile_state(user_id,key,data) values($1,'Bad Key','{}')", [
      A,
    ]);
    await assert.rejects(
      db.exec(read('../../database/migrations/20261120120000_profile_state_hardening.sql')),
      /PROFILE_STATE_ABORT/,
    );
  } finally {
    await db.close();
  }
});
