export class AppError extends Error {
  constructor(code, message, status = 400, options = {}) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryable = Boolean(options.retryable);
    this.details = options.details;
  }
}

export const errors = {
  authRequired: () => new AppError('AUTH_REQUIRED', 'É necessário entrar na conta.', 401),
  forbidden: () => new AppError('FORBIDDEN', 'Você não tem acesso a este recurso.', 403),
  notFound: (resource = 'Recurso') => new AppError('NOT_FOUND', `${resource} não encontrado.`, 404),
  invalidAudioType: () => new AppError('INVALID_AUDIO_TYPE', 'Formato de áudio não aceito.', 400),
  audioTooLarge: () => new AppError('AUDIO_TOO_LARGE', 'O arquivo excede o limite de 100 MB.', 400),
  invalidQuestionCount: (max) =>
    new AppError(
      'INVALID_QUESTION_COUNT',
      max ? `Escolha de 1 a ${max} questões.` : 'Escolha 3, 5, 10 ou 20 questões.',
      400,
    ),
  configuration: (names) => new AppError('CONFIGURATION_ERROR', `Configuração ausente: ${names.join(', ')}.`, 503),
};
