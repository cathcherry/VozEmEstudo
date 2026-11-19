/**
 * TranscriptionProvider contract.
 *
 * Synchronous providers implement `transcribe(buffer, { durationMs, settings })` and resolve a
 * normalized result. Asynchronous providers instead implement:
 *   submit(buffer, { settings, onUploaded }) -> { externalJobId, uploadRef }
 *   poll(externalJobId)                      -> { state: 'processing' } | { state: 'completed', result }
 *                                               | { state: 'failed', code, message }
 *   findSubmission(uploadRef)                -> externalJobId | null  (recovers ambiguous submits)
 * Every provider exposes `name`, `mode` ('sync' | 'async') and `capabilities`.
 *
 * Normalized result (milliseconds relative to the processed clip):
 *   { text, language, segments: [{ startMs, endMs, text, speaker }],
 *     words: [{ startMs, endMs, text, speaker, confidence }],   // [] when not supplied
 *     metadata: { provider, requestedModel, actualModel, externalJobId, capabilities } }
 */
const finite = (value) => Number.isFinite(Number(value));

export function assertTranscriptionProvider(provider) {
  if (!provider?.name || !['sync', 'async'].includes(provider.mode))
    throw new TypeError('Provedor de transcrição inválido.');
  const required = provider.mode === 'sync' ? ['transcribe'] : ['submit', 'poll', 'findSubmission'];
  for (const method of required)
    if (typeof provider[method] !== 'function')
      throw new TypeError(`Provedor ${provider.name} não implementa ${method}().`);
  return provider;
}

/** Validates the normalized shape; never fabricates timings for missing word data. */
export function assertTranscriptionResult(result) {
  if (!result || typeof result.text !== 'string') throw new TypeError('Transcrição sem texto.');
  if (!Array.isArray(result.segments) || !Array.isArray(result.words))
    throw new TypeError('Transcrição sem segmentos/palavras normalizados.');
  let previous = -1;
  for (const word of result.words) {
    if (!finite(word.startMs) || !finite(word.endMs) || word.endMs < word.startMs)
      throw new TypeError('Palavra com tempo inválido.');
    if (word.startMs < previous) throw new TypeError('Palavras fora de ordem.');
    previous = word.startMs;
  }
  for (const segment of result.segments)
    if (!finite(segment.startMs) || !finite(segment.endMs) || segment.endMs < segment.startMs)
      throw new TypeError('Segmento com tempo inválido.');
  if (!result.metadata?.provider) throw new TypeError('Transcrição sem metadados do provedor.');
  return result;
}
