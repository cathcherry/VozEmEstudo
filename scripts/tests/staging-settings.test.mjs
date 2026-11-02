import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EXISTING_PROJECT_REF,
  syntheticWave,
  validateStagingSettings,
  validateStagingConfig,
} from '../staging-settings.mjs';
import { runStagingChecks } from '../staging-academic-check.mjs';

function fakeSettings() {
  return {
    E02_STAGING_WRITES_APPROVED: 'true',
    E02_SYNTHETIC_ONLY: 'true',
    E02_MOCK_PROVIDERS_CONFIRMED: 'true',
    E02_STAGING_PROJECT_REF: 'abcdefghijklmnopqrst',
    E02_API_URL: 'http://127.0.0.1:3000',
    E02_PUBLISHABLE_KEY: 'sb_publishable_fixture_only',
    E02_USER_A_EMAIL: 'e02-a@example.test',
    E02_USER_B_EMAIL: 'e02-b@example.test',
    E02_USER_A_PASSWORD: 'synthetic-password-a',
    E02_USER_B_PASSWORD: 'synthetic-password-b',
    E02_FIXTURE_FILE: path.join(tmpdir(), `e02-private-fixture-${randomUUID()}.json`),
  };
}

test('new remote suite rejects absent approvals before fetch', async () => {
  let calls = 0;
  await assert.rejects(
    runStagingChecks({}, () => {
      calls++;
    }),
  );
  assert.equal(calls, 0);
});

test('staging target excludes the existing project, remote API and administrative key', () => {
  const valid = fakeSettings();
  assert.equal(validateStagingSettings(valid).projectRef, valid.E02_STAGING_PROJECT_REF);
  for (const patch of [
    { E02_STAGING_PROJECT_REF: EXISTING_PROJECT_REF },
    { E02_API_URL: 'https://example.org' },
    { E02_API_URL: 'http://localhost:3000/?redirect=1' },
    { E02_API_URL: 'http://user:password@localhost:3000/' },
    { E02_PUBLISHABLE_KEY: 'sb_secret_fixture_not_a_key' },
    { E02_USER_A_EMAIL: valid.E02_USER_B_EMAIL },
    { E02_USER_A_EMAIL: 'real-person@example.org' },
    { E02_SYNTHETIC_ONLY: 'false' },
    { E02_STAGING_WRITES_APPROVED: 'false' },
    { E02_FIXTURE_FILE: path.resolve('fixture-private.json') },
  ])
    assert.throws(() => validateStagingSettings({ ...valid, ...patch }));
});

test('actual API configuration must match the approved isolated project and flags', async () => {
  const source = fakeSettings();
  const settings = validateStagingSettings(source);
  const config = {
    supabaseUrl: settings.supabaseUrl,
    supabasePublishableKey: settings.publicKey,
    audioBucket: 'audios',
    permissionDeclaration: { version: 'fake-version', text: 'Fake declaration' },
    featureFlags: Object.fromEntries(
      [
        'catalog_units',
        'planning',
        'mp4_retention',
        'study_tracking',
        'quiz_v2',
        'flashcards',
        'social_basic',
        'sharing',
      ].map((name) => [name, false]),
    ),
  };
  validateStagingConfig(settings, config);
  assert.throws(() =>
    validateStagingConfig(settings, {
      ...config,
      supabaseUrl: `https://${EXISTING_PROJECT_REF}.supabase.co`,
    }),
  );
  assert.throws(() =>
    validateStagingConfig(settings, { ...config, featureFlags: { catalog_units: true } }),
  );
  let calls = 0;
  await assert.rejects(
    runStagingChecks(source, async () => {
      calls++;
      return new Response(JSON.stringify({ ...config, supabaseUrl: 'https://other.supabase.co' }));
    }),
  );
  assert.equal(calls, 1, 'Target mismatch prevents login and fixture writes');
});

test('synthetic audio contains valid mono PCM header and no recorded speech', () => {
  const buffer = syntheticWave();
  assert.equal(buffer.subarray(0, 4).toString(), 'RIFF');
  assert.equal(buffer.readUInt16LE(22), 1);
  assert.equal(buffer.readUInt32LE(24), 16000);
  assert.equal(buffer.length, 32044);
  assert(buffer.subarray(44).every((value) => value === 0));
});
