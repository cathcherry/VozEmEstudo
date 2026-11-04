import { apiFetch } from './http.js';

export const getPlanning = () => apiFetch('/api/planning');
export const createGoal = (goal) => apiFetch('/api/planning/goals', {
  method: 'POST', body: JSON.stringify(goal),
});
export const createTask = (goalId, task) =>
  apiFetch(`/api/planning/goals/${encodeURIComponent(goalId)}/tasks`, {
    method: 'POST', body: JSON.stringify(task),
  });
export const setTaskCompleted = (taskId, completed) =>
  apiFetch(`/api/planning/tasks/${encodeURIComponent(taskId)}/completion`, {
    method: 'PATCH', body: JSON.stringify({ completed }),
  });
