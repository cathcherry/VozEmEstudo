import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

// Investigations, discoveries and the collection (FEATURE_DISCOVERIES). Every rule lives in the
// database functions of 20261123090000_discoveries.sql; this module only maps their errors.
// A missing schema answers a 503 scoped to these routes; the rest of the app keeps working.
const SCHEMA_CODES = ['42P01', '42883', '42703', 'PGRST202', 'PGRST205'];
const MESSAGES = {
  DISCOVERY_NOT_FOUND: [404, 'Investigação, descoberta ou aula não encontrada.'],
  DISCOVERY_VERSION_CONFLICT: [409, 'Este registro mudou em outro aparelho. Atualize antes de editar.'],
  DISCOVERY_REQUEST_CONFLICT: [409, 'Este envio já foi usado com outros dados. Atualize a página.'],
  DISCOVERY_REVISION_UNCONFIRMED: [409, 'Confirme a transcrição desta aula antes de investigar com ela.'],
  DISCOVERY_SOURCE_CHANGED: [409, 'A transcrição confirmada desta aula mudou. Recarregue para investigar a versão atual.'],
  DISCOVERY_ANCHOR_CONFLICT: [409, 'O trecho escolhido não corresponde à transcrição confirmada. Selecione o trecho de novo.'],
  DISCOVERY_EVIDENCE_DUPLICATE: [409, 'Este trecho já está entre as evidências.'],
  DISCOVERY_EVIDENCE_REQUIRED: [409, 'Reúna pelo menos um trecho da aula como evidência.'],
  DISCOVERY_EXPLANATION_REQUIRED: [409, 'Escreva a sua explicação (pelo menos 20 caracteres) antes de registrar a descoberta.'],
  DISCOVERY_INVESTIGATION_COMPLETED: [409, 'Esta investigação já virou uma descoberta. Edite a descoberta no Arquivo.'],
  DISCOVERY_LINK_INVALID: [409, 'Só é possível ligar questões que você respondeu e cartões, destaques ou cadernos seus.'],
  DISCOVERY_LINK_UNAVAILABLE: [409, 'Este tipo de ligação ainda não está disponível neste servidor.'],
  DISCOVERY_CONNECTION_INVALID: [409, 'Escolha outra descoberta para ligar.'],
  DISCOVERY_LIMIT: [409, 'Você chegou ao limite deste tipo de registro.'],
  DISCOVERY_INVALID_INPUT: [400, 'Os dados enviados são inválidos.'],
  COLLECTION_NOT_UNLOCKED: [409, 'Só é possível colocar na mesa objetos que você já encontrou.'],
  COLLECTION_LAYOUT_INVALID: [400, 'A arrumação da mesa é inválida: um objeto por lugar e lugares conhecidos.'],
};

export function assertDiscoveryDb(error) {
  if (!error) return;
  const mapped = MESSAGES[error.message];
  if (mapped) throw new AppError(error.message, mapped[1], mapped[0]);
  if (SCHEMA_CODES.includes(error.code))
    throw new AppError(
      'DISCOVERIES_SCHEMA_REQUIRED',
      'As investigações e o Arquivo de Descobertas ainda não foram habilitados no banco.',
      503,
    );
  if (['23505', '23503', '23514', '22001', '22P02'].includes(error.code))
    throw new AppError('DISCOVERY_CONFLICT', 'Confira os limites e a versão do registro antes de enviar novamente.', 409);
  if (['40001', '40P01', '55P03', '57014'].includes(error.code))
    throw new AppError('DATABASE_TEMPORARY_ERROR', 'O banco está temporariamente indisponível. Tente novamente.', 503, {
      retryable: true,
    });
  throw error;
}

async function rpc(name, body) {
  const { data, error } = await getAdminSupabase().rpc(name, body);
  assertDiscoveryDb(error);
  return data;
}

export const source = (user, materialId) =>
  rpc('investigation_source_admin', { p_user_id: user, p_material_id: materialId });
export const getInvestigation = (user, id) => rpc('investigation_get_admin', { p_user_id: user, p_id: id });
export const saveInvestigation = (user, id, data) =>
  rpc('investigation_save_admin', {
    p_user_id: user,
    p_id: id,
    p_version: data.version,
    p_request_id: data.requestId,
    p_body: data.body,
  });
export const addEvidence = (user, id, { id: evidenceId, ...body }) =>
  rpc('investigation_add_evidence_admin', {
    p_user_id: user,
    p_investigation_id: id,
    p_evidence_id: evidenceId,
    p_body: body,
  });
export const removeEvidence = (user, id, evidenceId) =>
  rpc('investigation_remove_evidence_admin', { p_user_id: user, p_investigation_id: id, p_evidence_id: evidenceId });
export const link = (user, id, { id: linkId, kind, refId }, remove = false) =>
  rpc('investigation_link_admin', {
    p_user_id: user,
    p_investigation_id: id,
    p_link_id: linkId ?? null,
    p_kind: kind,
    p_ref_id: refId,
    p_remove: remove,
  });
export const linkOptions = (user, id) =>
  rpc('investigation_link_options_admin', { p_user_id: user, p_investigation_id: id });
export const complete = (user, id, requestId) =>
  rpc('investigation_complete_admin', { p_user_id: user, p_investigation_id: id, p_request_id: requestId });
export const listDiscoveries = (user) => rpc('discovery_list_admin', { p_user_id: user });
export const getDiscovery = (user, id) => rpc('discovery_get_admin', { p_user_id: user, p_id: id });
export const updateDiscovery = (user, id, { version, requestId, ...body }) =>
  rpc('discovery_update_admin', { p_user_id: user, p_id: id, p_version: version, p_request_id: requestId, p_body: body });
export const addReflection = (user, id, data) =>
  rpc('discovery_add_reflection_admin', { p_user_id: user, p_id: id, p_reflection_id: data.id, p_text: data.text });
export const connect = (user, id, data) =>
  rpc('discovery_connect_admin', {
    p_user_id: user,
    p_id: id,
    p_connection_id: data.id,
    p_other_id: data.otherId,
    p_note: data.note ?? '',
  });
export const collection = (user) => rpc('collection_get_admin', { p_user_id: user });
export const saveLayout = (user, data) =>
  rpc('desk_layout_save_admin', {
    p_user_id: user,
    p_version: data.version,
    p_request_id: data.requestId,
    p_items: data.items,
  });
