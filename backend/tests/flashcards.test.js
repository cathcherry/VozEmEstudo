import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlashcardService } from '../src/services/flashcard.service.js';
import {
  flashcardId, validateNewFlashcard, validateFlashcardPatch,
  validateFlashcardQuery, validateFlashcardReview,
} from '../src/validators/flashcard.validator.js';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cardId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const materialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('flashcards validate strict forms, lengths, UUID and rating', () => {
  assert.deepEqual(validateNewFlashcard({
    front: '  O que é   ASR? ', back: 'Reconhecimento de fala.',
  }), {
    front_text: 'O que é ASR?', back_text: 'Reconhecimento de fala.',
    material_id: null,
  });
  assert.deepEqual(validateFlashcardPatch({ archived: true }), { status: 'archived' });
  assert.deepEqual(validateFlashcardPatch({ materialId: null }), { material_id: null });
  assert.deepEqual(validateFlashcardQuery({}), { filter: 'due' });
  assert.equal(flashcardId(cardId), cardId);
  assert.deepEqual(validateFlashcardReview({ rating: 0, requestId }), { rating: 0, requestId });
  assert.throws(() => validateNewFlashcard({ front: '', back: 'Verso' }));
  assert.throws(() => validateNewFlashcard({ front: 'Frente', back: '' }));
  assert.throws(() => validateNewFlashcard({ front: 'Frente', back: 'Verso', user_id: owner }));
  assert.throws(() => validateNewFlashcard({ front: 'x'.repeat(1001), back: 'Verso' }));
  assert.throws(() => validateFlashcardPatch({}));
  assert.throws(() => validateFlashcardQuery({ filter: 'other' }));
  assert.throws(() => validateFlashcardReview({ rating: 4, requestId }));
  assert.throws(() => validateFlashcardReview({ rating: 'good', requestId }));
  assert.throws(() => validateFlashcardReview({ rating: 2, requestId: 'bad' }));
});

test('create and update verify that a linked material belongs to the signed-in user', async () => {
  const calls = [];
  const store = {
    async assertOwnedMaterial(userId, id) {
      calls.push(['verify', userId, id]);
      return { id };
    },
    async createOwnedFlashcard(userId, item) {
      calls.push(['create', userId, item]);
      return { id: cardId, ...item };
    },
    async updateOwnedFlashcard(userId, id, patch) {
      calls.push(['update', userId, id, patch]);
      return { id, ...patch };
    },
  };
  const service = buildFlashcardService(store);
  await service.create(owner, { front: 'Frente', back: 'Verso', materialId });
  await service.update(owner, cardId, { front: 'Nova frente', materialId });
  assert.equal(calls.length, 4);
  assert(calls.every((call) => call[1] === owner));
  assert.deepEqual(calls[0], ['verify', owner, materialId]);
  assert.equal(calls[1][2].material_id, materialId);
  assert.deepEqual(calls[2], ['verify', owner, materialId]);
  assert.equal(calls[3][2], cardId);
});

test('invalid or foreign material prevents writing cards', async () => {
  let writes = 0;
  const service = buildFlashcardService({
    async assertOwnedMaterial() {
      throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
    },
    async createOwnedFlashcard() { writes++; },
    async updateOwnedFlashcard() { writes++; },
  });
  await assert.rejects(service.create(owner, {
    front: 'Frente', back: 'Verso', materialId,
  }), (error) => error.code === 'NOT_FOUND');
  await assert.rejects(service.update(owner, cardId, {
    materialId,
  }), (error) => error.code === 'NOT_FOUND');
  assert.equal(writes, 0);
});

test('list, review and history always use the authenticated owner', async () => {
  const calls = [];
  const service = buildFlashcardService({
    async listOwnedFlashcards(userId, filter) {
      calls.push(['list', userId, filter]);
      return { cards: [], total: 0, limit: 100 };
    },
    async getOwnedFlashcard(userId, id) {
      calls.push(['card', userId, id]);
      return { id };
    },
    async listOwnedFlashcardReviews(userId, id) {
      calls.push(['history', userId, id]);
      return [];
    },
    async reviewOwnedFlashcard(userId, id, rating, request) {
      calls.push(['review', userId, id, rating, request]);
      return { cardId: id, rating };
    },
  });
  await service.list(owner, { filter: 'due' });
  await service.history(owner, cardId);
  const result = await service.review(owner, cardId, { rating: 3, requestId });
  assert.equal(result.rating, 3);
  assert.deepEqual(calls.map((entry) => entry[0]), ['list', 'card', 'history', 'review']);
  assert(calls.every((entry) => entry[1] === owner));
  assert.deepEqual(calls[3], ['review', owner, cardId, 3, requestId]);
});

test('a missing or foreign card blocks review-history lookup', async () => {
  let reads = 0;
  const service = buildFlashcardService({
    async getOwnedFlashcard() {
      throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
    },
    async listOwnedFlashcardReviews() { reads++; },
  });
  await assert.rejects(service.history(owner, cardId), (error) => error.code === 'NOT_FOUND');
  assert.equal(reads, 0);
});
