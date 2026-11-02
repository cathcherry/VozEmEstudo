import { getOwnedMaterial } from '../repositories/material.repository.js';
import { listSummaries } from '../repositories/summary.repository.js';
import { enqueueSummary } from '../services/material.service.js';

export async function list(req, res, next) {
  try {
    await getOwnedMaterial(req.user.id, req.params.materialId);
    res.json(await listSummaries(req.params.materialId));
  } catch (e) {
    next(e);
  }
}
export async function regenerate(req, res, next) {
  try {
    const job = await enqueueSummary(req.user.id, req.params.materialId, req.body);
    res.status(202).json({ jobId: job.id, materialId: job.material_id });
  } catch (e) {
    next(e);
  }
}
