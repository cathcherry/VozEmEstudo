// Writes the original SVG art set into frontend/assets/art/.
// Usage: node scripts/art/build-art.mjs [--force]
// A file that no longer carries the generator marker (for example, a hand-drawn replacement)
// is never overwritten unless --force is given.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK } from './lib.mjs';
import { lumeFiles } from './lume.mjs';
import { stampFiles } from './stamps.mjs';
import { objectFiles } from './objects.mjs';
import { coverFiles } from './covers.mjs';
import { wallpaperFiles } from './wallpapers.mjs';
import { emptyFiles } from './empty.mjs';
import { iconFiles } from './icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(root, 'frontend/assets/art');
const force = process.argv.includes('--force');

const groups = [
  lumeFiles,
  stampFiles,
  objectFiles,
  coverFiles,
  wallpaperFiles,
  emptyFiles,
  iconFiles,
];
const files = Object.assign({}, ...groups.map((make) => make()));

let written = 0;
const kept = [];
for (const [relative, content] of Object.entries(files)) {
  const file = path.join(target, relative);
  const current = await readFile(file, 'utf8').catch(() => null);
  if (current !== null && !current.includes(MARK) && !force) {
    kept.push(relative);
    continue;
  }
  if (current === content) continue;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  written += 1;
}
console.log(JSON.stringify({ total: Object.keys(files).length, written, keptReplacements: kept }));
