import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// A policy on storage.objects whose expression reads storage.objects makes Postgres fail every
// insert with "infinite recursion detected in policy" (42P17). That broke all audio uploads in
// production on 24/11/2026. Counting must go through a SECURITY DEFINER function instead.
const dir = new URL('../../database/migrations/', import.meta.url);
const latest = new Map();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(new URL(file, dir), 'utf8');
  for (const m of sql.matchAll(/create\s+policy\s+(\w+)\s+on\s+storage\.objects([\s\S]*?)(?:\$p\$|;)/gi))
    latest.set(m[1], { file, body: m[2] });
}

test('no storage.objects policy reads storage.objects directly', () => {
  assert(latest.size > 0, 'found storage policies');
  for (const [name, { file, body }] of latest)
    assert.doesNotMatch(body, /\bfrom\s+storage\.objects\b/i, `${name} (${file}) recurses on storage.objects`);
});

test('the audio object cap counts through the definer function', () => {
  const fix = readFileSync(new URL('20261125120000_audio_object_cap_fix.sql', dir), 'utf8');
  assert.match(fix, /security definer/i);
  assert.match(fix, /set search_path = ''/);
  assert.match(fix, /private\.audio_object_count_for_current_user\(\) < 40/);
  assert.match(fix, /revoke all on function private\.audio_object_count_for_current_user\(\) from public, anon/);
});
