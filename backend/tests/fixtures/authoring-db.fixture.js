import { readFileSync } from 'node:fs';

const read = (file) =>
  readFileSync(new URL('../../../database/migrations/' + file, import.meta.url), 'utf8');

/** Applies the prerequisite chain (E03, E05) and the study-authoring candidate migration. */
export async function migrateStudyAuthoring(db, { flashcards = false } = {}) {
  for (const file of ['20261104190000_catalog_units.sql', '20261104203000_study_planning.sql'])
    await db.exec(read(file));
  await db.exec(read('20261119120000_study_authoring.sql'));
  if (flashcards) {
    await db.exec(read('20261104234500_flashcards.sql'));
    await db.exec(read('20261119121000_flashcard_sets.sql'));
  }
}
