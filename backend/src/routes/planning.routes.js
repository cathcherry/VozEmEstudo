import { Router } from 'express';
import * as planning from '../controllers/planning.controller.js';

export const planningRouter = Router();

planningRouter.get('/', planning.list);
planningRouter.post('/goals', planning.createGoal);
planningRouter.patch('/goals/:goalId', planning.updateGoal);
planningRouter.delete('/goals/:goalId', planning.deleteGoal);
planningRouter.post('/goals/:goalId/subgoals', planning.createSubgoal);
planningRouter.patch('/subgoals/:subgoalId', planning.updateSubgoal);
planningRouter.delete('/subgoals/:subgoalId', planning.deleteSubgoal);
planningRouter.put('/goals/:goalId/tasks/order', planning.reorderTasks);
planningRouter.post('/goals/:goalId/tasks', planning.createTask);
planningRouter.patch('/tasks/:taskId', planning.updateTask);
planningRouter.patch('/tasks/:taskId/completion', planning.updateCompletion);
planningRouter.delete('/tasks/:taskId', planning.deleteTask);
