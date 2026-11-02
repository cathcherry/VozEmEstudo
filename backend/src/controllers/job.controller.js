import { getOwnedJob, listOwnedEvents } from '../repositories/job.repository.js';

export async function get(req, res, next) {
  try { res.json(await getOwnedJob(req.user.id, req.params.jobId)); } catch (e) { next(e); }
}
export async function events(req, res, next) {
  try { res.json(await listOwnedEvents(req.user.id, req.params.jobId)); } catch (e) { next(e); }
}
