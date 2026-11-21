import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

// Milestone C — every read and write is one server-only database function (*_admin); the
// account always comes from the authenticated request. The knowledge-map cache has its own
// functions and its own migration: a missing cache is reported as such, never as a missing
// multi-lesson schema.

const failures = {
  MULTI_LESSON_NOT_FOUND: [404, 'Material integrado, unidade ou disciplina não encontrado.'],
  MULTI_LESSON_INVALID_SELECTION: [400, 'Confira a seleção de aulas, unidades ou disciplina.'],
  MULTI_LESSON_INVALID_INPUT: [400, 'Confira os dados enviados.'],
  MULTI_LESSON_NO_SOURCES: [
    409,
    'Nenhuma aula da seleção tem a transcrição atual confirmada. Confira e confirme as transcrições antes.',
  ],
  MULTI_LESSON_TOO_MANY_SOURCES: [409, 'Escolha no máximo 12 aulas confirmadas por material integrado.'],
  MULTI_LESSON_SOURCES_CHANGED: [409, 'As aulas da seleção mudaram. Revise a lista e confirme de novo.'],
  MULTI_LESSON_REQUEST_CONFLICT: [409, 'Este envio já foi usado com outros dados. Atualize a página.'],
  MULTI_LESSON_GENERATION_NOT_FOUND: [409, 'A geração mudou de estado. Tente de novo.'],
  MULTI_LESSON_REUSE_UNAVAILABLE: [409, 'O material equivalente não está mais disponível.'],
  MULTI_LESSON_LEASE_LOST: [409, 'Outra execução assumiu esta tarefa.'],
  MULTI_LESSON_SOURCES_IMMUTABLE: [409, 'As aulas de origem de um material integrado não podem ser alteradas.'],
  TRANSCRIPTION_CONFIRMATION_REQUIRED: [409, 'Uma das transcrições deixou de estar confirmada.'],
  KNOWLEDGE_MAP_SOURCE_FORBIDDEN: [403, 'Revisão fora da sua conta.'],
  // Exports (20261121180000_multi_lesson_exports.sql).
  MULTI_LESSON_NOT_READY: [409, 'O material integrado ainda não está pronto.'],
  MULTI_LESSON_NOTHING_TO_EXPORT: [409, 'Este material integrado não tem itens deste tipo para salvar.'],
  MULTI_LESSON_ANCHOR_UNAVAILABLE: [
    409,
    'Nenhuma aula de origem continua disponível e confirmada para guardar a lista. Confira as aulas usadas.',
  ],
  PERMISSION_REQUIRED: [409, 'Falta a declaração de permissão de uma das aulas de origem.'],
  INVALID_GENERATION: [422, 'As questões deste material não estão num formato que possa virar lista.'],
  FLASHCARD_INVALID_SET: [422, 'Os cartões deste material não estão num formato que possa virar conjunto.'],
  FLASHCARD_SET_LIMIT: [409, 'O conjunto ultrapassaria o limite de 500 cartões.'],
};
export const SCHEMA_CODES = ['PGRST202', 'PGRST205', '42883', '42P01', '42703'];

function mapError(error, status, schemaCode, schemaMessage) {
  const failure = failures[error?.message];
  if (failure) return new AppError(error.message, failure[1], failure[0]);
  if (SCHEMA_CODES.includes(error?.code)) return new AppError(schemaCode, schemaMessage, 503);
  if (['22P02', '23514', '23502'].includes(error?.code))
    return new AppError('MULTI_LESSON_INVALID_INPUT', failures.MULTI_LESSON_INVALID_INPUT[1], 400);
  if (status === 0 || status === 408 || status >= 500 || String(error?.code || '').startsWith('08') || ['40001', '40P01', '55P03', '57014'].includes(error?.code))
    return new AppError('DATABASE_TEMPORARY_ERROR', 'O banco está temporariamente indisponível. Tente novamente.', 503, {
      retryable: true,
      cause: error,
    });
  return error;
}

export function createMultiLessonCaller(db = getAdminSupabase) {
  return async function call(name, params) {
    const { data, error, status } = await db().rpc(name, params);
    if (!error) return data;
    throw mapError(error, status, 'MULTI_LESSON_SCHEMA_REQUIRED', 'O material integrado ainda não foi habilitado no banco.');
  };
}
const call = createMultiLessonCaller();

export const resolveSources = (userId, kind, ids) =>
  call('multi_lesson_resolve_admin', { p_user_id: userId, p_kind: kind, p_ids: ids });
export const attachRequest = (params) => call('multi_lesson_attach_admin', params);
export const getMultiLesson = (userId, id) => call('multi_lesson_get_admin', { p_user_id: userId, p_id: id });
export const listMultiLessons = (userId, limit = 50) =>
  call('multi_lesson_list_admin', { p_user_id: userId, p_limit: limit });
export const deleteMultiLesson = (userId, id) => call('multi_lesson_delete_admin', { p_user_id: userId, p_id: id });

// Exports: questions → an ordinary question list, flashcards → a personal set. Their own
// migration: without it the endpoints answer 503 MULTI_LESSON_EXPORTS_SCHEMA_REQUIRED and the
// integrated material keeps working.
export function createExportsCaller(db = getAdminSupabase) {
  return async function exportsRpc(name, params) {
    const { data, error, status } = await db().rpc(name, params);
    if (!error) return data;
    // 42501: execution revoked on purpose (rollback step 1) — the same answer as a missing schema.
    throw mapError(
      error?.code === '42501' ? { ...error, code: '42883' } : error,
      status,
      'MULTI_LESSON_EXPORTS_SCHEMA_REQUIRED',
      'Salvar o material integrado como lista ou conjunto ainda não foi habilitado no banco.',
    );
  };
}
const exportsCall = createExportsCaller();
export const listExports = (userId, id) => exportsCall('multi_lesson_exports_admin', { p_user_id: userId, p_id: id });
export const exportQuestions = (userId, id, requestId, title) =>
  exportsCall('multi_lesson_export_questions_admin', {
    p_user_id: userId,
    p_id: id,
    p_request_id: requestId,
    p_title: title ?? null,
  });
export const exportFlashcards = (userId, id, requestId, name) =>
  exportsCall('multi_lesson_export_flashcards_admin', {
    p_user_id: userId,
    p_id: id,
    p_request_id: requestId,
    p_name: name ?? null,
  });

// Queue (worker only).
export const claimJob = (workerId, staleSeconds) =>
  call('multi_lesson_claim_job_admin', { p_worker_id: workerId, p_stale_after_seconds: staleSeconds });
export const renewLease = (jobId, workerId) =>
  call('multi_lesson_renew_lease_admin', { p_job_id: jobId, p_worker_id: workerId });
export const jobSources = (jobId, workerId) =>
  call('multi_lesson_job_sources_admin', { p_job_id: jobId, p_worker_id: workerId });
export const completeJob = (jobId, workerId, result, model) =>
  call('multi_lesson_complete_job_admin', { p_job_id: jobId, p_worker_id: workerId, p_result: result, p_model: model || null });
export const failJob = (jobId, workerId, code, retryAt) =>
  call('multi_lesson_fail_job_admin', { p_job_id: jobId, p_worker_id: workerId, p_error_code: code, p_retry_at: retryAt });

// Knowledge-map cache (optional layer, own migration).
async function cacheCall(name, params) {
  const { data, error, status } = await getAdminSupabase().rpc(name, params);
  if (error) throw mapError(error, status, 'KNOWLEDGE_MAP_CACHE_UNAVAILABLE', 'O cache de mapas de conhecimento não está no banco.');
  return data;
}
export function createKnowledgeMapCache({ userId, promptVersion, modelFamily }) {
  return {
    async get(revisionIds) {
      const rows = await cacheCall('knowledge_map_get_admin', {
        p_user_id: userId,
        p_revision_ids: revisionIds,
        p_prompt_version: promptVersion,
        p_model_family: modelFamily,
      });
      return new Map((rows || []).map((row) => [row.revisionId, row.map]));
    },
    put: (revisionId, map, model) =>
      cacheCall('knowledge_map_put_admin', {
        p_user_id: userId,
        p_revision_id: revisionId,
        p_prompt_version: promptVersion,
        p_model_family: modelFamily,
        p_map: map,
        p_model: model || null,
      }),
  };
}
