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

export function validateSubgoalPatch(input) {
  const parsed = z.object({
    title: label160.optional(),
    dueDate: optionalDate,
  }).strict().refine((value) => Object.keys(value).length > 0, 'Informe alguma alteração.').parse(input);
  const patch = {};
  if ('title' in parsed) patch.title = clean(parsed.title);
  if ('dueDate' in parsed) patch.due_date = parsed.dueDate;
  return patch;
}

function validateReferenceUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = z.string().trim().max(2048).parse(value);
  let url;
  try { url = new URL(parsed); }
  catch { throw new z.ZodError([{ code: 'custom', path: ['referenceUrl'], message: 'Informe um link HTTPS válido.' }]); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password)
    throw new z.ZodError([{ code: 'custom', path: ['referenceUrl'], message: 'Somente links HTTPS sem credenciais são aceitos.' }]);
  return url.href;
}

export function validateTaskOrder(input) {
  const ids = z.object({ taskIds: z.array(uuid).min(2).max(500) }).strict().parse(input).taskIds;
  if (new Set(ids).size !== ids.length)
    throw new z.ZodError([{ code: 'custom', path: ['taskIds'], message: 'Uma tarefa não pode aparecer duas vezes.' }]);
  return ids;
}

export function validateNewTask(input) {
  const task = z.object({
    title: label180,
    dueDate: optionalDate,
    materialId: uuid.nullable().optional(),
    subgoalId: uuid.nullable().optional(),
    referenceUrl: z.string().trim().max(2048).nullable().optional(),
  }).strict().parse(input);
  return {
    title: clean(task.title),
    due_date: task.dueDate || null,
    material_id: task.materialId || null,
    subgoal_id: task.subgoalId || null,
    reference_url: validateReferenceUrl(task.referenceUrl),
  };
}

export function validateTaskPatch(input) {
  const parsed = z.object({
    title: label180.optional(),
    dueDate: optionalDate,
    materialId: uuid.nullable().optional(),
    subgoalId: uuid.nullable().optional(),
    referenceUrl: z.string().trim().max(2048).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Informe alguma alteração.').parse(input);
  const data = {};
  if ('title' in parsed) data.title = clean(parsed.title);
  if ('dueDate' in parsed) data.due_date = parsed.dueDate;
  if ('materialId' in parsed) data.material_id = parsed.materialId;
  if ('subgoalId' in parsed) data.subgoal_id = parsed.subgoalId;
  if ('referenceUrl' in parsed) data.reference_url = validateReferenceUrl(parsed.referenceUrl);
  return data;
}

export function validateTaskCompletion(input) {
  return z.object({ completed: z.boolean() }).strict().parse(input).completed;
}
