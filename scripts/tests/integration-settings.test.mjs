import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRemoteSettings } from '../integration-check.mjs';

const fixture = {
  E01_REMOTE_READS_APPROVED: 'true',
  E01_STAGING_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa',
  E01_API_URL: 'https://staging.example.test',
  E01_PUBLISHABLE_KEY: 'sb_publishable_synthetic-fixture',
  E01_USER_A_TOKEN: 'synthetic-a',
  E01_USER_B_TOKEN: 'synthetic-b',
  E01_MATERIAL_A_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  E01_JOB_A_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

test('remote checks reject missing approval, existing project and administrative credentials before fetch', () => {
  for (const patch of [
    { E01_REMOTE_READS_APPROVED: '' },
    { E01_STAGING_PROJECT_REF: 'fxsuagrcfargpejglwtl' },
    { E01_PUBLISHABLE_KEY: 'sb_' + 'secret_fixture' },
    { E01_USER_B_TOKEN: 'synthetic-a' },
    { E01_API_URL: 'http://staging.example.test' },
  ])
    assert.throws(() => validateRemoteSettings({ ...fixture, ...patch }));
});

test('remote configuration accepts an explicit synthetic staging reference without contacting it', () => {
  assert.equal(
    validateRemoteSettings(fixture).supabaseUrl,
    'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
  );
});
