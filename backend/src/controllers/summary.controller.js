import { z } from 'zod';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { listSummaries, renameSummary } from '../repositories/summary.repository.js';
import { enqueueSummary } from '../services/material.service.js';
import { validateSummaryLabel } from '../validators/summary-options.validator.js';

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
    // 3.3: with generation reuse the job may be an equivalent one that is running or finished.
    res.status(202).json({ jobId: job.id, materialId: job.material_id, ...(job.generation ? { generation: job.generation } : {}) });
  } catch (e) {
    next(e);
  }
}
/** Names a saved version. The text, options and source of the summary never change. */
export async function rename(req, res, next) {
  try {
    const materialId = z.string().uuid().parse(req.params.materialId);
    const summaryId = z.string().uuid().parse(req.params.summaryId);
    const { label } = validateSummaryLabel(req.body);
    await getOwnedMaterial(req.user.id, materialId);
    res.json(await renameSummary(req.user.id, materialId, summaryId, label));
  } catch (e) {
    next(e);
  }
}
