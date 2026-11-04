import * as repository from '../repositories/planning.repository.js';
import {
  validatePlanningId,
  validateNewGoal,
  validateNewTask,
  validateTaskCompletion,
} from '../validators/planning.validator.js';

export function buildPlanningService(store = repository) {
  return {
    list: (userId) => store.listOwnedPlanning(userId),
    createGoal: (userId, body) => store.insertGoal(userId, validateNewGoal(body)),
    async createTask(userId, goalId, body) {
      const id = validatePlanningId(goalId);
      const task = validateNewTask(body);
      await store.getOwnedGoal(userId, id);
      if (task.material_id) await store.getOwnedMaterialForTask(userId, task.material_id);
      return store.insertTask(userId, id, task);
    },
    setTaskCompletion(userId, taskId, body) {
      const id = validatePlanningId(taskId);
      const completed = validateTaskCompletion(body);
      return store.setOwnedTaskCompletion(userId, id, completed);
    },
  };
}

export const planningService = buildPlanningService();
