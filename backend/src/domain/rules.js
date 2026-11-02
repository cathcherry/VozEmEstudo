import { AUDIO_EXTENSIONS, MAX_AUDIO_BYTES, QUESTION_COUNTS } from '../config/constants.js';
import { errors } from './errors.js';

export function assertQuestionCount(value) {
  const count = Number(value);
  if (!QUESTION_COUNTS.includes(count)) throw errors.invalidQuestionCount();
  return count;
}

export function assertAudioMetadata({ extension, sizeBytes }) {
  const ext = String(extension || '').toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(ext)) throw errors.invalidAudioType();
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_BYTES) throw errors.audioTooLarge();
  return { extension: ext, sizeBytes: size };
}

export function isDerivedOutputStale(sourceRevision, currentRevision) {
  return Number(sourceRevision) < Number(currentRevision);
}

export function sanitizeFilename(name = 'audio') {
  return String(name)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160) || 'audio';
}
