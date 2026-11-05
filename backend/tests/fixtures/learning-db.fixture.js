import { readFileSync } from 'node:fs';
export async function migrateLearningTools(db){
  for(const file of ['20261104190000_catalog_units.sql','20261104203000_study_planning.sql','20261105014000_annotations.sql','20261105014500_calendar_sharing.sql'])
    await db.exec(readFileSync(new URL('../../../database/migrations/'+file,import.meta.url),'utf8'));
}
