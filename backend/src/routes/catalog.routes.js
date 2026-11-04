import { Router } from 'express';
import * as catalog from '../controllers/catalog.controller.js';

export const catalogRouter = Router();

catalogRouter.get('/', catalog.list);
catalogRouter.post('/subjects', catalog.createSubject);
catalogRouter.post('/subjects/:subjectId/units', catalog.createUnit);
catalogRouter.patch('/materials/:materialId', catalog.assignMaterial);
