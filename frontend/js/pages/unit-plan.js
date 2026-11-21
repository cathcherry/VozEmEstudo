// Planejar › "Planejar uma unidade": one task per lesson of a catalog unit, inside a goal, with
// deadlines spread from a start date. Run it again later and only lessons that still have no
// task in that goal are added: new lessons join the plan by an explicit choice, never silently.
// Uses the existing planning and catalog APIs (no new tables).
import { getCatalog } from '../api/catalog.api.js';
import { getPlanning, createTask } from '../api/planning.api.js';

export const UNIT_PLAN_LIMIT = 100;

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * Tasks to create for `unitId` in `goalId`. Lessons keep the order they were added (class order);
 * lessons already linked to a task of this goal are skipped. `everyDays` 0 means no deadlines.
 */
export function planUnitTasks({ materials, tasks, unitId, goalId, start, everyDays = 0 }) {
  const lessons = materials
    .filter((m) => m.unit_id === unitId)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const planned = new Set(tasks.filter((t) => t.goal_id === goalId && t.material_id).map((t) => t.material_id));
  const missing = lessons.filter((m) => !planned.has(m.id));
  const create = missing.slice(0, UNIT_PLAN_LIMIT).map((lesson, index) => ({
    title: `Estudar: ${lesson.title}`.slice(0, 180),
    materialId: lesson.id,
    dueDate: everyDays > 0 && start ? addDays(start, index * everyDays) : null,
  }));
  return { lessons: lessons.length, alreadyPlanned: lessons.length - missing.length, create, overLimit: Math.max(0, missing.length - UNIT_PLAN_LIMIT) };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Opens the dialog; resolves with the number of tasks created (0 when cancelled). */
export async function openUnitPlanDialog({ materials, opener }) {
  const [catalog, planning] = await Promise.all([getCatalog(), getPlanning()]);
  const goals = (planning.goals || []).filter((g) => g.status !== 'archived');
  const tasks = planning.tasks || [];
  const dialog = make('dialog', null, 'settings-dialog app-dialog unit-plan-dialog');
  dialog.setAttribute('aria-labelledby', 'unit-plan-title');
  const form = make('form');
  form.method = 'dialog';
  const title = make('h2', 'Planejar uma unidade');
  title.id = 'unit-plan-title';
  const hint = make(
    'p',
    'Cria uma tarefa para cada aula da unidade, dentro de um objetivo. Se a unidade ganhar aulas novas, use de novo: só as que faltam entram.',
    'app-dialog-hint',
  );
  const field = (label, control) => {
    const wrap = make('label', label);
    wrap.append(control);
    return wrap;
  };
  const unit = make('select');
  unit.required = true;
  unit.append(new Option('Escolha a unidade', ''));
  for (const subject of catalog.subjects || []) {
    const units = (catalog.units || []).filter((u) => u.subject_id === subject.id);
    if (!units.length) continue;
    const group = document.createElement('optgroup');
    group.label = subject.name;
    for (const item of units) group.append(new Option(item.title, item.id));
    unit.append(group);
  }
  const goal = make('select');
  goal.required = true;
  for (const item of goals) goal.append(new Option(item.title, item.id));
  const start = make('input');
  start.type = 'date';
  start.value = today();
  const every = make('select');
  for (const [value, label] of [
    ['0', 'Sem prazo'],
    ['1', 'Uma aula por dia'],
    ['2', 'A cada 2 dias'],
    ['3', 'A cada 3 dias'],
    ['7', 'Uma aula por semana'],
  ])
    every.append(new Option(label, value));
  every.value = '2';
  const startField = field('Começar em', start);
  const preview = make('div', null, 'unit-plan-preview');
  preview.setAttribute('role', 'status');
  preview.setAttribute('aria-live', 'polite');
  const actions = make('div', null, 'form-actions');
  const cancel = make('button', 'Cancelar', 'secondary-action');
  cancel.type = 'button';
  const save = make('button', 'Criar tarefas', 'primary-action');
  save.type = 'submit';
  save.disabled = true;
  actions.append(cancel, save);
  form.append(title, hint, field('Unidade', unit), field('Objetivo', goal), field('Ritmo', every), startField, preview, actions);
  if (!goals.length) {
    form.replaceChildren(title, make('p', 'Crie um objetivo primeiro (por exemplo, "Prova de Biologia") e volte aqui.', 'app-dialog-hint'), actions);
    save.hidden = true;
  }
  dialog.append(form);
  document.body.append(dialog);
  let plan = null;
  const dateLabel = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(globalThis.VOZ_LOCALE || 'pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const update = () => {
    startField.hidden = every.value === '0';
    if (!unit.value) {
      plan = null;
      save.disabled = true;
      preview.replaceChildren();
      return;
    }
    plan = planUnitTasks({ materials, tasks, unitId: unit.value, goalId: goal.value, start: start.value, everyDays: Number(every.value) });
    const lines = make('ul', null, 'unit-plan-summary');
    lines.append(make('li', `${plan.lessons} ${plan.lessons === 1 ? 'aula na unidade' : 'aulas na unidade'}`));
    if (plan.alreadyPlanned) lines.append(make('li', `${plan.alreadyPlanned} já ${plan.alreadyPlanned === 1 ? 'tem tarefa' : 'têm tarefa'} neste objetivo`));
    lines.append(make('li', `${plan.create.length} ${plan.create.length === 1 ? 'tarefa será criada' : 'tarefas serão criadas'}`));
    const nodes = [lines];
    if (plan.create.length) {
      const sample = make('ol', null, 'unit-plan-sample');
      for (const item of plan.create.slice(0, 5))
        sample.append(make('li', item.dueDate ? `${item.title} · ${dateLabel(item.dueDate)}` : item.title));
      if (plan.create.length > 5) sample.append(make('li', `e mais ${plan.create.length - 5}`, 'unit-plan-more'));
      nodes.push(sample);
    }
    preview.replaceChildren(...nodes);
    save.disabled = !plan.create.length;
  };
  for (const control of [unit, goal, start, every]) control.addEventListener('change', update);
  update();
  return new Promise((resolve) => {
    let created = 0;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!plan?.create.length || !form.reportValidity()) return;
      save.disabled = true;
      save.textContent = 'Criando…';
      try {
        for (const item of plan.create) {
          tasks.push(await createTask(goal.value, item));
          created += 1;
        }
        dialog.close();
      } catch (error) {
        // Tasks already created are known now, so trying again only adds the rest.
        save.textContent = 'Criar tarefas';
        update();
        preview.append(make('p', `${error.message || 'Não foi possível criar todas as tarefas.'} ${created} criadas.`, 'unit-plan-error'));
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(created);
    });
    dialog.showModal();
    (goals.length ? unit : cancel).focus();
  });
}
