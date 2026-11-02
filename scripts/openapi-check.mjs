import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import YAML from 'yaml';
import { FEATURE_FLAG_NAMES } from '../backend/src/config/feature-flags.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'docs/engineering/AudioEstudo_openapi.yaml');
const document = YAML.parse(await readFile(filename, 'utf8'));
await SwaggerParser.validate(structuredClone(document), { resolve: { external: false } });
const expected = [
  ['get', '/health'],
  ['get', '/config'],
];
for (const [prefix, moduleName] of [
  ['/materials', 'material'],
  ['/questions', 'question'],
  ['/jobs', 'job'],
  ['/media', 'media'],
]) {
  const source = await readFile(
    path.join(root, `backend/src/routes/${moduleName}.routes.js`),
    'utf8',
  );
  for (const match of source.matchAll(/\w+Router\.(get|post|patch|delete)\(['"]([^'"]+)['"]/g)) {
    const route = (prefix + (match[2] === '/' ? '' : match[2])).replace(/:([\w]+)/g, '{$1}');
    expected.push([match[1], route]);
  }
}
const operations = Object.entries(document.paths).flatMap(([route, item]) =>
  Object.keys(item)
    .filter((key) => ['get', 'post', 'patch', 'delete'].includes(key))
    .map((method) => `${method} ${route}`),
);
assert.deepEqual(
  operations.sort(),
  expected.map(([method, route]) => `${method} ${route}`).sort(),
  'OpenAPI must describe every effective API route and no future route',
);
assert(document.components.schemas.CreateMaterialRequest.required.includes('id'));
assert.deepEqual(
  document.components.schemas.CreateMaterialRequest.properties.questionCount.enum,
  [3, 5, 10, 20],
);
assert.deepEqual(document.components.schemas.FeatureFlags.required, FEATURE_FLAG_NAMES);
for (const name of ['material_id', 'attempt_count', 'max_attempts'])
  assert(document.components.schemas.Job.required.includes(name));
for (const [method, route] of expected.filter(
  ([, candidate]) => !['/health', '/config'].includes(candidate),
))
  assert(document.paths[route][method].responses['401']);
console.log(
  JSON.stringify({
    valid: true,
    operations: operations.length,
    externalReferences: false,
    futureRoutes: 0,
  }),
);
