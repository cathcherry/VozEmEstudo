import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAKED_PASSWORD_MESSAGE,
  isPasswordLeaked,
  missingPasswordRules,
  passwordProblem,
  translatePasswordError,
} from '../js/utils/password-policy.js';

// SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function pwned(lines, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(lines.join('\r\n'), { status: 200 });
  };
}

test('rules mirror the Supabase setting: 8+, lowercase, uppercase, digit, symbol', () => {
  assert.deepEqual(missingPasswordRules('Abcdef1!'), []);
  assert.deepEqual(missingPasswordRules('abc'), [
    'Pelo menos 8 caracteres',
    'Uma letra maiúscula',
    'Um número',
    'Um símbolo (ex.: ! @ # ?)',
  ]);
  assert.deepEqual(missingPasswordRules('ABCDEFG1!'), ['Uma letra minúscula']);
  assert.deepEqual(missingPasswordRules('Senha forte 9 '), ['Um símbolo (ex.: ! @ # ?)'], 'spaces are not symbols');
});

test('leak check sends only the 5-character hash prefix, with padding', async () => {
  const calls = [];
  const leaked = await isPasswordLeaked('password', {
    fetchImpl: pwned([`0018A45C4D1DEF81644B54AB7F969B88D65:0`, `${SUFFIX}:9659365`], calls),
  });
  assert.equal(leaked, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.pwnedpasswords.com/range/${PREFIX}`);
  assert.equal(calls[0].init.headers['Add-Padding'], 'true');
  assert.equal(calls[0].init.credentials, 'omit');
  // Nothing but the 5-character prefix is in the request path (no password, no full hash).
  assert.equal(new URL(calls[0].url).pathname, `/range/${PREFIX}`);
  assert.equal(new URL(calls[0].url).search, '');
});

test('padding rows (count 0) and other suffixes are not matches', async () => {
  assert.equal(await isPasswordLeaked('password', { fetchImpl: pwned([`${SUFFIX}:0`]) }), false);
  assert.equal(await isPasswordLeaked('password', { fetchImpl: pwned(['ABCDEF:12']) }), false);
});

test('an unreachable service never blocks the user', async () => {
  const offline = async () => {
    throw new TypeError('NetworkError when attempting to fetch resource.');
  };
  assert.equal(await isPasswordLeaked('password', { fetchImpl: offline }), null);
  const failing = async () => new Response('', { status: 503 });
  assert.equal(await isPasswordLeaked('password', { fetchImpl: failing }), null);
  assert.equal(await passwordProblem('Vegetação#2026', { fetchImpl: offline }), null);
});

test('problems: rules first (no network), then leaks', async () => {
  let fetched = false;
  const spy = async () => {
    fetched = true;
    return new Response('');
  };
  assert.match(await passwordProblem('curta', { fetchImpl: spy }), /^A senha precisa ter: pelo menos 8 caracteres/);
  assert.equal(fetched, false, 'a weak password is rejected before any lookup');
  // "P@ssw0rd" meets every rule but is leaked.
  const leakedStrong = async (url) => {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode('P@ssw0rd'));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    assert(url.endsWith(hash.slice(0, 5)));
    return new Response(`${hash.slice(5)}:123`);
  };
  assert.equal(await passwordProblem('P@ssw0rd', { fetchImpl: leakedStrong }), LEAKED_PASSWORD_MESSAGE);
});

test('Supabase weak-password errors are shown in Portuguese', () => {
  assert.match(
    translatePasswordError({ code: 'weak_password', message: 'Password should contain at least one character of each: ...' }),
    /requisitos de segurança/,
  );
  assert.equal(translatePasswordError({ message: 'Invalid login credentials' }), null);
});
