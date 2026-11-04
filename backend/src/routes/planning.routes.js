import { Router } from 'express';
import * as planning from '../controllers/planning.controller.js';

export const planningRouter = Router();

planningRouter.get('/', planning.list);
planningRouter.post('/goals', planning.createGoal);
planningRouter.patch('/goals/:goalId', planning.updateGoal);
planningRouter.post('/goals/:goalId/subgoals', planning.createSubgoal);
planningRouter.post('/goals/:goalId/tasks', planning.createTask);
planningRouter.patch('/tasks/:taskId', planning.updateTask);
planningRouter.patch('/tasks/:taskId/completion', planning.updateCompletion);
