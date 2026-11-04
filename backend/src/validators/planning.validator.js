import { z } from 'zod';

const uuid = z.string().uuid();
const label160 = z.string().trim().min(1).max(160);
const label180 = z.string().trim().min(1).max(180);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
const date = z.string().refine(validDate, 'Informe uma data válida no formato AAAA-MM-DD.');
const optionalDate = date.nullable().optional();
const goalStatus = z.enum(['active', 'completed', 'archived']);
const clean = (text) => text.replace(/\s+/gu, ' ');

export function validatePlanningId(id) {
  return uuid.parse(id);
}

export function validateNewGoal(input) {
  const goal = z.object({
    title: label160,
    description: z.string().trim().max(1000).nullable().optional(),
    targetDate: optionalDate,
  }).strict().parse(input);
  return { title: clean(goal.title), description: goal.description || null, target_date: goal.targetDate || null };
}

export function validateGoalPatch(input) {
  const parsed = z.object({
    title: label160.optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    targetDate: optionalDate,
    status: goalStatus.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Informe alguma alteração.').parse(input);
  const data = {};
  if ('title' in parsed) data.title = clean(parsed.title);
  if ('description' in parsed) data.description = parsed.description || null;
  if ('targetDate' in parsed) data.target_date = parsed.targetDate;
  if ('status' in parsed) data.status = parsed.status;
  return data;
}

export function validateNewSubgoal(input) {
  const parsed = z.object({
    title: label160,
    dueDate: optionalDate,
  }).strict().parse(input);
  return { title: clean(parsed.title), due_date: parsed.dueDate || null };
}

export function validateNewTask(input) {
  const task = z.object({
    title: label180,
    dueDate: optionalDate,
    materialId: uuid.nullable().optional(),
    subgoalId: uuid.nullable().optional(),
  }).strict().parse(input);
  return {
    title: clean(task.title),
    due_date: task.dueDate || null,
    material_id: task.materialId || null,
    subgoal_id: task.subgoalId || null,
  };
}

export function validateTaskPatch(input) {
  const parsed = z.object({
    title: label180.optional(),
    dueDate: optionalDate,
    materialId: uuid.nullable().optional(),
    subgoalId: uuid.nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Informe alguma alteração.').parse(input);
  const data = {};
  if ('title' in parsed) data.title = clean(parsed.title);
  if ('dueDate' in parsed) data.due_date = parsed.dueDate;
  if ('materialId' in parsed) data.material_id = parsed.materialId;
  if ('subgoalId' in parsed) data.subgoal_id = parsed.subgoalId;
  return data;
}

export function validateTaskCompletion(input) {
  return z.object({ completed: z.boolean() }).strict().parse(input).completed;
}
