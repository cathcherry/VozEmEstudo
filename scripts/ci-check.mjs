import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quality = YAML.parse(
  await readFile(path.join(root, '.github/workflows/quality.yml'), 'utf8'),
);
const remote = YAML.parse(
  await readFile(path.join(root, '.github/workflows/staging-readonly.yml'), 'utf8'),
);
assert(Object.hasOwn(quality.on, 'push') && Object.hasOwn(quality.on, 'pull_request'));
assert.equal(Object.hasOwn(quality.on, 'pull_request_target'), false);
assert.equal(JSON.stringify(quality).includes('secrets.'), false);
assert.deepEqual(Object.keys(remote.on), ['workflow_dispatch']);
assert.equal(remote.jobs['staging-readonly'].environment, 'staging-readonly');
assert(remote.jobs['staging-readonly'].if.includes('APPROVE_STAGING_READS'));
for (const workflow of [quality, remote]) {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const job of Object.values(workflow.jobs)) {
    assert(job['timeout-minutes'] > 0);
    for (const step of job.steps.filter((item) => item.uses))
      assert.match(step.uses, /^actions\/[\w-]+@[\da-f]{40}$/);
  }
}
const commands = quality.jobs['local-quality'].steps.map((step) => step.run || '').join('\n');
for (const command of [
  'npm ci --ignore-scripts',
  'npm ci --prefix backend',
  'npm ci --prefix frontend',
  'npm run check',
  'npm run test:browser',
  'distribution-audit.py audit',
])
  assert(commands.includes(command));
console.log(
  JSON.stringify({
    workflows: 2,
    checked: true,
    remoteExecution: false,
    environmentProtectionConfigured: 'not verified; requires repository owner',
  }),
);
