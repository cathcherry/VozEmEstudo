import { ninoNote } from '../utils/material-ui.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import { toast } from '../utils/toast.js';
import {
  progressForGoal, sortedPlanningTasks, deadlineState, deadlineFromText, quickDeadlines,
  longDayLabel, shortDayLabel,
} from '../utils/planning-view.js';
import {
  getPlanning, createGoal, updateGoal, deleteGoal, createSubgoal, updateSubgoal, deleteSubgoal,
  createTask, updateTask, deleteTask, reorderGoalTasks, setTaskCompleted,
} from '../api/planning.api.js';

// Goals are cards: title, deadline in words, a progress bar and the count, then the tasks with
// their checkboxes, and a quick "Adicionar tarefa" line at the end of the card (and of each
// subgoal). Less frequent actions (edit, add a subgoal, complete, archive, delete, reorder) live
// in one "⋯" menu per goal, subgoal and task. The dialog creates goals and, with every detail,
// tasks (from Início or "Mais opções").

// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal = (name, detail) => {
  try {
    const view = document.defaultView;
    if (view?.CustomEvent) document.dispatchEvent(new view.CustomEvent(`voz:${name}`, { detail }));
  } catch { /* the dashboard summary is optional */ }
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function button(text, className, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
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

/** A "⋯" menu (details.row-menu: floating-menu.js places it, closes it and adds arrow keys). */
function rowMenu(label, items) {
  const menu = el('details', 'row-menu planning-menu');
  const summary = el('summary', 'planning-menu-button');
  summary.setAttribute('aria-label', label);
  summary.title = label;
  const dots = el('span', '', '⋯');
  dots.setAttribute('aria-hidden', 'true');
  summary.append(dots);
  const content = el('div', 'row-menu-content planning-menu-content');
  for (const item of items.filter(Boolean)) {
    const entry = button(item.label, item.danger ? 'is-danger' : '', () => {
      menu.open = false;
      item.onClick(summary);
    });
    if (item.disabled) entry.disabled = true;
    content.append(entry);
  }
  menu.append(summary, content);
  return menu;
}

/** "Prazo: qui., 26/11 · faltam 3 dias": the date and, when close or passed, the same in words. */
function deadlineBadge(isoDay, { done = false, prefix = 'Prazo:' } = {}) {
  const info = deadlineState(isoDay, { done });
  if (info.state === 'none') return null;
  const badge = el('span', 'planning-due');
  badge.dataset.state = info.state;
  badge.append(el('span', 'planning-due-date', `${prefix} ${info.date}`));
  if (info.text) badge.append(el('span', 'planning-due-words', info.text));
  return badge;
}

export async function initPlanningPanel({ materials }) {
  const panel = document.querySelector('[data-planning-panel]');
  if (!panel || !(await isFeatureEnabled('planning'))) return;
  const formGoal = panel.querySelector('[data-planning-goal-form]');
  const formTask = panel.querySelector('[data-planning-task-form]');
  const goalSelect = panel.querySelector('[data-planning-goal-select]');
  const taskSubgoalSelect = panel.querySelector('[data-planning-task-subgoal]');
  const materialSelect = panel.querySelector('[data-planning-material-select]');
  const taskFilter = panel.querySelector('[data-planning-task-filter]');
  const taskSort = panel.querySelector('[data-planning-task-sort]');
  const referenceInput = formTask.querySelector('[data-planning-task-link]');
  const list = panel.querySelector('[data-planning-list]');
  const notice = panel.querySelector('[data-planning-status]');
  const goalTitle = formGoal.querySelector('[name="title"]');
  const goalDate = formGoal.querySelector('[name="targetDate"]');
  const quickDates = formGoal.querySelector('[data-planning-quick-dates]');
  const detected = formGoal.querySelector('[data-planning-goal-detected]');
  const allowedMaterials = new Map(materials.map((m) => [m.id, m]));
  let goals = [];
  let subgoals = [];
  let tasks = [];
  // After a re-render, focus returns to the control the person was using (by key).
  let focusKey = '';

  const toolbar = panel.querySelector('[data-planning-toolbar]');
  const sortControls = panel.querySelector('[data-planning-controls]');
  const forms = { goal: formGoal, task: formTask };
  const openers = Object.fromEntries(
    [...panel.querySelectorAll('[data-planning-open]')].map((b) => [b.dataset.planningOpen, b]),
  );
  let openedFrom = null;
  const dialog = panel.querySelector('[data-planning-dialog]');
  const dialogError = el('p', 'planning-dialog-error');
  dialogError.setAttribute('role', 'alert');
  dialog.append(dialogError);

  // ---- Goal deadline: shortcuts and a deadline read from the text ("até quinta-feira") -------
  let autoDate = false;
  function syncQuickDates() {
    for (const chip of quickDates.querySelectorAll('button'))
      chip.setAttribute('aria-pressed', String((chip.dataset.date || '') === goalDate.value));
  }
  function renderQuickDates() {
    quickDates.replaceChildren();
    for (const { label, date } of [...quickDeadlines(), { label: 'Sem prazo', date: '' }]) {
      const chip = button(label, 'planning-chip', () => {
        goalDate.value = date;
        autoDate = false;
        detected.textContent = date ? `Prazo: ${longDayLabel(date)}.` : '';
        syncQuickDates();
      });
      chip.dataset.date = date;
      if (date) chip.title = longDayLabel(date);
      quickDates.append(chip);
    }
    syncQuickDates();
  }
  goalTitle.addEventListener('input', () => {
    const found = deadlineFromText(goalTitle.value);
    if (found && (!goalDate.value || autoDate)) {
      goalDate.value = found.date;
      autoDate = true;
      detected.textContent = `Prazo entendido pelo texto ("${found.phrase}"): ${longDayLabel(found.date)}. Altere se preferir.`;
    } else if (!found && autoDate) {
      goalDate.value = '';
      autoDate = false;
      detected.textContent = '';
    }
    syncQuickDates();
  });
  goalDate.addEventListener('input', () => {
    autoDate = false;
    detected.textContent = goalDate.value ? `Prazo: ${longDayLabel(goalDate.value)}.` : '';
    syncQuickDates();
  });

  // ---- Dialog: one form at a time ---------------------------------------------------------
  function showForm(kind, { goalId = null, subgoalId = null, title = '', from = null } = {}) {
    for (const [name, form] of Object.entries(forms)) {
      form.hidden = name !== kind;
      openers[name]?.setAttribute('aria-expanded', String(name === kind));
    }
    openedFrom = from || openers[kind] || null;
    const form = forms[kind];
    dialogError.textContent = '';
    dialog.setAttribute('aria-labelledby', form.querySelector('h3')?.id || '');
    if (kind === 'goal') renderQuickDates();
    if (kind === 'task') {
      if (goalId) goalSelect.value = goalId;
      // A new task starts in the first goal; the title is what the student types first.
      if (!goalSelect.value && goals.length) goalSelect.value = goals[0].id;
      refreshTaskSubgoals();
      if (subgoalId) taskSubgoalSelect.value = subgoalId;
      if (title) formTask.querySelector('[name="title"]').value = title;
    }
    if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    form.querySelector('[name="title"]')?.focus();
  }
  function hideForms({ restoreFocus = true } = {}) {
    for (const [name, form] of Object.entries(forms)) {
      form.hidden = true;
      openers[name]?.setAttribute('aria-expanded', 'false');
    }
    if (dialog.open) dialog.close();
    const target = [openedFrom, openers.goal, list.querySelector('.nino-note-action')]
      .find((element) => element?.isConnected && !element.closest('[hidden]'));
    openedFrom = null;
    if (restoreFocus) target?.focus();
  }
  for (const [kind, opener] of Object.entries(openers))
    opener.addEventListener('click', () => showForm(kind));
  for (const cancel of panel.querySelectorAll('[data-planning-cancel]'))
    cancel.addEventListener('click', () => hideForms());
  // Escape or a click on the backdrop closes the dialog like Cancel.
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); hideForms(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) hideForms(); });

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

  // Confirmations are toasts that go away by themselves; errors stay in the status line until the
  // next action (and also appear inside the dialog when it is open).
  async function mutate(action, success) {
    setStatus(notice, '');
    dialogError.textContent = '';
    try {
      await action();
      if (success) toast(success, { type: 'success' });
      return true;
    } catch (error) {
      const message = error.message || 'Não foi possível salvar.';
      setStatus(notice, message, 'error');
      if (dialog.open) dialogError.textContent = message;
      return false;
    }
  }

  // ---- Inline edit forms (opened from the "⋯" menus) -------------------------------------
  function editForm(fields, saveLabel, onSave) {
    const form = el('form', 'planning-edit-form');
    form.hidden = true;
    const save = el('button', 'primary-action', saveLabel);
    save.type = 'submit';
    const cancel = button('Cancelar', 'text-action', () => close());
    const actions = el('div', 'planning-edit-actions');
    actions.append(cancel, save);
    form.append(...fields.map((field) => field.label), actions);
    let opener = null;
    function close() {
      form.hidden = true;
      if (opener?.isConnected) opener.focus();
    }
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      void onSave().finally(() => { save.disabled = false; });
    });
    return {
      form,
      open(from) {
        opener = from;
        form.hidden = false;
        fields[0].input?.focus();
      },
    };
  }

  function goalEditor(goal) {
    const title = inputField('Título', goal.title, { maxLength: 160 });
    title.input.required = true;
    const deadline = inputField('Prazo', goal.target_date, { type: 'date' });
    const status = selectField('Situação', [
      { id: 'active', title: 'Em andamento' },
      { id: 'completed', title: 'Concluído' },
      { id: 'archived', title: 'Arquivado' },
    ], goal.status);
    return editForm([title, deadline, status], 'Salvar objetivo', () => mutate(async () => {
      const updated = await updateGoal(goal.id, {
        title: title.input.value, targetDate: deadline.input.value || null,
        status: status.select.value,
      });
      goals = goals.map((g) => g.id === updated.id ? updated : g);
      render();
    }, 'Objetivo atualizado.'));
  }

  function subgoalEditor(subgoal) {
    const title = inputField('Nome do subobjetivo', subgoal.title, { maxLength: 160 });
    title.input.required = true;
    const due = inputField('Prazo', subgoal.due_date, { type: 'date' });
    return editForm([title, due], 'Salvar subobjetivo', () => mutate(async () => {
      const updated = await updateSubgoal(subgoal.id, {
        title: title.input.value, dueDate: due.input.value || null,
      });
      subgoals = subgoals.map((s) => s.id === updated.id ? updated : s);
      render();
    }, 'Subobjetivo atualizado.'));
  }

  function taskEditor(task) {
    const title = inputField('Tarefa', task.title);
    title.input.required = true;
    const due = inputField('Prazo', task.due_date, { type: 'date' });
    const reference = inputField('Link de apoio (HTTPS)', task.reference_url, {
      type: 'url', maxLength: 2048,
    });
    const linkedSubgoals = subgoals.filter((s) => s.goal_id === task.goal_id);
    const subgoal = selectField('Subobjetivo', linkedSubgoals, task.subgoal_id, 'Sem subobjetivo');
    const materialItems = materials.map((m) => ({ id: m.id, title: m.title }));
    const material = selectField('Aula relacionada', materialItems, task.material_id, 'Sem aula');
    return editForm([title, due, subgoal, material, reference], 'Salvar tarefa', () => mutate(async () => {
      const updated = await updateTask(task.id, {
        title: title.input.value, dueDate: due.input.value || null,
        subgoalId: subgoal.select.value || null,
        materialId: material.select.value || null,
        referenceUrl: reference.input.value || null,
      });
      tasks = tasks.map((t) => t.id === updated.id ? updated : t);
      render();
    }, 'Tarefa atualizada.'));
  }

  // ---- Changes from the menus --------------------------------------------------------------
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
    focusKey = `menu:${task.id}`;
    await mutate(async () => {
      const changed = await reorderGoalTasks(task.goal_id, ordering);
      const ranks = new Map(changed.map((item) => [item.id, item.sort_order]));
      tasks = tasks.map((item) => ranks.has(item.id)
        ? { ...item, sort_order: ranks.get(item.id) }
        : item);
      render();
    }, 'Ordem das tarefas salva.');
  }

  function setGoalStatus(goal, status, success) {
    focusKey = `goal-menu:${goal.id}`;
    void mutate(async () => {
      const updated = await updateGoal(goal.id, { status });
      goals = goals.map((g) => g.id === updated.id ? updated : g);
      render();
    }, success);
  }

  function removeGoal(goal) {
    const count = tasks.filter((t) => t.goal_id === goal.id).length;
    const detail = count
      ? (count === 1 ? ' A tarefa dele também será excluída.' : ` As ${count} tarefas dele também serão excluídas.`)
      : '';
    if (!confirm(`Excluir o objetivo "${goal.title}"?${detail} Isso não pode ser desfeito.`)) return;
    focusKey = 'toolbar';
    void mutate(async () => {
      await deleteGoal(goal.id);
      goals = goals.filter((g) => g.id !== goal.id);
      subgoals = subgoals.filter((s) => s.goal_id !== goal.id);
      tasks = tasks.filter((t) => t.goal_id !== goal.id);
      render();
    }, 'Objetivo excluído.');
  }

  function removeSubgoal(subgoal) {
    if (!confirm(`Excluir o subobjetivo "${subgoal.title}"? As tarefas dele continuam no objetivo.`)) return;
    focusKey = `goal-menu:${subgoal.goal_id}`;
    void mutate(async () => {
      await deleteSubgoal(subgoal.id);
      subgoals = subgoals.filter((s) => s.id !== subgoal.id);
      tasks = tasks.map((t) => t.subgoal_id === subgoal.id ? { ...t, subgoal_id: null } : t);
      render();
    }, 'Subobjetivo excluído.');
  }

  function removeTask(task) {
    if (!confirm(`Excluir a tarefa "${task.title}"?`)) return;
    focusKey = `add:${task.goal_id}:${task.subgoal_id || ''}`;
    void mutate(async () => {
      await deleteTask(task.id);
      tasks = tasks.filter((t) => t.id !== task.id);
      render();
    }, 'Tarefa excluída.');
  }

  // ---- Quick add: a task line at the end of a goal or subgoal --------------------------------
  function quickAdd(goal, subgoal = null) {
    const form = el('form', 'planning-quick-add');
    const key = `add:${goal.id}:${subgoal?.id || ''}`;
    const where = subgoal ? subgoal.title : goal.title;
    const label = el('label', 'sr-only', `Nova tarefa em ${where}`);
    const input = el('input');
    input.id = `planning-add-${goal.id}-${subgoal?.id || 'goal'}`;
    label.htmlFor = input.id;
    input.name = 'title';
    input.maxLength = 180;
    input.autocomplete = 'off';
    input.required = true;
    input.placeholder = 'Adicionar tarefa';
    input.dataset.focusKey = key;
    const hint = el('span', 'planning-quick-hint');
    hint.id = `${input.id}-hint`;
    hint.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', hint.id);
    const add = el('button', 'secondary-action planning-quick-submit', 'Adicionar');
    add.type = 'submit';
    add.setAttribute('aria-label', `Adicionar tarefa em ${where}`);
    const more = button('Mais opções', 'text-action planning-quick-more', () =>
      showForm('task', { goalId: goal.id, subgoalId: subgoal?.id, title: input.value, from: more }));
    more.setAttribute('aria-label', `Nova tarefa com prazo, aula ou link em ${where}`);
    more.setAttribute('aria-haspopup', 'dialog');
    // "Ensaiar a fala até quarta" gets that deadline (shown before saving).
    input.addEventListener('input', () => {
      const found = deadlineFromText(input.value);
      hint.textContent = found ? `Prazo: ${shortDayLabel(found.date)}` : '';
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) { input.focus(); return; }
      add.disabled = true;
      focusKey = key;
      const found = deadlineFromText(title);
      void mutate(async () => {
        const task = await createTask(goal.id, {
          title, dueDate: found?.date || null, subgoalId: subgoal?.id || null,
          materialId: null, referenceUrl: null,
        });
        tasks.push(task);
        render();
      }, 'Tarefa adicionada.').finally(() => { add.disabled = false; });
    });
    const row = el('div', 'planning-quick-row');
    row.append(label, input, add);
    form.append(row, hint);
    // In a subgoal the line stays short; the goal's own line offers every detail.
    if (!subgoal) form.append(more);
    return form;
  }

  function subgoalAdder(goal, opener) {
    const form = el('form', 'planning-subgoal-add');
    form.hidden = true;
    const title = inputField('Novo subobjetivo', '', { maxLength: 160 });
    title.input.required = true;
    title.input.placeholder = 'Ex.: Slides, Ensaio';
    title.input.dataset.focusKey = `subgoal-add:${goal.id}`;
    const due = inputField('Prazo (opcional)', '', { type: 'date' });
    const save = el('button', 'primary-action', 'Adicionar subobjetivo');
    save.type = 'submit';
    const cancel = button('Cancelar', 'text-action', () => { form.hidden = true; opener()?.focus(); });
    const actions = el('div', 'planning-edit-actions');
    actions.append(cancel, save);
    form.append(title.label, due.label, actions);
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !title.input.value.trim()) return;
      save.disabled = true;
      void mutate(async () => {
        const created = await createSubgoal(goal.id, {
          title: title.input.value, dueDate: due.input.value || null,
        });
        subgoals.push(created);
        focusKey = `add:${goal.id}:${created.id}`;
        render();
      }, 'Subobjetivo criado.').finally(() => { save.disabled = false; });
    });
    return form;
  }

  // ---- Rendering ------------------------------------------------------------------------------
  function renderTasks(host, related) {
    const visible = sortedPlanningTasks(related, { filter: taskFilter.value, sort: taskSort.value });
    if (!visible.length) {
      // Say why the list is empty instead of showing nothing (only when there is something hidden).
      if (related.length) {
        host.append(el('p', 'planning-empty', taskFilter.value === 'completed'
          ? 'Nenhuma tarefa concluída aqui.'
          : 'Todas as tarefas daqui estão concluídas.'));
      }
      return;
    }
    const ul = el('ul', 'planning-tasks');
    const manual = taskSort.value === 'manual' && taskFilter.value === 'all' && related.length > 1;
    const siblings = sortedPlanningTasks(related, { sort: 'manual' });
    for (const task of visible) {
      const li = el('li', 'planning-task');
      const done = Boolean(task.completed_at);
      const due = deadlineState(task.due_date, { done });
      if (done) li.classList.add('is-done');
      else if (due.state === 'overdue') li.classList.add('is-overdue');
      const label = el('label', 'planning-task-check');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = done;
      check.dataset.focusKey = `check:${task.id}`;
      check.setAttribute('aria-label', `Concluir tarefa: ${task.title}`);
      label.append(check, el('span', 'planning-task-title', task.title));
      const body = el('div', 'planning-task-body');
      body.append(label);
      const meta = el('div', 'planning-task-meta');
      const badge = deadlineBadge(task.due_date, { done, prefix: 'Até' });
      if (badge) meta.append(badge);
      const material = allowedMaterials.get(task.material_id);
      if (material) {
        const link = el('a', 'planning-task-link', `Aula: ${material.title}`);
        link.href = `./material.html?id=${encodeURIComponent(material.id)}`;
        meta.append(link);
      }
      if (task.reference_url) {
        const external = el('a', 'planning-task-link', 'Link de apoio');
        external.href = task.reference_url;
        external.target = '_blank';
        external.rel = 'noopener noreferrer';
        meta.append(external);
      }
      if (meta.childElementCount) body.append(meta);
      const editor = taskEditor(task);
      const index = siblings.findIndex((item) => item.id === task.id);
      const menu = rowMenu(`Mais ações da tarefa: ${task.title}`, [
        { label: 'Editar tarefa', onClick: (from) => editor.open(from) },
        manual && { label: 'Subir', disabled: index <= 0, onClick: () => void moveTask(task, related, -1) },
        manual && { label: 'Descer', disabled: index >= siblings.length - 1, onClick: () => void moveTask(task, related, 1) },
        { label: 'Excluir tarefa', danger: true, onClick: () => removeTask(task) },
      ]);
      menu.querySelector('summary').dataset.focusKey = `menu:${task.id}`;
      li.append(body, menu, editor.form);
      check.addEventListener('change', async () => {
        const desired = check.checked;
        check.disabled = true;
        focusKey = `check:${task.id}`;
        const updated = await mutate(async () => {
          const response = await setTaskCompleted(task.id, desired);
          tasks = tasks.map((t) => t.id === response.id ? response : t);
          render();
        }, desired ? 'Tarefa concluída.' : 'Tarefa reaberta.');
        if (!updated) { check.checked = !desired; check.disabled = false; }
      });
      ul.append(li);
    }
    host.append(ul);
  }

  const STATUS = { active: 'Em andamento', completed: 'Concluído', archived: 'Arquivado' };
  const RANK = { active: 0, completed: 1, archived: 2 };

  function renderGoal(goal) {
    const section = el('section', 'planning-goal');
    const status = goal.status || 'active';
    section.dataset.status = status;
    const headingId = `planning-goal-${goal.id}`;
    section.setAttribute('aria-labelledby', headingId);
    const progress = progressForGoal(goal, tasks);
    const goalSubgoals = subgoals.filter((item) => item.goal_id === goal.id);

    const head = el('header', 'planning-goal-header');
    const titles = el('div', 'planning-goal-titles');
    const heading = el('h3', '', goal.title);
    heading.id = headingId;
    titles.append(heading);
    const line = el('p', 'planning-goal-due');
    const badge = status === 'active' ? deadlineBadge(goal.target_date) : null;
    if (badge) line.append(badge);
    if (status !== 'active') line.append(el('span', 'planning-goal-status', STATUS[status] || STATUS.active));
    if (line.childElementCount) titles.append(line);
    const editor = goalEditor(goal);
    const adder = subgoalAdder(goal, () => section.querySelector('.planning-menu summary'));
    const menu = rowMenu(`Mais ações do objetivo: ${goal.title}`, [
      { label: 'Editar objetivo', onClick: (from) => editor.open(from) },
      { label: 'Novo subobjetivo', onClick: () => { adder.hidden = false; adder.querySelector('input')?.focus(); } },
      { label: 'Nova tarefa com detalhes', onClick: (from) => showForm('task', { goalId: goal.id, from }) },
      status === 'completed'
        ? { label: 'Reabrir objetivo', onClick: () => setGoalStatus(goal, 'active', 'Objetivo reaberto.') }
        : { label: 'Marcar como concluído', onClick: () => setGoalStatus(goal, 'completed', 'Objetivo concluído. Parabéns!') },
      status === 'archived'
        ? { label: 'Desarquivar', onClick: () => setGoalStatus(goal, 'active', 'Objetivo de volta à lista.') }
        : { label: 'Arquivar', onClick: () => setGoalStatus(goal, 'archived', 'Objetivo arquivado.') },
      { label: 'Excluir objetivo', danger: true, onClick: () => removeGoal(goal) },
    ]);
    menu.querySelector('summary').dataset.focusKey = `goal-menu:${goal.id}`;
    head.append(titles, menu);
    section.append(head);

    // Progress: the bar and the same in words (the words are what screen readers get).
    const progressRow = el('div', 'planning-progress-row');
    const bar = el('span', 'planning-progress');
    bar.setAttribute('aria-hidden', 'true');
    const share = progress.total ? progress.completed / progress.total : 0;
    bar.style.setProperty('--done', String(share));
    const words = el('p', 'planning-meta');
    words.textContent = !progress.total
      ? 'Nenhuma tarefa ainda'
      : progress.completed === progress.total
        ? `Todas as ${progress.total} tarefas concluídas`
        : `${progress.completed} de ${progress.total} tarefas concluídas`;
    if (progress.total && progress.completed === progress.total && progress.total === 1)
      words.textContent = 'A tarefa foi concluída';
    progressRow.append(bar, words);
    if (progress.total) {
      const percent = el('span', 'planning-percent', `${Math.round(share * 100)}%`);
      percent.setAttribute('aria-hidden', 'true');
      progressRow.append(percent);
    }
    section.append(progressRow, editor.form);
    if (goal.description) section.append(el('p', 'planning-goal-description', goal.description));

    for (const subgoal of goalSubgoals) {
      const child = el('section', 'planning-subgoal');
      const subHead = el('div', 'planning-subgoal-head');
      const label = el('h4', '', subgoal.title);
      label.id = `planning-subgoal-${subgoal.id}`;
      child.setAttribute('aria-labelledby', label.id);
      const subTasks = tasks.filter((t) => t.goal_id === goal.id && t.subgoal_id === subgoal.id);
      const subDone = subTasks.filter((t) => t.completed_at).length;
      const titleBox = el('div', 'planning-subgoal-titles');
      titleBox.append(label);
      const subMeta = el('p', 'planning-meta');
      if (subTasks.length) subMeta.append(el('span', '', `${subDone} de ${subTasks.length}`));
      const subBadge = deadlineBadge(subgoal.due_date, { done: subTasks.length > 0 && subDone === subTasks.length });
      if (subBadge) subMeta.append(subBadge);
      if (subMeta.childElementCount) titleBox.append(subMeta);
      const subEditor = subgoalEditor(subgoal);
      const subMenu = rowMenu(`Mais ações do subobjetivo: ${subgoal.title}`, [
        { label: 'Editar subobjetivo', onClick: (from) => subEditor.open(from) },
        { label: 'Excluir subobjetivo', danger: true, onClick: () => removeSubgoal(subgoal) },
      ]);
      subHead.append(titleBox, subMenu);
      child.append(subHead, subEditor.form);
      renderTasks(child, subTasks);
      if (status !== 'archived') child.append(quickAdd(goal, subgoal));
      section.append(child);
    }

    const without = tasks.filter((t) => t.goal_id === goal.id && !t.subgoal_id);
    if (goalSubgoals.length && without.length)
      section.append(el('h4', 'planning-ungrouped-title', 'Outras tarefas'));
    renderTasks(section, without);
    section.append(adder);
    if (status !== 'archived') section.append(quickAdd(goal));
    return section;
  }

  function render() {
    refreshOptions(goalSelect, goals, 'Selecione um objetivo');
    refreshTaskSubgoals();
    list.replaceChildren();
    signal('planning', { goals, subgoals, tasks });
    sortControls.hidden = !tasks.length;
    // With nothing created yet, the empty card carries the one action.
    toolbar.hidden = !goals.length;

    if (!goals.length) {
      list.append(ninoNote('Um objetivo reúne as tarefas de uma prova, matéria ou projeto. Comece pelo que você quer alcançar e até quando.', 'reading', {
        className: 'planning-empty planning-start',
        artId: 'empty.planner',
        title: 'Nenhum objetivo criado ainda',
        action: { label: 'Criar primeiro objetivo', onClick: (from) => showForm('goal', { from }) },
      }));
    } else {
      const ordered = [...goals].sort((a, b) => (RANK[a.status] ?? 0) - (RANK[b.status] ?? 0));
      for (const goal of ordered) list.append(renderGoal(goal));
    }
    if (focusKey) {
      const key = focusKey;
      focusKey = '';
      const target = key === 'toolbar'
        ? (openers.goal?.closest('[hidden]') ? list.querySelector('.nino-note-action') : openers.goal)
        : [...list.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === key);
      target?.focus();
    }
  }

  async function submit(form, action, success) {
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try { return await mutate(action, success); }
    finally { submitButton.disabled = false; }
  }

  formGoal.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formGoal.reportValidity()) return;
    void submit(formGoal, async () => {
      const created = await createGoal({ title: goalTitle.value, targetDate: goalDate.value || null });
      goals.unshift(created);
      goalTitle.value = '';
      goalDate.value = '';
      detected.textContent = '';
      autoDate = false;
      goalSelect.value = created.id;
      hideForms({ restoreFocus: false });
      // Straight on to the first task, in the new goal's own card.
      focusKey = `add:${created.id}:`;
      render();
    }, 'Objetivo criado. Agora adicione as tarefas.');
  });

  formTask.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formTask.reportValidity() || !goalSelect.value) return;
    const title = formTask.querySelector('[name="title"]');
    const due = formTask.querySelector('[name="dueDate"]');
    void submit(formTask, async () => {
      const task = await createTask(goalSelect.value, {
        title: title.value, dueDate: due.value || deadlineFromText(title.value)?.date || null,
        materialId: materialSelect.value || null, subgoalId: taskSubgoalSelect.value || null,
        referenceUrl: referenceInput.value || null,
      });
      tasks.push(task);
      title.value = '';
      due.value = '';
      materialSelect.value = '';
      referenceInput.value = '';
      taskSubgoalSelect.value = '';
      hideForms();
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
    signal('planning', { error: error.message || 'O planejamento está temporariamente indisponível.' });
    for (const submitButton of panel.querySelectorAll('[type="submit"]')) submitButton.disabled = true;
  }
}
