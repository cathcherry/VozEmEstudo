import { getOwnedMaterial } from '../repositories/material.repository.js';
import * as reviews from '../repositories/review.repository.js';
import { validatePermission, validateConfirmation } from '../validators/review.validator.js';

export async function permission(userId, materialId, input) {
  validatePermission(input);
  await getOwnedMaterial(userId, materialId);
  const record = await reviews.declarePermission(userId, materialId);
  return {
    id: record.id,
    userId: record.user_id,
    materialId: record.material_id,
    declarationVersion: record.declaration_version,
    declaredAt: new Date(record.declared_at).toISOString(),
  };
}
export async function state(userId, materialId) {
  await getOwnedMaterial(userId, materialId);
  return reviews.getReviewState(userId, materialId);
}
export async function confirm(userId, materialId, input) {
  const { sourceRevisionId } = validateConfirmation(input);
  await getOwnedMaterial(userId, materialId);
  await reviews.confirmRevision(userId, materialId, sourceRevisionId);
  return reviews.getReviewState(userId, materialId);
}
