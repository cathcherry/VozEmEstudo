import { apiFetch } from './http.js';

export const getPlanning = () => apiFetch('/api/planning');
export const createGoal = (goal) => apiFetch('/api/planning/goals', {
  method: 'POST', body: JSON.stringify(goal),
});
export const updateGoal = (goalId, changes) =>
  apiFetch(`/api/planning/goals/${encodeURIComponent(goalId)}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  });
export const createSubgoal = (goalId, data) =>
  apiFetch(`/api/planning/goals/${encodeURIComponent(goalId)}/subgoals`, {
    method: 'POST', body: JSON.stringify(data),
  });
export const updateSubgoal = (subgoalId, changes) =>
  apiFetch(`/api/planning/subgoals/${encodeURIComponent(subgoalId)}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  });
export const reorderGoalTasks = (goalId, taskIds) =>
  apiFetch(`/api/planning/goals/${encodeURIComponent(goalId)}/tasks/order`, {
    method: 'PUT', body: JSON.stringify({ taskIds }),
  });
export const createTask = (goalId, task) =>
  apiFetch(`/api/planning/goals/${encodeURIComponent(goalId)}/tasks`, {
    method: 'POST', body: JSON.stringify(task),
  });
export const updateTask = (taskId, changes) =>
  apiFetch(`/api/planning/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  });
export const setTaskCompleted = (taskId, completed) =>
  apiFetch(`/api/planning/tasks/${encodeURIComponent(taskId)}/completion`, {
    method: 'PATCH', body: JSON.stringify({ completed }),
  });
