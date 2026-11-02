import { Router } from 'express';
import * as job from '../controllers/job.controller.js';
export const jobRouter = Router();
jobRouter.get('/:jobId', job.get);
jobRouter.get('/:jobId/events', job.events);
