import { env } from '../config/env.js';
import { assertQuestionCount } from '../domain/rules.js';
import { createJsonCompletion } from '../integrations/llm/groq.client.js';
import { buildQuestionMessages, QUESTIONS_PROMPT_VERSION } from '../prompts/questions.v1.js';
import { validateQuestionsPayload } from '../validators/llm-output.validator.js';
import { createQuestionBatch, getQuestionForAnswer } from '../repositories/question.repository.js';

export async function generateQuestions(job, source, requestedCount) {
  const count = assertQuestionCount(requestedCount);
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      let raw = await createJsonCompletion({
        messages: buildQuestionMessages(source.full_text, count),
        maxTokens: Math.max(2500, count * 550),
      });
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
        model: env.groqModel,
        promptVersion: QUESTIONS_PROMPT_VERSION,
      });
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === 2) throw error;
    }
  }
  throw lastError;
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
