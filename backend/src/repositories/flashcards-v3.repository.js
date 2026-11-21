import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

export const MEDIA_BUCKET = 'flashcard-media';
export const V3_CARD_FIELDS =
  'id,set_id,material_id,front_text,back_text,status,due_at,interval_days,repetitions,ease_factor,' +
  'last_reviewed_at,created_at,updated_at,source_revision_id,evidence,source_segments,card_style,difficulty,focus,' +
  'note_type,note_fields,content_hash,origin_kind,origin_label,origin_user_id,media';

const messages = {
  FLASHCARD_NOT_FOUND: [404, 'Conjunto ou cartão não encontrado.'],
  FLASHCARD_INVALID_SET: [400, 'Confira o nome e os cartões do conjunto.'],
  FLASHCARD_SET_LIMIT: [409, 'Um conjunto pode ter no máximo 500 cartões.'],
  CARD_TEMPLATE_NOT_FOUND: [404, 'Modelo não encontrado.'],
  CARD_TEMPLATE_INVALID: [400, 'Confira o modelo.'],
  CARD_TEMPLATE_LIMIT: [409, 'Você já tem 50 modelos. Exclua um para criar outro.'],
  CARD_TEMPLATE_VERSION_CONFLICT: [409, 'Este modelo mudou em outro aparelho. Recarregue para ver a versão mais recente.'],
  CARD_TEMPLATE_REQUEST_CONFLICT: [409, 'Este envio já foi usado com outro conteúdo.'],
};
export function assertV3(error) {
  if (!error) return;
  const match = messages[error.message];
  if (match) throw new AppError(error.message, match[1], match[0]);
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code))
    throw new AppError('FLASHCARDS_V3_SCHEMA_REQUIRED', 'Os recursos de Flashcards 3.0 ainda não foram habilitados no banco.', 503);
  throw error;
}
const db = () => getAdminSupabase();
async function rpc(name, params) {
  const { data, error } = await db().rpc(name, params);
  assertV3(error);
  return data;
}

export const createDeck = (userId, id, body) =>
  rpc('study_create_flashcard_deck_admin', { p_user_id: userId, p_set_id: id, p_body: body });
export const addNotes = (userId, setId, cards) =>
  rpc('study_add_flashcard_notes_admin', { p_user_id: userId, p_set_id: setId, p_cards: cards });
export const saveTemplate = (userId, id, { version, requestId, body }) =>
  rpc('study_save_card_template_admin', {
    p_user_id: userId,
    p_id: id,
    p_version: version,
    p_request_id: requestId,
    p_body: body,
  });
export const setTemplate = (userId, setId, { templateId, base }) =>
  rpc('study_set_flashcard_set_template_admin', {
    p_user_id: userId,
    p_set_id: setId,
    p_template_id: templateId,
    p_base: base,
  });

export async function listTemplates(userId) {
  const { data, error } = await db()
    .from('study_card_templates')
    .select('id,name,base,tokens,variants,version,updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  assertV3(error);
  return data || [];
}

/** One of the user's own sets with its cards (for merges). */
export async function ownSetWithCards(userId, setId) {
  const { data: set, error } = await db()
    .from('study_flashcard_sets')
    .select('id,name,user_id')
    .eq('id', setId)
    .eq('user_id', userId)
    .maybeSingle();
  assertV3(error);
  if (!set) throw new AppError('FLASHCARD_NOT_FOUND', 'Conjunto não encontrado.', 404);
  const { data: cards, error: cardsError } = await db()
    .from('study_flashcards')
    .select(V3_CARD_FIELDS)
    .eq('user_id', userId)
    .eq('set_id', setId)
    .order('created_at', { ascending: true });
  assertV3(cardsError);
  return { ...set, cards: cards || [] };
}

export async function uploadMedia(path, bytes, mime) {
  const { error } = await db().storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new AppError('FLASHCARD_MEDIA_UPLOAD', 'Não foi possível guardar uma imagem do pacote.', 502);
}
export async function removeMedia(paths) {
  if (!paths.length) return;
  await db().storage.from(MEDIA_BUCKET).remove(paths);
}
/** Short-lived signed URLs for card images (the bucket is private). */
export async function signMedia(paths) {
  if (!paths.length) return new Map();
  const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUrls(paths, 3600);
  if (error) return new Map();
  return new Map((data || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}
