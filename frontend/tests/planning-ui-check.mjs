import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  progressForGoal, dateLabel, sortedPlanningTasks, deadlineFromText, deadlineState, quickDeadlines,
  shortDayLabel, addIsoDays, daysUntil,
} from '../js/utils/planning-view.js';

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
    'data-planning-task-subgoal','data-planning-quick-dates','data-planning-goal-detected','data-planning-task-filter','data-planning-task-sort',
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
  assert.match(code, /function goalEditor/);
  assert.match(code, /function taskEditor/);
  assert.match(code, /createSubgoal/);
  // el() writes textContent; titles never go through HTML.
  assert.match(code, /if \(text !== undefined\) node\.textContent = text/);
  assert.match(code, /el\('h3', '', goal\.title\)/);
  assert.match(code, /el\('h4', '', subgoal\.title\)/);
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
  assert.match(code, /function subgoalEditor/);
  assert.match(code, /noopener noreferrer/);
  assert.doesNotMatch(code, /innerHTML/);
});

test('one primary action: the toolbar has Novo objetivo (and the unit planner), not four buttons', () => {
  const toolbar = html.slice(html.indexOf('data-planning-toolbar'), html.indexOf('<dialog'));
  assert.equal((toolbar.match(/class="primary-action"/g) || []).length, 1);
  assert.match(toolbar, />Novo objetivo</);
  assert.doesNotMatch(toolbar, /Nova tarefa|Novo subobjetivo/);
  assert.match(toolbar, /data-unit-plan-open/);
  // The long intro under the title went to Ajuda.
  assert.doesNotMatch(html, /Defina objetivos, divida-os em tarefas/);
});

test('tasks and subgoals are added inside the goal card; edit and delete live in a ⋯ menu', () => {
  assert.match(code, /function quickAdd\(goal, subgoal = null\)/);
  assert.match(code, /Nova tarefa em \$\{where\}/);
  assert.match(code, /function subgoalAdder/);
  assert.match(code, /row-menu planning-menu/);
  for (const label of ['Editar objetivo', 'Excluir objetivo', 'Editar tarefa', 'Excluir tarefa', 'Excluir subobjetivo', 'Marcar como concluído', 'Arquivar'])
    assert(code.includes(`'${label}'`), label);
  // Confirmations are toasts; the status line only keeps errors.
  assert.match(code, /toast\(success, \{ type: 'success' \}\)/);
  assert.doesNotMatch(code, /setStatus\(notice, success/);
});

test('a deadline written in the goal is understood ("até quinta-feira")', () => {
  const monday = '2026-11-23';
  assert.deepEqual(deadlineFromText('Quero concluir a apresentação do meu TCC até quinta-feira.', monday),
    { date: '2026-11-26', phrase: 'até quinta-feira' });
  assert.equal(deadlineFromText('Revisar até amanhã', monday).date, '2026-11-24');
  assert.equal(deadlineFromText('Prova para sábado', monday).date, '2026-11-28');
  assert.equal(deadlineFromText('Entregar até 30/11', monday).date, '2026-11-30');
  assert.equal(deadlineFromText('Entregar até 02/01', monday).date, '2027-01-02', 'a past day means next year');
  assert.equal(deadlineFromText('até segunda', monday).date, monday, 'the same weekday is today');
  assert.equal(deadlineFromText('Estudar para a prova', monday), null);
  assert.equal(deadlineFromText('até 31/02', monday), null, 'impossible dates are ignored');
  assert.deepEqual(quickDeadlines(monday).map((q) => q.date), ['2026-11-24', '2026-11-27', '2026-11-30']);
  assert.equal(quickDeadlines('2026-11-27')[1].date, '2026-12-04', 'on a Friday, "Sexta-feira" is the next one');
});

test('deadlines are said in words, not only colour', () => {
  const today = '2026-11-23';
  assert.deepEqual(deadlineState('2026-11-22', { today }), { state: 'overdue', text: 'venceu ontem', date: 'dom., 22/11' });
  assert.equal(deadlineState('2026-11-20', { today }).text, 'venceu há 3 dias');
  assert.equal(deadlineState(today, { today }).text, 'vence hoje');
  assert.equal(deadlineState('2026-11-24', { today }).text, 'vence amanhã');
  assert.equal(deadlineState('2026-11-26', { today }).text, 'faltam 3 dias');
  assert.equal(deadlineState('2026-12-10', { today }).state, 'later');
  assert.equal(deadlineState('2026-11-20', { today, done: true }).state, 'done');
  assert.equal(deadlineState(null).state, 'none');
  assert.equal(shortDayLabel('2027-01-05', today), 'ter., 05/01/2027');
  assert.equal(addIsoDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysUntil('2026-11-30', today), 7);
});
