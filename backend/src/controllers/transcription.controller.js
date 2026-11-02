import * as materials from '../repositories/material.repository.js';
import {
  getTranscriptionByMaterial,
  applyTranscriptionEdits,
  restoreRevision,
  listVersions,
} from '../services/transcription.service.js';
import { validateTranscriptionEdits } from '../validators/transcription.validator.js';
import { errors } from '../domain/errors.js';

export async function get(req, res, next) {
  try {
    await materials.getOwnedMaterial(req.user.id, req.params.materialId);
    const data = await getTranscriptionByMaterial(req.params.materialId);
    if (!data) throw errors.notFound('Transcrição');
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function patch(req, res, next) {
  try {
    await materials.getOwnedMaterial(req.user.id, req.params.materialId);
    const input = validateTranscriptionEdits(req.body);
    const result = await applyTranscriptionEdits(
      req.params.materialId,
      input.expectedRevision,
      input.segments,
      req.user.id,
    );
    res.json({ revision: result });
  } catch (e) {
    next(e);
  }
}

export async function versions(req, res, next) {
  try {
    await materials.getOwnedMaterial(req.user.id, req.params.materialId);
    res.json(await listVersions(req.params.materialId));
  } catch (e) {
    next(e);
  }
}

export async function restore(req, res, next) {
  try {
    await materials.getOwnedMaterial(req.user.id, req.params.materialId);
    const revision = Number(req.params.revision);
    const result = await restoreRevision(req.params.materialId, revision, req.user.id);
    res.json({ revision: result });
  } catch (e) {
    next(e);
  }
}
