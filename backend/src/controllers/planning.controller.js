import { planningService } from '../services/planning.service.js';

export async function list(req, res, next) {
  try {
    res.json(await planningService.list(req.user.id));
  } catch (error) {
    next(error);
  }
}

export async function createGoal(req, res, next) {
  try {
    res.status(201).json(await planningService.createGoal(req.user.id, req.body));
  } catch (error) {
    next(error);
  }
}

export async function createTask(req, res, next) {
  try {
    res.status(201).json(await planningService.createTask(req.user.id, req.params.goalId, req.body));
  } catch (error) {
    next(error);
  }
}

export async function updateCompletion(req, res, next) {
  try {
    res.json(await planningService.setTaskCompletion(req.user.id, req.params.taskId, req.body));
  } catch (error) {
    next(error);
  }
}
