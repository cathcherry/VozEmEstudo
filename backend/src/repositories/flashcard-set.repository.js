import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { V3_CARD_FIELDS, signMedia } from './flashcards-v3.repository.js';

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
    throw new AppError(
      'FLASHCARD_SETS_SCHEMA_REQUIRED',
      'Os conjuntos de flashcards ainda não foram habilitados no banco.',
      503,
    );
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
  rpc('study_update_flashcard_set_admin', {
    p_user_id: userId,
    p_set_id: setId,
    p_name: name,
    p_status: status,
  });
export const deleteSet = (userId, setId) =>
  rpc('study_delete_flashcard_set_admin', { p_user_id: userId, p_set_id: setId });
export const deleteCard = (userId, cardId) =>
  rpc('study_delete_flashcard_admin', { p_user_id: userId, p_card_id: cardId });

export async function listSets(userId, materialId) {
  let query = db()
    .from('study_flashcard_sets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (materialId) query = query.eq('material_id', materialId);
  const { data: sets, error } = await query;
  assertDb(error);
  // Counted per set: one query over all of the user's cards would be cut at PostgREST's row
  // limit (1000). A set holds at most 500 cards (database rule), so each query is complete.
  const now = Date.now();
  return Promise.all(
    (sets || []).map(async (set) => {
      const { data: cards, error: cardsError } = await db()
        .from('study_flashcards')
        .select('id,status,due_at')
        .eq('user_id', userId)
        .eq('set_id', set.id);
      assertDb(cardsError);
      const own = cards || [];
      return {
        ...set,
        card_count: own.length,
        due_count: own.filter((card) => card.status === 'active' && Date.parse(card.due_at) <= now)
          .length,
      };
    }),
  );
}

export async function getSet(userId, setId) {
  const { data: set, error } = await db()
    .from('study_flashcard_sets')
    .select('*')
    .eq('id', setId)
    .eq('user_id', userId)
    .maybeSingle();
  assertDb(error);
  if (!set) throw new AppError('FLASHCARD_NOT_FOUND', 'Conjunto não encontrado.', 404);
  // Flashcards 3.0 adds the note type, origin and imported images (signed for one hour).
  const v3 = isFeatureEnabled('flashcards_v3');
  const { data: cards, error: cardsError } = await db()
    .from('study_flashcards')
    .select(v3 ? V3_CARD_FIELDS : SET_CARD_FIELDS)
    .eq('user_id', userId)
    .eq('set_id', setId)
    .order('created_at', { ascending: true });
  assertDb(cardsError);
  if (!v3) return { ...set, cards: cards || [] };
  const urls = await signMedia([...new Set((cards || []).flatMap((c) => (c.media || []).map((m) => m.path)))]);
  return {
    ...set,
    cards: (cards || []).map((card) => ({
      ...card,
      media: (card.media || []).map((m) => ({ name: m.name, mime: m.mime, url: urls.get(m.path) || null })),
    })),
  };
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
