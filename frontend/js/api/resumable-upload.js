/**
 * Resumable uploads to Supabase Storage (TUS protocol, /storage/v1/upload/resumable).
 * The file goes in 6 MB chunks; when the connection drops, the upload asks the server how
 * much it already holds and continues from there instead of starting over.
 */
import { getPublicConfig } from './config.js';
import { getSupabase } from './supabase-browser.js';

// Supabase requires exactly 6 MB for every chunk except the last.
export const CHUNK_SIZE = 6 * 1024 * 1024;
export const RETRY_DELAYS_MS = Object.freeze([1000, 3000, 5000, 10000, 20000]);
export const NETWORK_MESSAGE =
  'A conexão caiu durante o envio e não voltou a tempo. Verifique a internet e tente novamente; nada foi perdido.';

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function uploadMetadata(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key} ${toBase64(String(value))}`)
    .join(',');
}

function storageError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = String(statusCode);
  return error;
}

async function readMessage(response, fallback) {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    return body.message || body.error || fallback;
  } catch {
    return text.trim().slice(0, 200) || fallback;
  }
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), {
      once: true,
    });
  });

// 5xx, 423 (locked by an interrupted request) and 409 (offset mismatch) are worth retrying.
const retryable = (status) => status >= 500 || status === 423 || status === 409 || status === 429;

/**
 * Uploads `file` to `bucket/objectName`. Resolves when the server holds every byte.
 * Errors carry `statusCode` like supabase-js storage errors (409 = object already exists).
 * Network failures that outlast the retries reject with `code = 'UPLOAD_NETWORK'`.
 */
export async function resumableUpload({
  endpoint,
  headers,
  bucket,
  objectName,
  file,
  contentType,
  cacheControl = '3600',
  onProgress,
  signal,
  fetchImpl = (...args) => fetch(...args),
  delays = RETRY_DELAYS_MS,
}) {
  const base = { ...headers, 'Tus-Resumable': '1.0.0' };
  let failures = 0;
  const recover = async (cause) => {
    if (signal?.aborted) throw signal.reason;
    if (failures >= delays.length) {
      if (cause?.statusCode) throw cause;
      const error = new Error(NETWORK_MESSAGE);
      error.code = 'UPLOAD_NETWORK';
      error.cause = cause;
      throw error;
    }
    await wait(delays[failures++], signal);
  };
  const send = async (url, init) => {
    try {
      return await fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      return null; // network failure: the caller retries
    }
  };

  // 1. Create the upload. A 409 means the object already exists (never overwritten).
  let location;
  for (;;) {
    const response = await send(endpoint, {
      method: 'POST',
      headers: {
        ...base,
        'Upload-Length': String(file.size),
        'Upload-Metadata': uploadMetadata({
          bucketName: bucket,
          objectName,
          contentType,
          cacheControl,
        }),
        'x-upsert': 'false',
      },
    });
    if (response?.ok && response.headers.get('Location')) {
      location = new URL(response.headers.get('Location'), endpoint).href;
      break;
    }
    if ((response && !retryable(response.status)) || response?.status === 409) {
      throw storageError(
        await readMessage(response, 'Não foi possível iniciar o envio.'),
        response.status,
      );
    }
    await recover(response && storageError('O armazenamento não respondeu.', response.status));
  }

  // 2. Send chunks; after any failure, ask the server for its offset and resume there.
  let offset = 0;
  let confirmed = true;
  onProgress?.(0);
  while (offset < file.size || !confirmed) {
    if (!confirmed) {
      const head = await send(location, { method: 'HEAD', headers: base });
      if (head?.status === 404 || head?.status === 410)
        throw storageError('O envio expirou. Tente novamente.', head.status);
      const known = Number(head?.headers.get('Upload-Offset'));
      if (!head?.ok || !Number.isFinite(known)) {
        await recover(head && storageError('O armazenamento não respondeu.', head.status));
        continue;
      }
      offset = known;
      confirmed = true;
      onProgress?.(offset / file.size);
      if (offset >= file.size) break;
    }
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const response = await send(location, {
      method: 'PATCH',
      headers: {
        ...base,
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: chunk,
    });
    const next = Number(response?.headers.get('Upload-Offset'));
    if (response?.ok && Number.isFinite(next) && next > offset) {
      offset = next;
      failures = 0;
      onProgress?.(offset / file.size);
      continue;
    }
    if (response && !response.ok && !retryable(response.status)) {
      throw storageError(
        await readMessage(response, 'O armazenamento recusou o arquivo.'),
        response.status,
      );
    }
    confirmed = false;
    await recover(response && storageError('O armazenamento não respondeu.', response.status));
  }
  onProgress?.(1);
}

/** Uploads through the session's Supabase project with the signed-in user's token. */
export async function uploadToStorage({ bucket, path, file, contentType, onProgress, signal }) {
  const [config, supabase] = await Promise.all([getPublicConfig(), getSupabase()]);
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sessão inválida. Entre novamente.');
  try {
    await resumableUpload({
      endpoint: new URL('/storage/v1/upload/resumable', config.supabaseUrl).href,
      headers: { authorization: `Bearer ${token}`, apikey: config.supabasePublishableKey },
      bucket,
      objectName: path,
      file,
      contentType,
      onProgress,
      signal,
    });
    return { error: null };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { error };
  }
}
