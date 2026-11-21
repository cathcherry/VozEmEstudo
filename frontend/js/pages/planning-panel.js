import { ninoNote } from '../utils/material-ui.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import { progressForGoal, dateLabel, sortedPlanningTasks } from '../utils/planning-view.js';
import {
  getPlanning, createGoal, updateGoal, createSubgoal, updateSubgoal, createTask,
  updateTask, reorderGoalTasks, setTaskCompleted,
} from '../api/planning.api.js';

// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal = (name, detail) => {
  try {
    const view = document.defaultView;
    if (view?.CustomEvent) document.dispatchEvent(new view.CustomEvent(`voz:${name}`, { detail }));
  } catch { /* the dashboard summary is optional */ }
};

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

/** Today as YYYY-MM-DD in this device's time zone (task due dates are calendar days). */
function localIsoDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

  const toolbar = panel.querySelector('[data-planning-toolbar]');
  const sortControls = panel.querySelector('[data-planning-controls]');
  const forms = { goal: formGoal, subgoal: formSubgoal, task: formTask };
  const openers = toolbar ? Object.fromEntries(
    [...toolbar.querySelectorAll('[data-planning-open]')].map((b) => [b.dataset.planningOpen, b]),
  ) : {};
  let openedFrom = null;
  // Creation happens in one modal dialog that shows the requested form; nothing stays open on
  // the page. Without the dialog (older markup) the forms open inline as before.
  const dialog = panel.querySelector('[data-planning-dialog]');
  const dialogError = dialog ? document.createElement('p') : null;
  if (dialogError) {
    dialogError.className = 'planning-dialog-error';
    dialogError.setAttribute('role', 'alert');
    dialog.append(dialogError);
  }

  // One creation form at a time, opened on request. Without the toolbar (older markup) the
  // forms simply stay visible as before.
  function showForm(kind, { goalId = null, from = null } = {}) {
    if (!toolbar) return;
    for (const [name, form] of Object.entries(forms)) {
      form.hidden = name !== kind;
      openers[name]?.setAttribute('aria-expanded', String(name === kind));
    }
    openedFrom = from || openers[kind] || null;
    if (goalId) {
      if (kind === 'task') { goalSelect.value = goalId; refreshTaskSubgoals(); }
      if (kind === 'subgoal') subgoalGoalSelect.value = goalId;
    }
    const form = forms[kind];
    if (dialog) {
      if (dialogError) dialogError.textContent = '';
      dialog.setAttribute('aria-labelledby', form.querySelector('h3')?.id || '');
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    }
    // A new task starts in the first goal; the title is what the student types first.
    if (kind === 'task' && !goalSelect.value && goals.length) { goalSelect.value = goals[0].id; refreshTaskSubgoals(); }
    const first = kind === 'subgoal' && !goalId
      ? form.querySelector('select, input')
      : form.querySelector('[name="title"]');
    form.scrollIntoView?.({ block: 'nearest' });
    first?.focus();
  }
  function hideForms({ restoreFocus = true } = {}) {
    if (!toolbar) return;
    for (const [name, form] of Object.entries(forms)) {
      form.hidden = true;
      openers[name]?.setAttribute('aria-expanded', 'false');
    }
    if (dialog?.open) dialog.close();
    const target = [openedFrom, openers.goal, list.querySelector('.nino-note-action')]
      .find((element) => element?.isConnected && !element.closest('[hidden]'));
    openedFrom = null;
    if (restoreFocus) target?.focus();
  }
  for (const [kind, button] of Object.entries(openers)) {
    button.addEventListener('click', () => {
      if (!forms[kind].hidden) hideForms();
      else showForm(kind);
    });
  }
  for (const cancel of panel.querySelectorAll('[data-planning-cancel]'))
    cancel.addEventListener('click', () => hideForms());
  // Escape or a click on the backdrop closes the dialog like Cancel.
  dialog?.addEventListener('cancel', (event) => { event.preventDefault(); hideForms(); });
  dialog?.addEventListener('click', (event) => { if (event.target === dialog) hideForms(); });
  for (const form of Object.values(forms))
    form.addEventListener('keydown', (event) => {
      // Escape closes the form first; a second Escape closes the dialog.
      if (event.key === 'Escape' && toolbar && !form.hidden) {
        event.preventDefault();
        event.stopPropagation();
        hideForms();
      }
    });
  document.addEventListener('voz:planning-command', (event) => {
    const action = event.detail?.action;
    // Tasks created elsewhere on the page (e.g. "Planejar uma unidade"): load them.
    if (action === 'reload') {
      void getPlanning()
        .then((response) => {
          goals = response.goals || [];
          subgoals = response.subgoals || [];
          tasks = response.tasks || [];
          render();
          signal('planning', { changed: true });
        })
        .catch(() => {});
      return;
    }
    if (action === 'goal' || (action === 'task' && !goals.length)) showForm('goal');
    else if (action === 'task') showForm('task');
  });

  function contextButton(text, kind, goal) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'planning-inline-button';
    button.textContent = text;
    button.setAttribute('aria-label', `${text} em ${goal.title}`);
    button.addEventListener('click', () => showForm(kind, { goalId: goal.id, from: button }));
    return button;
  }

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

  // Confirmations show in a small inline banner that clears itself; errors stay until the next
  // action. With the creation dialog open, the error also appears inside it, next to the form.
  let clearTimer;
  async function mutate(action, success) {
    clearTimeout(clearTimer);
    setStatus(notice, '');
    if (dialogError) dialogError.textContent = '';
    try {
      await action();
      setStatus(notice, success, 'success');
      clearTimer = setTimeout(() => { if (notice.dataset.state === 'success') setStatus(notice, ''); }, 6000);
      return true;
    } catch (error) {
      const message = error.message || 'Não foi possível salvar.';
      setStatus(notice, message, 'error');
      if (dialog?.open && dialogError) dialogError.textContent = message;
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
    if (!visible.length) {
      // Say why the list is empty instead of showing nothing.
      const empty = document.createElement('p');
      empty.className = 'planning-empty';
      empty.textContent = !related.length
        ? 'Nenhuma tarefa aqui ainda.'
        : taskFilter.value === 'completed'
          ? 'Nenhuma tarefa concluída aqui.'
          : 'Todas as tarefas daqui estão concluídas.';
      host.append(empty);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'planning-tasks';
    const today = localIsoDay();
    for (const task of visible) {
      const li = document.createElement('li');
      li.className = 'planning-task';
      if (task.completed_at) li.classList.add('is-done');
      else if (task.due_date && String(task.due_date).slice(0, 10) < today) li.classList.add('is-overdue');
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
    signal('planning', { goals, subgoals, tasks });
    if (openers.task) openers.task.hidden = !goals.length;
    if (openers.subgoal) openers.subgoal.hidden = !goals.length;
    if (sortControls && toolbar) sortControls.hidden = !tasks.length;
    // With nothing created yet, the empty card carries the one action.
    if (toolbar) toolbar.hidden = !goals.length;

    if (!goals.length) {
      list.append(ninoNote('Um objetivo reúne as tarefas de uma prova, matéria ou projeto. Comece pelo que você quer alcançar.', 'reading', {
        className: 'planning-empty planning-start',
        artId: 'empty.planner',
        title: 'Nenhum objetivo criado ainda',
        action: toolbar ? { label: 'Criar primeiro objetivo', onClick: (button) => showForm('goal', { from: button }) } : null,
      }));
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
      const actions = document.createElement('div');
      actions.className = 'planning-goal-actions';
      head.append(actions);
      if (toolbar) actions.append(contextButton('Adicionar tarefa', 'task', goal), contextButton('Adicionar subobjetivo', 'subgoal', goal));
      inlineEditGoal(goal, actions);
      section.append(head);

      const progress = progressForGoal(goal, tasks);
      const details = document.createElement('p');
      details.className = 'planning-meta';
      const statuses = { active: 'Em andamento', completed: 'Concluído', archived: 'Arquivado' };
      details.textContent = `${progress.completed} de ${progress.total} tarefas concluídas · ${statuses[goal.status] || 'Em andamento'}${goal.target_date ? ' · Meta: ' + dateLabel(goal.target_date) : ''}`;
      // A quiet bar under the title says the same as the sentence (which stays for screen readers).
      const bar = document.createElement('span');
      bar.className = 'planning-progress';
      bar.setAttribute('aria-hidden', 'true');
      bar.style.setProperty('--done', String(progress.total ? progress.completed / progress.total : 0));
      section.dataset.status = goal.status || 'active';
      section.append(details, bar);
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
      hideForms();
    }, 'Objetivo criado. Agora você pode adicionar tarefas a ele.');
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
      hideForms();
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
      const details = formTask.querySelector('[data-planning-more]');
      if (details) { details.hidden = true; formTask.querySelector('[data-planning-more-toggle]')?.setAttribute('aria-expanded', 'false'); }
      render();
      hideForms();
    }, 'Tarefa criada.');
  });

  goalSelect.addEventListener('change', refreshTaskSubgoals);
  // Optional task details stay one click away so the form starts short.
  const moreToggle = formTask.querySelector('[data-planning-more-toggle]');
  const more = formTask.querySelector('[data-planning-more]');
  moreToggle?.addEventListener('click', () => {
    more.hidden = !more.hidden;
    moreToggle.setAttribute('aria-expanded', String(!more.hidden));
    if (!more.hidden) more.querySelector('select, input')?.focus();
  });
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
    signal('planning', { error: error.message || 'O planejamento está temporariamente indisponível.' });
    for (const button of panel.querySelectorAll('[type="submit"]')) button.disabled = true;
  }
}
