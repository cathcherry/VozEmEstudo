import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingTasks, upcomingAgenda } from '../js/pages/dashboard-home.js';

test('upcoming tasks: pending tasks of active goals only, earliest deadline first', () => {
  const goals = [
    { id: 'a', title: 'Ativo', status: 'active' },
    { id: 'c', title: 'Concluído', status: 'completed' },
    { id: 'x', title: 'Arquivado', status: 'archived' },
  ];
  const tasks = [
    { id: '1', goal_id: 'a', title: 'sem prazo', due_date: null, sort_order: 1 },
    { id: '2', goal_id: 'a', title: 'amanhã', due_date: '2026-11-22', sort_order: 2 },
    { id: '3', goal_id: 'a', title: 'feita', due_date: '2026-11-20', completed_at: '2026-11-20T10:00:00Z' },
    { id: '4', goal_id: 'c', title: 'de objetivo concluído', due_date: '2026-11-21' },
    { id: '5', goal_id: 'x', title: 'de objetivo arquivado', due_date: '2026-11-21' },
  ];
  const result = upcomingTasks({ goals, tasks });
  assert.deepEqual(result.map((t) => t.id), ['2', '1']);
  assert.equal(result[0].goalTitle, 'Ativo');
  assert.equal(upcomingTasks({ goals, tasks }, 1).length, 1);
  assert.deepEqual(upcomingTasks({}), []);
});

test('upcoming agenda: ongoing and future items in time order; deadlines count as all-day', () => {
  const now = new Date(2026, 10, 21, 12, 0);
  const at = (day, hour) => new Date(2026, 10, day, hour).toISOString();
  const items = [
    { kind: 'event', id: 'past', startsAt: at(21, 8), endsAt: at(21, 9) },
    { kind: 'event', id: 'now', startsAt: at(21, 11), endsAt: at(21, 13) },
    { kind: 'task', id: 'today', date: '2026-11-21' },
    { kind: 'task', id: 'yesterday', date: '2026-11-20' },
    { kind: 'event', id: 'later', startsAt: at(23, 10), endsAt: at(23, 11) },
  ];
  assert.deepEqual(upcomingAgenda(items, now).map((i) => i.id), ['today', 'now', 'later']);
  assert.deepEqual(upcomingAgenda(items, now, 1).map((i) => i.id), ['today']);
});
