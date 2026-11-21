import * as repository from '../repositories/discovery.repository.js';
import {
  discoveryId,
  validateComplete,
  validateConnection,
  validateDiscoveryUpdate,
  validateEvidence,
  validateInvestigationSave,
  validateLayout,
  validateLink,
  validateLinkKind,
  validateReflection,
} from '../validators/discovery.validator.js';

/**
 * Investigation → evidence → own explanation → discovery, and the collection they unlock. The
 * service validates input; ownership, verification and every unlock happen in the database.
 * There is deliberately no operation that grants a collectible.
 */
export function buildDiscoveryService(store = repository) {
  return {
    source: (user, materialId) => store.source(user, discoveryId(materialId)),
    getInvestigation: (user, id) => store.getInvestigation(user, discoveryId(id)),
    saveInvestigation: (user, id, body) =>
      store.saveInvestigation(user, discoveryId(id), validateInvestigationSave(body)),
    addEvidence: (user, id, body) => store.addEvidence(user, discoveryId(id), validateEvidence(body)),
    removeEvidence: (user, id, evidenceId) =>
      store.removeEvidence(user, discoveryId(id), discoveryId(evidenceId)),
    link: (user, id, body) => store.link(user, discoveryId(id), validateLink(body)),
    unlink: (user, id, kind, refId) =>
      store.link(user, discoveryId(id), { kind: validateLinkKind(kind), refId: discoveryId(refId) }, true),
    linkOptions: (user, id) => store.linkOptions(user, discoveryId(id)),
    complete: (user, id, body) => store.complete(user, discoveryId(id), validateComplete(body).requestId),
    listDiscoveries: (user) => store.listDiscoveries(user),
    getDiscovery: (user, id) => store.getDiscovery(user, discoveryId(id)),
    updateDiscovery: (user, id, body) =>
      store.updateDiscovery(user, discoveryId(id), validateDiscoveryUpdate(body)),
    addReflection: (user, id, body) => store.addReflection(user, discoveryId(id), validateReflection(body)),
    connect: (user, id, body) => store.connect(user, discoveryId(id), validateConnection(body)),
    collection: (user) => store.collection(user),
    saveLayout: (user, body) => store.saveLayout(user, validateLayout(body)),
  };
}
export const discoveryService = buildDiscoveryService();
