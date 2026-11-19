import * as service from '../services/material.service.js';

export async function create(req, res, next) {
  try { res.status(201).json(await service.create(req.user.id, req.body)); } catch (e) { next(e); }
}
export async function list(req, res, next) {
  try { res.json(await service.list(req.user.id)); } catch (e) { next(e); }
}
export async function get(req, res, next) {
  try { res.json(await service.get(req.user.id, req.params.materialId)); } catch (e) { next(e); }
}
export async function patch(req, res, next) {
  try { res.json(await service.patch(req.user.id, req.params.materialId, req.body)); } catch (e) { next(e); }
}
export async function remove(req, res, next) {
  try { await service.remove(req.user.id, req.params.materialId); res.status(204).end(); } catch (e) { next(e); }
}
export async function processInitial(req, res, next) {
  try { const job = await service.enqueueInitial(req.user.id, req.params.materialId, { recordingLanguage: req.body?.recordingLanguage }); res.status(202).json({ jobId: job.id, materialId: job.material_id }); } catch (e) { next(e); }
}
