import { z } from 'zod';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { listBatches } from '../repositories/question.repository.js';
import { enqueueQuestions } from '../services/material.service.js';
import { answerQuestion } from '../services/question.service.js';
import { assertQuestionCount } from '../domain/rules.js';

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
    const count = assertQuestionCount(req.body?.count);
    const job = await enqueueQuestions(req.user.id, req.params.materialId, count, {
      sourceRevisionId: req.body?.sourceRevisionId,
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.status(202).json({ jobId: job.id, materialId: job.material_id });
  } catch (e) {
    next(e);
  }
}
export async function answer(req, res, next) {
  try {
    const { selectedIndex } = z
      .object({ selectedIndex: z.number().int().min(0).max(3) })
      .parse(req.body);
    res.json(await answerQuestion(req.user.id, req.params.questionId, selectedIndex));
  } catch (e) {
    next(e);
  }
}
