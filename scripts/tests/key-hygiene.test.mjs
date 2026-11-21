import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Everything under frontend/ is served to browsers as is (no build step): nothing in it may name,
// read or embed a privileged Supabase credential. The vendored SDK is excluded (it only mentions
// the role names in its own documentation strings).
const root = new URL('../../frontend/', import.meta.url);
const served = readdirSync(root, { recursive: true })
  .filter((file) => /\.(js|mjs|html|css|json)$/.test(file))
  .filter((file) => !/^(node_modules|tests)\//.test(file) && !file.startsWith('js/vendor/'));

test('no served frontend file references a privileged Supabase key', () => {
  assert.ok(served.length > 50, 'scanned the served files');
  const forbidden = [/SUPABASE_SECRET_KEY/, /supabaseSecretKey/, /sb_secret_[A-Za-z0-9_-]{8,}/, /service_role/];
  const hits = [];
  for (const file of served) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const pattern of forbidden) if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
  }
  assert.deepEqual(hits, []);
});

test('the browser client is created only from the public config (publishable key)', () => {
  const client = readFileSync(new URL('js/api/supabase-browser.js', root), 'utf8');
  assert.match(client, /createClient\(config\.supabaseUrl, config\.supabasePublishableKey/);
  const creators = served.filter((file) => /createClient\(/.test(readFileSync(new URL(file, root), 'utf8')));
  assert.deepEqual(creators, ['js/api/supabase-browser.js'], 'a single browser Supabase client');
});
