import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createAcademicDatabase } from './academic-db.fixture.js';
import { migrateMultiLesson } from './multi-lesson-db.fixture.js';
import { identities } from './ownership.fixture.js';

export const CONTRIBUTIONS_MIGRATION = '20261122090000_classroom_contributions.sql';
export const readContributionsMigration = () =>
  readFileSync(
    new URL('../../../database/migrations/' + CONTRIBUTIONS_MIGRATION, import.meta.url),
    'utf8',
  );

/** Applies the contributions migration on top of migrateClassrooms (multi-lesson included). */
export async function migrateContributions(f, { apply = true } = {}) {
  await migrateMultiLesson(f, { cache: false });
  if (apply) await f.db.exec(readContributionsMigration());
}

/** Full chain: classrooms, generation reuse, multi-lesson and the contributions migration. */
export async function createContributionsDatabase(options) {
  const f = await createAcademicDatabase();
  await migrateContributions(f, options);
  return f;
}

/**
 * An integrated material of an account, inserted as the worker leaves it: a result with the
 * owner-only report, model and lesson ids that members must never read.
 */
export async function addIntegratedMaterial(
  db,
  identity,
  { title = 'Revisão integrada', status = 'ready' } = {},
) {
  const id = randomUUID();
  const sourceId = randomUUID();
  const revisionId = randomUUID();
  const citation = {
    materialId: sourceId,
    revisionId,
    revision: 3,
    lessonTitle: 'Ondas 1',
    position: 0,
    quote: 'A onda transporta energia.',
    startMs: 1200,
  };
  const result = {
    summary: {
      sections: [{ heading: 'Energia', text: 'Ondas levam energia.', citations: [citation] }],
    },
    questions: [
      {
        statement: 'O que a onda transporta?',
        options: ['Energia', 'Matéria', 'Carga', 'Massa'],
        correctIndex: 0,
        explanation: 'Energia, sem matéria.',
        citations: [citation],
      },
    ],
    flashcards: [{ front: 'Onda', back: 'Transporta energia.', citations: [citation] }],
    lessons: [
      { label: 'A1', materialId: sourceId, revisionId, revision: 3, title: 'Ondas 1', concepts: 2 },
    ],
    report: { droppedSections: 0, modelCalls: 2, secretNote: 'PRIVATE-REPORT' },
    promptVersions: { map: 'map-v1', synthesis: 'synth-v1' },
  };
  await db.query(
    `insert into public.multi_lesson_materials(id, user_id, request_id, title, selection_kind, selection_ids,
       outputs, settings, sources, source_revision_ids, status, result, model, completed_at)
     values ($1, $2, $3, $4, 'lessons', $5, array['summary','questions','flashcards'], $6, $7, $8, $9, $10,
       'private-model', now())`,
    [
      id,
      identity.id,
      randomUUID(),
      title,
      [sourceId],
      JSON.stringify({ focus: 'PRIVATE-FOCUS' }),
      JSON.stringify([{ materialId: sourceId, revisionId, revision: 3, title: 'Ondas 1' }]),
      [revisionId],
      status,
      status === 'ready' ? JSON.stringify(result) : null,
    ],
  );
  return { id, sourceId, revisionId };
}

export const sha = (value) => createHash('sha256').update(value).digest('hex');
let counter = 0;
export const NAMES = { a: 'Profa. Ana', b: 'Bruno', c: 'Carla', d: 'Davi', e: 'Eva' };

/** A class of teacher a with students b and c and assistant d (e stays outside). */
export async function createClassWithMembers(f) {
  const ids = Object.fromEntries(Object.entries(identities).map(([k, v]) => [k, v.id]));
  const classId = randomUUID();
  await f.call('classroom_create_admin', [ids.a, classId, 'Física', null, NAMES.a]);
  const code = `CONTRIB${String(++counter).padStart(5, '2')}`;
  await f.call('classroom_create_invite_admin', [
    ids.a,
    classId,
    randomUUID(),
    randomUUID(),
    sha(code),
    7,
    30,
  ]);
  for (const who of ['b', 'c', 'd'])
    await f.call('classroom_join_admin', [ids[who], sha(code), NAMES[who]]);
  await f.call('classroom_set_member_role_admin', [ids.a, classId, ids.d, 'assistant']);
  return { classId, inviteCode: code };
}

export { identities };
