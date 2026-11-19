import { AppError } from '../domain/errors.js';
import { recordingLanguageOptions } from '../ai/provider-config.js';

/** Optional; must be one of the options the active ASR provider can honour. */
export function validateRecordingLanguage(value, config) {
  if (value === undefined || value === null || value === '') return null;
  const { options } = recordingLanguageOptions(config);
  if (typeof value !== 'string' || !options.includes(value))
    throw new AppError(
      'INVALID_RECORDING_LANGUAGE',
      options.length
        ? 'Escolha um idioma da gravação da lista.'
        : 'O serviço de transcrição configurado não permite escolher o idioma.',
      400,
    );
  return value;
}
