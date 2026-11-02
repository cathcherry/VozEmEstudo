import * as review from '../controllers/review.controller.js';
import { Router } from 'express';
import * as material from '../controllers/material.controller.js';
import * as transcription from '../controllers/transcription.controller.js';
import * as summary from '../controllers/summary.controller.js';
import * as question from '../controllers/question.controller.js';

export const materialRouter = Router();
materialRouter.get('/', material.list);
materialRouter.post('/', material.create);
materialRouter.get('/:materialId', material.get);
materialRouter.patch('/:materialId', material.patch);
materialRouter.delete('/:materialId', material.remove);
materialRouter.post('/:materialId/process', material.processInitial);

materialRouter.get('/:materialId/transcription', transcription.get);
materialRouter.patch('/:materialId/transcription', transcription.patch);
materialRouter.get('/:materialId/transcription/versions', transcription.versions);
materialRouter.post('/:materialId/transcription/versions/:revision/restore', transcription.restore);

materialRouter.get('/:materialId/summaries', summary.list);
materialRouter.post('/:materialId/summaries', summary.regenerate);
materialRouter.get('/:materialId/question-batches', question.listBatchesController);
materialRouter.post('/:materialId/question-batches', question.createBatch);

materialRouter.post('/:materialId/permission', review.permission);
materialRouter.get('/:materialId/transcription/review', review.state);
materialRouter.post('/:materialId/transcription/confirm', review.confirm);
materialRouter.post('/:materialId/transcription/warnings', review.warnings);
