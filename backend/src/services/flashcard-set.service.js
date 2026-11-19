import { z } from 'zod';
import * as repository from '../repositories/flashcard-set.repository.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import {
  validateNewFlashcardSet, validateSetCards, validateSetPatch,
} from '../validators/flashcard-generation.validator.js';

const uuid = z.string().uuid();

export function buildFlashcardSetService(store = repository, owned = getOwnedMaterial) {
  return {
    list: (userId, query) =>
      store.listSets(userId, query.materialId ? uuid.parse(query.materialId) : undefined),
    get: (userId, setId) => store.getSet(userId, uuid.parse(setId)),
    async create(userId, body) {
      const data = validateNewFlashcardSet(body);
      if (data.materialId) await owned(userId, data.materialId);
      return store.createSet(userId, data);
    },
    async addCards(userId, setId, body) {
      return { added: await store.addCards(userId, uuid.parse(setId), validateSetCards(body)) };
    },
    update(userId, setId, body) {
      const patch = validateSetPatch(body);
      return store.updateSet(userId, uuid.parse(setId), {
        name: patch.name ?? null,
        status: patch.archived === undefined ? null : patch.archived ? 'archived' : 'active',
      });
    },
    remove: (userId, setId) => store.deleteSet(userId, uuid.parse(setId)),
    removeCard: (userId, cardId) => store.deleteCard(userId, uuid.parse(cardId)),
  };
}
export const flashcardSetService = buildFlashcardSetService();
