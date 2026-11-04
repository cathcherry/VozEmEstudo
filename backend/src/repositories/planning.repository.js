import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError, errors } from '../domain/errors.js';

function assertDb(error) {
  if (!error) return;
  if (['42P01', '42703', 'PGRST202'].includes(error.code))
    throw new AppError('PLANNING_SCHEMA_REQUIRED', 'O planejamento ainda não foi habilitado no banco.', 503);
  if (error.code === '23503')
    throw errors.notFound('Vínculo de planejamento');
  if (error.code === '23505')
    throw new AppError('PLANNING_CONFLICT', 'Já existe um item com esses dados.', 409);
  throw error;
}

export async function listOwnedPlanning(userId) {
  const db = getAdminSupabase();
  const [goals, tasks] = await Promise.all([
    db.from('study_goals')
      .select('id,title,description,target_date,status,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    db.from('study_tasks')
      .select('id,goal_id,title,due_date,material_id,completed_at,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);
  assertDb(goals.error);
  assertDb(tasks.error);
  return { goals: goals.data || [], tasks: tasks.data || [] };
}

export async function getOwnedGoal(userId, goalId) {
  const { data, error } = await getAdminSupabase().from('study_goals')
    .select('id')
    .eq('user_id', userId).eq('id', goalId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Objetivo');
  return data;
}

export async function getOwnedMaterialForTask(userId, materialId) {
  const { data, error } = await getAdminSupabase().from('materials')
    .select('id').eq('user_id', userId).eq('id', materialId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Material');
  return data;
}

export async function insertGoal(userId, goal) {
  const { data, error } = await getAdminSupabase().from('study_goals')
    .insert({ ...goal, user_id: userId })
    .select('id,title,description,target_date,status,created_at').single();
  assertDb(error);
  return data;
}

export async function insertTask(userId, goalId, task) {
  const { data, error } = await getAdminSupabase().from('study_tasks')
    .insert({ ...task, goal_id: goalId, user_id: userId })
    .select('id,goal_id,title,due_date,material_id,completed_at,created_at').single();
  assertDb(error);
  return data;
}

export async function setOwnedTaskCompletion(userId, taskId, completed) {
  const { data, error } = await getAdminSupabase().from('study_tasks')
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq('user_id', userId).eq('id', taskId)
    .select('id,goal_id,title,due_date,material_id,completed_at,created_at')
    .maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Tarefa');
  return data;
}
