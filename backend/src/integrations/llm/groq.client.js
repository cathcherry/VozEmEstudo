import Groq from 'groq-sdk';
import { AppError, errors } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';

/** Groq's reasoning models: their hidden reasoning spends the completion-token budget. */
export const isReasoningModel = (model) => /^openai\/gpt-oss/.test(String(model || ''));

function mapGroqError(error) {
  if (error instanceof AppError) return error;
  const status = Number(error?.status || error?.statusCode || 0);
  // JSON mode: the model produced no valid JSON (often cut by the token limit). The callers
  // already repair or skip invalid output, so it is reported as such (retryable once).
  if (status === 400 && groqErrorCode(error) === 'json_validate_failed') {
    return new AppError('LLM_INVALID_OUTPUT', 'O modelo retornou uma estrutura inválida.', 502, {
      retryable: true,
      cause: error,
    });
  }
  const retryable = status === 429 || status >= 500 || status === 408 || status === 0;
  return new AppError(
    retryable ? 'LLM_TEMPORARY_ERROR' : 'LLM_FAILED',
    retryable
      ? 'O serviço de geração textual está temporariamente indisponível.'
      : 'Não foi possível gerar o material textual.',
    502,
    { retryable, cause: error },
  );
}

function groqErrorCode(error) {
  return error?.error?.error?.code || error?.error?.code || error?.code || null;
}

/** Groq adapter for the TextGenerationProvider contract (see ai/contracts/text-generation.js). */
export function createGroqProvider({
  apiKey,
  mock = false,
  createClient = (key) => new Groq({ apiKey: key }),
  log = logger,
  reasoningEffort = 'low',
}) {
  let client;
  function getClient() {
    if (!apiKey) throw errors.configuration(['GROQ_API_KEY']);
    if (!client) client = createClient(apiKey);
    return client;
  }
  async function complete({ model, messages, temperature, maxTokens, json }) {
    const startedAt = Date.now();
    try {
      const completion = await getClient().chat.completions.create({
        model,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...(isReasoningModel(model) && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        stream: false,
      });
      // Operational record of every paid call: tokens and latency (no prompt or output text).
      const usage = completion.usage || {};
      log.info('LLM_USAGE', {
        provider: 'groq',
        model: completion.model || model,
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        latencyMs: Date.now() - startedAt,
        finishReason: completion.choices?.[0]?.finish_reason || null,
      });
      return {
        content: completion.choices?.[0]?.message?.content,
        model: completion.model || model,
      };
    } catch (error) {
      const mapped = mapGroqError(error);
      log.info('LLM_CALL_FAILED', {
        provider: 'groq',
        model,
        status: Number(error?.status || error?.statusCode || 0) || null,
        providerCode: groqErrorCode(error),
        code: mapped.code,
        latencyMs: Date.now() - startedAt,
      });
      throw mapped;
    }
  }
  return {
    name: 'groq',
    async completeText({ model, messages, temperature = 0.2, maxTokens = 1800 }) {
      if (mock)
        return {
          text: 'Resumo de demonstração. Ative as credenciais reais para gerar conteúdo com o modelo.',
          model,
        };
      const result = await complete({ model, messages, temperature, maxTokens });
      return { text: result.content?.trim() || '', model: result.model };
    },
    async completeJson({ model, messages, temperature = 0.15, maxTokens = 5000 }) {
      if (mock)
        return {
          data: {
            questions: [
              {
                statement: 'Questão de demonstração?',
                options: ['A', 'B', 'C', 'D'],
                correctIndex: 0,
                explanation: 'Demonstração.',
              },
            ],
          },
          model,
        };
      const result = await complete({ model, messages, temperature, maxTokens, json: true });
      return { data: parseJsonContent(result.content), model: result.model };
    },
  };
}

export function parseJsonContent(content) {
  try {
    return JSON.parse(content || '{}');
  } catch (error) {
    throw new AppError('LLM_INVALID_OUTPUT', 'O modelo retornou uma estrutura inválida.', 502, {
      retryable: true,
      cause: error,
    });
  }
}
