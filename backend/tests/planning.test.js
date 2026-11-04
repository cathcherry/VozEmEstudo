import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningService } from '../src/services/planning.service.js';
import {
  validateNewGoal, validateNewTask, validateTaskCompletion,
} from '../src/validators/planning.validator.js';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const goal = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const material = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const task = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('planning validates deadlines, strict payloads and task checkboxes', () => {
  assert.deepEqual(validateNewGoal({ title: '  Revisar   Química ', targetDate: '2026-11-30' }), {
    title: 'Revisar Química', description: null, target_date: '2026-11-30',
  });
  assert.deepEqual(validateNewTask({ title: 'Fazer questões' }), {
    title: 'Fazer questões', due_date: null, material_id: null,
  });
  assert.throws(() => validateNewGoal({ title: 'A', targetDate: '2026-02-30' }));
  assert.throws(() => validateNewTask({ title: 'A', materialId: 'abc' }));
  assert.throws(() => validateTaskCompletion({ completed: 'true' }));
  assert.throws(() => validateNewGoal({ title: 'A', user_id: a }));
});

test('create task checks ownership of goal and linked material before insert', async () => {
  const calls = [];
  const service = buildPlanningService({
    async listOwnedPlanning(userId) { calls.push(['list',userId]); return { goals: [], tasks: [] }; },
    async insertGoal(userId, data) { calls.push(['createGoal',userId,data]); return data; },
    async getOwnedGoal(userId, id) { calls.push(['getGoal',userId,id]); return { id }; },
    async getOwnedMaterialForTask(userId, id) { calls.push(['getMaterial',userId,id]); return { id }; },
    async insertTask(userId, id, data) { calls.push(['createTask',userId,id,data]); return data; },
    async setOwnedTaskCompletion(userId, id, done) { calls.push(['done',userId,id,done]); return {id}; },
  });
  await service.list(a);
  await service.createGoal(a, { title: 'Revisar' });
  await service.createTask(a, goal, { title: 'Ouvir aula', materialId: material });
  await service.setTaskCompletion(a, task, { completed: true });
  assert(calls.every((entry) => entry[1] === a));
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'list','createGoal','getGoal','getMaterial','createTask','done',
  ]);
});

test('foreign goal or foreign linked material blocks insertion', async () => {
  let inserted = 0;
  const store = {
    async getOwnedGoal() { throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }); },
    async getOwnedMaterialForTask() {},
    async insertTask() { inserted++; },
  };
  await assert.rejects(
    buildPlanningService(store).createTask(a, goal, { title: 'Tarefa' }),
    (error) => error.code === 'NOT_FOUND',
  );
  store.getOwnedGoal = async () => ({ id: goal });
  store.getOwnedMaterialForTask = async () => { throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }); };
  await assert.rejects(
    buildPlanningService(store).createTask(a, goal, { title: 'Tarefa', materialId: material }),
    (error) => error.code === 'NOT_FOUND',
  );
  assert.equal(inserted, 0);
});
