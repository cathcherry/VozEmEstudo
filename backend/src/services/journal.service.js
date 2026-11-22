import * as repository from '../repositories/journal.repository.js';
import { journalId, validateJournalSave, validatePageSave } from '../validators/journal.validator.js';

/** Diário de estudo: the service validates input; ownership and every rule are in the database. */
export function buildJournalService(store = repository) {
  return {
    list: (user) => store.list(user),
    get: (user, id) => store.get(user, journalId(id)),
    linkOptions: (user) => store.linkOptions(user),
    save: (user, id, body) => store.save(user, journalId(id), validateJournalSave(body)),
    savePage: (user, id, pageId, body) =>
      store.savePage(user, journalId(id), journalId(pageId), validatePageSave(body)),
  };
}
export const journalService = buildJournalService();
