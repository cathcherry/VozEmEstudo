import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import {
  addLesson,
  addSubject,
  editLesson,
  identities,
  migrateMultiLesson,
  migrateMultiLessonExports,
  readExportsMigration,
} from './fixtures/multi-lesson-db.fixture.js';

// 3.4: an integrated material becomes an ordinary question list (answered with the usual quiz
// flow) and a personal flashcard set. Real SQL on PGlite; the "ready" record is completed through
// the real queue functions with a result shaped like the generator's (citations included).
const migration = readExportsMigration();
const a = identities.a;
const b = identities.b;
const check = (name) =>
  readFileSync(new URL(`../../database/checks/multi-lesson-exports-${name}.sql`, import.meta.url), 'utf8');

const SEG = (topic) => [
  `A ${topic} começa quando observamos o fenômeno com bastante atenção.`,
  `Na ${topic} as variáveis principais mudam de forma previsível ao longo do tempo.`,
];

const cite = (lesson, position = 0) => ({
  materialId: lesson.id,
  revisionId: lesson.revisionId,
  revision: 1,
  lessonTitle: lesson.title,
  position,
  quote: 'trecho citado da aula',
  startMs: 0,
});

/** A ready integrated material of `lessons`, through attach → claim → complete. */
async function readyRecord(f, user, lessons, { outputs = ['summary', 'questions', 'flashcards'], result } = {}) {
  const ids = lessons.map((lesson) => lesson.id);
  const sources = lessons.map((lesson) => lesson.revisionId);
  const begun = await f.call('begin_generation_admin', [user.id, randomUUID().replace(/-/g, '').padEnd(64, '0'), 'user', user.id, 'multi_lesson', sources, 'multi-lesson-v1', 'groq:test', null, false, 50]);
  const record = await f.call('multi_lesson_attach_admin', [user.id, randomUUID(), randomUUID(), 'Ondas integradas', 'lessons', ids, outputs, JSON.stringify({ ai: { provider: 'groq', model: 'test' } }), begun.generation.id, begun.decision, 2]);
  const job = await f.call('multi_lesson_claim_job_admin', ['w1', 600]);
  const [first, second = first] = lessons;
  const body = result || {
    summary: { sections: [{ heading: 'Ondas', text: 'Texto', citations: [cite(first)] }] },
    questions: [
      { statement: 'O que é uma onda?', options: ['Perturbação', 'Massa', 'Carga', 'Tempo'], correctIndex: 0, explanation: 'Veja a aula.', citations: [cite(first), cite(second, 1)] },
      { statement: 'O que muda na frequência?', options: ['Nada', 'Variáveis', 'Cor', 'Peso'], correctIndex: 1, explanation: '', citations: [cite(second, 1)] },
    ],
    flashcards: [
      { front: 'Onda', back: 'Perturbação que se propaga.', citations: [cite(first)] },
      { front: 'Frequência', back: 'Oscilações por segundo.', citations: [cite(second, 1)] },
      { front: 'onda', back: 'Repetida (mesma pergunta).', citations: [cite(first)] },
    ],
  };
  await f.call('multi_lesson_complete_job_admin', [job.id, 'w1', JSON.stringify(body), 'test-model']);
  return record;
}

async function library({ exports = true } = {}) {
  const f = await createAcademicDatabase();
  await migrateMultiLessonExports(f, { exports });
  const physics = await addSubject(f, a, 'Ondulatória', ['Ondas']);
  const l1 = await addLesson(f, a, { title: 'Ondas 1', segments: SEG('onda'), subjectId: physics.subjectId, unitId: physics.unitIds[0] });
  const l2 = await addLesson(f, a, { title: 'Ondas 2', segments: SEG('frequência'), subjectId: physics.subjectId, unitId: physics.unitIds[0] });
  return { ...f, l1, l2 };
}

test('migration is guarded, additive, transactional and server-only', async () => {
  assert.match(migration, /MULTI_LESSON_EXPORTS_ABORT/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(migration, /\b(drop |truncate|create or replace|delete from|alter table public\.(question_batches|questions|processing_jobs|study_flashcards|study_flashcard_sets|multi_lesson_materials))\b/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /grant [^;]* to (anon|authenticated)/i);
  assert.match(migration, /alter table public\.multi_lesson_exports enable row level security/);
  assert.match(migration, /revoke all on table public\.multi_lesson_exports from public, anon, authenticated/);
  for (const fn of migration.matchAll(/create function public\.(\w+)\([^)]*\)\s*returns [^$]+?\$\$/g))
    assert.match(fn[0], /security invoker set search_path = ''/, fn[1]);

  // Refused without its prerequisites, refused twice; nothing left by a refused run.
  const f = await createAcademicDatabase();
  try {
    await migrateMultiLesson(f);
    await assert.rejects(f.db.exec(migration), /MULTI_LESSON_EXPORTS_ABORT: aplicar/);
    await f.db.exec('rollback');
    assert.equal((await f.db.query("select to_regclass('public.multi_lesson_exports') as t")).rows[0].t, null);
  } finally {
    await f.db.close();
  }
  const g = await library();
  try {
    await assert.rejects(g.db.exec(migration), /MULTI_LESSON_EXPORTS_ABORT: multi_lesson_exports ja existe/);
    await g.db.exec('rollback');
  } finally {
    await g.db.close();
  }
});

test('read-only preflight and postflight report what the guide promises', async () => {
  const f = await library({ exports: false });
  try {
    const pre = (await f.db.query(check('preflight'))).rows[0];
    assert.equal(pre.prerequisites, true);
    assert.equal(pre.already_applied, false);
    await f.db.exec(migration);
    const post = (await f.db.query(check('postflight'))).rows[0];
    assert.equal(Number(post.batches_after), Number(pre.batches_before));
    assert.equal(Number(post.sets_after), Number(pre.sets_before));
    assert.equal(Number(post.jobs_after), Number(pre.jobs_before));
    assert.equal(Number(post.exports), 0);
    for (const key of ['rls_enabled', 'no_browser_access', 'functions_server_only']) assert.equal(post[key], true, key);
    assert.equal((await f.db.query(check('preflight'))).rows[0].already_applied, true);
    for (const name of ['preflight', 'postflight']) assert.doesNotMatch(check(name), /\b(insert|update|delete|create|drop|alter)\b/i);
  } finally {
    await f.db.close();
  }
});

test('questions become an answerable list of the first source lesson, idempotent, with provenance', async () => {
  const f = await library();
  try {
    const record = await readyRecord(f, a, [f.l1, f.l2]);
    const requestId = randomUUID();
    const made = await f.call('multi_lesson_export_questions_admin', [a.id, record.id, requestId, null]);
    assert.equal(made.kind, 'questions');
    assert.equal(made.materialId, f.l1.id, 'anchored on the first source lesson');
    assert.equal(made.itemCount, 2);
    assert.equal(made.replayed, false);

    const batch = (await f.db.query('select * from public.question_batches where id=$1', [made.batchId])).rows[0];
    assert.equal(batch.material_id, f.l1.id);
    assert.equal(batch.title, 'Questões integradas: Ondas integradas');
    assert.equal(batch.generated_count, 2);
    assert.equal(batch.source_transcription_version_id, f.l1.revisionId);
    assert.equal(batch.config.origin.kind, 'multi_lesson');
    assert.equal(batch.config.origin.multiLessonId, record.id);
    assert.deepEqual(batch.config.origin.sources.map((s) => s.title), ['Ondas 1', 'Ondas 2']);
    const questions = (await f.db.query('select * from public.questions where batch_id=$1 order by position', [made.batchId])).rows;
    assert.deepEqual(questions.map((q) => q.correct_index), [0, 1]);
    assert.equal(questions[0].explanation, 'Veja a aula.\n\nFontes: Ondas 1, trecho 1; Ondas 2, trecho 2');
    assert.equal(questions[1].explanation, 'Fontes: Ondas 2, trecho 2', 'an empty explanation still names the source');
    assert.equal(questions[0].metadata.origin, 'multi_lesson');
    assert.deepEqual(questions[0].metadata.citations.map((c) => c.materialId), [f.l1.id, f.l2.id]);
    // The job that the list's frozen-source rule requires is already complete: no worker runs it.
    const job = (await f.db.query('select status, type, params from public.processing_jobs where id=$1', [made.processingJobId ?? batch.processing_job_id])).rows[0];
    assert.equal(job.status, 'CONCLUIDA');
    assert.equal(job.type, 'GERAR_QUESTOES');
    assert.equal(job.params.multiLessonId, record.id);
    assert.equal(Number((await f.db.query("select count(*) as n from public.processing_jobs where params->>'origin' = 'multi_lesson' and status <> 'CONCLUIDA'")).rows[0].n), 0);

    // Replay of the same request; second click with another request id: same list, no duplicate.
    const replay = await f.call('multi_lesson_export_questions_admin', [a.id, record.id, requestId, null]);
    assert.equal(replay.batchId, made.batchId);
    assert.equal(replay.replayed, true);
    const second = await f.call('multi_lesson_export_questions_admin', [a.id, record.id, randomUUID(), 'Outro nome']);
    assert.equal(second.batchId, made.batchId);
    assert.equal(second.replayed, true);
    const count = async (sql) => Number((await f.db.query(sql)).rows[0].n);
    assert.equal(await count("select count(*) as n from public.question_batches where config->'origin'->>'kind' = 'multi_lesson'"), 1);
    assert.equal(await count("select count(*) as n from public.processing_jobs where params->>'origin' = 'multi_lesson'"), 1);
    // A request id already used for another record or kind is a conflict.
    await assert.rejects(f.call('multi_lesson_export_flashcards_admin', [a.id, record.id, requestId, null]), /MULTI_LESSON_REQUEST_CONFLICT/);

    // Answered with the usual quiz flow (quiz_sessions + quiz_submit_answer_admin).
    const session = (
      await f.db.query("insert into public.quiz_sessions(user_id, material_id, batch_id, feedback_mode) values($1,$2,$3,'immediate') returning id", [a.id, f.l1.id, made.batchId])
    ).rows[0].id;
    const answer = await f.call('quiz_submit_answer_admin', [a.id, session, questions[0].id, 0]);
    assert.equal(answer.is_correct ?? answer.correct ?? answer.isCorrect, true);

    // Listing shows what exists.
    const listed = await f.call('multi_lesson_exports_admin', [a.id, record.id]);
    assert.deepEqual(listed.map((e) => [e.kind, e.available]), [['questions', true]]);
  } finally {
    await f.db.close();
  }
});

test('questions: only the owner, only ready records, anchor falls back, deleted list can be made again', async () => {
  const f = await library();
  try {
    const record = await readyRecord(f, a, [f.l1, f.l2]);
    await assert.rejects(f.call('multi_lesson_export_questions_admin', [b.id, record.id, randomUUID(), null]), /MULTI_LESSON_NOT_FOUND/);
    await assert.rejects(f.call('multi_lesson_exports_admin', [b.id, record.id]), /MULTI_LESSON_NOT_FOUND/);
    await assert.rejects(f.call('multi_lesson_export_questions_admin', [a.id, record.id, randomUUID(), 'x'.repeat(161)]), /MULTI_LESSON_INVALID_INPUT/);

    // A queued record cannot be exported.
    const begun = await f.call('begin_generation_admin', [a.id, 'e'.repeat(64), 'user', a.id, 'multi_lesson', [f.l2.revisionId], 'multi-lesson-v1', 'groq:test', null, false, 50]);
    const queued = await f.call('multi_lesson_attach_admin', [a.id, randomUUID(), randomUUID(), 'Fila', 'lessons', [f.l2.id], ['questions'], '{}', begun.generation.id, begun.decision, 2]);
    await assert.rejects(f.call('multi_lesson_export_questions_admin', [a.id, queued.id, randomUUID(), null]), /MULTI_LESSON_NOT_READY/);
    await assert.rejects(f.call('multi_lesson_export_flashcards_admin', [a.id, queued.id, randomUUID(), null]), /MULTI_LESSON_NOT_READY/);

    // The first lesson is gone: the list is anchored on the next source. Its deletion removes the
    // list (like any list of that lesson); asking again makes a new one, still only one per record.
    await f.db.query('delete from public.materials where id=$1', [f.l1.id]);
    const made = await f.call('multi_lesson_export_questions_admin', [a.id, record.id, randomUUID(), null]);
    assert.equal(made.materialId, f.l2.id);
    await f.db.query('delete from public.materials where id=$1', [f.l2.id]);
    const gone = await f.call('multi_lesson_exports_admin', [a.id, record.id]);
    assert.deepEqual(gone.map((e) => [e.kind, e.available, e.batchId]), [['questions', false, null]]);
    await assert.rejects(f.call('multi_lesson_export_questions_admin', [a.id, record.id, randomUUID(), null]), /MULTI_LESSON_ANCHOR_UNAVAILABLE/);
  } finally {
    await f.db.close();
  }
});

test('anchor uses the frozen revision even after the lesson was edited; a record without questions has nothing to export', async () => {
  const f = await library();
  try {
    const record = await readyRecord(f, a, [f.l1, f.l2]);
    await editLesson(f, a, f.l1.id, 'A onda começa quando observamos o fenômeno com muita atenção.');
    const made = await f.call('multi_lesson_export_questions_admin', [a.id, record.id, randomUUID(), null]);
    const batch = (await f.db.query('select source_transcription_version_id from public.question_batches where id=$1', [made.batchId])).rows[0];
    assert.equal(batch.source_transcription_version_id, f.l1.revisionId, 'the revision the questions came from');

    const summaryOnly = await readyRecord(f, a, [f.l2], {
      outputs: ['summary'],
      result: { summary: { sections: [{ heading: 'x', text: 'y', citations: [cite(f.l2)] }] } },
    });
    await assert.rejects(f.call('multi_lesson_export_questions_admin', [a.id, summaryOnly.id, randomUUID(), null]), /MULTI_LESSON_NOTHING_TO_EXPORT/);
    await assert.rejects(f.call('multi_lesson_export_flashcards_admin', [a.id, summaryOnly.id, randomUUID(), null]), /MULTI_LESSON_NOTHING_TO_EXPORT/);
  } finally {
    await f.db.close();
  }
});

test('flashcards become one personal set with sources per card; a second click does not duplicate', async () => {
  const f = await library();
  try {
    const record = await readyRecord(f, a, [f.l1, f.l2]);
    const requestId = randomUUID();
    const made = await f.call('multi_lesson_export_flashcards_admin', [a.id, record.id, requestId, null]);
    assert.equal(made.kind, 'flashcards');
    assert.equal(made.itemCount, 2);
    assert.equal(made.skipped, 1, 'the repeated question is skipped and reported');
    const set = (await f.db.query('select * from public.study_flashcard_sets where id=$1', [made.setId])).rows[0];
    assert.equal(set.user_id, a.id);
    assert.equal(set.material_id, null, 'a personal set, not tied to one lesson');
    assert.equal(set.name, 'Ondas integradas');
    assert.equal(set.config.origin.kind, 'multi_lesson');
    assert.equal(set.config.origin.multiLessonId, record.id);
    const cards = (await f.db.query('select * from public.study_flashcards where set_id=$1 order by front_text', [made.setId])).rows;
    assert.deepEqual(cards.map((c) => c.front_text), ['Frequência', 'Onda']);
    const onda = cards.find((c) => c.front_text === 'Onda');
    assert.equal(onda.origin_label, 'Ondas 1');
    assert.equal(onda.evidence, 'trecho citado da aula');
    assert.equal(onda.source_segments[0].materialId, f.l1.id);
    assert.equal(onda.note_type, 'basic');
    assert.equal(onda.status, 'active');

    const again = await f.call('multi_lesson_export_flashcards_admin', [a.id, record.id, randomUUID(), 'Outro']);
    assert.equal(again.setId, made.setId);
    assert.equal(again.replayed, true);
    const replay = await f.call('multi_lesson_export_flashcards_admin', [a.id, record.id, requestId, null]);
    assert.equal(replay.setId, made.setId);
    assert.equal(Number((await f.db.query('select count(*) as n from public.study_flashcard_sets')).rows[0].n), 1);
    await assert.rejects(f.call('multi_lesson_export_flashcards_admin', [b.id, record.id, randomUUID(), null]), /MULTI_LESSON_NOT_FOUND/);

    // The student deletes the set: it can be made again (a new set), still one per record.
    await f.call('study_delete_flashcard_set_admin', [a.id, made.setId]);
    const listed = await f.call('multi_lesson_exports_admin', [a.id, record.id]);
    assert.deepEqual(listed.map((e) => [e.kind, e.available]), [['flashcards', false]]);
    const remade = await f.call('multi_lesson_export_flashcards_admin', [a.id, record.id, randomUUID(), null]);
    assert.notEqual(remade.setId, made.setId);
    assert.equal(remade.replayed, false);
    assert.equal(Number((await f.db.query('select count(*) as n from public.multi_lesson_exports')).rows[0].n), 1);

    // Deleting the integrated material keeps the set (an independent copy) and drops the link.
    await f.call('multi_lesson_delete_admin', [a.id, record.id]);
    assert.equal(Number((await f.db.query('select count(*) as n from public.study_flashcard_sets where id=$1', [remade.setId])).rows[0].n), 1);
    assert.equal(Number((await f.db.query('select count(*) as n from public.multi_lesson_exports')).rows[0].n), 0);
  } finally {
    await f.db.close();
  }
});

test('the browser roles cannot read the table nor call the functions', async () => {
  const f = await library();
  try {
    for (const role of ['anon', 'authenticated']) {
      const can = (
        await f.db.query(
          `select has_table_privilege($1, 'public.multi_lesson_exports', 'select') as t,
            has_function_privilege($1, 'public.multi_lesson_export_questions_admin(uuid,uuid,uuid,text)', 'execute') as q,
            has_function_privilege($1, 'public.multi_lesson_export_flashcards_admin(uuid,uuid,uuid,text)', 'execute') as c,
            has_function_privilege($1, 'public.multi_lesson_exports_admin(uuid,uuid)', 'execute') as l`,
          [role],
        )
      ).rows[0];
      assert.deepEqual(can, { t: false, q: false, c: false, l: false }, role);
    }
  } finally {
    await f.db.close();
  }
});
