import { AppError, errors } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';
import { parseJsonContent } from './groq.client.js';

function gatewayError(status) {
  const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  return new AppError(
    retryable ? 'LLM_TEMPORARY_ERROR' : 'LLM_FAILED',
    retryable
      ? 'O serviço de geração textual está temporariamente indisponível.'
      : 'Não foi possível gerar o material textual.',
    502,
    { retryable, details: { status } },
  );
}

/**
 * AssemblyAI LLM Gateway adapter (OpenAI-compatible chat completions) for the
 * TextGenerationProvider contract. JSON mode is requested only when configured; callers always
 * validate the parsed output locally, whatever the vendor.
 */
export function createAssemblyAiGatewayProvider({
  apiKey,
  baseUrl = 'https://llm-gateway.assemblyai.com/v1',
  jsonMode = 'json_object',
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 120000,
}) {
  async function complete({ model, messages, temperature, maxTokens, json }) {
    if (!apiKey) throw errors.configuration(['ASSEMBLYAI_API_KEY']);
    let response;
    try {
      response = await fetchImpl(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(json && jsonMode === 'json_object'
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw gatewayError(0);
    }
    if (!response.ok) {
      logger.error('LLM_PROVIDER_HTTP_ERROR', {
        provider: 'assemblyai-gateway',
        status: response.status,
      });
      throw gatewayError(response.status);
    }
    const body = await response.json();
    return { content: body.choices?.[0]?.message?.content, model: body.model || model };
  }
  return {
    name: 'assemblyai-gateway',
    async completeText({ model, messages, temperature = 0.2, maxTokens = 1800 }) {
      const result = await complete({ model, messages, temperature, maxTokens });
      return { text: result.content?.trim() || '', model: result.model };
    },
    async completeJson({ model, messages, temperature = 0.15, maxTokens = 5000 }) {
      const result = await complete({ model, messages, temperature, maxTokens, json: true });
      // Some models wrap JSON in a Markdown fence even in JSON mode.
      const content = String(result.content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      return { data: parseJsonContent(content), model: result.model };
    },
  };
}
