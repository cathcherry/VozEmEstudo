import { env } from '../config/env.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { buildQuestionMessages, QUESTIONS_PROMPT_VERSION } from '../prompts/questions.v1.js';
import { QUESTIONS_V2_PROMPT_VERSION } from '../prompts/questions.v2.js';
import { validateQuestionsPayload } from '../validators/llm-output.validator.js';
import { validateQuestionConfig } from '../validators/question-config.validator.js';
import {
  createQuestionBatch,
  createQuestionList,
  getQuestionForAnswer,
  listBatches,
} from '../repositories/question.repository.js';
import { buildQuestionGenerator, mockQuestionCompletion } from './question-generation.service.js';
import { assertQuestionCount } from '../domain/rules.js';

/** Jobs with a list config (study authoring) use the planned pipeline; others keep the E02 path. */
export async function generateQuestions(job, source, requestedCount) {
  if (job.params?.config) return generateQuestionList(job, source, requestedCount);
  return generateLegacyBatch(job, source, requestedCount);
}

async function generateLegacyBatch(job, source, requestedCount) {
  const count = assertQuestionCount(requestedCount);
  const llm = getAiRegistry().text('questions', job.aiSnapshot || undefined);
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await llm.completeJson({
        messages: buildQuestionMessages(source.full_text, count),
        maxTokens: Math.max(2500, count * 550),
      });
      let raw = completion.data;
      const model = completion.model;
      if (env.mockExternalServices) {
        raw = {
          questions: Array.from({ length: count }, (_, i) => ({
            statement: `Questão de demonstração ${i + 1}?`,
            options: ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'],
            correctIndex: 0,
            explanation: 'Conteúdo de demonstração.',
          })),
        };
      }
      const questions = validateQuestionsPayload(raw, count);
      return createQuestionBatch(job.material_id, {
        jobId: job.id,
        requestedCount: count,
        questions,
        model,
        promptVersion: QUESTIONS_PROMPT_VERSION,
      });
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === 2) throw error;
    }
  }
  throw lastError;
}

/** Earlier questions of the same material, used to avoid repeats and to find untested concepts. */
async function previousQuestions(materialId) {
  const batches = await listBatches(materialId, { includeAnswers: true });
  return batches.flatMap((batch) =>
    (batch.questions || []).map((question) => ({
      statement: question.statement,
      options: question.options,
      correctIndex: question.correct_index,
      concept: question.metadata?.concept || null,
      facet: question.metadata?.facet || null,
      skill: question.metadata?.skill || null,
    })),
  );
}

async function generateQuestionList(job, source, requestedCount) {
  const count = Number(requestedCount);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Quantidade inválida.');
  const config = validateQuestionConfig(job.params.config);
  const llm = getAiRegistry().text('questions', job.aiSnapshot || undefined);
  let model = env.mockExternalServices ? 'mock' : llm.model;
  const generate = buildQuestionGenerator({
    complete: env.mockExternalServices
      ? mockQuestionCompletion
      : async ({ messages, maxTokens }) => {
          const completion = await llm.completeJson({ messages, maxTokens });
          model = completion.model || model;
          return completion.data;
        },
  });
  const result = await generate({
    source,
    count,
    config,
    previous: await previousQuestions(job.material_id),
  });
  const { title, ...generationConfig } = config;
  return createQuestionList(job.material_id, {
    jobId: job.id,
    requestedCount: count,
    questions: result.questions,
    model,
    promptVersion: QUESTIONS_V2_PROMPT_VERSION,
    title,
    config: generationConfig,
    coverage: result.coverage,
    provider: env.mockExternalServices ? 'mock' : llm.provider,
  });
}

export async function answerQuestion(userId, questionId, selectedIndex) {
  const question = await getQuestionForAnswer(userId, questionId);
  const selected = Number(selectedIndex);
  return {
    correct: selected === question.correct_index,
    correctIndex: question.correct_index,
    explanation: question.explanation || null,
  };
}
