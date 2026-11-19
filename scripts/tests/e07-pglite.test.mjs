import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('E07 SQL enforces ownership, ranges, private bucket and two-account upload/read policies', async () => {
  const db = new PGlite();
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const material = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const path = `original/${owner}/${material}/source.mp4`;
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
      create table public.materials(id uuid primary key,user_id uuid not null references auth.users,
        unique(id,user_id));
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id integer generated always as identity,bucket_id text,name text);
      create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant usage on schema auth,storage,public to authenticated;
      -- Production: authenticated has no SELECT on materials (reads go through the API).
      revoke all on public.materials from authenticated;
      grant select,insert on storage.objects to authenticated;
      grant usage on sequence storage.objects_id_seq to authenticated;
    `);
    for (const id of [owner, foreign]) await db.query('insert into auth.users values ($1)', [id]);
    await db.query('insert into public.materials values ($1,$2),($3,$4)', [
      material,
      owner,
      other,
      foreign,
    ]);
    await db.exec(
      readFileSync(
        new URL('../../database/migrations/20261105003500_player_video.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          '../../database/migrations/20261120090000_player_video_storage_owner_fix.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    // Re-running the fix (e.g. on an already-patched project) must be harmless.
    await db.exec(
      readFileSync(
        new URL(
          '../../database/migrations/20261120090000_player_video_storage_owner_fix.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const bucket = (
      await db.query(
        "select public,allowed_mime_types,file_size_limit from storage.buckets where id='study-videos'",
      )
    ).rows[0];
    assert.equal(bucket.public, false);
    assert.deepEqual(bucket.allowed_mime_types, ['video/mp4']);
    assert.equal(Number(bucket.file_size_limit), 104857600);
    const insert = `insert into public.material_videos(material_id,user_id,original_name,storage_path,size_bytes,duration_ms,clip_start_ms,clip_end_ms)
      values ($1,$2,'aula.mp4',$3,1000,60000,30000,33000)`;
    await db.query(insert, [material, owner, path]);
    await assert.rejects(db.query(insert, [other, owner, `original/${owner}/${other}/source.mp4`]));
    await assert.rejects(
      db.query('update public.material_videos set clip_end_ms=90000 where material_id=$1', [
        material,
      ]),
    );
    const grants = (
      await db.query(`select
      has_table_privilege('authenticated','public.material_videos','SELECT') as browser_read,
      has_table_privilege('anon','public.material_videos','INSERT') as anon_write,
      has_table_privilege('service_role','public.material_videos','INSERT') as server_write`)
    ).rows[0];
    assert.deepEqual(grants, { browser_read: false, anon_write: false, server_write: true });
    await db.exec(`set role authenticated; set test.user_id='${owner}';`);
    // Previously failed in production with "permission denied for table materials".
    await db.query("insert into storage.objects(bucket_id,name) values ('study-videos',$1)", [
      path,
    ]);
    assert.equal(
      (await db.query('select public.storage_owns_material($1) as own', [other])).rows[0].own,
      false,
    );
    await assert.rejects(db.query('select id from public.materials'), /permission denied/);
    assert.equal(
      (await db.query("select * from storage.objects where bucket_id='study-videos'")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values ('study-videos',$1)", [
        `original/${owner}/${other}/source.mp4`,
      ]),
    );
    await db.exec(`set test.user_id='${foreign}';`);
    assert.equal(
      (await db.query("select * from storage.objects where bucket_id='study-videos'")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values ('study-videos',$1)", [path]),
    );
  } finally {
    await db.close();
  }
});
