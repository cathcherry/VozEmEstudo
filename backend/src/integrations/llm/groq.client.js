import Groq from 'groq-sdk';
import { env } from '../../config/env.js';
import { AppError, errors } from '../../domain/errors.js';

let client;

function getClient() {
  if (!env.groqApiKey) throw errors.configuration(['GROQ_API_KEY']);
  if (!client) client = new Groq({ apiKey: env.groqApiKey });
  return client;
}

function mapGroqError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const retryable = status === 429 || status >= 500 || status === 408 || status === 0;
  return new AppError(
    retryable ? 'LLM_TEMPORARY_ERROR' : 'LLM_FAILED',
    retryable ? 'O serviço de geração textual está temporariamente indisponível.' : 'Não foi possível gerar o material textual.',
    502,
    { retryable, cause: error },
  );
}

export async function createTextCompletion({ messages, temperature = 0.2, maxTokens = 1800 }) {
  if (env.mockExternalServices) {
    return 'Resumo de demonstração. Ative as credenciais reais para gerar conteúdo com o modelo.';
  }
  try {
    const completion = await getClient().chat.completions.create({
      model: env.groqModel,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      stream: false,
    });
    return completion.choices?.[0]?.message?.content?.trim() || '';
  } catch (error) {
    throw mapGroqError(error);
  }
}

export async function createJsonCompletion({ messages, temperature = 0.15, maxTokens = 5000 }) {
  if (env.mockExternalServices) {
    return {
      questions: [
        { statement: 'Questão de demonstração?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Demonstração.' },
      ],
    };
  }
  try {
    const completion = await getClient().chat.completions.create({
      model: env.groqModel,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false,
    });
    const content = completion.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError('LLM_INVALID_OUTPUT', 'O modelo retornou uma estrutura inválida.', 502, { retryable: true, cause: error });
    }
    throw mapGroqError(error);
  }
}
