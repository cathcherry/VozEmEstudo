import test from 'node:test';
import assert from 'node:assert/strict';
import { applySettings, RELEASE_SETTINGS } from '../release/enable-3-4-features.mjs';
import { FEATURE_FLAG_NAMES } from '../../backend/src/config/feature-flags.js';
import { readinessFlagErrors } from '../../backend/src/diagnostics/readiness.js';

test('enables every implemented flag, keeps secrets untouched, and is idempotent', () => {
  const env = 'SUPABASE_SECRET_KEY=keep-me\nFEATURE_PLANNING=false\nGROQ_MODEL=llama-3.3-70b-versatile\n# comment\n';
  const once = applySettings(env);
  assert.match(once.text, /^SUPABASE_SECRET_KEY=keep-me$/m);
  assert.match(once.text, /^FEATURE_PLANNING=true$/m);
  assert.match(once.text, /^GROQ_MODEL=openai\/gpt-oss-120b$/m);
  assert.match(once.text, /^# comment$/m);
  assert.equal(applySettings(once.text).text, once.text, 'second run changes nothing');
  // 3.6 staging-only flags are deliberately absent: the 3.4 script never touches them, so they
  // stay at their default (false). Their migrations are not in the 3.4 release either.
  const STAGING_ONLY = ['journal'];
  for (const name of FEATURE_FLAG_NAMES.filter((n) => !STAGING_ONLY.includes(n)))
    assert.ok(`FEATURE_${name.toUpperCase()}` in RELEASE_SETTINGS, name);
  for (const name of STAGING_ONLY) assert.ok(!(`FEATURE_${name.toUpperCase()}` in RELEASE_SETTINGS), name);
});

test('the enabled flag set satisfies every readiness dependency', () => {
  const flags = Object.fromEntries(FEATURE_FLAG_NAMES.map((n) => [n, RELEASE_SETTINGS[`FEATURE_${n.toUpperCase()}`] === 'true']));
  assert.deepEqual(readinessFlagErrors(flags), []);
});
