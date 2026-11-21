import { readFileSync } from 'node:fs';
import { Client, handle_file } from '@gradio/client';
import { env } from '../../config/env.js';
import { AppError } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';

let appPromise;
async function getApp() {
  if (!appPromise) {
    appPromise = Client.connect(env.hfAsrSpaceId, env.hfToken ? { token: env.hfToken } : undefined)
      .catch((error) => { appPromise = undefined; throw error; });
  }
  return appPromise;
}

function normalizeSegment(segment, index, durationMs) {
  const timestamps = segment?.timestamp || segment?.timestamps;
  const start = segment?.startMs ?? (Array.isArray(timestamps) ? Number(timestamps[0]) * 1000 : Number(segment?.start) * 1000);
  const end = segment?.endMs ?? (Array.isArray(timestamps) ? Number(timestamps[1]) * 1000 : Number(segment?.end) * 1000);
  const startMs = Math.max(0, Math.round(Number(start) || 0));
  return {
    position: index,
    startMs,
    endMs: Math.max(startMs, Math.round(Number(end) || durationMs || startMs)),
    text: String(segment?.text || '').trim(),
  };
}

function parseResult(result, durationMs) {
  let raw = result?.data ?? result;
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try { raw = JSON.parse(trimmed); } catch { /* a plain transcript can start with a brace */ }
    }
  }
  if (raw && typeof raw === 'object') {
    if (raw.value && typeof raw.value === 'object') raw = raw.value;
    const segments = (Array.isArray(raw.segments) ? raw.segments : Array.isArray(raw.chunks) ? raw.chunks : [])
      .map((item, i) => normalizeSegment(item, i, durationMs)).filter((item) => item.text);
    const text = String(raw.text || raw.transcription || segments.map((s) => s.text).join(' ')).trim();
    return { text, language: String(raw.language || 'pt'), segments: segments.length ? segments : text ? [{ position: 0, startMs: 0, endMs: durationMs, text }] : [] };
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  return { text, language: 'pt', segments: text ? [{ position: 0, startMs: 0, endMs: durationMs, text }] : [] };
}

function listEndpoints(api) {
  const endpoints = api?.named_endpoints || api?.namedEndpoints || {};
  return Object.entries(endpoints).map(([name, spec]) => ({ name, spec }));
}

function selectEndpoint(api) {
  const available = listEndpoints(api);
  const configured = env.hfAsrApiName.startsWith('/') ? env.hfAsrApiName : `/${env.hfAsrApiName}`;
  return available.find((e) => e.name === configured)
    || available.find((e) => /transcri|predict|run|infer/i.test(e.name))
    || available[0]
    || { name: configured, spec: null };
}

function buildPayload(spec, file) {
  const params = spec?.parameters;
  if (!Array.isArray(params) || !params.length) {
    return { [env.hfAsrAudioField]: file, [env.hfAsrTaskField]: env.hfAsrTaskValue };
  }
  const payload = {};
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i];
    const name = param?.parameter_name || param?.name || param?.label || `param_${i}`;
    const hint = `${name} ${param?.component || ''} ${param?.type?.type || ''}`.toLowerCase();
    if (/audio|file|input|sound|wav/.test(hint) || (i === 0 && !/task|language/.test(hint))) payload[name] = file;
    else if (/task/.test(hint)) payload[name] = env.hfAsrTaskValue;
    else if (param?.parameter_default !== undefined) payload[name] = param.parameter_default;
    else if (param?.default !== undefined) payload[name] = param.default;
    else payload[name] = null;
  }
  return payload;
}

/**
 * Simulated transcript (MOCK_EXTERNAL_SERVICES). MOCK_ASR_SEGMENTS_FILE may point to a JSON array of
 * strings, spread evenly over the audio, so demos and staging runs get realistic multi-segment text.
 */
export function mockTranscript(durationMs = 0, file = env.mockAsrSegmentsFile) {
  const total = durationMs || 5000;
  let texts = ['Transcrição de demonstração para desenvolvimento local.'];
  if (file) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length || parsed.some((t) => typeof t !== 'string' || !t.trim())) {
      throw new AppError('ASR_MOCK_SEGMENTS_INVALID', 'MOCK_ASR_SEGMENTS_FILE precisa ser uma lista JSON de textos.', 500, { retryable: false });
    }
    texts = parsed.map((t) => t.trim());
  }
  const step = Math.floor(total / texts.length);
  const segments = texts.map((text, position) => ({
    position,
    startMs: position * step,
    endMs: position === texts.length - 1 ? total : (position + 1) * step,
    text,
  }));
  return { text: texts.join(' '), language: 'pt', segments };
}

export async function transcribeAudio(buffer, { durationMs = 0 } = {}) {
  if (env.mockExternalServices) return mockTranscript(durationMs);
  if (!buffer?.length) throw new AppError('ASR_EMPTY_AUDIO', 'O áudio enviado está vazio.', 400, { retryable: false });
  try {
    const app = await getApp();
    let api;
    try { api = await app.view_api(); }
    catch (error) { logger.info('ASR_API_DISCOVERY_FAILED', { message: String(error?.message || error).slice(0, 180) }); }
    const endpoint = selectEndpoint(api);
    const audio = handle_file(new Blob([buffer], { type: 'audio/wav' }));
    const payload = buildPayload(endpoint.spec, audio);
    logger.info('ASR_REQUEST', { space: env.hfAsrSpaceId, endpoint: endpoint.name, payloadFields: Object.keys(payload), audioBytes: buffer.length });
    const result = await app.predict(endpoint.name, payload);
    const parsed = parseResult(result, durationMs);
    if (!parsed.text) throw new AppError('ASR_EMPTY_RESULT', 'O modelo retornou uma transcrição vazia. Confira o áudio e o endpoint.', 502, { retryable: false });
    return parsed;
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
    const detail = String(error?.cause?.message || error?.message || error).slice(0, 400);
    logger.error('ASR_REQUEST_FAILED', { space: env.hfAsrSpaceId, endpoint: env.hfAsrApiName, status, detail });
    if (error instanceof AppError) throw error;
    const retryable = status === 429 || status >= 500 || status === 408 || status === 0;
    throw new AppError(retryable ? 'ASR_TEMPORARY_ERROR' : 'ASR_FAILED',
      retryable ? 'O serviço de transcrição está temporariamente indisponível. Consulte o terminal para o motivo.' : 'A API de transcrição recusou o pedido. Consulte o terminal para o motivo.',
      502, { retryable, cause: error });
  }
}

/** Legacy Hugging Face/Whisper adapter for the TranscriptionProvider contract (synchronous). */
export function createHuggingFaceProvider({ transcribe = transcribeAudio } = {}) {
  const capabilities = Object.freeze({ wordTimestamps: false, speakerLabels: false, async: false });
  return {
    name: 'huggingface',
    mode: 'sync',
    capabilities,
    async transcribe(buffer, { durationMs = 0, model = env.hfAsrSpaceId } = {}) {
      const result = await transcribe(buffer, { durationMs });
      return {
        text: result.text,
        language: result.language || null,
        segments: result.segments.map(({ startMs, endMs, text }) => ({
          startMs,
          endMs,
          text,
          speaker: null,
        })),
        // Whisper via Gradio supplies no word timings; none are invented.
        words: [],
        metadata: {
          provider: 'huggingface',
          requestedModel: model,
          actualModel: env.hfAsrSpaceId,
          externalJobId: null,
          capabilities,
        },
      };
    },
  };
}
