import { getSession } from './auth.api.js';
export const MEDIA_EXTENSIONS = ['mp4', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mov'];
export function mediaExtension(file) { return file.name.split('.').pop().toLowerCase(); }
async function requestMedia(path, file, params = {}, signal) {
  const session = await getSession();
  if (!session) throw new Error('Entre novamente para preparar a mídia.');
  const query = new URLSearchParams({ extension: mediaExtension(file), ...params });
  const response = await fetch(`/api/media/${path}?${query}`, { method: 'POST', body: file, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/octet-stream' }, signal });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message || 'Não foi possível preparar a mídia.'); }
  return response;
}
export async function inspectMedia(file, signal) { return (await requestMedia('inspect', file, {}, signal)).json(); }
export async function convertMedia(file, range, output = 'wav', signal) {
  const response = await requestMedia('convert', file, { start: String(range.start), end: String(range.end), output }, signal);
  const blob = await response.blob();
  const name = `${file.name.replace(/\.[^.]+$/, '').slice(0, 130)}-trecho.${output}`;
  return { file: new File([blob], name, { type: blob.type }), durationMs: Number(response.headers.get('X-Media-Duration-Ms')) || Math.round((range.end - range.start) * 1000) };
}
