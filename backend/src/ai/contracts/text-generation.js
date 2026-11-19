/**
 * TextGenerationProvider contract. Adapters receive OpenAI-style chat messages and return
 * provider-neutral results; vendor payloads, auth and errors stay inside the adapter.
 *   completeText({ model, messages, temperature, maxTokens }) -> { text, model }
 *   completeJson({ model, messages, temperature, maxTokens }) -> { data, model }
 * `model` in the result is the model reported by the provider when available, otherwise the
 * requested one. Errors are AppError with codes LLM_TEMPORARY_ERROR (retryable), LLM_FAILED or
 * LLM_INVALID_OUTPUT (retryable, bounded by the caller).
 */
export function assertTextGenerationProvider(provider) {
  if (!provider?.name) throw new TypeError('Provedor de texto inválido.');
  for (const method of ['completeText', 'completeJson'])
    if (typeof provider[method] !== 'function')
      throw new TypeError(`Provedor ${provider.name} não implementa ${method}().`);
  return provider;
}
