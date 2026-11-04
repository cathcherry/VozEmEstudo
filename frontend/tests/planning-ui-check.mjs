import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { progressForGoal, dateLabel } from '../js/utils/planning-view.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root,'pages/painel.html'),'utf8');
const css = readFileSync(resolve(root,'css/planning.css'),'utf8');
const code = readFileSync(resolve(root,'js/pages/planning-panel.js'),'utf8');

test('planning is hidden by default and uses scoped dashboard styles', () => {
  assert.match(html,/data-planning-panel hidden/);
  assert.match(html,/\/css\/planning\.css/);
  assert.match(css,/body\[data-page='dashboard'\]/);
  assert.match(code,/isFeatureEnabled\('planning'\)/);
  for(const name of [
    'data-planning-goal-form','data-planning-task-form',
    'data-planning-goal-select','data-planning-material-select',
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
