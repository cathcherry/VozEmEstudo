import { Router } from 'express';
import * as testing from '../services/testing.service.js';
import * as demo from '../services/demo.service.js';

const action = (handler, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await handler(req));
  } catch (error) {
    next(error);
  }
};

// Public testing program (FEATURE_PUBLIC_TESTING). Every value comes from the server: role, limits
// and use are read from the database for the signed-in account; nothing in the request can change
// them. Administrative figures exist only for allowlisted accounts (404 for everyone else).
export const testingRouter = Router();
testingRouter.get('/me', action((req) => testing.usage(req.user.id)));
testingRouter.get('/overview', action((req) => testing.overview(req.user.id)));

export const demoLessonRouter = Router();
demoLessonRouter.get('/', action((req) => demo.list(req.user.id)));
demoLessonRouter.post('/:demoId/open', action((req) => demo.open(req.user.id, req.params.demoId)));
