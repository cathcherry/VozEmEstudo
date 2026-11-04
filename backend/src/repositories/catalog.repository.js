import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';
import { errors } from '../domain/errors.js';

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
