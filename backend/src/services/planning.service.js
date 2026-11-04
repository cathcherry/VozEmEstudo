import * as repository from '../repositories/planning.repository.js';
import { errors } from '../domain/errors.js';
import {
  validatePlanningId, validateNewGoal, validateGoalPatch, validateNewSubgoal,
  validateNewTask, validateTaskPatch, validateTaskCompletion,
  validateSubgoalPatch, validateTaskOrder,
} from '../validators/planning.validator.js';

export function buildPlanningService(store = repository) {
  async function validateOwnedLinks(userId, goalId, data) {
    if (data.material_id) await store.getOwnedMaterialForTask(userId, data.material_id);
    if (data.subgoal_id) {
      const subgoal = await store.getOwnedSubgoal(userId, data.subgoal_id);
      if (subgoal.goal_id !== goalId) throw errors.notFound('Subobjetivo');
    }
  }
  return {
    list: (userId) => store.listOwnedPlanning(userId),
    createGoal: (userId, body) => store.insertGoal(userId, validateNewGoal(body)),
    updateGoal: (userId, goalId, body) =>
      store.updateOwnedGoal(userId, validatePlanningId(goalId), validateGoalPatch(body)),
    async createSubgoal(userId, goalId, body) {
      const id = validatePlanningId(goalId);
      const payload = validateNewSubgoal(body);
      await store.getOwnedGoal(userId, id);
      return store.insertSubgoal(userId, id, payload);
    },
    updateSubgoal(userId, subgoalId, body) {
      return store.updateOwnedSubgoal(
        userId, validatePlanningId(subgoalId), validateSubgoalPatch(body),
      );
    },
    async reorderTasks(userId, goalId, body) {
      const id = validatePlanningId(goalId);
      const taskIds = validateTaskOrder(body);
      await store.getOwnedGoal(userId, id);
      return store.reorderOwnedTasks(userId, id, taskIds);
    },
    async createTask(userId, goalId, body) {
      const id = validatePlanningId(goalId);
      const task = validateNewTask(body);
      await store.getOwnedGoal(userId, id);
      await validateOwnedLinks(userId, id, task);
      return store.insertTask(userId, id, task);
    },
    async updateTask(userId, taskId, body) {
      const id = validatePlanningId(taskId);
      const patch = validateTaskPatch(body);
      const existing = await store.getOwnedTask(userId, id);
      await validateOwnedLinks(userId, existing.goal_id, patch);
      return store.updateOwnedTask(userId, id, patch);
    },
    setTaskCompletion(userId, taskId, body) {
      const id = validatePlanningId(taskId);
      const completed = validateTaskCompletion(body);
      return store.setOwnedTaskCompletion(userId, id, completed);
    },
  };
}

export const planningService = buildPlanningService();
