import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlashcardService } from '../src/services/flashcard.service.js';
import { buildFlashcardListQuery } from '../src/repositories/flashcard.repository.js';
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
  assert.deepEqual(validateFlashcardQuery({}), { filter: 'due', status: 'all', offset: 0 });
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

test('pagination rejects invalid ranges and untrusted query fields', () => {
  assert.deepEqual(validateFlashcardQuery({ filter: 'all', offset: '100', materialId, status: 'archived' }),
    { filter: 'all', offset: 100, materialId, status: 'archived' });
  for (const offset of ['-1', '1.5', 'NaN', 'Infinity', '1000001'])
    assert.throws(() => validateFlashcardQuery({ offset }));
  assert.throws(() => validateFlashcardQuery({ materialId: 'invalid' }));
  assert.throws(() => validateFlashcardQuery({ user_id: owner }));
  assert.throws(() => validateFlashcardQuery({ status: 'deleted' }));
});

test('list forwards validated pagination and filters with the authenticated owner', async () => {
  const service = buildFlashcardService({
    async listOwnedFlashcards(userId, filter, options) {
      assert.equal(userId, owner);
      assert.equal(filter, 'all');
      assert.deepEqual(options, { status: 'archived', offset: 100, materialId });
      return { cards: [], total: 101, offset: 100, limit: 100 };
    },
  });
  const result = await service.list(owner, { filter: 'all', status: 'archived', offset: '100', materialId });
  assert.equal(result.offset, 100);
});

test('database pagination retains account scope, stable ordering and the active-only due queue', () => {
  const calls = [];
  const query = new Proxy({}, { get: (_, method) => (...args) => {
    calls.push([method, ...args]);
    return query;
  } });
  const db = { from(table) { calls.push(['from', table]); return query; } };
  const now = new Date('2026-11-05T12:00:00Z');
  buildFlashcardListQuery(db, owner, 'all', { offset: 100, materialId, status: 'archived' }, now);
  assert(calls.some((call) => JSON.stringify(call) === JSON.stringify(['eq', 'user_id', owner])));
  assert(calls.some((call) => JSON.stringify(call) === JSON.stringify(['eq', 'material_id', materialId])));
  assert(calls.some((call) => JSON.stringify(call) === JSON.stringify(['range', 100, 199])));
  assert(calls.some((call) => JSON.stringify(call) === JSON.stringify(['eq', 'status', 'archived'])));
  assert.deepEqual(calls.filter((call) => call[0] === 'order').map((call) => call[1]), ['created_at', 'id']);
  calls.length = 0;
  buildFlashcardListQuery(db, owner, 'due', { status: 'archived' }, now);
  assert(calls.some((call) => JSON.stringify(call) === JSON.stringify(['eq', 'status', 'active'])));
  assert(!calls.some((call) => call.includes('archived')));
  assert(calls.some((call) => JSON.stringify(call) === JSON.stringify(['lte', 'due_at', now.toISOString()])));
  assert.deepEqual(calls.filter((call) => call[0] === 'order').map((call) => call[1]), ['due_at', 'id']);
});

