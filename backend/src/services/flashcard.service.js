import * as repository from '../repositories/flashcard.repository.js';
import {
  flashcardId, validateNewFlashcard, validateFlashcardPatch,
  validateFlashcardQuery, validateFlashcardReview,
} from '../validators/flashcard.validator.js';

export function buildFlashcardService(store = repository) {
  async function checkMaterial(userId, item) {
    if (item.material_id) await store.assertOwnedMaterial(userId, item.material_id);
  }

  return {
    list(userId, query) {
      const { filter, ...options } = validateFlashcardQuery(query);
      return store.listOwnedFlashcards(userId, filter, options);
    },
    async create(userId, body) {
      const item = validateNewFlashcard(body);
      await checkMaterial(userId, item);
      return store.createOwnedFlashcard(userId, item);
    },
    async update(userId, cardId, body) {
      const patch = validateFlashcardPatch(body);
      await checkMaterial(userId, patch);
      return store.updateOwnedFlashcard(userId, flashcardId(cardId), patch);
    },
    async history(userId, cardId) {
      const id = flashcardId(cardId);
      await store.getOwnedFlashcard(userId, id);
      return store.listOwnedFlashcardReviews(userId, id);
    },
    review(userId, cardId, body) {
      const data = validateFlashcardReview(body);
      return store.reviewOwnedFlashcard(
        userId, flashcardId(cardId), data.rating, data.requestId,
      );
    },
  };
}

export const flashcardService = buildFlashcardService();

