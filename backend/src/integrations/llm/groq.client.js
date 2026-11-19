import Groq from 'groq-sdk';
import { AppError, errors } from '../../domain/errors.js';

function mapGroqError(error) {
  if (error instanceof AppError) return error;
  const status = Number(error?.status || error?.statusCode || 0);
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

/** Groq adapter for the TextGenerationProvider contract (see ai/contracts/text-generation.js). */
export function createGroqProvider({
  apiKey,
  mock = false,
  createClient = (key) => new Groq({ apiKey: key }),
}) {
  let client;
  function getClient() {
    if (!apiKey) throw errors.configuration(['GROQ_API_KEY']);
    if (!client) client = createClient(apiKey);
    return client;
  }
  async function complete({ model, messages, temperature, maxTokens, json }) {
    try {
      const completion = await getClient().chat.completions.create({
        model,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        stream: false,
      });
      return {
        content: completion.choices?.[0]?.message?.content,
        model: completion.model || model,
      };
    } catch (error) {
      throw mapGroqError(error);
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
