import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_FLAG_NAMES, createFeatureFlags } from '../src/config/feature-flags.js';
import {
  FEATURE_FLAG_NAMES as browserNames,
  normalizeFeatureFlags,
} from '../../frontend/js/utils/feature-flags.js';

test('all future flags default OFF in server and browser, including an old config response', () => {
  const expected = Object.fromEntries(FEATURE_FLAG_NAMES.map((name) => [name, false]));
  assert.deepEqual(browserNames, FEATURE_FLAG_NAMES);
  assert.deepEqual(createFeatureFlags(), expected);
  assert.deepEqual(normalizeFeatureFlags(), expected);
  assert.deepEqual(normalizeFeatureFlags(null), expected);
  assert(Object.isFrozen(createFeatureFlags()));
  assert(Object.isFrozen(normalizeFeatureFlags()));
});

test('flags require explicit booleans and discard unknown or credential fields', () => {
  const flags = createFeatureFlags({
    FEATURE_PLANNING: 'true',
    FEATURE_SHARING: '1',
    SUPABASE_SECRET_KEY: 'synthetic',
  });
  assert.equal(flags.planning, true);
  assert.equal(flags.sharing, false);
  assert.equal(Object.keys(flags).length, 8);
  assert.deepEqual(
    normalizeFeatureFlags({ ...flags, sharing: 'true', secret: 'synthetic' }),
    flags,
  );
});
