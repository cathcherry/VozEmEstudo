import { rpc } from './rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { errors } from '../domain/errors.js';

export const createQuestionBatch = (
  materialId,
  { jobId, requestedCount, questions, model, promptVersion },
) =>
  rpc('commit_question_batch_admin', {
    p_material_id: materialId,
    p_job_id: jobId,
    p_count: requestedCount,
    p_questions: questions,
    p_model: model,
    p_prompt_version: promptVersion,
  });

export async function listBatches(materialId, { includeAnswers = false } = {}) {
  const db = getAdminSupabase();
  const questionColumns = includeAnswers ? '*' : 'id,position,statement,options,created_at';
  const { data, error } = await db
    .from('question_batches')
    .select(`*,questions(${questionColumns})`)
    .eq('material_id', materialId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((batch) => ({
    ...batch,
    questions: (batch.questions || []).sort((a, b) => a.position - b.position),
  }));
}

export async function getQuestionForAnswer(userId, questionId) {
  const db = getAdminSupabase();
  const { data: question, error } = await db
    .from('questions')
    .select('id,statement,options,correct_index,explanation,batch_id')
    .eq('id', questionId)
    .maybeSingle();
  if (error) throw error;
  if (!question) throw errors.notFound('Questão');

  const { data: batch, error: batchError } = await db
    .from('question_batches')
    .select('material_id')
    .eq('id', question.batch_id)
    .single();
  if (batchError) throw batchError;

  const { data: material, error: materialError } = await db
    .from('materials')
    .select('id')
    .eq('id', batch.material_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (materialError) throw materialError;
  if (!material) throw errors.notFound('Questão');
  return question;
}
