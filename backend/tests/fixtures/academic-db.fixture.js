import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { identities, resourceIds } from './ownership.fixture.js';
import { PERMISSION_DECLARATION } from '../../src/config/permission-declaration.js';

export const revisionIds = {
  a: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  b: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
};
export async function createAcademicDatabase() {
  const db = new PGlite();
  await db.exec("set timezone = 'UTC'");
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls;' +
      'create schema auth; create table auth.users(id uuid primary key);' +
      "create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
      "create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('sub',auth.uid()) $$;" +
      'create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);' +
      'create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);' +
      "create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;" +
      'alter table storage.objects enable row level security;',
  );
  const baseline = await readFile(
    fileURLToPath(new URL('../../../database/migrations/001_initial.sql', import.meta.url)),
    'utf8',
  );
  // PGlite has core gen_random_uuid; pgcrypto is not bundled. The original SQL is never modified.
  await db.exec(baseline.replace(/create extension if not exists pgcrypto;/i, ''));
  for (const [key, identity, materialId] of [
    ['a', identities.a, resourceIds.materialA],
    ['b', identities.b, resourceIds.materialB],
  ]) {
    await db.query('insert into auth.users(id) values($1)', [identity.id]);
    await db.query(
      'insert into public.materials(id,user_id,title,subject,status) values($1,$2,$3,$4,$5)',
      [materialId, identity.id, 'Aula sintética ' + key, 'Física', 'PRONTO'],
    );
    const transcript = (
      await db.query(
        'insert into public.transcriptions(material_id,current_text) values($1,$2) returning id',
        [materialId, 'Energia é conservada. Uma afirmação citada pode ser refutada.'],
      )
    ).rows[0];
    const segment = (
      await db.query(
        'insert into public.transcription_segments(transcription_id,position,start_ms,end_ms,original_text,current_text) values($1,0,0,3000,$2,$2) returning id',
        [transcript.id, 'Energia é conservada. Uma afirmação citada pode ser refutada.'],
      )
    ).rows[0];
    await db.query(
      'insert into public.transcription_versions(id,transcription_id,revision,origin,full_text,segments_snapshot) values($1,$2,1,$3,$4,$5)',
      [
        revisionIds[key],
        transcript.id,
        'ASR',
        'Energia é conservada. Uma afirmação citada pode ser refutada.',
        JSON.stringify([
          {
            id: segment.id,
            position: 0,
            startMs: 0,
            endMs: 3000,
            text: 'Energia é conservada. Uma afirmação citada pode ser refutada.',
          },
        ]),
      ],
    );
  }
  for (const [identity, materialId, jobId, batchId, questionId] of [
    [
      identities.a,
      resourceIds.materialA,
      resourceIds.jobA,
      resourceIds.batchA,
      resourceIds.questionA,
    ],
    [
      identities.b,
      resourceIds.materialB,
      resourceIds.jobB,
      resourceIds.batchB,
      resourceIds.questionB,
    ],
  ]) {
    await db.query(
      'insert into public.audio_files(material_id,original_name,mime_type,extension,size_bytes,duration_ms,retain_original,storage_path) values($1,$2,$3,$4,1024,3000,true,$5)',
      [
        materialId,
        'fixture.wav',
        'audio/wav',
        'wav',
        'retained/' + identity.id + '/' + materialId + '/fixture.wav',
      ],
    );
    await db.query(
      'insert into public.processing_jobs(id,material_id,type,status) values($1,$2,$3,$4)',
      [jobId, materialId, 'PROCESSAMENTO_INICIAL', 'CONCLUIDA'],
    );
    await db.query(
      'insert into public.question_batches(id,material_id,source_transcription_revision,requested_count,generated_count,model,prompt_version) values($1,$2,1,5,1,$3,$4)',
      [batchId, materialId, 'fixture', 'legacy'],
    );
    await db.query(
      'insert into public.questions(id,batch_id,position,statement,options,correct_index,explanation) values($1,$2,0,$3,$4,1,$5)',
      [
        questionId,
        batchId,
        'Questão sintética?',
        JSON.stringify(['A', 'B', 'C', 'D']),
        'Explicação sintética.',
      ],
    );
  }
  await db.query('insert into public.processing_job_events(job_id,message) values($1,$2)', [
    resourceIds.jobA,
    'Evento sintético.',
  ]);
  const preflight = await db.exec(
    await readFile(
      fileURLToPath(new URL('../../../database/checks/e02-preflight.sql', import.meta.url)),
      'utf8',
    ),
  );
  const migration = await readFile(
    fileURLToPath(
      new URL('../../../database/migrations/20261009101846_academic_review.sql', import.meta.url),
    ),
    'utf8',
  );
  await db.exec(migration);
  const postflight = await db.exec(
    await readFile(
      fileURLToPath(new URL('../../../database/checks/e02-postflight.sql', import.meta.url)),
      'utf8',
    ),
  );
  // Match a Data API environment with SELECT available; test the real policies independently of API ownership guards.
  await db.exec(
    'grant usage on schema auth to authenticated; grant select on public.materials to authenticated',
  );
  async function call(name, values) {
    if (!/^[a-z_]+$/.test(name)) throw new Error('Unsafe test RPC name');
    return db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      const placeholders = values.map((_, i) => '$' + (i + 1)).join(',');
      const result = await tx.query(
        'select public.' + name + '(' + placeholders + ') as data',
        values,
      );
      return result.rows[0].data;
    });
  }
  const permit = (identity, materialId) =>
    call('declare_material_permission_admin', [
      identity.id,
      materialId,
      PERMISSION_DECLARATION.version,
      PERMISSION_DECLARATION.text,
    ]);
  const confirm = (identity, materialId, versionId) =>
    call('confirm_transcription_admin', [
      identity.id,
      materialId,
      versionId,
      PERMISSION_DECLARATION.version,
    ]);
  const enqueue = (identity, materialId, type, params, sourceId, key) =>
    call('enqueue_processing_job_admin', [
      identity.id,
      materialId,
      type,
      JSON.stringify(params),
      sourceId,
      key,
      PERMISSION_DECLARATION.version,
      3,
    ]);
  return { db, call, permit, confirm, enqueue, preflight, postflight };
}
