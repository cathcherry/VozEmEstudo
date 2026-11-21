import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FEATURE_FLAG_NAMES } from '../../backend/src/config/feature-flags.js';

const example = readFileSync(new URL('../../backend/.env.example', import.meta.url), 'utf8');
const declared = new Set([...example.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));

test('.env.example lists every feature flag, off by default', () => {
  for (const name of FEATURE_FLAG_NAMES) {
    const key = `FEATURE_${name.toUpperCase()}`;
    assert.match(example, new RegExp(`^${key}=false$`, 'm'), `${key}=false missing`);
  }
});

test('.env.example documents every process.env variable the backend reads directly', () => {
  const dir = new URL('../../backend/src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js'));
  const used = new Set();
  for (const file of files) {
    for (const m of readFileSync(new URL(file, dir), 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(missing, []);
});
