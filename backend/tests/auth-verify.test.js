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
