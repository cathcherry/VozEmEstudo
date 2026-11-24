import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningService } from '../src/services/planning.service.js';
import {
  validateNewGoal, validateNewTask, validateTaskCompletion,
  validateGoalPatch, validateTaskPatch, validateNewSubgoal,
  validateSubgoalPatch, validateTaskOrder,
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
    title: 'Fazer questões', due_date: null, material_id: null, subgoal_id: null, reference_url: null,
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

test('goal editing, subgoals and task patch are strict, minimal and predictable', () => {
  assert.deepEqual(validateGoalPatch({ title: '  Simulado  ', targetDate: null, status: 'active' }), {
    title: 'Simulado', target_date: null, status: 'active',
  });
  assert.deepEqual(validateNewSubgoal({ title: '  Revisar   capítulos  ', dueDate: '2026-11-10' }), {
    title: 'Revisar capítulos', due_date: '2026-11-10',
  });
  assert.deepEqual(validateTaskPatch({ title: '  Leitura   A  ', subgoalId: null }), {
    title: 'Leitura A', subgoal_id: null,
  });
  assert.throws(() => validateGoalPatch({}));
  assert.throws(() => validateGoalPatch({ status: 'unknown' }));
  assert.throws(() => validateGoalPatch({ user_id: a }));
  assert.throws(() => validateNewSubgoal({ title: ' ' }));
  assert.throws(() => validateTaskPatch({}));
  assert.throws(() => validateTaskPatch({ dueDate: '2026-02-30' }));
});

test('subgoal creation requires a goal owned by this account', async () => {
  let inserted = 0;
  const store = {
    async getOwnedGoal(userId, id) { assert.equal(userId, a); assert.equal(id, goal); throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }); },
    async insertSubgoal() { inserted++; },
  };
  await assert.rejects(
    buildPlanningService(store).createSubgoal(a, goal, { title: 'Revisão 1' }),
    (error) => error.code === 'NOT_FOUND',
  );
  assert.equal(inserted, 0);
  store.getOwnedGoal = async () => ({ id: goal });
  store.insertSubgoal = async (userId, id, data) => {
    assert.equal(userId, a);
    assert.equal(id, goal);
    inserted++;
    return { id: task, goal_id: id, ...data };
  };
  const created = await buildPlanningService(store).createSubgoal(a, goal, { title: 'Revisão 1' });
  assert.equal(created.title, 'Revisão 1');
  assert.equal(inserted, 1);
});

test('task cannot be moved to a subgoal belonging to another goal', async () => {
  const otherGoal = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  let writes = 0;
  const store = {
    async getOwnedTask(userId, taskId) {
      assert.equal(userId, a); assert.equal(taskId, task);
      return { id: task, goal_id: goal };
    },
    async getOwnedSubgoal(userId, subgoalId) {
      assert.equal(userId, a);
      assert.equal(subgoalId, otherGoal);
      return { id: otherGoal, goal_id: otherGoal };
    },
    async updateOwnedTask() { writes++; },
  };
  await assert.rejects(
    buildPlanningService(store).updateTask(a, task, { subgoalId: otherGoal }),
    (error) => error.code === 'NOT_FOUND',
  );
  assert.equal(writes, 0);
  store.getOwnedSubgoal = async () => ({ id: otherGoal, goal_id: goal });
  store.updateOwnedTask = async (userId, taskId, patch) => {
    assert.equal(userId, a);
    assert.equal(taskId, task);
    assert.deepEqual(patch, { subgoal_id: otherGoal });
    writes++;
    return { id: task, ...patch };
  };
  await buildPlanningService(store).updateTask(a, task, { subgoalId: otherGoal });
  assert.equal(writes, 1);
});

test('goal edits are always scoped to the authenticated user', async () => {
  const service = buildPlanningService({
    async updateOwnedGoal(userId, id, changes) {
      assert.equal(userId, a);
      assert.equal(id, goal);
      assert.deepEqual(changes, { title: 'Nova meta' });
      return { id, ...changes };
    },
  });
  assert.equal((await service.updateGoal(a, goal, { title: 'Nova meta' })).title, 'Nova meta');
});

test('subgoal edits preserve ownership and reject empty or foreign fields', async () => {
  const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  assert.deepEqual(validateSubgoalPatch({ title: '  Reavaliar  ', dueDate: null }), {
    title: 'Reavaliar', due_date: null,
  });
  assert.throws(() => validateSubgoalPatch({}));
  assert.throws(() => validateSubgoalPatch({ user_id: a }));
  assert.throws(() => validateSubgoalPatch({ dueDate: '2026-02-30' }));
  const service = buildPlanningService({
    async updateOwnedSubgoal(userId, subgoalId, data) {
      assert.equal(userId, a);
      assert.equal(subgoalId, id);
      assert.deepEqual(data, { title: 'Corrigido' });
      return { id: subgoalId, ...data };
    },
  });
  assert.equal((await service.updateSubgoal(a, id, { title: 'Corrigido' })).id, id);
});

test('reference links accept only HTTPS without credentials and stay optional', () => {
  const url = 'https://example.org/artigo?q=1';
  assert.equal(validateNewTask({ title: 'Ler', referenceUrl: url }).reference_url, url);
  assert.equal(validateNewTask({ title: 'Ler', referenceUrl: null }).reference_url, null);
  assert.equal(validateTaskPatch({ referenceUrl: '' }).reference_url, null);
  assert.throws(() => validateNewTask({ title: 'Ler', referenceUrl: 'http://example.org' }));
  assert.throws(() => validateNewTask({ title: 'Ler', referenceUrl: 'javascript:alert(1)' }));
  assert.throws(() => validateNewTask({ title: 'Ler', referenceUrl: 'https://x:y@example.org' }));
  assert.throws(() => validateNewTask({ title: 'Ler', referenceUrl: 'abc' }));
});

test('task reordering accepts exact unique IDs and passes the owner to the repository', async () => {
  const ids = [task, material];
  assert.deepEqual(validateTaskOrder({ taskIds: ids }), ids);
  assert.throws(() => validateTaskOrder({ taskIds: [task, task] }));
  assert.throws(() => validateTaskOrder({ taskIds: [task] }));
  assert.throws(() => validateTaskOrder({ taskIds: [task, 'bad'] }));
  assert.throws(() => validateTaskOrder({ taskIds: ids, user_id: a }));
  let calls = 0;
  const service = buildPlanningService({
    async getOwnedGoal(userId, goalId) {
      assert.equal(userId, a);
      assert.equal(goalId, goal);
      return { id: goal };
    },
    async reorderOwnedTasks(userId, goalId, taskIds) {
      assert.equal(userId, a);
      assert.equal(goalId, goal);
      assert.deepEqual(taskIds, ids);
      calls++;
      return ids.map((id, i) => ({ id, sort_order: (i + 1) * 1000 }));
    },
  });
  assert.equal((await service.reorderTasks(a, goal, { taskIds: ids })).length, 2);
  assert.equal(calls, 1);
});

test('reordering foreign goals never reaches the database mutation', async () => {
  let writes = 0;
  const service = buildPlanningService({
    async getOwnedGoal() { throw Object.assign(new Error('not found'), { code:'NOT_FOUND' }); },
    async reorderOwnedTasks() { writes++; },
  });
  await assert.rejects(service.reorderTasks(a, goal, { taskIds: [task, material] }),
    (error) => error.code === 'NOT_FOUND');
  assert.equal(writes, 0);
});

test('deleting goals, subgoals and tasks is scoped to the owner and validates ids', async () => {
  const calls = [];
  const service = buildPlanningService({
    async deleteOwnedGoal(userId, id) { calls.push(['goal', userId, id]); return { id, deleted: true }; },
    async deleteOwnedSubgoal(userId, id) { calls.push(['subgoal', userId, id]); return { id, deleted: true }; },
    async deleteOwnedTask(userId, id) { calls.push(['task', userId, id]); return { id, deleted: true }; },
  });
  assert.deepEqual(await service.deleteTask(a, task), { id: task, deleted: true });
  await service.deleteSubgoal(a, material);
  await service.deleteGoal(a, goal);
  assert.deepEqual(calls, [['task', a, task], ['subgoal', a, material], ['goal', a, goal]]);
  assert.throws(() => service.deleteTask(a, 'not-an-id'));
  assert.equal(calls.length, 3);
});
