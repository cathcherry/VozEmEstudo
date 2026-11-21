import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createAcademicDatabase } from './academic-db.fixture.js';
import { migrateClassrooms, currentRevisionId } from './classroom-db.fixture.js';
import { identities } from './ownership.fixture.js';
import { PERMISSION_DECLARATION } from '../../src/config/permission-declaration.js';

const read = (file) =>
  readFileSync(new URL('../../../database/migrations/' + file, import.meta.url), 'utf8');
export const MULTI_LESSON_MIGRATION = '20261121170000_multi_lesson.sql';
export const KNOWLEDGE_MAP_MIGRATION = '20261121171000_knowledge_map_cache.sql';
export const readMultiLessonMigration = () => read(MULTI_LESSON_MIGRATION);
export const readKnowledgeMapMigration = () => read(KNOWLEDGE_MAP_MIGRATION);
export const EXPORTS_MIGRATION = '20261121180000_multi_lesson_exports.sql';
export const readExportsMigration = () => read(EXPORTS_MIGRATION);

/**
 * Milestone C chain plus what the exports need: Flashcards 3.0 (deck function), quiz sessions
 * (to answer the list through the usual flow) and the exports migration itself.
 */
export async function migrateMultiLessonExports(f, { exports = true } = {}) {
  await migrateMultiLesson(f);
  await f.db.exec(read('20261121150000_flashcards_3_0.sql'));
  await f.db.exec(read('20261104223000_quiz_sessions.sql'));
  if (exports) await f.db.exec(readExportsMigration());
}

/** Applies the full prerequisite chain, generation reuse and Milestone C (cache optional). */
export async function migrateMultiLesson(f, { cache = true } = {}) {
  await migrateClassrooms(f);
  await f.db.exec(read('20261121160000_generation_reuse.sql'));
  await f.db.exec(readMultiLessonMigration());
  if (cache) await f.db.exec(readKnowledgeMapMigration());
}

export async function createMultiLessonDatabase(options) {
  const f = await createAcademicDatabase();
  await migrateMultiLesson(f, options);
  return f;
}

/** A subject (and optionally units) of an account, inserted like the catalog API would. */
export async function addSubject(f, identity, name, units = []) {
  const subjectId = randomUUID();
  await f.db.query(
    'insert into public.study_subjects(id,user_id,name,normalized_name) values($1,$2,$3,$3)',
    [subjectId, identity.id, name],
  );
  const unitIds = [];
  for (const [index, title] of units.entries()) {
    const id = randomUUID();
    await f.db.query(
      'insert into public.study_units(id,user_id,subject_id,title,normalized_title,sort_order) values($1,$2,$3,$4,$4,$5)',
      [id, identity.id, subjectId, title, index],
    );
    unitIds.push(id);
  }
  return { subjectId, unitIds };
}

/**
 * A lesson created through the real functions (permission, initial transcript, confirmation).
 * `segments` are texts; `confirm: false` leaves it awaiting review; `transcribe: false` leaves it
 * without a transcript.
 */
export async function addLesson(
  f,
  identity,
  { title, segments = [], subjectId = null, unitId = null, confirm = true, transcribe = true },
) {
  const id = randomUUID();
  await f.call('create_material_with_permission_admin', [
    identity.id,
    JSON.stringify({
      id,
      title,
      subject: null,
      questionCount: 5,
      originalFilename: 'aula.wav',
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
  if (subjectId)
    await f.db.query('update public.materials set subject_id=$2, unit_id=$3 where id=$1', [
      id,
      subjectId,
      unitId,
    ]);
  let revisionId = null;
  if (transcribe) {
    await f.call('create_initial_transcription_admin', [
      id,
      JSON.stringify({
        text: segments.join(' '),
        segments: segments.map((text, i) => ({ text, startMs: i * 5000, endMs: i * 5000 + 4000 })),
      }),
    ]);
    revisionId = await currentRevisionId(f.db, id);
    if (confirm) await f.confirm(identity, id, revisionId);
  }
  return { id, revisionId, title };
}

/** Edits the first segment (a new revision) through the real owner function. */
export async function editLesson(f, identity, materialId, text) {
  const segment = (
    await f.db.query(
      'select s.id from public.transcription_segments s join public.transcriptions t on t.id=s.transcription_id where t.material_id=$1 order by position limit 1',
      [materialId],
    )
  ).rows[0];
  const revision = (
    await f.db.query('select current_revision from public.transcriptions where material_id=$1', [
      materialId,
    ])
  ).rows[0].current_revision;
  await f.call('apply_transcription_edits_owned_admin', [
    identity.id,
    materialId,
    revision,
    JSON.stringify([{ id: segment.id, text }]),
  ]);
  return currentRevisionId(f.db, materialId);
}

export { identities };
