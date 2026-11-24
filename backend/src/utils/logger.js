// Field names whose values never reach the log (tokens, keys, passwords, contact data, content).
// `token$` spares usage counters such as promptTokens/totalTokens.
const SENSITIVE_KEY =
  /authorization|cookie|token$|secret|password|passwd|api[_-]?key|apikey|jwt|signed_?url|email|e-mail|transcript|full_?text|note_?text|statement/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/** A copy of `value` safe to log: sensitive fields replaced, long strings cut, depth bounded. */
export function redact(value, depth = 0) {
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[${value.length}]` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, code: value.code };
  const result = {};
  for (const [key, item] of Object.entries(value))
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1);
  return result;
}

function write(level, event, fields = {}) {
  const payload = {
    time: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  };
  // Não inclua áudio, transcrição integral, JWTs, senhas ou API keys nos campos (redact é a rede
  // de segurança, não a regra).
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload));
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
