import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';

// Real SQL (PGlite) for the public testing program: admin allowlist, cohort, atomic and
// idempotent quotas with global caps, and the shared demonstration lessons with private copies.
const read = (path) => readFileSync(new URL(`../../database/${path}`, import.meta.url), 'utf8');
const migration = read('migrations/20261125100000_public_testing.sql');
const a = identities.a.id;
const b = identities.b.id;

const segments = [
  { position: 0, startMs: 0, endMs: 4000, text: 'A crase é a fusão da preposição a com o artigo a.' },
  { position: 1, startMs: 4300, endMs: 9000, text: 'Usamos o acento grave antes de palavras femininas.' },
];
const demoContent = {
  segments,
  words: null,
  credits: 'Roteiro original.',
  summary: { label: 'Resumo da aula', text: '## Crase\n\n- Fusão de **a** + **a**.' },
  questions: {
    title: 'Questões da aula',
    items: [
      {
        statement: 'O que é a crase?',
        options: ['A fusão de a + a', 'Um acento agudo', 'Um verbo', 'Um plural'],
        correctIndex: 0,
        explanation: 'É a fusão da preposição com o artigo.',
        metadata: { evidence: 'a fusão da preposição a com o artigo a', sourceRefs: [{ position: 0, startMs: 0, endMs: 4000 }] },
      },
    ],
  },
  flashcards: { name: 'Cartões: Crase', cards: [{ front: 'Crase', back: 'a + a', evidence: 'fusão', sourceSegments: [] }] },
};

async function migrated() {
  const f = await createAcademicDatabase();
  await migrateStudyAuthoring(f.db);
  await f.db.exec(read('migrations/20261104223000_quiz_sessions.sql'));
  await f.db.exec('alter table auth.users add column created_at timestamptz not null default now()');
  await f.db.exec("update auth.users set created_at = '2026-01-01'");
  await f.db.exec(migration);
  const call = f.call;
  const setConfig = (sql) => f.db.exec(`update public.public_testing_config set ${sql} where id = 1`);
  const newUser = async (createdAt = new Date().toISOString()) => {
    const id = randomUUID();
    await f.db.query('insert into auth.users(id, created_at) values ($1, $2)', [id, createdAt]);
    return id;
  };
  const addDemo = async (published = true) => {
    const id = randomUUID();
    await f.db.query(
      `insert into public.demo_lessons(id, slug, title, subject, duration_ms, audio_storage_path, audio_mime, audio_size_bytes, content, published)
       values ($1, $2, 'Crase', 'Português', 9000, $3, 'audio/mpeg', 1000, $4, $5)`,
      [id, 'crase-' + id.slice(0, 6), `demo/crase/audio.mp3`, JSON.stringify(demoContent), published],
    );
    return id;
  };
  return { ...f, call, setConfig, newUser, addDemo };
}

test('migration is guarded, transactional, additive and server-only', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /PUBLIC_TESTING_ABORT: faltam pré-requisitos/);
  assert.match(migration, /PUBLIC_TESTING_ABORT: estruturas do programa de testes ja existem/);
  assert.doesNotMatch(
    migration,
    /\b(drop\s+(table|column|constraint|function|trigger|policy|index)|truncate|create or replace|alter table public\.(materials|questions|question_batches|transcription|summary|audio_files|study_))/i,
  );
  for (const name of ['app_admins', 'public_testing_config', 'demo_access_grants', 'usage_ledger', 'demo_lessons', 'demo_lesson_copies'])
    assert.match(migration, new RegExp(`alter table public\\.${name} enable row level security`));
  for (const [, name, header] of migration.matchAll(/create function public\.(\w+)\(([^$]*?)as \$\$/g))
    if (name === 'testing_account_created_at')
      assert.match(header, /stable security definer set search_path = ''/, 'the one definer helper');
    else assert.match(header, /security invoker set search_path = ''/, name);
  assert.equal((migration.match(/security definer/g) || []).length, 1, 'a single definer function');
  assert.match(migration, /as restrictive for insert/);
});

test('nothing changes until the program is enabled; guard refuses to run twice', async () => {
  const f = await migrated();
  try {
    assert.equal(await f.call('testing_policy', [a]), 'off');
    const r = await f.call('testing_reserve_admin', [a, 'transcription_seconds', 'job-1', 99999, null]);
    assert.equal(r.ok, true, 'program off: no personal or global limit');
    assert.equal(r.policy, 'off');
    assert.equal(await f.call('testing_demo_access_admin', [a]), false);
    await assert.rejects(f.db.exec(migration), /PUBLIC_TESTING_ABORT: estruturas/);
  } finally {
    await f.db.close();
  }
});

test('browsers have no access to the new tables or functions', async () => {
  const f = await migrated();
  try {
    for (const role of ['anon', 'authenticated']) {
      for (const sql of [
        'select * from public.usage_ledger',
        'select * from public.app_admins',
        'select * from public.demo_lessons',
        "insert into public.app_admins(user_id, granted_by) values ('" + a + "', 'x')",
        "select public.testing_reserve_admin('" + a + "', 'summary', 'r', 1, null)",
        "select public.demo_lesson_materialize_admin('" + a + "', '" + randomUUID() + "')",
      ]) {
        await assert.rejects(
          f.db.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.exec(`set local request.jwt.claim.sub = '${a}'`);
            await tx.query(sql);
          }),
          /permission denied/,
          `${role}: ${sql}`,
        );
      }
    }
  } finally {
    await f.db.close();
  }
});

test('roles: admin allowlist, new cohort accounts are testers, existing accounts stay legacy', async () => {
  const f = await migrated();
  try {
    await f.setConfig("enabled = true, registration_starts_at = '2026-11-01', registration_ends_at = '2026-12-31'");
    const fresh = await f.newUser('2026-11-25T10:00:00Z');
    assert.equal(await f.call('testing_policy', [a]), 'legacy', 'created before the window');
    assert.equal(await f.call('testing_policy', [fresh]), 'tester');
    await f.db.query("insert into public.app_admins(user_id, granted_by) values ($1, 'setup')", [a]);
    assert.equal(await f.call('testing_policy', [a]), 'admin');
    // Revocation takes effect immediately.
    await f.db.query('update public.app_admins set revoked_at = now() where user_id = $1', [a]);
    assert.equal(await f.call('testing_policy', [a]), 'legacy');
    // Nothing a user writes in their profile can grant a role: only app_admins (server-only) does.
    await f.setConfig('apply_to_existing_accounts = true');
    assert.equal(await f.call('testing_policy', [b]), 'tester');
  } finally {
    await f.db.close();
  }
});

test('five cumulative minutes per tester: atomic, idempotent, never renewed', async () => {
  const f = await migrated();
  try {
    await f.setConfig("enabled = true, registration_starts_at = '2026-11-01'");
    const u = await f.newUser('2026-11-25T10:00:00Z');
    const r1 = await f.call('testing_reserve_admin', [u, 'transcription_seconds', 'job-1', 120, null]);
    assert.equal(r1.ok, true);
    assert.equal(r1.remaining, 180);
    const again = await f.call('testing_reserve_admin', [u, 'transcription_seconds', 'job-1', 120, null]);
    assert.equal(again.duplicate, true, 'the same job never counts twice');
    const r2 = await f.call('testing_reserve_admin', [u, 'transcription_seconds', 'job-2', 181, null]);
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'user_quota');
    assert.equal(r2.remaining, 180);
    const r3 = await f.call('testing_reserve_admin', [u, 'transcription_seconds', 'job-3', 180, null]);
    assert.equal(r3.ok, true);
    assert.equal(r3.remaining, 0);
    const r4 = await f.call('testing_reserve_admin', [u, 'transcription_seconds', 'job-4', 1, null]);
    assert.equal(r4.ok, false, 'exhausted');
    // A job that never reached the provider gives its seconds back.
    assert.equal(await f.call('testing_release_admin', [u, 'transcription_seconds', 'job-3']), true);
    const usage = await f.call('testing_usage_admin', [u]);
    assert.equal(usage.policy, 'tester');
    assert.equal(Number(usage.used.transcription_seconds), 120);
    assert.equal(Number(usage.limits.transcription_seconds), 300);
    // Generations are separate kinds with their own limits; multi-lesson is off for testers.
    assert.equal((await f.call('testing_reserve_admin', [u, 'summary', 's1', 1, null])).ok, true);
    assert.equal((await f.call('testing_reserve_admin', [u, 'summary', 's2', 1, null])).ok, true);
    assert.equal((await f.call('testing_reserve_admin', [u, 'summary', 's3', 1, null])).reason, 'user_quota');
    assert.equal((await f.call('testing_reserve_admin', [u, 'multi_lesson', 'm1', 1, null])).reason, 'user_quota');
  } finally {
    await f.db.close();
  }
});

test('concurrent reservations never overshoot the personal limit', async () => {
  const f = await migrated();
  try {
    await f.setConfig("enabled = true, registration_starts_at = '2026-11-01'");
    const u = await f.newUser('2026-11-25T10:00:00Z');
    // PGlite serializes statements; the advisory locks are what protect a real multi-connection
    // database. Ten "simultaneous" 60 s jobs must accept exactly five.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => f.call('testing_reserve_admin', [u, 'transcription_seconds', `job-${i}`, 60, null])),
    );
    assert.equal(results.filter((r) => r.ok).length, 5);
  } finally {
    await f.db.close();
  }
});

test('global caps stop everyone, admins included, and use estimated LLM load', async () => {
  const f = await migrated();
  try {
    await f.setConfig(
      `enabled = true, registration_starts_at = '2026-11-01',
       global_limits = '{"transcription_seconds":{"total":500,"day":400,"hour":300},"llm_requests":{"day":5,"hour":5},"llm_tokens":{"day":20000}}'`,
    );
    await f.db.query("insert into public.app_admins(user_id, granted_by) values ($1, 'setup')", [a]);
    const u = await f.newUser('2026-11-25T10:00:00Z');
    assert.equal((await f.call('testing_reserve_admin', [u, 'transcription_seconds', 'j1', 250, null])).ok, true);
    const blocked = await f.call('testing_reserve_admin', [a, 'transcription_seconds', 'j2', 100, null]);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'global_cap');
    assert.equal(blocked.window, 'hour');
    // Tokens: one question list is estimated at 22 000 tokens > 20 000 per day.
    const questions = await f.call('testing_reserve_admin', [a, 'questions', 'q1', 1, null]);
    assert.equal(questions.reason, 'global_cap');
    assert.equal((await f.call('testing_reserve_admin', [a, 'summary', 's1', 1, null])).ok, true);
    const overview = await f.call('testing_overview_admin', []);
    assert.equal(Number(overview.transcriptionSeconds.total), 250);
    assert.equal(Number(overview.llmRequests.day), 1);
  } finally {
    await f.db.close();
  }
});

test('demo lessons: cohort access, private copies, no shared state, idempotent', async () => {
  const f = await migrated();
  try {
    await f.setConfig("enabled = true, registration_starts_at = '2026-11-01', registration_ends_at = '2026-12-01'");
    const demo = await f.addDemo();
    await f.addDemo(false); // unpublished: never listed
    const u1 = await f.newUser('2026-11-25T10:00:00Z');
    const u2 = await f.newUser('2026-11-26T10:00:00Z');
    const late = await f.newUser('2026-12-05T10:00:00Z');
    assert.equal((await f.call('demo_lessons_list_admin', [a])).length, 0, 'existing account outside the cohort');
    assert.equal((await f.call('demo_lessons_list_admin', [late])).length, 0, 'registered after the window');
    const list = await f.call('demo_lessons_list_admin', [u1]);
    assert.equal(list.length, 1);
    assert.equal(list[0].materialId, null);
    await assert.rejects(f.call('demo_lesson_materialize_admin', [late, demo]), /DEMO_NOT_AVAILABLE/);

    const c1 = await f.call('demo_lesson_materialize_admin', [u1, demo]);
    const c2 = await f.call('demo_lesson_materialize_admin', [u2, demo]);
    assert.equal(c1.created, true);
    assert.notEqual(c1.materialId, c2.materialId, 'each participant has their own copy');
    assert.equal((await f.call('demo_lesson_materialize_admin', [u1, demo])).materialId, c1.materialId, 'idempotent');
    assert.equal((await f.call('demo_lessons_list_admin', [u1]))[0].materialId, c1.materialId);

    // The copy is a complete, confirmed lesson owned by the participant.
    const review = await f.call('get_transcription_review_admin', [u1, c1.materialId, (await f.db.query('select public.current_permission_version() v')).rows[0].v]);
    assert.equal(review.state, 'ready_to_generate');
    const rows = (await f.db.query(
      `select (select count(*) from public.transcription_segments s join public.transcriptions t on t.id = s.transcription_id where t.material_id = $1) segs,
              (select count(*) from public.summary_versions where material_id = $1) sums,
              (select count(*) from public.questions q join public.question_batches qb on qb.id = q.batch_id where qb.material_id = $1) qs,
              (select storage_path from public.audio_files where material_id = $1) audio`,
      [c1.materialId],
    )).rows[0];
    assert.deepEqual([Number(rows.segs), Number(rows.sums), Number(rows.qs), rows.audio], [2, 1, 1, 'demo/crase/audio.mp3']);
    assert.equal(c1.flashcards.cards.length, 1, 'flashcards handed to the API for the set service');

    // Private progress: a quiz attempt of u1 on their copy is invisible to u2's copy and to u2.
    const batch1 = (await f.db.query('select id from public.question_batches where material_id = $1', [c1.materialId])).rows[0].id;
    await f.db.query("insert into public.quiz_sessions(user_id, material_id, batch_id, feedback_mode) values ($1, $2, $3, 'deferred')", [u1, c1.materialId, batch1]);
    const u2Sessions = (await f.db.query('select count(*) n from public.quiz_sessions where user_id = $1', [u2])).rows[0].n;
    assert.equal(Number(u2Sessions), 0);
    // u2 cannot attach progress to u1's copy (ownership constraint).
    await assert.rejects(
      f.db.query("insert into public.quiz_sessions(user_id, material_id, batch_id, feedback_mode) values ($1, $2, $3, 'deferred')", [u2, c1.materialId, batch1]),
      /foreign key/,
    );
    // Editing a copy never touches the canonical lesson or another copy.
    await f.db.query("update public.transcription_segments set current_text = 'editado' where transcription_id = (select id from public.transcriptions where material_id = $1)", [c1.materialId]);
    const canonical = (await f.db.query('select content from public.demo_lessons where id = $1', [demo])).rows[0].content;
    assert.equal(canonical.segments[0].text, segments[0].text);
    const other = (await f.db.query("select count(*) n from public.transcription_segments s join public.transcriptions t on t.id = s.transcription_id where t.material_id = $1 and s.current_text = 'editado'", [c2.materialId])).rows[0].n;
    assert.equal(Number(other), 0);
    // Deleting a copy frees the slot; reopening creates a fresh copy (canonical intact).
    await f.db.query('delete from public.materials where id = $1', [c1.materialId]);
    const again = await f.call('demo_lesson_materialize_admin', [u1, demo]);
    assert.equal(again.created, true);
    assert.equal((await f.call('demo_copy_of_admin', [u1, again.materialId])).audioPath, 'demo/crase/audio.mp3');
    assert.equal(await f.call('demo_copy_of_admin', [u2, again.materialId]), null, 'copy lookup is per owner');
    // Access persists after the registration window closes (grant stored).
    await f.setConfig("registration_ends_at = '2026-11-20'");
    assert.equal((await f.call('demo_lessons_list_admin', [u2])).length, 1);
  } finally {
    await f.db.close();
  }
});
