import { z } from 'zod';
import { env } from '../config/env.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { AppError } from '../domain/errors.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { getAnswerKey, listBatches, renameQuestionList } from '../repositories/question.repository.js';
import { hasOpenDeferredAttempt } from '../repositories/quiz-session.repository.js';
import { enqueueQuestions } from '../services/material.service.js';
import { answerQuestion } from '../services/question.service.js';
import {
  assertListQuestionCount,
  validateListTitle,
  validateQuestionConfig,
} from '../validators/question-config.validator.js';

const uuid = z.string().uuid();

export async function listBatchesController(req, res, next) {
  try {
    await getOwnedMaterial(req.user.id, req.params.materialId);
    res.json(await listBatches(req.params.materialId));
  } catch (e) {
    next(e);
  }
}
export async function createBatch(req, res, next) {
  try {
    const custom = isFeatureEnabled('study_authoring');
    const count = assertListQuestionCount(req.body?.count, { custom, max: env.maxQuestionListCount });
    // List configs need the authoring migration (partial lists, names, metadata). Without the flag
    // the request keeps the original E02 behaviour and shape, whatever the client sent.
    const config =
      custom && req.body?.config !== undefined ? validateQuestionConfig(req.body.config) : undefined;
    const job = await enqueueQuestions(
      req.user.id,
      req.params.materialId,
      count,
      {
        sourceRevisionId: req.body?.sourceRevisionId,
        idempotencyKey: req.body?.idempotencyKey,
      },
      config,
    );
    res.status(202).json({ jobId: job.id, materialId: job.material_id });
  } catch (e) {
    next(e);
  }
}
export async function rename(req, res, next) {
  try {
    const materialId = uuid.parse(req.params.materialId),
      batchId = uuid.parse(req.params.batchId);
    const title = validateListTitle(req.body);
    await getOwnedMaterial(req.user.id, materialId);
    res.json(await renameQuestionList(req.user.id, materialId, batchId, title));
  } catch (e) {
    next(e);
  }
}
/**
 * Teacher answer key, for the owner only. While the owner has an unfinished attempt with feedback
 * at the end on this list, the key stays hidden so the export cannot reveal unreleased answers.
 */
export async function answerKey(req, res, next) {
  try {
    const materialId = uuid.parse(req.params.materialId),
      batchId = uuid.parse(req.params.batchId);
    await getOwnedMaterial(req.user.id, materialId);
    if (isFeatureEnabled('quiz_v2') && (await hasOpenDeferredAttempt(req.user.id, batchId)))
      throw new AppError(
        'ANSWERS_NOT_RELEASED',
        'Conclua a tentativa em andamento desta lista antes de exportar o gabarito.',
        409,
      );
    const batch = await getAnswerKey(materialId, batchId);
    res.set('Cache-Control', 'no-store');
    res.json({
      id: batch.id,
      title: batch.title || null,
      questions: batch.questions.map((q) => ({
        id: q.id,
        position: q.position,
        statement: q.statement,
        options: q.options,
        correctIndex: q.correct_index,
        explanation: q.explanation || '',
        metadata: q.metadata || {},
      })),
    });
  } catch (e) {
    next(e);
  }
}
export async function answer(req, res, next) {
  try {
    // E10: prevent bypassing deferred feedback through the legacy endpoint.
    if (isFeatureEnabled('quiz_v2'))
      throw new AppError('QUIZ_SESSION_REQUIRED', 'Use uma tentativa para responder às questões.', 409);
    const { selectedIndex } = z
      .object({ selectedIndex: z.number().int().min(0).max(3) })
      .parse(req.body);
    res.json(await answerQuestion(req.user.id, req.params.questionId, selectedIndex));
  } catch (e) {
    next(e);
  }
}
