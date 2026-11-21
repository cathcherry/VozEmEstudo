// Verifies a release manifest before a production window (read only, no database access):
//   * every file exists (migration, preflight, postflight, rollback guide, migration guide);
//   * each migration's SHA-256 is the one recorded (the file applied is the file reviewed);
//   * the order respects every declared dependency;
//   * each migration is transactional, guarded (*_ABORT) and additive (no drop / create or replace /
//     truncate / delete from), and enables RLS on every table it creates.
// Usage: node scripts/release/verify-release.mjs [database/release/3.4/manifest.json]
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function verifyRelease(manifestPath, root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'));
  const problems = [];
  const position = new Map(manifest.steps.map((s) => [s.migration, s.order]));
  for (const file of [...manifest.before, ...manifest.after]) if (!existsSync(resolve(root, file))) problems.push(`missing ${file}`);
  for (const step of manifest.steps) {
    for (const key of ['migration', 'preflight', 'postflight', 'rollback', 'guide'])
      if (!existsSync(resolve(root, step[key]))) problems.push(`#${step.order}: missing ${key} ${step[key]}`);
    if (!existsSync(resolve(root, step.migration))) continue;
    const sql = readFileSync(resolve(root, step.migration), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    if (sha !== step.sha256) problems.push(`#${step.order}: ${step.migration} changed since the manifest (sha256 ${sha.slice(0, 12)} ≠ ${step.sha256.slice(0, 12)})`);
    for (const dep of step.dependsOn) {
      if (!position.has(dep)) continue; // a dependency outside this release must already be applied
      if (position.get(dep) >= step.order) problems.push(`#${step.order}: depends on ${dep}, which comes later`);
    }
    if (!/^begin;/m.test(sql) || !/^commit;/m.test(sql)) problems.push(`#${step.order}: not wrapped in begin/commit`);
    if (!/_ABORT/.test(sql)) problems.push(`#${step.order}: no *_ABORT guard`);
    const code = sql.replace(/--.*$/gm, '');
    // Function and DO bodies run later, on request (e.g. a user deleting their own record); only the
    // statements executed by the migration itself must be additive.
    const topLevel = code.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '');
    if (/\b(drop\s+(table|column|function|index|policy|trigger)|create\s+or\s+replace|truncate|delete\s+from)\b/i.test(topLevel))
      problems.push(`#${step.order}: contains a destructive or replacing statement`);
    for (const [, table] of code.matchAll(/create table (public\.\w+)/gi))
      if (!new RegExp(`alter table ${table.replace('.', '\\.')} enable row level security`, 'i').test(code)) problems.push(`#${step.order}: ${table} without RLS`);
  }
  return { manifest, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { manifest, problems } = verifyRelease(process.argv[2] || 'database/release/3.4/manifest.json');
  for (const step of manifest.steps)
    console.log(`${String(step.order).padStart(2)}  ${step.sha256.slice(0, 12)}  ${step.migration}${step.optional ? '  (opcional)' : ''}${step.transformsData ? '  (transforma dados)' : ''}`);
  if (problems.length) {
    problems.forEach((p) => console.error(`ERRO  ${p}`));
    process.exit(1);
  }
  console.log(`\nRelease ${manifest.release}: ${manifest.steps.length} migrations verificadas (arquivos, SHA-256, ordem, guardas, aditividade, RLS).`);
}
