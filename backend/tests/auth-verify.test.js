import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokenVerifier, userFromClaims } from '../src/integrations/supabase/auth-client.js';

const fakeClient = (auth) => () => ({ auth });
const claims = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  email: 'aluno@example.test',
  user_metadata: { display_name: 'Aluna' },
  app_metadata: { provider: 'email' },
};

test('server mode keeps asking Auth for the user (getUser) and never reads claims', async () => {
  let calls = 0;
  const verify = buildTokenVerifier({
    mode: 'server',
    client: fakeClient({
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      getClaims: async () => {
        calls += 1;
        return { data: null, error: null };
      },
    }),
  });
  assert.deepEqual(await verify('t'), { id: 'u1' });
  assert.equal(calls, 0);
});

test('jwks mode builds req.user from verified claims (id, metadata used by classrooms)', async () => {
  const verify = buildTokenVerifier({
    mode: 'jwks',
    client: fakeClient({ getClaims: async () => ({ data: { claims }, error: null }) }),
  });
  const user = await verify('t');
  assert.equal(user.id, claims.sub);
  assert.equal(user.user_metadata.display_name, 'Aluna');
});

test('jwks mode refuses invalid signatures, anonymous-role tokens and tokens without sub', async () => {
  const cases = [
    { data: null, error: new Error('invalid JWT signature') },
    { data: { claims: { ...claims, role: 'service_role' } }, error: null },
    { data: { claims: { ...claims, sub: undefined } }, error: null },
    { data: { claims: { ...claims, role: 'anon' } }, error: null },
  ];
  for (const answer of cases) {
    const verify = buildTokenVerifier({ mode: 'jwks', client: fakeClient({ getClaims: async () => answer }) });
    await assert.rejects(verify('t'), (error) => error.code === 'AUTH_REQUIRED');
  }
});

test('userFromClaims never trusts a missing or non-user role', () => {
  assert.equal(userFromClaims(null), null);
  assert.equal(userFromClaims({ sub: 'x', role: 'service_role' }), null);
});

test('server mode refuses anonymous sign-ins and unconfirmed e-mail accounts', async () => {
  const verifyWith = (user) =>
    buildTokenVerifier({
      mode: 'server',
      client: fakeClient({ getUser: async () => ({ data: { user }, error: null }) }),
    })('t');
  const base = { id: 'u1', app_metadata: { provider: 'email' } };
  await assert.rejects(verifyWith({ ...base, email_confirmed_at: null }), (e) => e.code === 'AUTH_REQUIRED');
  await assert.rejects(
    verifyWith({ id: 'u2', is_anonymous: true, app_metadata: { provider: 'anonymous' } }),
    (e) => e.code === 'AUTH_REQUIRED',
  );
  assert.equal((await verifyWith({ ...base, email_confirmed_at: '2026-11-01T00:00:00Z' })).id, 'u1');
  // OAuth accounts are confirmed by the provider.
  assert.equal((await verifyWith({ id: 'u3', app_metadata: { provider: 'google' } })).id, 'u3');
});

test('jwks mode refuses anonymous tokens and does not require the (absent) confirmation claim', async () => {
  const verifyWith = (extra) =>
    buildTokenVerifier({
      mode: 'jwks',
      client: fakeClient({
        getClaims: async () => ({ data: { claims: { ...claims, ...extra } }, error: null }),
      }),
    })('t');
  await assert.rejects(verifyWith({ is_anonymous: true }), (e) => e.code === 'AUTH_REQUIRED');
  assert.equal((await verifyWith({})).id, claims.sub);
});
