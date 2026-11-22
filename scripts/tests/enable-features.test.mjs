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
  for (const name of FEATURE_FLAG_NAMES) assert.ok(`FEATURE_${name.toUpperCase()}` in RELEASE_SETTINGS, name);
});

test('the enabled flag set satisfies every readiness dependency', () => {
  const flags = Object.fromEntries(FEATURE_FLAG_NAMES.map((n) => [n, RELEASE_SETTINGS[`FEATURE_${n.toUpperCase()}`] === 'true']));
  assert.deepEqual(readinessFlagErrors(flags), []);
});
