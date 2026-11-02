function write(level, event, fields = {}) {
  const payload = {
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  // Não inclua áudio, transcrição integral, JWTs, senhas ou API keys nos campos.
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload));
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
