import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError, errors } from '../domain/errors.js';

function ensureDatabaseResult(error) {
  if (!error) return;
  if (error.code === '23505')
    throw new AppError('CATALOG_DUPLICATE', 'Já existe um item com esse nome neste grupo.', 409);
  if (['42P01', '42703', 'PGRST202'].includes(error.code))
    throw new AppError(
      'CATALOG_SCHEMA_REQUIRED',
      'O catálogo ainda não foi habilitado no banco de dados.',
      503,
    );
  throw error;
}

export async function listCatalog(userId) {
  const db = getAdminSupabase();
  const [subjectsResult, unitsResult] = await Promise.all([
    db
      .from('study_subjects')
      .select('id,name,color_token,sort_order,created_at')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    db
      .from('study_units')
      .select('id,subject_id,title,description,sort_order,created_at')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
  ]);
  ensureDatabaseResult(subjectsResult.error);
  ensureDatabaseResult(unitsResult.error);
  return { subjects: subjectsResult.data || [], units: unitsResult.data || [] };
}

export async function getOwnedSubject(userId, subjectId) {
  const { data, error } = await getAdminSupabase()
    .from('study_subjects')
    .select('id,name,user_id')
    .eq('id', subjectId)
    .eq('user_id', userId)
    .is('archived_at', null)
    .maybeSingle();
  ensureDatabaseResult(error);
  if (!data) throw errors.notFound('Disciplina');
  return data;
}

export async function getOwnedUnit(userId, unitId) {
  const { data, error } = await getAdminSupabase()
    .from('study_units')
    .select('id,subject_id,user_id')
    .eq('id', unitId)
    .eq('user_id', userId)
    .is('archived_at', null)
    .maybeSingle();
  ensureDatabaseResult(error);
  if (!data) throw errors.notFound('Unidade');
  return data;
}

export async function insertSubject(userId, subject) {
  const { data, error } = await getAdminSupabase()
    .from('study_subjects')
    .insert({ ...subject, user_id: userId })
    .select('id,name,color_token,sort_order,created_at')
    .single();
  ensureDatabaseResult(error);
  return data;
}

export async function insertUnit(userId, subjectId, unit) {
  const { data, error } = await getAdminSupabase()
    .from('study_units')
    .insert({ ...unit, user_id: userId, subject_id: subjectId })
    .select('id,subject_id,title,description,sort_order,created_at')
    .single();
  ensureDatabaseResult(error);
  return data;
}

/**
 * Read-only resource index for E04. Only owned material IDs enter the four
 * downstream queries. No transcription, summary, question text or audio path
 * is returned to the browser.
 */
export function summarizeOwnedResources(materialIds, rows) {
  const result = Object.fromEntries(
    materialIds.map((id) => [
      id,
      { audio: false, transcription: false, summary: false, questions: false },
    ]),
  );
  for (const [kind, collection] of Object.entries(rows)) {
    if (!['audio', 'transcription', 'summary', 'questions'].includes(kind)) continue;
    for (const row of collection || []) {
      if (!Object.hasOwn(result, row.material_id)) continue;
      if (kind === 'audio') {
        if (row.retain_original === true && Boolean(row.storage_path))
          result[row.material_id].audio = true;
      } else result[row.material_id][kind] = true;
    }
  }
  return result;
}

export async function listLibraryResources(userId) {
  const db = getAdminSupabase();
  const availability = {};
  // Explicit page size avoids assuming the Data API's default row limit.
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { data: materials, error } = await db
      .from('materials')
      .select('id')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    ensureDatabaseResult(error);
    const ids = (materials || []).map((material) => material.id);
    if (ids.length === 0) break;

    const results = await Promise.all([
      db.from('audio_files').select('material_id,retain_original,storage_path').in('material_id', ids),
      db.from('transcriptions').select('material_id').in('material_id', ids),
      db
        .from('summary_versions')
        .select('material_id')
        .in('material_id', ids)
        .eq('is_current', true),
      db
        .from('question_batches')
        .select('material_id')
        .in('material_id', ids)
        .gt('generated_count', 0),
    ]);
    for (const response of results) ensureDatabaseResult(response.error);
    Object.assign(
      availability,
      summarizeOwnedResources(ids, {
        audio: results[0].data,
        transcription: results[1].data,
        summary: results[2].data,
        questions: results[3].data,
      }),
    );
    if (ids.length < pageSize) break;
  }
  return availability;
}

export async function updateMaterialCatalog(userId, materialId, selection) {
  const { data, error } = await getAdminSupabase()
    .from('materials')
    .update(selection)
    .eq('id', materialId)
    .eq('user_id', userId)
    .select('id,title,subject,subject_id,unit_id')
    .maybeSingle();
  ensureDatabaseResult(error);
  if (!data) throw errors.notFound('Material');
  return data;
}
