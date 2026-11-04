import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import { progressForGoal, dateLabel } from '../utils/planning-view.js';
import { getPlanning, createGoal, createTask, setTaskCompleted } from '../api/planning.api.js';

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

export async function initPlanningPanel({ materials }) {
  const panel = document.querySelector('[data-planning-panel]');
  if (!panel || !(await isFeatureEnabled('planning'))) return;
  const formGoal = panel.querySelector('[data-planning-goal-form]');
  const formTask = panel.querySelector('[data-planning-task-form]');
  const goalSelect = panel.querySelector('[data-planning-goal-select]');
  const materialSelect = panel.querySelector('[data-planning-material-select]');
  const list = panel.querySelector('[data-planning-list]');
  const notice = panel.querySelector('[data-planning-status]');
  const allowedMaterials = new Map(materials.map((m) => [m.id, m]));
  let goals = [];
  let tasks = [];

  panel.hidden = false;
  materialSelect.replaceChildren(option('', 'Sem aula vinculada'));
  for (const material of materials) materialSelect.append(option(material.id, material.title));

  function render() {
    const selected = goalSelect.value;
    goalSelect.replaceChildren(option('', 'Selecione um objetivo'));
    for (const goal of goals) goalSelect.append(option(goal.id, goal.title));
    if (goals.some((g) => g.id === selected)) goalSelect.value = selected;
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
      const heading = document.createElement('h3');
      heading.textContent = goal.title;
      section.append(heading);

      const progress = progressForGoal(goal, tasks);
      const details = document.createElement('p');
      details.className = 'planning-meta';
      details.textContent = `${progress.completed} de ${progress.total} tarefas concluídas${goal.target_date ? ' · Meta: ' + dateLabel(goal.target_date) : ''}`;
      section.append(details);
      if (goal.description) {
        const description = document.createElement('p');
        description.textContent = goal.description;
        section.append(description);
      }

      const tasksList = document.createElement('ul');
      tasksList.className = 'planning-tasks';
      const related = tasks.filter((t) => t.goal_id === goal.id);
      for (const task of related) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = Boolean(task.completed_at);
        check.setAttribute('aria-label', `Concluir tarefa: ${task.title}`);
        const span = document.createElement('span');
        span.textContent = task.title;
        label.append(check, span);
        li.append(label);

        if (task.due_date) {
          const due = document.createElement('small');
          due.textContent = 'Até ' + dateLabel(task.due_date);
          li.append(due);
        }
        const material = allowedMaterials.get(task.material_id);
        if (material) {
          const link = document.createElement('a');
          link.href = `./material.html?id=${encodeURIComponent(material.id)}`;
          link.textContent = 'Abrir aula';
          li.append(link);
        }
        check.addEventListener('change', async () => {
          const desired = check.checked;
          check.disabled = true;
          setStatus(notice, '');
          try {
            const updated = await setTaskCompleted(task.id, desired);
            tasks = tasks.map((t) => t.id === updated.id ? updated : t);
            render();
          } catch (error) {
            check.checked = !desired;
            setStatus(notice, error.message || 'Não foi possível atualizar a tarefa.', 'error');
          } finally {
            check.disabled = false;
          }
        });
        tasksList.append(li);
      }
      if (!related.length) {
        const note = document.createElement('p');
        note.className = 'planning-empty';
        note.textContent = 'Adicione uma tarefa para acompanhar este objetivo.';
        section.append(note);
      }
      section.append(tasksList);
      list.append(section);
    }
  }

  async function submit(form, action, success) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setStatus(notice, '');
    try {
      await action();
      setStatus(notice, success, 'success');
    } catch (error) {
      setStatus(notice, error.message || 'Não foi possível salvar.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  formGoal.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formGoal.reportValidity()) return;
    const title = formGoal.querySelector('[name="title"]');
    const deadline = formGoal.querySelector('[name="targetDate"]');
    void submit(formGoal, async () => {
      const created = await createGoal({
        title: title.value, targetDate: deadline.value || null,
      });
      goals.unshift(created);
      title.value = '';
      deadline.value = '';
      render();
      goalSelect.value = created.id;
    }, 'Objetivo criado.');
  });

  formTask.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!formTask.reportValidity()) return;
    const title = formTask.querySelector('[name="title"]');
    const due = formTask.querySelector('[name="dueDate"]');
    if (!goalSelect.value) {
      setStatus(notice, 'Escolha um objetivo para a tarefa.', 'error');
      return;
    }
    void submit(formTask, async () => {
      const task = await createTask(goalSelect.value, {
        title: title.value, dueDate: due.value || null,
        materialId: materialSelect.value || null,
      });
      tasks.push(task);
      title.value = '';
      due.value = '';
      materialSelect.value = '';
      render();
    }, 'Tarefa criada.');
  });

  try {
    const response = await getPlanning();
    goals = response.goals || [];
    tasks = response.tasks || [];
    render();
  } catch (error) {
    setStatus(notice, error.message || 'O planejamento está temporariamente indisponível.', 'error');
    for (const button of panel.querySelectorAll('[type="submit"]')) button.disabled = true;
  }
}
