import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { progressForGoal, dateLabel, sortedPlanningTasks } from '../js/utils/planning-view.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root,'pages/planejar.html'),'utf8');
const css = readFileSync(resolve(root,'css/planning.css'),'utf8');
const code = readFileSync(resolve(root,'js/pages/planning-panel.js'),'utf8');

test('planning is hidden by default and uses styles scoped to the Planejar page', () => {
  assert.match(html,/data-planning-panel hidden/);
  assert.match(html,/\/css\/planning\.css/);
  assert.match(css,/data-page='plan'/);
  assert.match(code,/isFeatureEnabled\('planning'\)/);
  for(const name of [
    'data-planning-goal-form','data-planning-task-form',
    'data-planning-goal-select','data-planning-material-select',
    'data-planning-subgoal-form','data-planning-subgoal-goal',
    'data-planning-task-subgoal','data-planning-task-filter','data-planning-task-sort',
    'data-planning-task-link',
    'data-planning-status role="status" aria-live="polite"',
  ]) assert(html.includes(name),name);
});

test('completion progress counts only tasks from the correct goal', () => {
  const goal={ id:'g' };
  assert.deepEqual(progressForGoal(goal,[
    {goal_id:'g', completed_at:'2026-11-04T10:00:00Z'},
    {goal_id:'g', completed_at:null},
    {goal_id:'other', completed_at:'2026-11-04T10:00:00Z'},
  ]),{completed:1,total:2});
  assert.equal(dateLabel('2026-11-04'),'04/11/2026');
  assert.equal(dateLabel(null),'');
});

test('sort and filter keep pending tasks first by deadline without mutating source', () => {
  const tasks = [
    { id:'b', title:'B', goal_id:'g', due_date:'2026-11-20', completed_at: null, created_at:'2026-11-01' },
    { id:'d', title:'D', goal_id:'g', due_date:'2026-11-02', completed_at: '2026-11-03', created_at:'2026-11-01' },
    { id:'a', title:'A', goal_id:'g', due_date:'2026-11-05', completed_at: null, created_at:'2026-11-01' },
    { id:'c', title:'C', goal_id:'g', due_date: null, completed_at:null, created_at:'2026-11-01' },
  ];
  assert.deepEqual(sortedPlanningTasks(tasks).map((x) => x.id), ['a','b','c','d']);
  assert.deepEqual(sortedPlanningTasks(tasks,{filter:'completed'}).map((x) => x.id), ['d']);
  assert.deepEqual(sortedPlanningTasks(tasks,{filter:'pending',sort:'title'}).map((x) => x.id), ['a','b','c']);
  assert.equal(tasks[0].id, 'b');
});

test('planning edit controls use DOM text, not injected HTML for user fields', () => {
  assert.match(code, /inlineEditGoal/);
  assert.match(code, /inlineEditTask/);
  assert.match(code, /createSubgoal/);
  assert.match(code, /textContent = goal\.title/);
  assert.match(code, /textContent = subgoal\.title/);
  assert.doesNotMatch(code, /innerHTML/);
});

test('manual ordering follows persisted sort_order rather than dates', () => {
  const tasks = [
    { id: 'c', title: 'C', sort_order: 3000, created_at: '2026-11-02' },
    { id: 'a', title: 'A', sort_order: 1000, created_at: '2026-11-04' },
    { id: 'b', title: 'B', sort_order: 2000, created_at: '2026-11-03' },
  ];
  assert.deepEqual(sortedPlanningTasks(tasks, { sort:'manual' }).map((t) => t.id), ['a','b','c']);
  assert.equal(tasks[0].id, 'c');
  assert.match(code, /reorderGoalTasks/);
  assert.match(code, /inlineEditSubgoal/);
  assert.match(code, /noopener noreferrer/);
  assert.doesNotMatch(code, /innerHTML/);
});
