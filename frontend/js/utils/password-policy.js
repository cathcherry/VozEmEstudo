/**
 * Password rules shown and checked before an account is created or a password is changed.
 * They mirror the project's Supabase Auth settings (minimum 8; lowercase, uppercase, digits and
 * symbols), which remain the real enforcement; this only explains the rules up front.
 * The leaked-password check is the free counterpart of Supabase's Pro-only option.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RULES = Object.freeze([
  { id: 'length', label: `Pelo menos ${MIN_PASSWORD_LENGTH} caracteres`, test: (value) => value.length >= MIN_PASSWORD_LENGTH },
  { id: 'lower', label: 'Uma letra minúscula', test: (value) => /[a-z]/.test(value) },
  { id: 'upper', label: 'Uma letra maiúscula', test: (value) => /[A-Z]/.test(value) },
  { id: 'digit', label: 'Um número', test: (value) => /[0-9]/.test(value) },
  { id: 'symbol', label: 'Um símbolo (ex.: ! @ # ?)', test: (value) => /[^A-Za-z0-9\s]/.test(value) },
]);

/** Labels of the rules the password does not meet yet. */
export function missingPasswordRules(value = '') {
  return PASSWORD_RULES.filter((rule) => !rule.test(String(value))).map((rule) => rule.label);
}

export const LEAKED_PASSWORD_MESSAGE =
  'Esta senha já apareceu em vazamentos de dados de outros sites e pode ser adivinhada. Escolha outra senha.';

async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Checks Have I Been Pwned with k-anonymity: only the first 5 characters of the password's
 * SHA-1 hash leave the browser; the password itself is never sent. Returns true (found in
 * leaks), false (not found) or null (service unreachable: the check is skipped, not blocking).
 */
export async function isPasswordLeaked(password, { fetchImpl = (...args) => fetch(...args), timeoutMs = 5000 } = {}) {
  try {
    const hash = await sha1Hex(String(password));
    const prefix = hash.slice(0, 5),
      suffix = hash.slice(5);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return null;
    for (const line of (await response.text()).split(/\r?\n/)) {
      const [candidate, count] = line.trim().split(':');
      // Padding rows have a count of 0 and never mean a real match.
      if (candidate === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * Live checklist under a password field: each rule turns "ok" as it is met. Announced through
 * aria-describedby, not a live region, so screen readers are not interrupted on every key.
 */
export function attachPasswordRules(input) {
  if (!input) return null;
  const list = document.createElement('ul');
  list.className = 'password-rules';
  list.id = `${input.id}-rules`;
  const items = PASSWORD_RULES.map((rule) => {
    const item = document.createElement('li');
    item.dataset.rule = rule.id;
    item.textContent = rule.label;
    list.append(item);
    return { rule, item };
  });
  const update = () => {
    for (const { rule, item } of items) item.dataset.ok = String(rule.test(input.value));
  };
  input.addEventListener('input', update);
  update();
  (input.closest('label') || input).after(list);
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), list.id].filter(Boolean).join(' '));
  return list;
}

/**
 * Full check before submitting: rules first (instant), then the leak lookup.
 * Returns an error message in Portuguese, or null when the password can be used.
 */
export async function passwordProblem(password, options) {
  const missing = missingPasswordRules(password);
  if (missing.length) return `A senha precisa ter: ${missing.map((label) => label.toLocaleLowerCase('pt-BR')).join(', ')}.`;
  if ((await isPasswordLeaked(password, options)) === true) return LEAKED_PASSWORD_MESSAGE;
  return null;
}

/** Supabase's own weak-password error, in Portuguese. */
export function translatePasswordError(error) {
  if (error?.code === 'weak_password' || /password should|weak password|pwned|leaked/i.test(error?.message || ''))
    return 'A senha não atende aos requisitos de segurança: use pelo menos 8 caracteres com letra minúscula, maiúscula, número e símbolo.';
  return null;
}
