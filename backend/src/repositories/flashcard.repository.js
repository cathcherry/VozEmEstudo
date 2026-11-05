import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError, errors } from '../domain/errors.js';

const cardFields = 'id,material_id,front_text,back_text,status,due_at,interval_days,repetitions,ease_factor,last_reviewed_at,created_at,updated_at';
const historyFields = 'id,card_id,rating,interval_days,repetitions,ease_factor,due_at,reviewed_at';
const PAGE_LIMIT = 100;

function assertDb(error) {
  if (!error) return;
  const mapped = {
    FLASHCARD_NOT_FOUND: [404, 'Cartão não encontrado.'],
    FLASHCARD_ARCHIVED: [409, 'Este cartão está arquivado.'],
    FLASHCARD_REQUEST_CONFLICT: [409, 'Este envio de revisão já foi usado em outra avaliação.'],
    FLASHCARD_INVALID_REVIEW: [400, 'Avaliação de revisão inválida.'],
  };
  const match = mapped[error.message];
  if (match) throw new AppError(error.message, match[1], match[0]);
  if (['42P01', '42703', '42883', 'PGRST202'].includes(error.code))
    throw new AppError('FLASHCARDS_SCHEMA_REQUIRED',
      'Os flashcards ainda não foram habilitados no banco.', 503);
  if (error.code === '23503') throw errors.notFound('Aula relacionada');
  if (error.code === '23505')
    throw new AppError('FLASHCARD_CONFLICT', 'Este registro já existe.', 409);
  throw error;
}

export function buildFlashcardListQuery(db, userId, filter, options = {}, now = new Date()) {
  const { offset = 0, materialId, status = 'all' } = options;
  let query = db.from('study_flashcards')
    .select(cardFields, { count: 'exact' })
    .eq('user_id', userId)
    .range(offset, offset + PAGE_LIMIT - 1);
  if (materialId) query = query.eq('material_id', materialId);
  if (filter === 'due') {
    query = query.eq('status', 'active').lte('due_at', now.toISOString())
      .order('due_at', { ascending: true }).order('id', { ascending: true });
  } else {
    if (status !== 'all') query = query.eq('status', status);
    query = query.order('created_at', { ascending: false })
      .order('id', { ascending: true });
  }
  return query;
}

export async function listOwnedFlashcards(userId, filter, options = {}) {
  const query = buildFlashcardListQuery(getAdminSupabase(), userId, filter, options);
  const { data, count, error } = await query;
  assertDb(error);
  return { cards: data || [], total: count || 0, limit: PAGE_LIMIT, offset: options.offset || 0 };
}

export async function assertOwnedMaterial(userId, materialId) {
  const { data, error } = await getAdminSupabase().from('materials')
    .select('id').eq('id', materialId).eq('user_id', userId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Aula relacionada');
  return data;
}

export async function createOwnedFlashcard(userId, item) {
  const { data, error } = await getAdminSupabase()
    .from('study_flashcards')
    .insert({ ...item, user_id: userId })
    .select(cardFields).single();
  assertDb(error);
  return data;
}

export async function updateOwnedFlashcard(userId, cardId, patch) {
  const { data, error } = await getAdminSupabase().from('study_flashcards')
    .update(patch).eq('id', cardId).eq('user_id', userId)
    .select(cardFields).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Cartão');
  return data;
}

export async function getOwnedFlashcard(userId, cardId) {
  const { data, error } = await getAdminSupabase().from('study_flashcards')
    .select('id').eq('id', cardId).eq('user_id', userId).maybeSingle();
  assertDb(error);
  if (!data) throw errors.notFound('Cartão');
  return data;
}

export async function listOwnedFlashcardReviews(userId, cardId) {
  const { data, error } = await getAdminSupabase().from('study_flashcard_reviews')
    .select(historyFields).eq('user_id', userId).eq('card_id', cardId)
    .order('reviewed_at', { ascending: false }).limit(50);
  assertDb(error);
  return data || [];
}

export async function reviewOwnedFlashcard(userId, cardId, rating, requestId) {
  const { data, error } = await getAdminSupabase().rpc('study_review_flashcard_admin', {
    p_user_id: userId, p_card_id: cardId, p_rating: rating,
    p_request_id: requestId,
  });
  assertDb(error);
  return data;
}

