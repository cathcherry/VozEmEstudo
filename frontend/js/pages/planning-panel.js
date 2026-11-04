import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import { progressForGoal, dateLabel, sortedPlanningTasks } from '../utils/planning-view.js';
import {
  getPlanning, createGoal, updateGoal, createSubgoal, updateSubgoal, createTask,
  updateTask, reorderGoalTasks, setTaskCompleted,
} from '../api/planning.api.js';

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function inputField(labelText, value, { type = 'text', maxLength = 180 } = {}) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  if (type === 'text' || type === 'url') input.maxLength = maxLength;
  if (type === 'url') input.pattern = 'https://.*';
  label.append(input);
  return { label, input };
}

function selectField(labelText, items, value, placeholder) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  if (placeholder !== undefined) select.append(option('', placeholder));
  for (const item of items) select.append(option(item.id, item.name || item.title));
  select.value = value || '';
  label.append(select);
  return { label, select };
}

export async function initPlanningPanel({ materials }) {
  const panel = document.querySelector('[data-planning-panel]');
  if (!panel || !(await isFeatureEnabled('planning'))) return;
  const formGoal = panel.querySelector('[data-planning-goal-form]');
  const formSubgoal = panel.querySelector('[data-planning-subgoal-form]');
  const formTask = panel.querySelector('[data-planning-task-form]');
  const goalSelect = panel.querySelector('[data-planning-goal-select]');
  const subgoalGoalSelect = panel.querySelector('[data-planning-subgoal-goal]');
  const taskSubgoalSelect = panel.querySelector('[data-planning-task-subgoal]');
  const materialSelect = panel.querySelector('[data-planning-material-select]');
  const taskFilter = panel.querySelector('[data-planning-task-filter]');
  const taskSort = panel.querySelector('[data-planning-task-sort]');
  const referenceInput = formTask.querySelector('[data-planning-task-link]');
  const list = panel.querySelector('[data-planning-list]');
  const notice = panel.querySelector('[data-planning-status]');
  const allowedMaterials = new Map(materials.map((m) => [m.id, m]));
  let goals = [];
  let subgoals = [];
  let tasks = [];

  panel.hidden = false;
  materialSelect.replaceChildren(option('', 'Sem aula vinculada'));
  for (const material of materials) materialSelect.append(option(material.id, material.title));

  function refreshOptions(select, items, placeholder) {
    const saved = select.value;
    select.replaceChildren(option('', placeholder));
    for (const item of items) select.append(option(item.id, item.title));
    if (items.some((item) => item.id === saved)) select.value = saved;
  }

  function refreshTaskSubgoals() {
    const previous = taskSubgoalSelect.value;
    const available = subgoals.filter((item) => item.goal_id === goalSelect.value);
    taskSubgoalSelect.replaceChildren(option('', 'Sem subobjetivo'));
    for (const item of available) taskSubgoalSelect.append(option(item.id, item.title));
    if (available.some((item) => item.id === previous)) taskSubgoalSelect.value = previous;
  }

  async function mutate(action, success) {
    setStatus(notice, '');
    try {
      await action();
      setStatus(notice, success, 'success');
      return true;
    } catch (error) {
      setStatus(notice, error.message || 'Não foi possível salvar.', 'error');
      return false;
    }
  }

  function inlineEditGoal(goal, host) {
    const form = document.createElement('form');
    form.className = 'planning-edit-form';
    form.hidden = true;
    const title = inputField('Título', goal.title, { maxLength: 160 });
    const deadline = inputField('Prazo', goal.target_date, { type: 'date' });
    const status = selectField('Situação', [
      { id: 'active', title: 'Em andamento' },
      { id: 'completed', title: 'Concluído' },
      { id: 'archived', title: 'Arquivado' },
    ], goal.status);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Salvar objetivo';
    form.append(title.label, deadline.label, status.label, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !title.input.value.trim()) return;
      save.disabled = true;
      void mutate(async () => {
        const updated = await updateGoal(goal.id, {
          title: title.input.value, targetDate: deadline.input.value || null,
          status: status.select.value,
        });
        goals = goals.map((g) => g.id === updated.id ? updated : g);
        render();
      }, 'Objetivo atualizado.').finally(() => { save.disabled = false; });
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'planning-inline-button';
    edit.textContent = 'Editar objetivo';
    edit.setAttribute('aria-expanded', 'false');
    edit.addEventListener('click', () => {
      form.hidden = !form.hidden;
      edit.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) title.input.focus();
    });
    host.append(edit, form);
  }

  function inlineEditSubgoal(subgoal, host) {
    const form = document.createElement('form');
    form.className = 'planning-edit-form';
    form.hidden = true;
    const title = inputField('Nome do subobjetivo', subgoal.title, { maxLength: 160 });
    const due = inputField('Prazo', subgoal.due_date, { type: 'date' });
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Salvar subobjetivo';
    form.append(title.label, due.label, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !title.input.value.trim()) return;
      save.disabled = true;
      void mutate(async () => {
        const updated = await updateSubgoal(subgoal.id, {
          title: title.input.value, dueDate: due.input.value || null,
        });
        subgoals = subgoals.map((s) => s.id === updated.id ? updated : s);
        render();
      }, 'Subobjetivo atualizado.').finally(() => { save.disabled = false; });
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'planning-inline-button';
    edit.textContent = 'Editar subobjetivo';
    edit.setAttribute('aria-expanded', 'false');
    edit.addEventListener('click', () => {
      form.hidden = !form.hidden;
      edit.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) title.input.focus();
    });
    host.append(edit, form);
  }

  async function moveTask(task, siblingTasks, delta) {
    const siblings = sortedPlanningTasks(siblingTasks, { sort: 'manual' });
    const i = siblings.findIndex((item) => item.id === task.id);
    const next = i + delta;
    if (i < 0 || next < 0 || next >= siblings.length) return;
    const ordering = sortedPlanningTasks(
      tasks.filter((item) => item.goal_id === task.goal_id),
      { sort: 'manual' },
    ).map((item) => item.id);
    const original = ordering.indexOf(siblings[i].id);
    const target = ordering.indexOf(siblings[next].id);
    [ordering[original], ordering[target]] = [ordering[target], ordering[original]];
    await mutate(async () => {
      const changed = await reorderGoalTasks(task.goal_id, ordering);
      const ranks = new Map(changed.map((item) => [item.id, item.sort_order]));
      tasks = tasks.map((item) => ranks.has(item.id)
        ? { ...item, sort_order: ranks.get(item.id) }
        : item);
      render();
    }, 'Ordem das tarefas salva.');
  }

  function inlineEditTask(task, host) {
    const form = document.createElement('form');
    form.className = 'planning-edit-form';
    form.hidden = true;
    const title = inputField('Tarefa', task.title);
    const due = inputField('Prazo', task.due_date, { type: 'date' });
    const reference = inputField('Link de apoio (HTTPS)', task.reference_url, {
      type: 'url', maxLength: 2048,
    });
    const linkedSubgoals = subgoals.filter((s) => s.goal_id === task.goal_id);
    const subgoal = selectField('Subobjetivo', linkedSubgoals, task.subgoal_id, 'Sem subobjetivo');
    const materialItems = materials.map((m) => ({ id: m.id, title: m.title }));
    const material = selectField('Aula relacionada', materialItems, task.material_id, 'Sem aula');
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Salvar tarefa';
    form.append(title.label, due.label, subgoal.label, material.label, reference.label, save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !title.input.value.trim()) return;
      save.disabled = true;
      void mutate(async () => {
        const updated = await updateTask(task.id, {
          title: title.input.value, dueDate: due.input.value || null,
          subgoalId: subgoal.select.value || null,
          materialId: material.select.value || null,
          referenceUrl: reference.input.value || null,
        });
        tasks = tasks.map((t) => t.id === updated.id ? updated : t);
        render();
      }, 'Tarefa atualizada.').finally(() => { save.disabled = false; });
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'planning-inline-button';
    edit.textContent = 'Editar tarefa';
    edit.setAttribute('aria-expanded', 'false');
    edit.addEventListener('click', () => {
      form.hidden = !form.hidden;
      edit.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) title.input.focus();
    });
    host.append(edit, form);
  }

  function renderTasks(host, related) {
    const visible = sortedPlanningTasks(related, { filter: taskFilter.value, sort: taskSort.value });
    const ul = document.createElement('ul');
    ul.className = 'planning-tasks';
    for (const task of visible) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = Boolean(task.completed_at);
      check.setAttribute('aria-label', `Concluir tarefa: ${task.title}`);
      const text = document.createElement('span');
      text.textContent = task.title;
      label.append(check, text);
      li.append(label);
      if (task.due_date) {
        const due = document.createElement('small');
        due.textContent = 'Até ' + dateLabel(task.due_date);
        li.append(due);
      }
      if (task.reference_url) {
        const external = document.createElement('a');
        external.href = task.reference_url;
        external.target = '_blank';
        external.rel = 'noopener noreferrer';
        external.textContent = 'Link de apoio';
        li.append(external);
      }
      const material = allowedMaterials.get(task.material_id);
      if (material) {
        const link = document.createElement('a');
        link.href = `./material.html?id=${encodeURIComponent(material.id)}`;
        link.textContent = 'Abrir aula';
        li.append(link);
      }
      if (taskSort.value === 'manual' && taskFilter.value === 'all' && related.length > 1) {
        const controls = document.createElement('span');
        controls.className = 'planning-order-controls';
        const siblings = sortedPlanningTasks(related, { sort: 'manual' });
        const index = siblings.findIndex((item) => item.id === task.id);
        for (const [direction, delta] of [['Subir', -1], ['Descer', 1]]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'planning-inline-button';
          button.textContent = direction;
          button.setAttribute('aria-label', `${direction} tarefa: ${task.title}`);
          button.disabled = index + delta < 0 || index + delta >= siblings.length;
          button.addEventListener('click', async () => {
            button.disabled = true;
            await moveTask(task, related, delta);
            button.disabled = false;
          });
          controls.append(button);
        }
        li.append(controls);
      }
      inlineEditTask(task, li);
      check.addEventListener('change', async () => {
        const desired = check.checked;
        check.disabled = true;
        const updated = await mutate(async () => {
          const response = await setTaskCompleted(task.id, desired);
          tasks = tasks.map((t) => t.id === response.id ? response : t);
          render();
        }, desired ? 'Tarefa concluída.' : 'Tarefa reaberta.');
        if (!updated) check.checked = !desired;
        check.disabled = false;
      });
      ul.append(li);
    }
    host.append(ul);
  }

  function render() {
    refreshOptions(goalSelect, goals, 'Selecione um objetivo');
    refreshOptions(subgoalGoalSelect, goals, 'Selecione um objetivo');
    refreshTaskSubgoals();
    list.replaceChildren();

    if (!goals.length) {
      const empty = document.createElement('p');
      empty.className = 'planning-empty';
      empty.textContent = 'Nenhum objetivo criado ainda. Comece definindo o que deseja estudar.';
      list.append(empty);
      return;
    }

    for (const goal of goals) {
      const section = document.createElement('section');
      section.className = 'planning-goal';
      const head = document.createElement('div');
      head.className = 'planning-goal-header';
      const heading = document.createElement('h3');
      heading.textContent = goal.title;
      head.append(heading);
      inlineEditGoal(goal, head);
      section.append(head);

      const progress = progressForGoal(goal, tasks);
      const details = document.createElement('p');
      details.className = 'planning-meta';
      const statuses = { active: 'Em andamento', completed: 'Concluído', archived: 'Arquivado' };
      details.textContent = `${progress.completed} de ${progress.total} tarefas concluídas · ${statuses[goal.status] || 'Em andamento'}${goal.target_date ? ' · Meta: ' + dateLabel(goal.target_date) : ''}`;
      section.append(details);
      if (goal.description) {
        const description = document.createElement('p');
        description.textContent = goal.description;
        section.append(description);
      }

      for (const subgoal of subgoals.filter((item) => item.goal_id === goal.id)) {
        const child = document.createElement('section');
        child.className = 'planning-subgoal';
        const label = document.createElement('h4');
        label.textContent = subgoal.title;
        child.append(label);
        inlineEditSubgoal(subgoal, child);
        if (subgoal.due_date) {
          const due = document.createElement('p');
          due.className = 'planning-meta';
          due.textContent = 'Prazo: ' + dateLabel(subgoal.due_date);
          child.append(due);
        }
        renderTasks(child, tasks.filter((t) => t.goal_id === goal.id && t.subgoal_id === subgoal.id));
        section.append(child);
      }

      const without = tasks.filter((t) => t.goal_id === goal.id && !t.subgoal_id);
      if (without.length) {
        const title = document.createElement('h4');
        title.className = 'planning-ungrouped-title';
        title.textContent = 'Outras tarefas';
        section.append(title);
        renderTasks(section, without);
      }
      if (!tasks.some((t) => t.goal_id === goal.id)) {
        const empty = document.createElement('p');
        empty.className = 'planning-empty';
        empty.textContent = 'Adicione uma tarefa para acompanhar este objetivo.';
        section.append(empty);
      }
      list.append(section);
    }
  }

  async function submit(form, action, success) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try { await mutate(action, success); }
    finally { button.disabled = false; }
  }

  formGoal.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formGoal.reportValidity()) return;
    const title = formGoal.querySelector('[name="title"]');
    const deadline = formGoal.querySelector('[name="targetDate"]');
    void submit(formGoal, async () => {
      const created = await createGoal({ title: title.value, targetDate: deadline.value || null });
      goals.unshift(created);
      title.value = '';
      deadline.value = '';
      render();
      goalSelect.value = created.id;
      subgoalGoalSelect.value = created.id;
      refreshTaskSubgoals();
    }, 'Objetivo criado.');
  });

  formSubgoal.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formSubgoal.reportValidity() || !subgoalGoalSelect.value) return;
    const title = formSubgoal.querySelector('[name="title"]');
    const due = formSubgoal.querySelector('[name="dueDate"]');
    void submit(formSubgoal, async () => {
      const created = await createSubgoal(subgoalGoalSelect.value, {
        title: title.value, dueDate: due.value || null,
      });
      subgoals.push(created);
      title.value = '';
      due.value = '';
      render();
    }, 'Subobjetivo criado.');
  });

  formTask.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formTask.reportValidity() || !goalSelect.value) return;
    const title = formTask.querySelector('[name="title"]');
    const due = formTask.querySelector('[name="dueDate"]');
    void submit(formTask, async () => {
      const task = await createTask(goalSelect.value, {
        title: title.value, dueDate: due.value || null,
        materialId: materialSelect.value || null, subgoalId: taskSubgoalSelect.value || null,
        referenceUrl: referenceInput.value || null,
      });
      tasks.push(task);
      title.value = '';
      due.value = '';
      materialSelect.value = '';
      referenceInput.value = '';
      taskSubgoalSelect.value = '';
      render();
    }, 'Tarefa criada.');
  });

  goalSelect.addEventListener('change', refreshTaskSubgoals);
  taskFilter.addEventListener('change', render);
  taskSort.addEventListener('change', render);

  try {
    const response = await getPlanning();
    goals = response.goals || [];
    subgoals = response.subgoals || [];
    tasks = response.tasks || [];
    render();
  } catch (error) {
    setStatus(notice, error.message || 'O planejamento está temporariamente indisponível.', 'error');
    for (const button of panel.querySelectorAll('[type="submit"]')) button.disabled = true;
  }
}
