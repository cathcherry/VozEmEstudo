import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createAcademicDatabase, revisionIds } from './academic-db.fixture.js';
import { migrateLearningTools } from './learning-db.fixture.js';
import { identities, resourceIds } from './ownership.fixture.js';
import { addMultiSegmentRevision, multiRevisionId, multiSegments } from './notes-db.fixture.js';
import { PERMISSION_DECLARATION } from '../../src/config/permission-declaration.js';

export const DISCOVERIES_MIGRATION = '20261123090000_discoveries.sql';
const read = (file) =>
  readFileSync(new URL('../../../database/migrations/' + file, import.meta.url), 'utf8');
export const discoveriesMigrationSql = () => read(DISCOVERIES_MIGRATION);
export { multiRevisionId, multiSegments };

/** Prerequisites: E02 (fixture), E03/E05/E14 (learning tools), E10 quiz answers, E13 flashcards, Notes 3.0. */
export async function migratePrerequisites(db) {
  await migrateLearningTools(db);
  for (const file of [
    '20261104223000_quiz_sessions.sql',
    '20261104234500_flashcards.sql',
    '20261121130000_notes_3_0.sql',
  ])
    await db.exec(read(file));
}

/** A lesson of `userId` with its permission declaration (required in the same transaction). */
export async function insertLesson(db, userId, { title, subject }, materialId = randomUUID()) {
  await db.transaction(async (tx) => {
    await tx.query(
      "insert into public.materials(id,user_id,title,subject,status) values($1,$2,$3,$4,'PRONTO')",
      [materialId, userId, title, subject],
    );
    await tx.query(
      'insert into public.material_permissions(user_id,material_id,declaration_version,declaration_text) values($1,$2,$3,$4)',
      [userId, materialId, PERMISSION_DECLARATION.version, PERMISSION_DECLARATION.text],
    );
  });
  return materialId;
}

/** A further confirmed lesson of `userId` (one segment per text), in `subject`. */
export async function addConfirmedLesson(db, userId, { title, subject, segments }) {
  const materialId = await insertLesson(db, userId, { title, subject });
  const revisionId = randomUUID();
  const transcription = (
    await db.query(
      'insert into public.transcriptions(material_id,current_text) values($1,$2) returning id',
      [materialId, segments.join(' ')],
    )
  ).rows[0];
  const snapshot = segments.map((text, position) => ({
    id: randomUUID(),
    position,
    startMs: position * 4000,
    endMs: position * 4000 + 4000,
    text,
  }));
  await db.query(
    "insert into public.transcription_versions(id,transcription_id,revision,origin,full_text,segments_snapshot) values($1,$2,1,'ASR',$3,$4)",
    [revisionId, transcription.id, segments.join(' '), JSON.stringify(snapshot)],
  );
  await db.query(
    'insert into public.transcription_confirmations(user_id,material_id,transcription_version_id,consent_version) values($1,$2,$3,$4)',
    [userId, materialId, revisionId, PERMISSION_DECLARATION.version],
  );
  return { materialId, revisionId };
}

/**
 * Fully migrated database: material A (Física) has the confirmed three-segment revision 2;
 * material B belongs to account B (confirmed revision 1).
 */
export async function createDiscoveriesDatabase({ migrate = true } = {}) {
  const f = await createAcademicDatabase();
  await migratePrerequisites(f.db);
  if (migrate) await f.db.exec(discoveriesMigrationSql());
  await f.permit(identities.a, resourceIds.materialA);
  await f.permit(identities.b, resourceIds.materialB);
  await addMultiSegmentRevision(f.db, identities.a.id, resourceIds.materialA);
  await f.confirm(identities.b, resourceIds.materialB, revisionIds.b);
  return f;
}

/** Shortcuts over the server functions, as account `user`. */
export function discoveryApi(call) {
  return {
    source: (user, material) => call('investigation_source_admin', [user, material]),
    start: (user, material, question, extra = {}) => {
      const id = randomUUID();
      return call('investigation_save_admin', [
        user,
        id,
        0,
        randomUUID(),
        JSON.stringify({
          materialId: material,
          sourceRevisionId: extra.sourceRevisionId ?? multiRevisionId,
          question,
          questionOrigin: 'student',
          ...extra.body,
        }),
      ]);
    },
    save: (user, id, version, body, requestId = randomUUID()) =>
      call('investigation_save_admin', [user, id, version, requestId, JSON.stringify(body)]),
    evidence: (user, id, body, evidenceId = randomUUID()) =>
      call('investigation_add_evidence_admin', [user, id, evidenceId, JSON.stringify(body)]),
    removeEvidence: (user, id, evidenceId) =>
      call('investigation_remove_evidence_admin', [user, id, evidenceId]),
    link: (user, id, kind, ref, remove = false) =>
      call('investigation_link_admin', [user, id, randomUUID(), kind, ref, remove]),
    linkOptions: (user, id) => call('investigation_link_options_admin', [user, id]),
    complete: (user, id) => call('investigation_complete_admin', [user, id, randomUUID()]),
    get: (user, id) => call('investigation_get_admin', [user, id]),
    discovery: (user, id) => call('discovery_get_admin', [user, id]),
    list: (user) => call('discovery_list_admin', [user]),
    update: (user, id, version, body, requestId = randomUUID()) =>
      call('discovery_update_admin', [user, id, version, requestId, JSON.stringify(body)]),
    reflect: (user, id, text, reflectionId = randomUUID()) =>
      call('discovery_add_reflection_admin', [user, id, reflectionId, text]),
    connect: (user, id, other, note = '', connectionId = randomUUID()) =>
      call('discovery_connect_admin', [user, id, connectionId, other, note]),
    collection: (user) => call('collection_get_admin', [user]),
    layout: (user, version, items, requestId = randomUUID()) =>
      call('desk_layout_save_admin', [user, version, requestId, JSON.stringify(items)]),
  };
}

/** Starts, gathers one verified quote, explains and completes an investigation. */
export async function completeInvestigation(api, user, material, { question, quote, explanation, revisionId }) {
  const started = await api.start(user, material, question, { sourceRevisionId: revisionId });
  const id = started.investigation.id;
  await api.evidence(user, id, quote);
  const saved = await api.save(user, id, started.investigation.version, { explanation });
  await api.complete(user, id);
  return { id, saved };
}
