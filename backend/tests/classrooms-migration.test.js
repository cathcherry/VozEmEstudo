import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import {
  migrateClassrooms,
  readClassroomsMigration,
  classroomResourceIds,
  currentRevisionId,
  createSet,
  identities,
  resourceIds,
} from './fixtures/classroom-db.fixture.js';
import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';

const migration = readClassroomsMigration();
const readDatabaseFile = (path) =>
  readFileSync(new URL('../../database/' + path, import.meta.url), 'utf8');
const TABLES = [
  'classrooms',
  'classroom_members',
  'classroom_invites',
  'classroom_submissions',
  'classroom_submission_events',
  'classroom_lessons',
  'classroom_shared_items',
  'classroom_resources',
];
const sha = (value) => createHash('sha256').update(value).digest('hex');
let codeCounter = 0;
const newCode = () => `TESTCODE${String(++codeCounter).padStart(4, '2')}`;
const ids = Object.fromEntries(Object.entries(identities).map(([k, v]) => [k, v.id]));
const NAMES = { a: 'Profa. Ana', b: 'Bruno', c: 'Carla', d: 'Davi', e: 'Eva' };
/** 'ok' or the error raised by the database function (e.g. CLASSROOM_NOT_FOUND). */
const outcome = (promise) =>
  promise.then(
    () => 'ok',
    (error) => error.message,
  );

function api(f) {
  const { call } = f;
  return {
    create: (who, id = randomUUID(), name = 'Física 2º ano') =>
      call('classroom_create_admin', [ids[who], id, name, 'Turma de teste', NAMES[who]]),
    invite: async (who, classId, { days = 7, maxUses = 30 } = {}) => {
      const code = newCode();
      const result = await call('classroom_create_invite_admin', [
        ids[who],
        classId,
        randomUUID(),
        randomUUID(),
        sha(code),
        days,
        maxUses,
      ]);
      return { code, ...result };
    },
    join: (who, code) => call('classroom_join_admin', [ids[who], sha(code), NAMES[who]]),
    get: (who, classId) => call('classroom_get_admin', [ids[who], classId]),
    publish: (who, classId, body, id = randomUUID()) =>
      call('classroom_publish_lesson_admin', [ids[who], classId, id, JSON.stringify(body)]),
    lessons: (who, classId) => call('classroom_list_lessons_admin', [ids[who], classId]),
    lesson: (who, classId, lessonId) =>
      call('classroom_get_lesson_admin', [ids[who], classId, lessonId]),
    submit: (who, classId, materialId, id = randomUUID()) =>
      call('classroom_submit_admin', [
        ids[who],
        classId,
        id,
        materialId,
        'Gravei a aula de ontem.',
        PERMISSION_DECLARATION.version,
      ]),
    move: (
      who,
      classId,
      subId,
      to,
      { requestId = randomUUID(), revisionId = null, note = null } = {},
    ) =>
      call('classroom_transition_submission_admin', [
        ids[who],
        classId,
        subId,
        to,
        requestId,
        revisionId,
        note,
      ]),
    submissions: (who, classId) => call('classroom_list_submissions_admin', [ids[who], classId]),
    share: (who, classId, setId, id = randomUUID()) =>
      call('classroom_share_item_admin', [ids[who], classId, id, 'flashcard_set', setId]),
    sharedSets: (who, classId) =>
      call('classroom_list_shared_flashcard_sets_admin', [ids[who], classId]),
    sharedSet: (who, classId, sharedId) =>
      call('classroom_get_shared_flashcard_set_admin', [ids[who], classId, sharedId]),
    revokeShare: (who, classId, sharedId) =>
      call('classroom_revoke_shared_item_admin', [ids[who], classId, sharedId]),
  };
}

test('classrooms migration is guarded, additive, server-only and never touches private records', () => {
  assert.match(migration, /CLASSROOMS_ABORT: faltam pré-requisitos/);
  assert.match(migration, /CLASSROOMS_ABORT: estruturas de turmas ja existem/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(
    migration,
    /\b(drop table|drop column|drop function|drop policy|truncate|delete from|create or replace)\b/i,
  );
  // Only the new tables are altered (the lesson link added after both tables exist).
  for (const [, table] of migration.matchAll(/alter table public\.([a-z_]+)/g))
    assert(TABLES.includes(table), `alters an existing table: ${table}`);
  for (const table of TABLES) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
  }
  assert.doesNotMatch(migration, /security definer/i);
  // Privacy boundary: no classroom function can read personal learning records.
  assert.doesNotMatch(
    migration,
    /study_flashcard_reviews|study_progress|study_sessions|study_time_credits|study_annotations|quiz_session|study_calendar|study_goals|study_tasks|material_shares/,
  );
  // Invitation codes are never stored in clear.
  assert.match(
    migration,
    /token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
  );
  assert.doesNotMatch(migration, /\bcode text\b|\btoken text\b/);
});

test('guard: refuses to run without prerequisites or twice; legacy rows are untouched', async () => {
  const bare = await createAcademicDatabase();
  try {
    await assert.rejects(
      bare.db.exec(migration),
      /CLASSROOMS_ABORT: faltam pré-requisitos: .*study_flashcard_sets/,
    );
    await bare.db.exec('rollback');
    assert.equal(
      (await bare.db.query("select to_regclass('public.classrooms') t")).rows[0].t,
      null,
    );
  } finally {
    await bare.db.close();
  }
  const f = await createAcademicDatabase();
  try {
    await migrateStudyAuthoring(f.db, { flashcards: true });
    const legacy = [
      'materials',
      'transcription_versions',
      'summary_versions',
      'question_batches',
      'questions',
      'study_flashcards',
      'study_flashcard_sets',
    ];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          legacy.map(async (t) => [
            t,
            (await f.db.query(`select * from public.${t} order by id`)).rows,
          ]),
        ),
      );
    const before = await snapshot();
    const pre = await f.db.exec(readDatabaseFile('checks/classrooms-preflight.sql'));
    assert.equal(
      pre.find((r) => r.fields.some((x) => x.name === 'classrooms_already_applied')).rows[0]
        .classrooms_already_applied,
      false,
    );
    await f.db.exec(migration);
    assert.deepEqual(await snapshot(), before, 'no existing row changes');
    await assert.rejects(f.db.exec(migration), /CLASSROOMS_ABORT: estruturas de turmas ja existem/);
    await f.db.exec('rollback');
    const post = await f.db.exec(readDatabaseFile('checks/classrooms-postflight.sql'));
    const flags = post.find((r) => r.fields.some((x) => x.name === 'all_rls_enabled')).rows[0];
    assert.deepEqual(flags, {
      has_classrooms: true,
      has_permission_check: true,
      has_state_machine: true,
      all_rls_enabled: true,
      hidden_from_browser: true,
      functions_server_only: true,
    });
  } finally {
    await f.db.close();
  }
});

test('classrooms end to end on a real Postgres engine', async (t) => {
  const f = await createAcademicDatabase();
  const { db, call } = f;
  const c = api(f);
  try {
    await migrateClassrooms(f);
    await f.permit(identities.a, resourceIds.materialA);
    await f.permit(identities.b, resourceIds.materialB);
    const classId = randomUUID();
    let invite;

    await t.test(
      'create: the teacher is the only teacher; retry replays; input is validated',
      async () => {
        const created = await c.create('a', classId);
        assert.equal(created.role, 'teacher');
        assert.equal(created.isOwner, true);
        assert.equal(created.memberCount, 1);
        assert.equal((await c.create('a', classId)).replayed, true);
        assert.equal(
          await outcome(c.create('b', classId)),
          'CLASSROOM_NOT_FOUND',
          'id owned by another account',
        );
        assert.equal(await outcome(c.create('a', randomUUID(), '  ')), 'CLASSROOM_INVALID_INPUT');
        assert.deepEqual(await call('classroom_list_mine_admin', [ids.b]), []);
      },
    );

    await t.test('invites: hashed, limited, expiring and revocable', async () => {
      invite = await c.invite('a', classId, { maxUses: 3 });
      const stored = (
        await db.query('select * from public.classroom_invites where id = $1', [invite.id])
      ).rows[0];
      assert.equal(stored.token_hash, sha(invite.code));
      assert(!JSON.stringify(stored).includes(invite.code), 'the code itself is never stored');
      const listed = await call('classroom_list_invites_admin', [ids.a, classId]);
      assert.equal(listed[0].state, 'active');
      assert(!JSON.stringify(listed).includes(stored.token_hash), 'listing never returns the hash');
      assert.equal(await outcome(c.invite('b', classId)), 'CLASSROOM_NOT_FOUND');
      assert.equal(await outcome(c.invite('a', classId, { days: 31 })), 'CLASSROOM_INVALID_INPUT');
      assert.equal(
        await outcome(c.invite('a', classId, { maxUses: 0 })),
        'CLASSROOM_INVALID_INPUT',
      );
      // Retrying the same request returns the same invitation; a different payload conflicts.
      const requestId = randomUUID();
      const hash = sha(newCode());
      const args = [ids.a, classId, randomUUID(), requestId, hash, 7, 5];
      const first = await call('classroom_create_invite_admin', args);
      assert.equal((await call('classroom_create_invite_admin', args)).replayed, true);
      assert.equal(
        await outcome(
          call('classroom_create_invite_admin', [
            ids.a,
            classId,
            randomUUID(),
            requestId,
            hash,
            7,
            6,
          ]),
        ),
        'CLASSROOM_REQUEST_CONFLICT',
      );
      await call('classroom_revoke_invite_admin', [ids.a, classId, first.id]);
      // Join with an unknown, revoked and expired code: one generic answer.
      assert.equal(await outcome(c.join('b', 'NOPE')), 'CLASSROOM_INVITE_INVALID');
      assert.equal(
        await outcome(call('classroom_join_admin', [ids.b, hash, 'Bruno'])),
        'CLASSROOM_INVITE_INVALID',
        'revoked',
      );
      const expiring = await c.invite('a', classId);
      await db.query(
        "update public.classroom_invites set expires_at = now() - interval '1 minute' where id = $1",
        [expiring.id],
      );
      assert.equal(
        await outcome(c.join('b', expiring.code)),
        'CLASSROOM_INVITE_INVALID',
        'expired',
      );
      const states = (await call('classroom_list_invites_admin', [ids.a, classId]))
        .map((i) => i.state)
        .sort();
      assert.deepEqual(states, ['active', 'expired', 'revoked']);
    });

    await t.test('join: max uses, idempotent re-join, display names', async () => {
      const joined = await c.join('b', invite.code);
      assert.equal(joined.role, 'student');
      assert.equal(joined.alreadyMember, false);
      assert.equal(joined.teacherName, 'Profa. Ana');
      assert.equal((await c.join('b', invite.code)).alreadyMember, true);
      await c.join('d', invite.code);
      await c.join('c', invite.code);
      assert.equal(
        (
          await db.query('select use_count from public.classroom_invites where id = $1', [
            invite.id,
          ])
        ).rows[0].use_count,
        3,
        're-joining while active consumes no use',
      );
      assert.equal(await outcome(c.join('e', invite.code)), 'CLASSROOM_INVITE_FULL');
      // The constraint is a backstop even for direct writes.
      await assert.rejects(
        db.query('update public.classroom_invites set use_count = max_uses + 1 where id = $1', [
          invite.id,
        ]),
        /classroom_invites_use_count_range/,
      );
      const members = await call('classroom_list_members_admin', [ids.b, classId]);
      assert.deepEqual(
        members.map((m) => [m.displayName, m.role]),
        [
          ['Profa. Ana', 'teacher'],
          ['Bruno', 'student'],
          ['Carla', 'student'],
          ['Davi', 'student'],
        ],
      );
    });

    await t.test('concurrent joins never exceed max uses', async () => {
      const other = randomUUID();
      await c.create('a', other, 'Turma concorrida');
      const seat = await c.invite('a', other, { maxUses: 2 });
      const results = await Promise.all(
        ['b', 'c', 'd', 'e'].map((who) => outcome(c.join(who, seat.code))),
      );
      assert.equal(results.filter((r) => r === 'ok').length, 2, results.join());
      assert.equal(results.filter((r) => r === 'CLASSROOM_INVITE_FULL').length, 2);
      assert.equal(
        (await db.query('select use_count from public.classroom_invites where id = $1', [seat.id]))
          .rows[0].use_count,
        2,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.classroom_members where classroom_id = $1 and role = 'student'",
            [other],
          )
        ).rows[0].n,
        2,
      );
      assert.match(
        migration,
        /where token_hash = p_hash for update;/,
        'the invitation row is locked',
      );
    });

    await t.test(
      'roles: only the teacher promotes; the teacher cannot be demoted or removed',
      async () => {
        assert.equal(
          await outcome(
            call('classroom_set_member_role_admin', [ids.b, classId, ids.d, 'assistant']),
          ),
          'CLASSROOM_FORBIDDEN',
        );
        await call('classroom_set_member_role_admin', [ids.a, classId, ids.d, 'assistant']);
        assert.equal((await c.get('d', classId)).canManage, true);
        assert.equal(
          await outcome(
            call('classroom_set_member_role_admin', [ids.d, classId, ids.b, 'assistant']),
          ),
          'CLASSROOM_FORBIDDEN',
          'assistants do not manage roles',
        );
        assert.equal(
          await outcome(
            call('classroom_set_member_role_admin', [ids.a, classId, ids.a, 'student']),
          ),
          'CLASSROOM_FORBIDDEN',
        );
        assert.equal(
          await outcome(call('classroom_remove_member_admin', [ids.a, classId, ids.a])),
          'CLASSROOM_FORBIDDEN',
        );
        assert.equal(
          await outcome(call('classroom_leave_admin', [ids.a, classId])),
          'CLASSROOM_OWNER_CANNOT_LEAVE',
        );
        assert.equal(
          await outcome(
            call('classroom_set_member_role_admin', [ids.a, classId, ids.b, 'teacher']),
          ),
          'CLASSROOM_INVALID_INPUT',
        );
      },
    );

    let lessonId, summaryId;
    await t.test(
      'published lesson: pinned revision, chosen content, members only, no write access',
      async () => {
        const body = {
          materialId: resourceIds.materialA,
          revisionId: revisionIds.a,
          questionBatchIds: [resourceIds.batchA],
        };
        assert.equal(
          await outcome(c.publish('a', classId, body)),
          'TRANSCRIPTION_CONFIRMATION_REQUIRED',
        );
        await f.confirm(identities.a, resourceIds.materialA, revisionIds.a);
        const job = await f.enqueue(
          identities.a,
          resourceIds.materialA,
          'REGERAR_RESUMO',
          {},
          revisionIds.a,
          randomUUID(),
        );
        summaryId = (
          await call('commit_summary_admin', [
            resourceIds.materialA,
            job.id,
            'Resumo: energia se conserva.',
            'fixture',
            'v1',
          ])
        ).id;
        assert.equal(await outcome(c.publish('b', classId, body)), 'CLASSROOM_FORBIDDEN');
        assert.equal(await outcome(c.publish('e', classId, body)), 'CLASSROOM_NOT_FOUND');
        assert.equal(
          await outcome(c.publish('d', classId, body)),
          'MATERIAL_NOT_FOUND',
          'only own materials',
        );
        assert.equal(
          await outcome(
            c.publish('a', classId, { ...body, questionBatchIds: [resourceIds.batchB] }),
          ),
          'CLASSROOM_CONTENT_MISMATCH',
        );
        assert.equal(
          await outcome(c.publish('a', classId, { ...body, revisionId: revisionIds.b })),
          'CLASSROOM_REVISION_NOT_FOUND',
        );
        const lesson = await c.publish('a', classId, {
          ...body,
          summaryId,
          title: 'Aula 1 — Energia',
        });
        lessonId = lesson.id;
        assert.equal(lesson.revision, 1);
        assert.equal(lesson.author.displayName, 'Profa. Ana');
        assert(!('materialId' in lesson), 'members never get the material id');
        assert.equal(await outcome(c.publish('a', classId, body)), 'CLASSROOM_ALREADY_PUBLISHED');

        // The teacher edits the transcript afterwards: members still read the pinned revision.
        const segment = (
          await db.query(
            'select s.id from public.transcription_segments s join public.transcriptions t on t.id = s.transcription_id where t.material_id = $1',
            [resourceIds.materialA],
          )
        ).rows[0];
        await call('apply_transcription_edits_owned_admin', [
          ids.a,
          resourceIds.materialA,
          1,
          JSON.stringify([{ id: segment.id, text: 'Rascunho novo do professor.' }]),
        ]);
        const seen = await c.lesson('b', classId, lessonId);
        assert.equal(seen.transcript.revision, 1);
        assert.match(seen.transcript.fullText, /Energia é conservada/);
        assert(!JSON.stringify(seen).includes('Rascunho novo'));
        assert.equal(seen.summary.text, 'Resumo: energia se conserva.');
        assert.equal(seen.questionLists.length, 1);
        assert.equal(seen.questionLists[0].questions[0].statement, 'Questão sintética?');
        assert.equal(seen.title, 'Aula 1 — Energia');
        assert.equal(await outcome(c.lesson('e', classId, lessonId)), 'CLASSROOM_NOT_FOUND');
        assert.equal((await c.lessons('c', classId)).length, 1);

        // Reading a lesson grants nothing over the teacher's material.
        assert.equal(
          await outcome(
            call('apply_transcription_edits_owned_admin', [
              ids.b,
              resourceIds.materialA,
              2,
              JSON.stringify([{ id: segment.id, text: 'x' }]),
            ]),
          ),
          'MATERIAL_NOT_FOUND',
        );
        assert.equal(
          await outcome(
            call('get_transcription_review_admin', [
              ids.b,
              resourceIds.materialA,
              PERMISSION_DECLARATION.version,
            ]),
          ),
          'MATERIAL_NOT_FOUND',
        );
        assert.equal(
          await outcome(
            call('confirm_transcription_admin', [
              ids.b,
              resourceIds.materialA,
              revisionIds.a,
              PERMISSION_DECLARATION.version,
            ]),
          ),
          'MATERIAL_NOT_FOUND',
        );

        // Unpublish (assistant may) hides it; republishing needs the new revision confirmed and
        // content from that revision.
        assert.equal(
          await outcome(call('classroom_unpublish_lesson_admin', [ids.b, classId, lessonId])),
          'CLASSROOM_FORBIDDEN',
        );
        await call('classroom_unpublish_lesson_admin', [ids.d, classId, lessonId]);
        assert.equal(await outcome(c.lesson('b', classId, lessonId)), 'CLASSROOM_NOT_FOUND');
        assert.deepEqual(await c.lessons('b', classId), []);
        const revision2 = await currentRevisionId(db, resourceIds.materialA);
        assert.equal(
          await outcome(
            c.publish('a', classId, { materialId: resourceIds.materialA, revisionId: revision2 }),
          ),
          'TRANSCRIPTION_CONFIRMATION_REQUIRED',
        );
        await f.confirm(identities.a, resourceIds.materialA, revision2);
        assert.equal(
          await outcome(
            c.publish('a', classId, {
              materialId: resourceIds.materialA,
              revisionId: revision2,
              summaryId,
            }),
          ),
          'CLASSROOM_CONTENT_MISMATCH',
          'a summary of revision 1 cannot be attached to revision 2',
        );
        lessonId = (
          await c.publish('a', classId, {
            materialId: resourceIds.materialA,
            revisionId: revision2,
          })
        ).id;
        assert.equal((await c.lesson('c', classId, lessonId)).transcript.revision, 2);
      },
    );

    await t.test('submission state machine: distinct steps, actors and preconditions', async () => {
      const materialB2 = randomUUID();
      await call('create_material_with_permission_admin', [
        ids.b,
        JSON.stringify({
          id: materialB2,
          title: 'Gravação do Bruno',
          subject: 'Física',
          questionCount: 5,
          originalFilename: 'b.wav',
          mimeType: 'audio/wav',
          extension: 'wav',
          sizeBytes: 1024,
          durationMs: 3000,
          retainAudio: false,
          storagePath: null,
        }),
        PERMISSION_DECLARATION.version,
        PERMISSION_DECLARATION.text,
      ]);
      assert.equal(
        await outcome(c.submit('b', classId, classroomResourceIds.materialC)),
        'MATERIAL_NOT_FOUND',
      );
      assert.equal(
        await outcome(c.submit('a', classId, resourceIds.materialA)),
        'CLASSROOM_FORBIDDEN',
        'teachers publish, not submit',
      );
      assert.equal(await outcome(c.submit('e', classId, materialB2)), 'CLASSROOM_NOT_FOUND');
      const subId = randomUUID();
      const sub = await c.submit('b', classId, materialB2, subId);
      assert.equal(sub.status, 'submitted');
      assert.deepEqual(sub.actions, ['withdrawn']);
      assert.equal((await c.submit('b', classId, materialB2, subId)).replayed, true);
      assert.equal(
        await outcome(c.submit('b', classId, materialB2)),
        'CLASSROOM_ALREADY_SUBMITTED',
      );
      // Other students cannot see or touch it; managers see it with their actions.
      assert.deepEqual(await c.submissions('c', classId), []);
      assert.equal(await outcome(c.move('c', classId, subId, 'withdrawn')), 'CLASSROOM_NOT_FOUND');
      const managed = (await c.submissions('a', classId)).find((s) => s.id === subId);
      assert.deepEqual(managed.actions, ['approved_for_processing', 'rejected']);
      assert.equal(managed.student.displayName, 'Bruno');

      // Illegal and unauthorized transitions.
      assert.equal(
        await outcome(c.move('a', classId, subId, 'published')),
        'CLASSROOM_ILLEGAL_TRANSITION',
      );
      assert.equal(
        await outcome(c.move('a', classId, subId, 'transcription_confirmed')),
        'CLASSROOM_ILLEGAL_TRANSITION',
      );
      assert.equal(
        await outcome(c.move('b', classId, subId, 'processing')),
        'CLASSROOM_ILLEGAL_TRANSITION',
      );
      assert.equal(
        await outcome(c.move('b', classId, subId, 'approved_for_processing')),
        'CLASSROOM_FORBIDDEN',
      );
      assert.equal(
        await outcome(c.move('a', classId, subId, 'bogus')),
        'CLASSROOM_ILLEGAL_TRANSITION',
      );

      // 1. approval for processing (by the assistant), idempotent per request.
      const requestId = randomUUID();
      const approved = await c.move('d', classId, subId, 'approved_for_processing', { requestId });
      assert.equal(approved.status, 'approved_for_processing');
      assert.equal(
        (await c.move('d', classId, subId, 'approved_for_processing', { requestId })).replayed,
        true,
      );
      assert.equal(
        await outcome(c.move('a', classId, subId, 'published')),
        'CLASSROOM_ILLEGAL_TRANSITION',
      );
      assert.equal(
        await outcome(c.move('a', classId, subId, 'processing')),
        'CLASSROOM_FORBIDDEN',
        'the student starts processing',
      );
      // 2. processing needs the existing pipeline to have started.
      assert.equal(
        await outcome(c.move('b', classId, subId, 'processing')),
        'CLASSROOM_PROCESSING_REQUIRED',
      );
      await call('create_initial_transcription_admin', [
        materialB2,
        JSON.stringify({ text: 'Aula do Bruno sobre ondas.' }),
      ]);
      assert.equal((await c.move('b', classId, subId, 'processing')).status, 'processing');
      // 3. the teacher's confirmation: current revision, after the student's own confirmation.
      const revisionB2 = await currentRevisionId(db, materialB2);
      assert.equal(
        await outcome(
          c.move('a', classId, subId, 'transcription_confirmed', { revisionId: revisionIds.a }),
        ),
        'REVISION_CONFLICT',
      );
      assert.equal(
        await outcome(
          c.move('a', classId, subId, 'transcription_confirmed', { revisionId: revisionB2 }),
        ),
        'CLASSROOM_STUDENT_CONFIRMATION_REQUIRED',
      );
      const review = await call('classroom_get_submission_admin', [ids.a, classId, subId]);
      assert.equal(review.review.revisionId, revisionB2);
      assert.equal(review.review.studentConfirmed, false);
      assert.match(review.review.fullText, /Aula do Bruno/);
      assert.equal(
        await outcome(call('classroom_get_submission_admin', [ids.c, classId, subId])),
        'CLASSROOM_NOT_FOUND',
      );
      await f.confirm(identities.b, materialB2, revisionB2);
      const confirmed = await c.move('a', classId, subId, 'transcription_confirmed', {
        revisionId: revisionB2,
      });
      assert.equal(confirmed.status, 'transcription_confirmed');
      assert.equal(confirmed.teacherConfirmedRevision, 1);
      assert.equal(
        (
          await db.query(
            'select count(*)::int n from public.transcription_confirmations where material_id = $1 and user_id = $2',
            [materialB2, ids.a],
          )
        ).rows[0].n,
        0,
        "the teacher's review never writes the student's confirmation table",
      );
      assert.equal((await c.lessons('c', classId)).length, 1, 'confirmed is not yet visible');
      // 4. publication: visible to the class at the confirmed revision.
      const published = await c.move('a', classId, subId, 'published', { note: 'Ótima gravação' });
      assert.equal(published.status, 'published');
      assert(published.lessonId);
      const fromStudent = await c.lesson('c', classId, published.lessonId);
      assert.equal(fromStudent.source, 'submission');
      assert.equal(fromStudent.author.displayName, 'Bruno');
      assert.match(fromStudent.transcript.fullText, /Aula do Bruno/);

      // The graph holds even for direct writes with the server role.
      await assert.rejects(
        db.query("update public.classroom_submissions set status = 'submitted' where id = $1", [
          subId,
        ]),
        /CLASSROOM_ILLEGAL_TRANSITION/,
      );
      await assert.rejects(
        db.query(
          "insert into public.classroom_submissions(id, classroom_id, material_id, student_id, status) values ($1, $2, $3, $4, 'published')",
          [randomUUID(), classId, resourceIds.materialB, ids.b],
        ),
        /CLASSROOM_ILLEGAL_TRANSITION/,
      );
      // Unpublishing through the lesson returns the submission to 'transcription_confirmed'.
      await call('classroom_unpublish_lesson_admin', [ids.a, classId, published.lessonId]);
      const back = (await c.submissions('b', classId)).find((s) => s.id === subId);
      assert.equal(back.status, 'transcription_confirmed');
      const again = await c.move('a', classId, subId, 'published');
      // 5. the student withdraws: the lesson disappears and the submission is final.
      await c.move('b', classId, subId, 'withdrawn');
      assert.equal(await outcome(c.lesson('c', classId, again.lessonId)), 'CLASSROOM_NOT_FOUND');
      assert.equal(
        await outcome(c.move('a', classId, subId, 'approved_for_processing')),
        'CLASSROOM_ILLEGAL_TRANSITION',
      );
      const log = (await call('classroom_get_submission_admin', [ids.b, classId, subId])).events;
      assert.deepEqual(
        log.map((e) => `${e.fromStatus ?? '∅'}→${e.toStatus}:${e.actorRole}`),
        [
          '∅→submitted:student',
          'submitted→approved_for_processing:assistant',
          'approved_for_processing→processing:student',
          'processing→transcription_confirmed:teacher',
          'transcription_confirmed→published:teacher',
          'published→transcription_confirmed:teacher',
          'transcription_confirmed→published:teacher',
          'published→withdrawn:student',
        ],
      );
      // Rejection is final and frees the material for a new submission.
      const rejectedId = randomUUID();
      await c.submit('b', classId, resourceIds.materialB, rejectedId);
      const rejected = await c.move('a', classId, rejectedId, 'rejected', {
        note: 'Áudio cortado',
      });
      assert.equal(rejected.decisionNote, 'Áudio cortado');
      assert.deepEqual(rejected.actions, []);
      assert.equal((await c.submit('b', classId, resourceIds.materialB)).status, 'submitted');
    });

    await t.test('shared flashcard sets: explicit, content only, revocable', async () => {
      const setB = await createSet(f, identities.b, 'Física — Bruno', ['Energia?', 'Trabalho?']);
      const [card] = (
        await db.query(
          'select id from public.study_flashcards where set_id = $1 order by front_text',
          [setB],
        )
      ).rows;
      await call('study_review_flashcard_admin', [ids.b, card.id, 3, randomUUID()]);
      assert.deepEqual(await c.sharedSets('c', classId), [], 'nothing is visible before sharing');
      assert.equal(
        await outcome(c.share('c', classId, setB)),
        'FLASHCARD_NOT_FOUND',
        "cannot share someone else's set",
      );
      assert.equal(await outcome(c.share('e', classId, setB)), 'CLASSROOM_NOT_FOUND');
      const shared = await c.share('b', classId, setB);
      assert.equal(await outcome(c.share('b', classId, setB)), 'CLASSROOM_ALREADY_SHARED');
      const list = await c.sharedSets('c', classId);
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'Física — Bruno');
      assert.equal(list[0].cardCount, 2);
      assert.deepEqual(list[0].author, { userId: ids.b, displayName: 'Bruno' });
      for (const viewer of ['c', 'a', 'd']) {
        const read = await c.sharedSet(viewer, classId, shared.sharedId);
        assert.deepEqual(read.cards.map((x) => x.front).sort(), ['Energia?', 'Trabalho?']);
        assert.deepEqual(Object.keys(read.cards[0]).sort(), [
          'back',
          'difficulty',
          'focus',
          'front',
          'id',
          'style',
        ]);
        assert.doesNotMatch(
          JSON.stringify(read),
          /due_?at|interval|repetitions|ease|last_?reviewed|rating|review|evidence|source/i,
          'no schedule, review history or source references',
        );
      }
      assert.equal(
        await outcome(c.sharedSet('e', classId, shared.sharedId)),
        'CLASSROOM_NOT_FOUND',
      );
      // Archiving the set hides it; restoring shows it again.
      await call('study_update_flashcard_set_admin', [ids.b, setB, null, 'archived']);
      assert.deepEqual(await c.sharedSets('c', classId), []);
      await call('study_update_flashcard_set_admin', [ids.b, setB, null, 'active']);
      assert.equal((await c.sharedSets('c', classId)).length, 1);
      // Only the owner or a manager revokes.
      assert.equal(
        await outcome(c.revokeShare('c', classId, shared.sharedId)),
        'CLASSROOM_FORBIDDEN',
      );
      await c.revokeShare('b', classId, shared.sharedId);
      assert.deepEqual(await c.sharedSets('c', classId), []);
      assert.equal(
        await outcome(c.sharedSet('c', classId, shared.sharedId)),
        'CLASSROOM_NOT_FOUND',
      );
      const reshared = await c.share('b', classId, setB);
      await c.revokeShare('d', classId, reshared.sharedId);
      assert.deepEqual(
        await c.sharedSets('a', classId),
        [],
        'a manager can hide it from the class',
      );
      await c.share('b', classId, setB);
    });

    await t.test(
      'leaving and removal hide the class and withdraw what the member shared',
      async () => {
        const setC = await createSet(f, identities.c, 'Ondas — Carla', ['Onda?']);
        await c.share('c', classId, setC);
        const subC = await c.submit('c', classId, classroomResourceIds.materialC);
        assert.equal((await c.sharedSets('b', classId)).length, 2);
        await call('classroom_leave_admin', [ids.c, classId]);
        for (const read of [
          () => c.get('c', classId),
          () => c.lessons('c', classId),
          () => c.sharedSets('c', classId),
          () => call('classroom_list_members_admin', [ids.c, classId]),
          () => c.lesson('c', classId, lessonId),
        ])
          assert.equal(await outcome(read()), 'CLASSROOM_NOT_FOUND');
        assert.deepEqual(
          (await c.sharedSets('b', classId)).map((s) => s.name),
          ['Física — Bruno'],
        );
        assert.equal(
          (await c.submissions('a', classId)).find((s) => s.id === subC.id).status,
          'withdrawn',
        );
        assert.equal(
          (await call('classroom_list_mine_admin', [ids.c])).some((x) => x.id === classId),
          false,
        );
        // Leaving is not a ban: a valid invitation lets them back in.
        const back = await c.invite('a', classId);
        await c.join('c', back.code);
        assert.equal((await c.get('c', classId)).role, 'student');
        // Removal: immediate, and older invitations no longer work for them.
        assert.equal(
          await outcome(call('classroom_remove_member_admin', [ids.d, classId, ids.c])),
          'CLASSROOM_FORBIDDEN',
        );
        await call('classroom_remove_member_admin', [ids.a, classId, ids.c]);
        assert.equal(await outcome(c.get('c', classId)), 'CLASSROOM_NOT_FOUND');
        assert.equal(await outcome(c.join('c', back.code)), 'CLASSROOM_REMOVED');
        const fresh = await c.invite('a', classId);
        await c.join('c', fresh.code);
        assert.equal((await c.get('c', classId)).role, 'student');
      },
    );

    await t.test('archived class: readable, but no new writes or joins', async () => {
      const open = await c.invite('a', classId);
      await call('classroom_update_admin', [ids.a, classId, null, null, 'archived']);
      assert.equal((await c.get('b', classId)).status, 'archived');
      assert.equal((await c.lessons('b', classId)).length, 1);
      assert.equal(await outcome(c.invite('a', classId)), 'CLASSROOM_ARCHIVED');
      assert.equal(await outcome(c.share('b', classId, randomUUID())), 'CLASSROOM_ARCHIVED');
      assert.equal(await outcome(c.join('e', open.code)), 'CLASSROOM_INVITE_INVALID');
      assert.equal(
        await outcome(call('classroom_update_admin', [ids.b, classId, 'X', null, 'active'])),
        'CLASSROOM_FORBIDDEN',
      );
      await call('classroom_update_admin', [ids.a, classId, 'Física 2º ano B', null, 'active']);
      assert.equal((await c.get('b', classId)).name, 'Física 2º ano B');
    });

    await t.test(
      'permission matrix: teacher, assistant, student, outsider, removed member',
      async () => {
        const room = randomUUID();
        await c.create('a', room, 'Matriz');
        const seat = await c.invite('a', room);
        for (const who of ['b', 'c', 'd']) await c.join(who, seat.code);
        await call('classroom_set_member_role_admin', [ids.a, room, ids.d, 'assistant']);
        await call('classroom_remove_member_admin', [ids.a, room, ids.c]);
        const actors = { teacher: 'a', assistant: 'd', student: 'b', outsider: 'e', removed: 'c' };
        const sets = {};
        for (const who of Object.values(actors))
          sets[who] = await createSet(f, identities[who], `Conjunto ${who}`, ['Frente?']);
        const ownMaterial = {
          a: resourceIds.materialA,
          b: resourceIds.materialB,
          c: classroomResourceIds.materialC,
          d: resourceIds.materialA,
          e: resourceIds.materialA,
        };
        const revision = await currentRevisionId(db, resourceIds.materialA);
        const NF = 'CLASSROOM_NOT_FOUND',
          FB = 'CLASSROOM_FORBIDDEN';
        const matrix = {
          'read class': [(w) => c.get(w, room), ['ok', 'ok', 'ok', NF, NF]],
          'list members': [
            (w) => call('classroom_list_members_admin', [ids[w], room]),
            ['ok', 'ok', 'ok', NF, NF],
          ],
          'list lessons': [(w) => c.lessons(w, room), ['ok', 'ok', 'ok', NF, NF]],
          'list submissions': [(w) => c.submissions(w, room), ['ok', 'ok', 'ok', NF, NF]],
          'list shared sets': [(w) => c.sharedSets(w, room), ['ok', 'ok', 'ok', NF, NF]],
          'list resources': [
            (w) => call('classroom_list_resources_admin', [ids[w], room]),
            ['ok', 'ok', 'ok', NF, NF],
          ],
          'create invite': [(w) => c.invite(w, room), ['ok', 'ok', FB, NF, NF]],
          'list invites': [
            (w) => call('classroom_list_invites_admin', [ids[w], room]),
            ['ok', 'ok', FB, NF, NF],
          ],
          'add resource': [
            (w) =>
              call('classroom_add_resource_admin', [
                ids[w],
                room,
                randomUUID(),
                'Lista extra',
                'https://example.org/lista',
                null,
              ]),
            ['ok', 'ok', FB, NF, NF],
          ],
          'update class': [
            (w) => call('classroom_update_admin', [ids[w], room, 'Matriz', null, null]),
            ['ok', FB, FB, NF, NF],
          ],
          'set role': [
            (w) => call('classroom_set_member_role_admin', [ids[w], room, ids.b, 'student']),
            ['ok', FB, FB, NF, NF],
          ],
          'remove member': [
            (w) => call('classroom_remove_member_admin', [ids[w], room, ids.a]),
            [FB, FB, FB, NF, NF],
          ],
          'publish lesson': [
            (w) => c.publish(w, room, { materialId: ownMaterial[w], revisionId: revision }),
            ['ok', 'MATERIAL_NOT_FOUND', FB, NF, NF],
          ],
          'submit recording': [(w) => c.submit(w, room, ownMaterial[w]), [FB, FB, 'ok', NF, NF]],
          'share own set': [(w) => c.share(w, room, sets[w]), ['ok', 'ok', 'ok', NF, NF]],
          leave: [
            (w) => call('classroom_leave_admin', [ids[w], room]),
            ['CLASSROOM_OWNER_CANNOT_LEAVE', 'skip', 'skip', NF, NF],
          ],
        };
        const roles = Object.keys(actors);
        for (const [name, [run, expected]] of Object.entries(matrix))
          for (const [index, role] of roles.entries()) {
            if (expected[index] === 'skip') continue;
            assert.equal(await outcome(run(actors[role])), expected[index], `${name} as ${role}`);
          }
        // Reading published content and a shared set as each actor.
        const [lesson] = await c.lessons('a', room);
        const [shared] = await c.sharedSets('a', room);
        for (const [index, role] of roles.entries()) {
          const expected = ['ok', 'ok', 'ok', NF, NF][index];
          assert.equal(
            await outcome(c.lesson(actors[role], room, lesson.id)),
            expected,
            `read lesson as ${role}`,
          );
          assert.equal(
            await outcome(c.sharedSet(actors[role], room, shared.sharedId)),
            expected,
            `read set as ${role}`,
          );
        }
        // Student sees only their own submissions; managers see all.
        assert.equal((await c.submissions('d', room)).length, 1);
        assert.equal(
          (await c.submissions('b', room)).every((s) => s.isMine),
          true,
        );
      },
    );

    await t.test('teachers cannot read students’ private learning records', async () => {
      await db.exec(
        readFileSync(
          new URL('../../database/migrations/20261105011000_study_tracking.sql', import.meta.url),
          'utf8',
        ),
      );
      await db.exec(
        readFileSync(
          new URL('../../database/migrations/20261105014000_annotations.sql', import.meta.url),
          'utf8',
        ),
      );
      const secret = 'SEGREDO-PESSOAL-DO-BRUNO';
      await db.query(
        `insert into public.study_annotations(id, user_id, material_id, source_revision_id, source_revision, quote, note_text, last_request_id, last_body)
         values ($1, $2, $3, $4, 1, 'Energia', $5, $6, '{}')`,
        [randomUUID(), ids.b, resourceIds.materialB, revisionIds.b, secret, randomUUID()],
      );
      await db.query(
        'insert into public.study_progress(material_id, user_id, position_seconds, completed) values ($1, $2, 42, true)',
        [resourceIds.materialB, ids.b],
      );
      const reviews = (
        await db.query('select * from public.study_flashcard_reviews where user_id = $1', [ids.b])
      ).rows;
      assert(reviews.length > 0);
      const reads = [];
      for (const fn of ['classroom_list_mine_admin']) reads.push(await call(fn, [ids.a]));
      for (const fn of [
        'classroom_get_admin',
        'classroom_list_members_admin',
        'classroom_list_lessons_admin',
        'classroom_list_submissions_admin',
        'classroom_list_shared_flashcard_sets_admin',
        'classroom_list_resources_admin',
        'classroom_list_invites_admin',
      ])
        reads.push(await call(fn, [ids.a, classId]));
      for (const s of await c.submissions('a', classId))
        reads.push(await call('classroom_get_submission_admin', [ids.a, classId, s.id]));
      for (const s of await c.sharedSets('a', classId))
        reads.push(await c.sharedSet('a', classId, s.sharedId));
      for (const l of await c.lessons('a', classId)) reads.push(await c.lesson('a', classId, l.id));
      const everything = JSON.stringify(reads);
      assert(!everything.includes(secret), 'no annotation text');
      assert.doesNotMatch(
        everything,
        /position_?seconds|completed|ease_?factor|due_?at|last_?reviewed|"rating"/i,
      );
      for (const r of reviews) assert(!everything.includes(r.id), 'no review ids');
      // The existing private reads stay owner-only.
      assert.deepEqual(
        (await call('study_list_annotations_admin', [ids.a, resourceIds.materialB, null, 0]))
          .notes ?? [],
        [],
      );
      assert.equal(
        await outcome(
          call('get_transcription_review_admin', [
            ids.a,
            resourceIds.materialB,
            PERMISSION_DECLARATION.version,
          ]),
        ),
        'MATERIAL_NOT_FOUND',
      );
    });

    await t.test(
      'browser roles cannot read tables or call functions (RLS and grants)',
      async () => {
        for (const table of TABLES) {
          const rights = (
            await db.query(
              `select c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'select') anon_read,
               has_table_privilege('authenticated', c.oid, 'select') browser_read,
               has_table_privilege('authenticated', c.oid, 'insert') browser_write,
               has_table_privilege('service_role', c.oid, 'select') server_read
             from pg_class c where c.oid = $1::regclass`,
              ['public.' + table],
            )
          ).rows[0];
          assert.deepEqual(
            rights,
            {
              rls: true,
              anon_read: false,
              browser_read: false,
              browser_write: false,
              server_read: true,
            },
            table,
          );
        }
        const functions = (
          await db.query(
            `select p.oid::regprocedure::text sig, has_function_privilege('authenticated', p.oid, 'execute') browser,
             has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') server
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'classroom\\_%'`,
          )
        ).rows;
        assert(functions.length >= 30, `${functions.length} functions`);
        for (const fn of functions)
          assert.deepEqual([fn.browser, fn.anon, fn.server], [false, false, true], fn.sig);
        for (const role of ['authenticated', 'anon'])
          await assert.rejects(
            db.transaction(async (tx) => {
              await tx.exec(`set local role ${role}`);
              await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ids.a]);
              await tx.query('select * from public.classrooms');
            }),
            /permission denied/,
            role,
          );
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.exec('set local role authenticated');
            await tx.query('select public.classroom_list_mine_admin($1)', [ids.a]);
          }),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
