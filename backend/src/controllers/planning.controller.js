import { planningService } from '../services/planning.service.js';

export async function list(req, res, next) {
  try { res.json(await planningService.list(req.user.id)); } catch (error) { next(error); }
}

export async function createGoal(req, res, next) {
  try { res.status(201).json(await planningService.createGoal(req.user.id, req.body)); }
  catch (error) { next(error); }
}

export async function updateGoal(req, res, next) {
  try { res.json(await planningService.updateGoal(req.user.id, req.params.goalId, req.body)); }
  catch (error) { next(error); }
}

export async function createSubgoal(req, res, next) {
  try { res.status(201).json(await planningService.createSubgoal(req.user.id, req.params.goalId, req.body)); }
  catch (error) { next(error); }
}

export async function updateSubgoal(req, res, next) {
  try { res.json(await planningService.updateSubgoal(req.user.id, req.params.subgoalId, req.body)); }
  catch (error) { next(error); }
}

export async function reorderTasks(req, res, next) {
  try { res.json(await planningService.reorderTasks(req.user.id, req.params.goalId, req.body)); }
  catch (error) { next(error); }
}

export async function createTask(req, res, next) {
  try { res.status(201).json(await planningService.createTask(req.user.id, req.params.goalId, req.body)); }
  catch (error) { next(error); }
}

export async function updateTask(req, res, next) {
  try { res.json(await planningService.updateTask(req.user.id, req.params.taskId, req.body)); }
  catch (error) { next(error); }
}

export async function updateCompletion(req, res, next) {
  try { res.json(await planningService.setTaskCompletion(req.user.id, req.params.taskId, req.body)); }
  catch (error) { next(error); }
}
