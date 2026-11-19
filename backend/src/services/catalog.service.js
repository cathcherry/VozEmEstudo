import * as repository from '../repositories/catalog.repository.js';
import { errors } from '../domain/errors.js';
import {
  validateAssignment,
  validateCatalogId,
  validateSubject,
  validateUnit,
} from '../validators/catalog.validator.js';

export function buildCatalogService(store = repository) {
  return {
    async list(userId) {
      return store.listCatalog(userId);
    },

    async resources(userId) {
      return store.listLibraryResources(userId);
    },

    async createSubject(userId, input) {
      return store.insertSubject(userId, validateSubject(input));
    },

    async updateSubject(userId, subjectId, input) {
      const id = validateCatalogId(subjectId);
      return store.updateSubject(userId, id, validateSubject(input));
    },

    async deleteSubject(userId, subjectId) {
      const id = validateCatalogId(subjectId);
      await store.getOwnedSubject(userId, id);
      return store.deleteSubject(userId, id);
    },

    async createUnit(userId, subjectId, input) {
      const id = validateCatalogId(subjectId);
      await store.getOwnedSubject(userId, id);
      return store.insertUnit(userId, id, validateUnit(input));
    },

    async assignMaterial(userId, materialId, input) {
      const id = validateCatalogId(materialId);
      const { subjectId, unitId } = validateAssignment(input);
      if (subjectId === null) {
        return store.updateMaterialCatalog(userId, id, {
          subject: null,
          subject_id: null,
          unit_id: null,
        });
      }
      const subject = await store.getOwnedSubject(userId, subjectId);
      if (unitId) {
        const unit = await store.getOwnedUnit(userId, unitId);
        if (unit.subject_id !== subject.id) throw errors.notFound('Unidade');
      }
      // Single-row update: legacy labels and new IDs must change together.
      return store.updateMaterialCatalog(userId, id, {
        subject: subject.name,
        subject_id: subject.id,
        unit_id: unitId,
      });
    },
  };
}

export const catalogService = buildCatalogService();
