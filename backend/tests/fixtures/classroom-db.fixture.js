import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { identities, resourceIds } from './ownership.fixture.js';
import { migrateStudyAuthoring } from './authoring-db.fixture.js';
import { PERMISSION_DECLARATION } from '../../src/config/permission-declaration.js';

export const CLASSROOMS_MIGRATION = '20261121140000_classrooms.sql';
export const readClassroomsMigration = () =>
  readFileSync(
    new URL('../../../database/migrations/' + CLASSROOMS_MIGRATION, import.meta.url),
    'utf8',
  );

/** Synthetic material of the second student (c). */
export const classroomResourceIds = {
  materialC: 'cccccccc-0000-4ccc-8ccc-cccccccccccc',
};

/**
 * Adds the extra accounts (c = second student with a transcribed material, d = assistant,
 * e = outsider) to a database created by createAcademicDatabase. Accounts a (teacher) and
 * b (student) already exist with their materials.
 */
export async function addClassroomAccounts(f) {
  for (const key of ['c', 'd', 'e'])
    await f.db.query('insert into auth.users(id) values($1) on conflict do nothing', [
      identities[key].id,
    ]);
  await f.call('create_material_with_permission_admin', [
    identities.c.id,
    JSON.stringify({
      id: classroomResourceIds.materialC,
      title: 'Aula sintética c',
      subject: 'Física',
      questionCount: 5,
      originalFilename: 'c.wav',
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
  await f.call('create_initial_transcription_admin', [
    classroomResourceIds.materialC,
    JSON.stringify({
      text: 'Ondas transportam energia.',
      segments: [{ text: 'Ondas transportam energia.', startMs: 0, endMs: 2000 }],
    }),
  ]);
}

/** Current transcript revision id of a material. */
export async function currentRevisionId(db, materialId) {
  return (
    await db.query(
      'select tv.id from public.transcription_versions tv join public.transcriptions t on t.id = tv.transcription_id where t.material_id = $1 and tv.revision = t.current_revision',
      [materialId],
    )
  ).rows[0]?.id;
}

/** Full chain for classroom tests: E02 fixture, authoring, E13, flashcard sets, classrooms. */
export async function migrateClassrooms(f) {
  await migrateStudyAuthoring(f.db, { flashcards: true });
  await f.db.exec(readClassroomsMigration());
  await addClassroomAccounts(f);
}

/** A named flashcard set with cards for an account (via the real Flashcards 2.0 function). */
export async function createSet(f, identity, name, fronts) {
  const id = randomUUID();
  await f.call('study_create_flashcard_set_admin', [
    identity.id,
    id,
    JSON.stringify({ name, cards: fronts.map((front) => ({ front, back: `Verso de ${front}` })) }),
  ]);
  return id;
}

export { identities, resourceIds };
