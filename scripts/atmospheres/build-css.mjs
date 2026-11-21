// Writes the atmosphere palettes (frontend/js/utils/atmospheres.js, the single source of truth)
// into the marked block of frontend/css/system.css, so they apply before first paint.
// Usage: node scripts/atmospheres/build-css.mjs [--check]
// --check exits 1 when the block is out of date (frontend/tests/atmospheres.test.mjs checks it too).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'frontend/css/system.css');
const { atmosphereCss, CSS_START, CSS_END } = await import(
  pathToFileURL(path.join(root, 'frontend/js/utils/atmospheres.js')).href
);

const css = readFileSync(file, 'utf8');
const begin = css.indexOf(CSS_START);
const end = css.indexOf(CSS_END);
if (begin < 0 || end < begin) {
  console.error('system.css: atmosphere markers not found');
  process.exit(1);
}
const next = `${css.slice(0, begin)}${CSS_START}\n${atmosphereCss()}\n${css.slice(end)}`;
if (process.argv.includes('--check')) {
  if (next !== css) {
    console.error('system.css: atmosphere block is out of date; run node scripts/atmospheres/build-css.mjs');
    process.exit(1);
  }
  console.log('atmospheres: up to date');
} else {
  writeFileSync(file, next);
  console.log('atmospheres: written');
}
