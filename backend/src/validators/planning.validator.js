import { z } from 'zod';

const uuid = z.string().uuid();

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
const optionalDate = z.string().refine(validDate, 'Informe uma data válida no formato AAAA-MM-DD.').nullable().optional();

export function validatePlanningId(id) {
  return uuid.parse(id);
}

export function validateNewGoal(input) {
  const goal = z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).nullable().optional(),
    targetDate: optionalDate,
  }).strict().parse(input);
  return {
    title: goal.title.replace(/\s+/gu, ' '),
    description: goal.description || null,
    target_date: goal.targetDate || null,
  };
}

export function validateNewTask(input) {
  const task = z.object({
    title: z.string().trim().min(1).max(180),
    dueDate: optionalDate,
    materialId: uuid.nullable().optional(),
  }).strict().parse(input);
  return {
    title: task.title.replace(/\s+/gu, ' '),
    due_date: task.dueDate || null,
    material_id: task.materialId || null,
  };
}

export function validateTaskCompletion(input) {
  return z.object({ completed: z.boolean() }).strict().parse(input).completed;
}
