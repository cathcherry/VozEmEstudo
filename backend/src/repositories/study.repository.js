import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

const messages = {
  STUDY_NOT_FOUND: [404,'Aula ou sessão não encontrada.'],
  STUDY_PROGRESS_CONFLICT: [409,'Outro dispositivo atualizou esta aula. Recarregue para usar o andamento mais recente.'],
  STUDY_REQUEST_CONFLICT: [409,'Este envio já foi usado ou a sequência da sessão mudou. Atualize o painel.'],
  STUDY_SESSION_ACTIVE: [409,'Já existe uma sessão ativa nesta conta. Encerre-a no painel ou aguarde 45 segundos sem atividade.'],
  STUDY_INVALID_INPUT: [400,'Dados de estudo inválidos.'],
  STUDY_INTERVAL_LIMIT: [409,'Há muitos trechos separados. Recarregue o andamento antes de continuar.'],
};
export function assertStudyDb(error) {
  if (!error) return;
  const match = messages[error.message];
  if (match) throw new AppError(error.message,match[1],match[0]);
  if (['42P01','42883','PGRST202','PGRST205'].includes(error.code))
    throw new AppError('STUDY_SCHEMA_REQUIRED','O progresso sincronizado ainda não foi habilitado no banco.',503);
  throw error;
}
async function call(name, params) {
  const {data,error} = await getAdminSupabase().rpc(name,params); assertStudyDb(error); return data;
}
export async function listProgress(userId,offset) {
  const {data,error,count} = await getAdminSupabase().from('study_progress')
    .select('material_id,position_seconds,duration_seconds,playback_rate,completed,intervals,version,updated_at',{count:'exact'})
    .eq('user_id',userId).order('material_id').range(offset,offset+199);
  assertStudyDb(error); return {progress:data || [], total:count || 0, offset, limit:200};
}
export const saveProgress = (userId,materialId,data) => call('study_save_progress_admin',{
  p_user_id:userId,p_material_id:materialId,p_version:data.version,p_request_id:data.requestId,p_patch:data.patch,
});
export const startSession = (userId,data) => call('study_start_session_admin',{
  p_user_id:userId,p_session_id:data.sessionId,p_material_id:data.materialId,p_kind:data.kind,
});
export const tickSession = (userId,id,data) => call('study_tick_session_admin',{
  p_user_id:userId,p_session_id:id,p_sequence:data.sequence,p_active:data.active,p_close:data.close,
});
export const saveSettings = (userId,data) => call('study_save_settings_admin',{
  p_user_id:userId,p_goal:data.goalMinutes,p_timezone:data.timezone,
});
export const overview = (userId) => call('study_overview_admin',{p_user_id:userId});

/** Sessions with credited time since `since` (newest first), at most 10 000 rows. */
export async function listSessionsSince(userId,since) {
  const rows=[];
  for (let page=0; page<10; page+=1) {
    const {data,error}=await getAdminSupabase().from('study_sessions')
      .select('material_id,started_at,total_seconds')
      .eq('user_id',userId).gte('started_at',since).gt('total_seconds',0)
      .order('started_at',{ascending:false}).range(page*1000,page*1000+999);
    assertStudyDb(error);
    rows.push(...(data || []));
    if (!data || data.length<1000) break;
  }
  return rows;
}
export async function getSettings(userId) {
  const {data,error}=await getAdminSupabase().from('study_settings')
    .select('weekly_goal_minutes,timezone').eq('user_id',userId).maybeSingle();
  assertStudyDb(error);
  return {goalMinutes:data?.weekly_goal_minutes ?? 120, timezone:data?.timezone || 'UTC'};
}
