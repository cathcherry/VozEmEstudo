import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXISTING_PROJECT_REF = 'fxsuagrcfargpejglwtl';
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validateStagingSettings(source) {
  for (const name of [
    'E02_STAGING_WRITES_APPROVED',
    'E02_SYNTHETIC_ONLY',
    'E02_MOCK_PROVIDERS_CONFIRMED',
  ])
    assert.equal(source[name], 'true', `Required approval: ${name}`);
  const projectRef = source.E02_STAGING_PROJECT_REF;
  assert.match(projectRef || '', /^[a-z0-9]{20}$/);
  assert.notEqual(projectRef, EXISTING_PROJECT_REF, 'Existing environment is excluded');
  const api = new URL(source.E02_API_URL);
  assert.equal(api.protocol, 'http:');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(api.hostname));
  assert.equal(api.pathname, '/');
  assert.equal(api.username + api.password + api.search + api.hash, '');
  const publicKey = source.E02_PUBLISHABLE_KEY || '';
  let anonymousJwt = false;
  try {
    const claims = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString());
    anonymousJwt = publicKey.startsWith('eyJ') && claims.role === 'anon';
    if (anonymousJwt && claims.ref) assert.equal(claims.ref, projectRef);
  } catch {
    assert(publicKey.startsWith('sb_publishable_'), 'Use a public project key');
  }
  assert(publicKey.startsWith('sb_publishable_') || anonymousJwt);
  for (const name of ['E02_USER_A_EMAIL', 'E02_USER_B_EMAIL'])
    assert.match(source[name] || '', /^[a-z0-9.+_-]+@example\.test$/i);
  assert.notEqual(source.E02_USER_A_EMAIL, source.E02_USER_B_EMAIL);
  for (const name of ['E02_USER_A_PASSWORD', 'E02_USER_B_PASSWORD'])
    assert((source[name] || '').length >= 12, `Missing private test password: ${name}`);
  const fixtureFile = path.resolve(source.E02_FIXTURE_FILE || '');
  assert(source.E02_FIXTURE_FILE && path.isAbsolute(source.E02_FIXTURE_FILE));
  const relative = path.relative(PROJECT_ROOT, fixtureFile);
  assert(relative.startsWith('..' + path.sep), 'Store the private fixture outside the project');
  return {
    apiUrl: api.origin,
    projectRef,
    supabaseUrl: `https://${projectRef}.supabase.co`,
    publicKey,
    fixtureFile,
    accounts: ['A', 'B'].map((label) => ({
      label,
      email: source[`E02_USER_${label}_EMAIL`],
      password: source[`E02_USER_${label}_PASSWORD`],
    })),
  };
}

export function validateStagingConfig(settings, config) {
  assert.equal(config.supabaseUrl, settings.supabaseUrl, 'API must use the approved staging');
  assert.equal(config.supabasePublishableKey, settings.publicKey);
  assert.equal(config.audioBucket, 'audios');
  assert(config.permissionDeclaration?.version && config.permissionDeclaration?.text);
  assert.deepEqual(
    Object.keys(config.featureFlags).sort(),
    [
      'catalog_units',
      'planning',
      'mp4_retention',
      'study_tracking',
      'quiz_v2',
      'flashcards',
      'social_basic',
      'sharing',
    ].sort(),
  );
  assert(Object.values(config.featureFlags).every((value) => value === false));
}

export function syntheticWave() {
  const sampleRate = 16000;
  const dataSize = sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Silence is deliberate: remote speech/LLM providers must remain mocked.
  return buffer;
}
