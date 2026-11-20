import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError, errors } from '../domain/errors.js';
import { getOwnedMaterial } from './material.repository.js';
import { isFeatureEnabled } from '../config/feature-flags.js';

const sessionFields = 'id,material_id,batch_id,feedback_mode,status,created_at,completed_at';
const answerFields = 'question_id,selected_index,answered_at';
function currentSessionFields() {
  return isFeatureEnabled('quiz_review')
    ? `${sessionFields},kind,source_session_id`
    : sessionFields;
}

function dbError(error) {
  if (!error) return;
  const messages = {
    QUIZ_SESSION_NOT_FOUND: [404, 'Tentativa não encontrada.'],
    QUIZ_SESSION_COMPLETE: [409, 'Esta tentativa já foi concluída.'],
    QUIZ_QUESTION_NOT_IN_SESSION: [404, 'Questão não pertence a esta tentativa.'],
    QUIZ_ALREADY_ANSWERED: [409, 'Esta questão já foi respondida com outra alternativa.'],
    QUIZ_INCOMPLETE: [409, 'Responda todas as questões antes de concluir.'],
    QUIZ_INVALID_SELECTION: [400, 'Selecione uma alternativa válida.'],
    QUIZ_INVALID_FEEDBACK_MODE: [400, 'Escolha uma forma válida de feedback.'],
    QUIZ_REVIEW_LOCKED: [409, 'Conclua a tentativa antes de revisar os erros.'],
    QUIZ_NOTHING_TO_REVIEW: [409, 'Esta tentativa não possui questões erradas para revisar.'],
  };
  if (Object.hasOwn(messages, error.message)) {
    const [status, message] = messages[error.message];
    throw new AppError(error.message, message, status);
  }
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code))
    throw new AppError('QUIZ_SCHEMA_REQUIRED', 'As sessões de questões ainda não estão habilitadas no banco.', 503);
  if (error.code === '23503') throw errors.notFound('Lote de questões');
  throw error;
}

export async function findOwnedBatch(userId, materialId, batchId) {
  await getOwnedMaterial(userId, materialId);
  const { data, error } = await getAdminSupabase()
    .from('question_batches').select('id,material_id,generated_count')
    .eq('id', batchId).eq('material_id', materialId).maybeSingle();
  dbError(error);
  if (!data) throw errors.notFound('Lote de questões');
  return data;
}

export async function createOwnedSession(userId, data) {
  const { data: session, error } = await getAdminSupabase().from('quiz_sessions')
    .insert({
      user_id: userId, material_id: data.materialId, batch_id: data.batchId,
      feedback_mode: data.feedbackMode,
    }).select(currentSessionFields()).single();
  dbError(error);
  return session;
}

export async function listOwnedSessions(userId) {
  const { data, error } = await getAdminSupabase().from('quiz_sessions')
    .select(currentSessionFields()).eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(50);
  dbError(error);
  return data || [];
}

export async function readOwnedSession(userId, sessionId) {
  const db = getAdminSupabase();
  const { data: session, error } = await db.from('quiz_sessions')
    .select(currentSessionFields()).eq('id', sessionId).eq('user_id', userId).maybeSingle();
  dbError(error);
  if (!session) throw errors.notFound('Tentativa');

  const [questionsResult, answersResult] = await Promise.all([
    db.from('questions').select('id,position,statement,options')
      .eq('batch_id', session.batch_id).order('position', { ascending: true }),
    db.from('quiz_session_answers').select(answerFields)
      .eq('session_id', sessionId).eq('user_id', userId),
  ]);
  dbError(questionsResult.error);
  dbError(answersResult.error);
  let questions = questionsResult.data || [];
  const rawAnswers = answersResult.data || [];

  // E12: a revisão seleciona somente referências aos erros da tentativa origem.
  // A tabela completa de questões e o respectivo gabarito nunca são enviados
  // para um cliente de revisão parcial.
  if (isFeatureEnabled('quiz_review') && session.kind === 'review') {
    const { data: items, error: itemsError } = await db.from('quiz_session_items')
      .select('question_id,position').eq('session_id', sessionId).eq('user_id', userId)
      .order('position', { ascending: true });
    dbError(itemsError);
    const byId = new Map(questions.map((question) => [question.id, question]));
    questions = (items || []).map((item) => byId.get(item.question_id)).filter(Boolean);
  }

  // The answer key is queried only for answered questions, and released
  // immediately only in immediate mode. Deferred mode unlocks after completion.
  const showFeedback = session.status === 'completed' || session.feedback_mode === 'immediate';
  let keys = new Map();
  if (showFeedback && rawAnswers.length) {
    const ids = rawAnswers.map((answer) => answer.question_id);
    const { data, error: keyError } = await db.from('questions')
      .select('id,correct_index,explanation').eq('batch_id', session.batch_id).in('id', ids);
    dbError(keyError);
    keys = new Map((data || []).map((entry) => [entry.id, entry]));
  }
  const answers = rawAnswers.map((answer) => {
    const entry = {
      questionId: answer.question_id, selectedIndex: answer.selected_index,
      answeredAt: answer.answered_at,
    };
    const key = keys.get(answer.question_id);
    if (showFeedback && key) {
      entry.correct = answer.selected_index === key.correct_index;
      entry.correctIndex = key.correct_index;
      entry.explanation = key.explanation || null;
    }
    return entry;
  });
  return {
    session, questions, answers,
    progress: { answered: answers.length, total: questions.length },
  };
}

export async function submitSessionAnswer(userId, sessionId, questionId, selectedIndex) {
  const { data, error } = await getAdminSupabase().rpc('quiz_submit_answer_admin', {
    p_user_id: userId, p_session_id: sessionId,
    p_question_id: questionId, p_selected_index: selectedIndex,
  });
  dbError(error);
  return data;
}

export async function finishOwnedSession(userId, sessionId) {
  const { data, error } = await getAdminSupabase().rpc('quiz_finish_session_admin', {
    p_user_id: userId, p_session_id: sessionId,
  });
  dbError(error);
  return data;
}

export async function createOwnedReviewSession(userId, sourceSessionId, feedbackMode) {
  const { data, error } = await getAdminSupabase().rpc('quiz_create_review_session_admin', {
    p_user_id: userId, p_source_session_id: sourceSessionId,
    p_feedback_mode: feedbackMode,
  });
  dbError(error);
  return { id: data };
}

/** True while the owner has an unfinished attempt with feedback only at the end on this list. */
export async function hasOpenDeferredAttempt(userId, batchId) {
  const { data, error } = await getAdminSupabase()
    .from('quiz_sessions').select('id')
    .eq('user_id', userId).eq('batch_id', batchId)
    .eq('feedback_mode', 'deferred').eq('status', 'active')
    .limit(1);
  dbError(error);
  return Boolean(data?.length);
}
