import * as repository from '../repositories/notebook.repository.js';
import { learningId } from '../validators/learning-tools.validator.js';
import { validateNotebookSave } from '../validators/notebook.validator.js';

/** One private notebook per lesson and account; ownership is checked by the database function. */
export function buildNotebookService(store = repository) {
  return {
    get: (user, materialId) => store.getNotebook(user, learningId(materialId)),
    save: (user, materialId, body) =>
      store.saveNotebook(user, learningId(materialId), validateNotebookSave(body)),
  };
}
export const notebookService = buildNotebookService();
