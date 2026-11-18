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
  assert.match(html, /data-library-folder-toolbar hidden/);
  assert.match(html, /\/css\/catalog\.css/);
  assert.match(css, /body\[data-page='history'\] \.library-subject-folder/);
  assert.match(page, /catalogEnabled = await isFeatureEnabled\('catalog_units'\)/);
  assert.match(page, /folderToolbar.hidden = !catalogEnabled/);
  assert.match(page, /initLibraryViewSwitcher/);
  assert.match(html, /data-library-view-switch hidden/);
  assert.match(html, /value="resources"/);
});

test('catalog uses a folder flow to create units and add lessons by search or drag and drop', () => {
  for (const selector of [
    'data-subject-form',
    'data-unit-form',
    'data-library-groups',
    'id="library-search"',
    'data-assign-form',
    'data-library-view-status role="status" aria-live="polite"',
  ]) {
    assert(html.includes(selector), selector);
  }
  assert.match(page, /function renderFolderGroups\(/);
  assert.match(page, /function openUnitDialog\(/);
  assert.match(page, /function openAssignDialog\(/);
  assert.match(page, /dataTransfer\?\.getData\('text\/plain'\)/);
});
