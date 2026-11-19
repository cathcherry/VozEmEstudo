import { Router } from 'express';
import * as catalog from '../controllers/catalog.controller.js';

export const catalogRouter = Router();

catalogRouter.get('/', catalog.list);
catalogRouter.get('/resources', catalog.resources);
catalogRouter.post('/subjects', catalog.createSubject);
catalogRouter.patch('/subjects/:subjectId', catalog.updateSubject);
catalogRouter.delete('/subjects/:subjectId', catalog.deleteSubject);
catalogRouter.post('/subjects/:subjectId/units', catalog.createUnit);
catalogRouter.patch('/materials/:materialId', catalog.assignMaterial);
