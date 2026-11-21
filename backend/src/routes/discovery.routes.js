import { Router } from 'express';
import { discoveryService as service } from '../services/discovery.service.js';

// Milestone 6 (FEATURE_DISCOVERIES). Private to the account; never cached or indexed.
const action = (fn) => async (req, res, next) => {
  try {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    res.json(await fn(req));
  } catch (error) {
    next(error);
  }
};

export const investigationRouter = Router();
investigationRouter.get('/source/:materialId', action((r) => service.source(r.user.id, r.params.materialId)));
investigationRouter.get('/:id', action((r) => service.getInvestigation(r.user.id, r.params.id)));
investigationRouter.put('/:id', action((r) => service.saveInvestigation(r.user.id, r.params.id, r.body)));
investigationRouter.post('/:id/evidence', action((r) => service.addEvidence(r.user.id, r.params.id, r.body)));
investigationRouter.delete(
  '/:id/evidence/:evidenceId',
  action((r) => service.removeEvidence(r.user.id, r.params.id, r.params.evidenceId)),
);
investigationRouter.get('/:id/link-options', action((r) => service.linkOptions(r.user.id, r.params.id)));
investigationRouter.put('/:id/links', action((r) => service.link(r.user.id, r.params.id, r.body)));
investigationRouter.delete(
  '/:id/links/:kind/:refId',
  action((r) => service.unlink(r.user.id, r.params.id, r.params.kind, r.params.refId)),
);
investigationRouter.post('/:id/complete', action((r) => service.complete(r.user.id, r.params.id, r.body)));

export const discoveryRouter = Router();
discoveryRouter.get('/', action((r) => service.listDiscoveries(r.user.id)));
discoveryRouter.get('/:id', action((r) => service.getDiscovery(r.user.id, r.params.id)));
discoveryRouter.put('/:id', action((r) => service.updateDiscovery(r.user.id, r.params.id, r.body)));
discoveryRouter.post('/:id/reflections', action((r) => service.addReflection(r.user.id, r.params.id, r.body)));
discoveryRouter.post('/:id/connections', action((r) => service.connect(r.user.id, r.params.id, r.body)));

export const collectionRouter = Router();
collectionRouter.get('/', action((r) => service.collection(r.user.id)));
collectionRouter.put('/layout', action((r) => service.saveLayout(r.user.id, r.body)));
