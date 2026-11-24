import * as testing from '../services/testing.service.js';
import * as service from '../services/review.service.js';
import { refreshWarnings } from '../services/warnings.service.js';

export async function permission(req, res, next) {
  try {
    res.json(await service.permission(req.user.id, req.params.materialId, req.body));
  } catch (error) {
    next(error);
  }
}
export async function state(req, res, next) {
  try {
    res.json(await service.state(req.user.id, req.params.materialId));
  } catch (error) {
    next(error);
  }
}
export async function confirm(req, res, next) {
  try {
    res.json(await service.confirm(req.user.id, req.params.materialId, req.body));
  } catch (error) {
    next(error);
  }
}
export async function warnings(req, res, next) {
  try {
    // Public testing: a manual re-analysis calls the LLM again; first runs come with the transcript.
    const ref = typeof req.body?.analysisId === 'string' ? req.body.analysisId : null;
    res.json(await testing.withReservation(req.user.id, testing.USAGE_KIND.WARNINGS, ref, () =>
      refreshWarnings(req.user.id, req.params.materialId, req.body), { materialId: req.params.materialId }));
  } catch (error) {
    next(error);
  }
}
