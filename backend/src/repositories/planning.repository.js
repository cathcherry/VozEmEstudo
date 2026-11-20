import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError, errors } from '../domain/errors.js';

function assertDb(error) {
  if (!error) return;
  if (['42P01', '42703', 'PGRST202', 'PGRST205'].includes(error.code))
    throw new AppError('PLANNING_SCHEMA_REQUIRED', 'O planejamento ainda não foi habilitado no banco.', 503);
  if (error.code === '23503') throw errors.notFound('Vínculo de planejamento');
  if (error.code === '23514')
    throw new AppError(
      'PLANNING_ORDER_CONFLICT',
      'A ordem mudou desde sua última atualização. Recarregue as tarefas.',
      409,
    );
  if (error.code === '23505') throw new AppError('PLANNING_CONFLICT', 'Já existe um item com esses dados.', 409);
  throw error;
}

const goalFields = 'id,title,description,target_date,status,created_at';
const subgoalFields = 'id,goal_id,title,due_date,created_at';
const taskFields = 'id,goal_id,subgoal_id,title,due_date,material_id,reference_url,sort_order,completed_at,created_at';

export async function listOwnedPlanning(userId) {
  const db = getAdminSupabase();
  const [goals, subgoals, tasks] = await Promise.all([
    db.from('study_goals').select(goalFields).eq('user_id', userId)
      .order('created_at', { ascending: false }),
    db.from('study_subgoals').select(subgoalFields).eq('user_id', userId)
      .order('created_at', { ascending: true }),
    db.from('study_tasks').select(taskFields).eq('user_id', userId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
  ]);
  for (const result of [goals, subgoals, tasks]) assertDb(result.error);
  return { goals: goals.data || [], subgoals: subgoals.data || [], tasks: tasks.data || [] };
}

export async function getOwnedGoal(userId, goalId) {
  const { data, error } = await getAdminSupabase().from('study_goals')
    .select('id').eq('user_id', userId).eq('id', goalId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Objetivo');
  return data;
}

export async function getOwnedSubgoal(userId, subgoalId) {
  const { data, error } = await getAdminSupabase().from('study_subgoals')
    .select('id,goal_id').eq('user_id', userId).eq('id', subgoalId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Subobjetivo');
  return data;
}

export async function getOwnedTask(userId, taskId) {
  const { data, error } = await getAdminSupabase().from('study_tasks')
    .select('id,goal_id').eq('user_id', userId).eq('id', taskId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Tarefa');
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
    .insert({ ...goal, user_id: userId }).select(goalFields).single();
  assertDb(error);
  return data;
}

export async function updateOwnedGoal(userId, goalId, patch) {
  const { data, error } = await getAdminSupabase().from('study_goals')
    .update(patch).eq('user_id', userId).eq('id', goalId).select(goalFields).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Objetivo');
  return data;
}

export async function insertSubgoal(userId, goalId, subgoal) {
  const { data, error } = await getAdminSupabase().from('study_subgoals')
    .insert({ ...subgoal, goal_id: goalId, user_id: userId }).select(subgoalFields).single();
  assertDb(error);
  return data;
}

export async function updateOwnedSubgoal(userId, subgoalId, patch) {
  const { data, error } = await getAdminSupabase().from('study_subgoals')
    .update(patch).eq('user_id', userId).eq('id', subgoalId)
    .select(subgoalFields).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Subobjetivo');
  return data;
}

export async function reorderOwnedTasks(userId, goalId, taskIds) {
  const { data, error } = await getAdminSupabase().rpc('study_reorder_tasks', {
    p_user_id: userId, p_goal_id: goalId, p_task_ids: taskIds,
  });
  assertDb(error);
  return data || [];
}

export async function insertTask(userId, goalId, task) {
  const { data, error } = await getAdminSupabase().from('study_tasks')
    .insert({ ...task, goal_id: goalId, user_id: userId }).select(taskFields).single();
  assertDb(error);
  return data;
}

export async function updateOwnedTask(userId, taskId, patch) {
  const { data, error } = await getAdminSupabase().from('study_tasks')
    .update(patch).eq('user_id', userId).eq('id', taskId).select(taskFields).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Tarefa');
  return data;
}

export async function setOwnedTaskCompletion(userId, taskId, completed) {
  const { data, error } = await getAdminSupabase().from('study_tasks')
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq('user_id', userId).eq('id', taskId).select(taskFields).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Tarefa');
  return data;
}
