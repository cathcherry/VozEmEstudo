import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

export const SET_CARD_FIELDS =
  'id,set_id,material_id,front_text,back_text,status,due_at,interval_days,repetitions,ease_factor,' +
  'last_reviewed_at,created_at,updated_at,source_revision_id,evidence,source_segments,card_style,difficulty,focus';

function assertDb(error) {
  if (!error) return;
  const mapped = {
    FLASHCARD_NOT_FOUND: [404, 'Conjunto ou cartão não encontrado.'],
    FLASHCARD_INVALID_SET: [400, 'Confira o nome e os cartões do conjunto.'],
    FLASHCARD_SET_LIMIT: [409, 'Este conjunto atingiu o limite de 500 cartões.'],
  };
  const match = mapped[error.message];
  if (match) throw new AppError(error.message, match[1], match[0]);
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code))
    throw new AppError('FLASHCARD_SETS_SCHEMA_REQUIRED', 'Os conjuntos de flashcards ainda não foram habilitados no banco.', 503);
  throw error;
}
const db = () => getAdminSupabase();
async function rpc(name, params) {
  const { data, error } = await db().rpc(name, params);
  assertDb(error);
  return data;
}

export const createSet = (userId, data) =>
  rpc('study_create_flashcard_set_admin', {
    p_user_id: userId,
    p_set_id: data.id,
    p_body: {
      name: data.name,
      materialId: data.materialId,
      sourceRevisionId: data.sourceRevisionId,
      config: data.config,
      cards: data.cards,
    },
  });
export const addCards = (userId, setId, cards) =>
  rpc('study_add_flashcards_admin', { p_user_id: userId, p_set_id: setId, p_cards: cards });
export const updateSet = (userId, setId, { name = null, status = null }) =>
  rpc('study_update_flashcard_set_admin', { p_user_id: userId, p_set_id: setId, p_name: name, p_status: status });
export const deleteSet = (userId, setId) =>
  rpc('study_delete_flashcard_set_admin', { p_user_id: userId, p_set_id: setId });
export const deleteCard = (userId, cardId) =>
  rpc('study_delete_flashcard_admin', { p_user_id: userId, p_card_id: cardId });

export async function listSets(userId, materialId) {
  let query = db().from('study_flashcard_sets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (materialId) query = query.eq('material_id', materialId);
  const { data: sets, error } = await query;
  assertDb(error);
  const { data: cards, error: cardsError } = await db()
    .from('study_flashcards').select('id,set_id,status,due_at').eq('user_id', userId);
  assertDb(cardsError);
  const now = Date.now();
  return (sets || []).map((set) => {
    const own = (cards || []).filter((card) => card.set_id === set.id);
    return {
      ...set,
      card_count: own.length,
      due_count: own.filter((card) => card.status === 'active' && Date.parse(card.due_at) <= now).length,
    };
  });
}

export async function getSet(userId, setId) {
  const { data: set, error } = await db().from('study_flashcard_sets').select('*')
    .eq('id', setId).eq('user_id', userId).maybeSingle();
  assertDb(error);
  if (!set) throw new AppError('FLASHCARD_NOT_FOUND', 'Conjunto não encontrado.', 404);
  const { data: cards, error: cardsError } = await db().from('study_flashcards').select(SET_CARD_FIELDS)
    .eq('user_id', userId).eq('set_id', setId).order('created_at', { ascending: true });
  assertDb(cardsError);
  return { ...set, cards: cards || [] };
}

/** Fronts already saved for the lesson (or one set): generation never proposes them again. */
export async function existingFronts(userId, materialId, setId) {
  let query = db().from('study_flashcards').select('front_text').eq('user_id', userId);
  query = setId ? query.eq('set_id', setId) : query.eq('material_id', materialId);
  const { data, error } = await query;
  if (error && ['42703'].includes(error.code)) return [];
  assertDb(error);
  return (data || []).map((row) => row.front_text).slice(0, 300);
}
