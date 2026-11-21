// 3.4 — what a ready integrated material can become (migration 20261121180000_multi_lesson_exports.sql):
//   * its questions → an ordinary question list of the first source lesson, answered with the
//     usual flow (responder.html, quiz sessions); each question keeps its citations;
//   * its flashcards → a personal flashcard set (Flashcards 3.0 deck), each card with its source.
// Both are idempotent: the POST carries a requestId, and a record is exported at most once per
// kind (a second click returns what already exists). Nothing is generated or paid again.
import { z } from 'zod';
import * as repository from '../repositories/multi-lesson.repository.js';

const uuid = z.string().uuid();
const schemas = {
  questions: z.object({ requestId: uuid, title: z.string().trim().min(1).max(160).optional() }).strict(),
  flashcards: z.object({ requestId: uuid, name: z.string().trim().min(1).max(160).optional() }).strict(),
};

/** Where the student continues: the list in the usual quiz page, the set in Revisar. */
export function exportLinks(item) {
  if (!item?.available) return null;
  if (item.kind === 'questions')
    return {
      answer: `./responder.html?material=${encodeURIComponent(item.materialId)}&batch=${encodeURIComponent(item.batchId)}`,
      lesson: `./material.html?id=${encodeURIComponent(item.materialId)}#questoes`,
    };
  return { review: `./revisar.html?conjunto=${encodeURIComponent(item.setId)}#flashcards` };
}
const withLinks = (item) => ({ ...item, links: exportLinks(item) });

export function buildMultiLessonExportService(repo = repository) {
  return {
    async list(user, id) {
      const items = await repo.listExports(user.id, uuid.parse(id));
      return (items || []).map(withLinks);
    },
    async questions(user, id, body) {
      const data = schemas.questions.parse(body || {});
      return withLinks(await repo.exportQuestions(user.id, uuid.parse(id), data.requestId, data.title));
    },
    async flashcards(user, id, body) {
      const data = schemas.flashcards.parse(body || {});
      return withLinks(await repo.exportFlashcards(user.id, uuid.parse(id), data.requestId, data.name));
    },
  };
}

export const multiLessonExportService = buildMultiLessonExportService();
