import { AppError, errors } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';
import { normalizeTranscription } from '../../ai/normalization/transcription.js';

const CAPABILITIES = Object.freeze({ wordTimestamps: true, speakerLabels: true, async: true });

function providerError(status, retryAfter) {
  const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  const auth = status === 401 || status === 403;
  return new AppError(
    retryable ? 'ASR_TEMPORARY_ERROR' : auth ? 'ASR_AUTH_FAILED' : 'ASR_FAILED',
    retryable
      ? 'O serviço de transcrição está temporariamente indisponível.'
      : auth
        ? 'A credencial do serviço de transcrição foi recusada. Confira a configuração do servidor.'
        : 'O serviço de transcrição recusou o pedido.',
    502,
    { retryable, details: { status, retryAfterSeconds: Number(retryAfter) || null } },
  );
}

/**
 * Builds the request options. Automatic detection and a fixed language are mutually exclusive, so
 * only one of them is sent. Disfluencies and repetitions are left as spoken (no cleanup here).
 */
export function transcriptRequest(uploadRef, { model, settings = {} }) {
  const body = {
    audio_url: uploadRef,
    speech_models: [model],
    punctuate: true,
    format_text: true,
  };
  if (settings.languageDetection) {
    body.language_detection = true;
    if (settings.expectedLanguages?.length)
      body.language_detection_options = { expected_languages: settings.expectedLanguages };
  } else body.language_code = settings.languageCode || 'pt';
  if (settings.speakerLabels) body.speaker_labels = true;
  return body;
}

export function normalizeAssemblyAiTranscript(body, { requestedModel, durationMs = 0 }) {
  const words = (body.words || []).map((word) => ({
    startMs: word.start,
    endMs: word.end,
    text: word.text,
    speaker: word.speaker ?? null,
    confidence: word.confidence ?? null,
  }));
  return normalizeTranscription({
    text: body.text,
    language: body.language_code || null,
    words,
    utterances: (body.utterances || []).map((u) => ({
      startMs: u.start,
      endMs: u.end,
      text: u.text,
      speaker: u.speaker ?? null,
    })),
    durationMs,
    metadata: {
      provider: 'assemblyai',
      requestedModel,
      actualModel: body.speech_model_used || body.speech_model || null,
      externalJobId: body.id || null,
      capabilities: CAPABILITIES,
    },
  });
}

/** AssemblyAI pre-recorded transcription adapter (asynchronous TranscriptionProvider). */
export function createAssemblyAiProvider({
  apiKey,
  baseUrl = 'https://api.assemblyai.com',
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 60000,
  uploadTimeoutMs = 300000,
  mock = false,
}) {
  async function call(path, { method = 'GET', body, headers = {}, timeout = timeoutMs } = {}) {
    if (!apiKey) throw errors.configuration(['ASSEMBLYAI_API_KEY']);
    let response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method,
        body,
        headers: { authorization: apiKey, ...headers },
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      // Network failure or timeout: the request may or may not have reached the provider.
      logger.error('ASR_PROVIDER_UNREACHABLE', {
        provider: 'assemblyai',
        path: path.split('/').slice(0, 3).join('/'),
      });
      throw providerError(0);
    }
    if (!response.ok) {
      // Provider bodies may echo request details; only the status is logged.
      logger.error('ASR_PROVIDER_HTTP_ERROR', { provider: 'assemblyai', status: response.status });
      throw providerError(response.status, response.headers.get('retry-after'));
    }
    return response.json();
  }
  if (mock) return createMockProvider();
  return {
    name: 'assemblyai',
    mode: 'async',
    capabilities: CAPABILITIES,
    async upload(buffer) {
      if (!buffer?.length)
        throw new AppError('ASR_EMPTY_AUDIO', 'O áudio enviado está vazio.', 400);
      const body = await call('/v2/upload', {
        method: 'POST',
        body: buffer,
        headers: { 'content-type': 'application/octet-stream' },
        timeout: uploadTimeoutMs,
      });
      if (!body.upload_url) throw providerError(502);
      return body.upload_url;
    },
    async submit(uploadRef, options) {
      const body = await call('/v2/transcript', {
        method: 'POST',
        body: JSON.stringify(transcriptRequest(uploadRef, options)),
        headers: { 'content-type': 'application/json' },
      });
      if (!body.id) throw providerError(502);
      return body.id;
    },
    async findSubmission(uploadRef) {
      // Recent transcripts list their audio_url; the upload URL is unique to our upload.
      const body = await call('/v2/transcript?limit=100');
      return (body.transcripts || []).find((item) => item.audio_url === uploadRef)?.id || null;
    },
    async poll(externalJobId, { model, durationMs } = {}) {
      const body = await call('/v2/transcript/' + encodeURIComponent(externalJobId));
      if (body.status === 'queued' || body.status === 'processing') return { state: 'processing' };
      if (body.status === 'error') {
        logger.error('ASR_PROVIDER_FAILED', { provider: 'assemblyai', externalJobId });
        return { state: 'failed', code: 'ASR_PROVIDER_ERROR' };
      }
      if (body.status !== 'completed') throw providerError(502);
      return {
        state: 'completed',
        result: normalizeAssemblyAiTranscript(body, { requestedModel: model, durationMs }),
      };
    },
  };
}

/** Offline stand-in for MOCK_EXTERNAL_SERVICES: exercises the async path without network calls. */
function createMockProvider() {
  const words = 'Transcrição de demonstração para desenvolvimento local.'
    .split(' ')
    .map((text, i) => ({ start: i * 450, end: i * 450 + 400, text, confidence: 1 }));
  return {
    name: 'assemblyai',
    mode: 'async',
    capabilities: CAPABILITIES,
    upload: async () => 'mock://upload',
    submit: async () => 'mock-transcript',
    findSubmission: async () => null,
    poll: async (id, { model, durationMs } = {}) => ({
      state: 'completed',
      result: normalizeAssemblyAiTranscript(
        { id, status: 'completed', language_code: 'pt', words },
        { requestedModel: model, durationMs },
      ),
    }),
  };
}
