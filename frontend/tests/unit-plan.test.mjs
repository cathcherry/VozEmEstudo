import test from 'node:test';
import assert from 'node:assert/strict';
import { planUnitTasks, UNIT_PLAN_LIMIT } from '../js/pages/unit-plan.js';

const lesson = (id, unit, created) => ({ id, title: `Aula ${id}`, unit_id: unit, created_at: created });
const materials = [
  lesson('b', 'u1', '2026-11-02'),
  lesson('a', 'u1', '2026-11-01'),
  lesson('c', 'u1', '2026-11-03'),
  lesson('x', 'u2', '2026-11-01'),
];

test('one task per lesson of the unit, in class order, with deadlines spread from the start', () => {
  const plan = planUnitTasks({ materials, tasks: [], unitId: 'u1', goalId: 'g1', start: '2026-11-30', everyDays: 2 });
  assert.deepEqual(plan.create.map((t) => [t.materialId, t.dueDate, t.title]), [
    ['a', '2026-11-30', 'Estudar: Aula a'],
    ['b', '2026-12-02', 'Estudar: Aula b'],
    ['c', '2026-12-04', 'Estudar: Aula c'],
  ]);
  assert.equal(plan.lessons, 3);
});

test('running it again adds only lessons without a task in that goal; no deadlines when asked', () => {
  const tasks = [
    { goal_id: 'g1', material_id: 'a' },
    { goal_id: 'g2', material_id: 'b' }, // another goal does not count
  ];
  const plan = planUnitTasks({ materials, tasks, unitId: 'u1', goalId: 'g1', start: '2026-11-30', everyDays: 0 });
  assert.deepEqual(plan.create.map((t) => [t.materialId, t.dueDate]), [['b', null], ['c', null]]);
  assert.equal(plan.alreadyPlanned, 1);
  const many = Array.from({ length: UNIT_PLAN_LIMIT + 5 }, (_, i) => lesson(`m${i}`, 'big', `2026-01-${String((i % 28) + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}`));
  const big = planUnitTasks({ materials: many, tasks: [], unitId: 'big', goalId: 'g1', start: '', everyDays: 1 });
  assert.equal(big.create.length, UNIT_PLAN_LIMIT);
  assert.equal(big.overLimit, 5);
  assert.equal(big.create[0].dueDate, null, 'no start date, no deadlines');
});
