import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'pages/historico.html'), 'utf8');
const css = readFileSync(resolve(root, 'css/catalog.css'), 'utf8');
const page = readFileSync(resolve(root, 'js/pages/history.page.js'), 'utf8');

test('catalog remains hidden and scoped until the feature flag is enabled', () => {
  assert.match(html, /data-catalog-panel hidden/);
  assert.match(html, /\/css\/catalog\.css/);
  assert.match(css, /body\[data-page='history'\] \.catalog-workspace/);
  assert.match(page, /initCatalogPanel/);
});

test('catalog panel has accessible forms for subjects, units, and material assignments', () => {
  for (const selector of [
    'data-catalog-subject-form',
    'data-catalog-unit-form',
    'data-catalog-assignment-form',
    'data-catalog-assign-material',
    'data-catalog-assign-subject',
    'data-catalog-assign-unit',
    'data-catalog-status role="status" aria-live="polite"',
  ]) {
    assert(html.includes(selector), selector);
  }
});
