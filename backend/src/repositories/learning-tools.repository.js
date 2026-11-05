import { createHash } from 'node:crypto';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';
export const hashShareToken=(token)=>createHash('sha256').update(token).digest('hex');
const messages={
  LEARNING_NOT_FOUND:[404,'Registro não encontrado.'],LEARNING_VERSION_CONFLICT:[409,'O registro mudou em outro aparelho. Atualize antes de editar.'],
  LEARNING_REQUEST_CONFLICT:[409,'Este envio já foi usado com outros dados. Atualize a lista.'],LEARNING_ANCHOR_IMMUTABLE:[409,'A referência do destaque não pode ser alterada. Crie outro destaque.'],
  LEARNING_ANCHOR_CONFLICT:[409,'A seleção não corresponde à revisão salva. Salve a transcrição e selecione novamente.'],
  LEARNING_CONFIRMATION_REQUIRED:[409,'Confirme a revisão atual antes de compartilhar.'],LEARNING_SUMMARY_REQUIRED:[409,'Gere um resumo da revisão confirmada antes de incluí-lo.'],
  LEARNING_SHARE_LIMIT:[409,'Revogue links antigos antes de criar novos.'],PERMISSION_REQUIRED:[422,'Confirme a permissão da gravação antes de compartilhar.'],
};
export function assertLearningDb(error){
  if(!error)return;const mapped=messages[error.message];if(mapped)throw new AppError(error.message,mapped[1],mapped[0]);
  if(['42P01','42883','PGRST202','PGRST205'].includes(error.code))throw new AppError('LEARNING_SCHEMA_REQUIRED','As ferramentas de estudo ainda não foram habilitadas no banco.',503);
  if(['23505','23503','23514','22001'].includes(error.code))throw new AppError('LEARNING_CONFLICT','Confira os limites, vínculos e versão do registro antes de enviar novamente.',409);
  throw error;
}
async function rpc(name,body){const {data,error}=await getAdminSupabase().rpc(name,body);assertLearningDb(error);return data;}
export const listNotes=(user,q)=>rpc('study_list_annotations_admin',{p_user_id:user,p_material_id:q.materialId||null,p_query:q.q,p_offset:q.offset});
export const saveNote=(user,data)=>rpc('study_save_annotation_admin',{p_user_id:user,p_id:data.id,p_material_id:data.materialId,p_version:data.version,p_request_id:data.requestId,p_body:data.body});
export const calendarFeed=(user,q)=>rpc('study_calendar_feed_admin',{p_user_id:user,p_from:q.from,p_to:q.to,p_from_day:q.fromDay,p_to_day:q.toDay,p_offset:q.offset});
export const saveCalendar=(user,data)=>rpc('study_save_calendar_admin',{p_user_id:user,p_id:data.id,p_version:data.version,p_request_id:data.requestId,p_body:data.body});
export const createShare=(user,materialId,data)=>rpc('study_create_share_admin',{p_user_id:user,p_id:data.id,p_material_id:materialId,p_request_id:data.requestId,
  p_hash:hashShareToken(data.token),p_revision_id:data.sourceRevisionId,p_transcript:data.includeTranscript,p_summary:data.includeSummary,p_days:data.days,p_permission_version:PERMISSION_DECLARATION.version});
export const resolveShare=(token)=>rpc('study_resolve_share_admin',{p_hash:hashShareToken(token)});
export async function listShares(user,materialId,offset){
  const {data,count,error}=await getAdminSupabase().from('material_shares').select('id,created_at,expires_at,revoked_at,include_transcript,include_summary,source_revision_id',{count:'exact'})
    .eq('user_id',user).eq('material_id',materialId).order('created_at',{ascending:false}).order('id').range(offset,offset+49);
  assertLearningDb(error);return {shares:data||[],total:count||0,offset,limit:50};
}
export async function revokeShare(user,materialId,id){
  const {data,error}=await getAdminSupabase().from('material_shares').update({revoked_at:new Date().toISOString()})
    .eq('id',id).eq('user_id',user).eq('material_id',materialId).select('id').maybeSingle();
  assertLearningDb(error);if(!data)throw new AppError('LEARNING_NOT_FOUND','Link não encontrado.',404);return data;
}
