import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogService } from '../src/services/catalog.service.js';
import {
  normalizeCatalogName,
  validateAssignment,
  validateSubject,
  validateUnit,
} from '../src/validators/catalog.validator.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const subjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const unitId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const materialId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('catalog normalizes names, validates inputs and blocks mismatched assignments', () => {
  assert.equal(normalizeCatalogName('  Língua   PORTUGUESA  '), 'língua portuguesa');
  assert.deepEqual(validateSubject({ name: '  Língua   Portuguesa ' }), {
    name: 'Língua Portuguesa',
    normalized_name: 'língua portuguesa',
  });
  assert.deepEqual(validateUnit({ title: '  Unidade   1  ' }), {
    title: 'Unidade 1',
    normalized_title: 'unidade 1',
    description: null,
  });
  assert.throws(() => validateAssignment({ subjectId: null, unitId }));
  assert.throws(() => validateAssignment({ subjectId, unitId, user_id: owner }));
  assert.throws(() => validateSubject({ name: '' }));
});

test('catalog passes the authenticated user to every operation', async () => {
  const calls = [];
  const repository = {
    async listCatalog(userId) {
      calls.push(['list', userId]);
      return { subjects: [], units: [] };
    },
    async getOwnedSubject(userId, id) {
      calls.push(['ownedSubject', userId, id]);
      return { id: subjectId, name: 'Português' };
    },
    async getOwnedUnit(userId, id) {
      calls.push(['ownedUnit', userId, id]);
      return { id: unitId, subject_id: subjectId };
    },
    async insertSubject(userId, data) {
      calls.push(['createSubject', userId, data.normalized_name]);
      return { id: subjectId, name: data.name };
    },
    async insertUnit(userId, id, data) {
      calls.push(['createUnit', userId, id, data.normalized_title]);
      return { id: unitId, subject_id: id, title: data.title };
    },
    async updateMaterialCatalog(userId, id, data) {
      calls.push(['assign', userId, id, data]);
      return { id, ...data };
    },
  };
  const service = buildCatalogService(repository);
  assert.deepEqual(await service.list(owner), { subjects: [], units: [] });
  await service.createSubject(owner, { name: 'Português' });
  await service.createUnit(owner, subjectId, { title: 'Unidade 1' });
  const assigned = await service.assignMaterial(owner, materialId, { subjectId, unitId });
  assert.deepEqual(assigned, {
    id: materialId,
    subject: 'Português',
    subject_id: subjectId,
    unit_id: unitId,
  });
  assert(calls.every((call) => call[1] === owner));
  assert.deepEqual(calls.at(-1)[3], {
    subject: 'Português',
    subject_id: subjectId,
    unit_id: unitId,
  });
});

test('catalog does not accept units from another discipline or missing owners', async () => {
  let updates = 0;
  const service = buildCatalogService({
    async getOwnedSubject() {
      return { id: subjectId, name: 'Português' };
    },
    async getOwnedUnit() {
      return { id: unitId, subject_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
    },
    async updateMaterialCatalog() {
      updates += 1;
    },
  });
  await assert.rejects(
    service.assignMaterial(owner, materialId, { subjectId, unitId }),
    (error) => error.code === 'NOT_FOUND',
  );
  assert.equal(updates, 0);
});

test('removing a catalog assignment clears IDs and legacy label in one update', async () => {
  const service = buildCatalogService({
    async updateMaterialCatalog(userId, id, selection) {
      assert.equal(userId, owner);
      assert.equal(id, materialId);
      return selection;
    },
  });
  assert.deepEqual(await service.assignMaterial(owner, materialId, { subjectId: null }), {
    subject: null,
    subject_id: null,
    unit_id: null,
  });
});
