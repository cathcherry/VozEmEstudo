/**
 * VisualAnalysisProvider contract (optional, disabled by default; no adapter is registered yet).
 *   analyzeFrames({ model, frames: [{ timestampMs, mimeType, bytes }] })
 *     -> { observations: [{ timestampMs, observedText, interpretation, uncertainty }], model }
 * Observations complement the spoken transcript and must never replace it. `timestampMs` is the
 * real timestamp of an extracted frame, not an estimate.
 */
export function assertVisualAnalysisProvider(provider) {
  if (!provider?.name || typeof provider.analyzeFrames !== 'function')
    throw new TypeError('Provedor de análise visual inválido.');
  return provider;
}
