import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set([
  'node_modules',
  '.git',
  '.venv',
  '__pycache__',
  '.ruff_cache',
  'vendor',
  'dist',
  'build',
  'backups',
  'dumps',
  'evidence',
  'artifacts',
]);

export async function collectFormatFiles(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.env') || entry.isSymbolicLink()) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...(await collectFormatFiles(filename)));
    } else if (entry.isFile()) {
      const info = await prettier.getFileInfo(filename, {
        ignorePath: path.join(root, '.prettierignore'),
      });
      if (!info.ignored && info.inferredParser) files.push(filename);
    }
  }
  return files.sort();
}

export async function checkFormatFiles(files, baseline, baseDirectory = root) {
  const report = { checked: files.length, formatted: 0, legacyDebt: [], failures: [] };
  for (const filename of files) {
    const relative = path.relative(baseDirectory, filename).split(path.sep).join('/');
    const content = await readFile(filename, 'utf8');
    const config = await prettier.resolveConfig(filename);
    if (await prettier.check(content, { ...config, filepath: filename })) {
      report.formatted += 1;
      continue;
    }
    const hash = createHash('sha256').update(content).digest('hex');
    if (baseline.files[relative] === hash) report.legacyDebt.push(relative);
    else report.failures.push(relative);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = JSON.parse(
    await readFile(path.join(root, 'quality/format-baseline.json'), 'utf8'),
  );
  const report = await checkFormatFiles(await collectFormatFiles(), baseline);
  console.log(JSON.stringify({ ...report, issue: baseline.issue }));
  process.exitCode = report.failures.length ? 1 : 0;
}
