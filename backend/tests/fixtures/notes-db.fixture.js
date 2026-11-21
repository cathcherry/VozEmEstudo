import { readFileSync } from 'node:fs';
import { PERMISSION_DECLARATION } from '../../src/config/permission-declaration.js';

export const NOTES_MIGRATION = '20261121130000_notes_3_0.sql';
export const notesMigrationSql = () =>
  readFileSync(new URL('../../../database/migrations/' + NOTES_MIGRATION, import.meta.url), 'utf8');

// Revision 2 of material A: three segments, so anchors can span segment boundaries.
export const multiRevisionId = '99999999-9999-4999-8999-999999999999';
export const multiSegments = [
  'Energia é conservada.',
  'Uma afirmação citada pode ser refutada.',
  'Calor é energia em trânsito.',
];

/** Adds and confirms a three-segment revision 2 for the material (current revision afterwards). */
export async function addMultiSegmentRevision(db, userId, materialId, revisionId = multiRevisionId) {
  const transcription = (
    await db.query('select id from public.transcriptions where material_id=$1', [materialId])
  ).rows[0];
  const snapshot = multiSegments.map((text, position) => ({
    id: `00000000-0000-4000-8000-00000000000${position}`,
    position,
    startMs: position * 3000,
    endMs: position * 3000 + 3000,
    text,
  }));
  await db.query(
    "insert into public.transcription_versions(id,transcription_id,revision,origin,full_text,segments_snapshot) values($1,$2,2,'ASR',$3,$4)",
    [revisionId, transcription.id, multiSegments.join(' '), JSON.stringify(snapshot)],
  );
  await db.query('update public.transcriptions set current_revision=2 where id=$1', [transcription.id]);
  await db.query(
    "insert into public.transcription_confirmations(user_id,material_id,transcription_version_id,consent_version) values($1,$2,$3,$4)",
    [userId, materialId, revisionId, PERMISSION_DECLARATION.version],
  );
}
