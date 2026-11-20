// Dashboard home: summary widgets fed by the study tools, and the dialogs ("workspaces") that hold
// each tool's full interface. The tools keep owning their own DOM and API calls; they announce
// their data with `voz:*` events and accept `voz:*-command` events, so this module never reaches
// into their internals. A tool whose feature flag is off never announces anything, and its
// widget simply stays hidden.
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { listCalendar } from '../api/learning-tools.api.js';
import { localDay } from '../utils/calendar-export.js';
import { sortedPlanningTasks, dateLabel } from '../utils/planning-view.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const clockLabel = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Pending tasks first by deadline, with the goal title, for the dashboard preview. */
export function upcomingTasks({ goals = [], tasks = [] }, limit = 4) {
  const titles = new Map(goals.map((goal) => [goal.id, goal.title]));
  const active = new Set(goals.filter((goal) => goal.status !== 'archived').map((goal) => goal.id));
  return sortedPlanningTasks(
    tasks.filter((task) => active.has(task.goal_id)),
    { filter: 'pending', sort: 'due' },
  )
    .slice(0, limit)
    .map((task) => ({ ...task, goalTitle: titles.get(task.goal_id) || '' }));
}

/** Calendar items still ahead (or happening now), in time order. Deadlines count as all-day. */
export function upcomingAgenda(items, now = new Date(), limit = 4) {
  const today = localDay(now);
  return items
    .map((item) => ({
      item,
      at:
        item.kind === 'task'
          ? new Date(`${item.date}T00:00:00`).getTime()
          : Date.parse(item.startsAt),
    }))
    .filter(({ item }) =>
      item.kind === 'task' ? item.date >= today : Date.parse(item.endsAt) > now.getTime(),
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map(({ item }) => item);
}

export function initDashboardHome() {
  const dialogs = new Map(
    [...document.querySelectorAll('dialog[data-workspace]')].map((dialog) => [
      dialog.dataset.workspace,
      dialog,
    ]),
  );
  const openers = new WeakMap();

  // ---- Workspaces -------------------------------------------------------------------------
  function openWorkspace(name, command) {
    const dialog = dialogs.get(name);
    if (!dialog) return;
    if (!dialog.open) {
      openers.set(dialog, document.activeElement);
      dialog.showModal();
    }
    if (command)
      document.dispatchEvent(
        new CustomEvent(`voz:${name}-command`, { detail: { action: command } }),
      );
  }
  for (const dialog of dialogs.values()) {
    dialog.querySelector('[data-workspace-close]')?.addEventListener('click', () => dialog.close());
    // A click on the backdrop lands on the <dialog> itself; the content sits in .workspace-inner.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      const opener = openers.get(dialog);
      openers.delete(dialog);
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
      if (dialog.dataset.workspace === 'calendar' || dialog.dataset.workspace === 'planning')
        void loadAgenda();
    });
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-open-workspace]');
    if (!trigger) return;
    event.preventDefault();
    openWorkspace(trigger.dataset.openWorkspace, trigger.dataset.workspaceCommand);
  });

  // ---- "O que pede sua atenção" line and the "Para estudar" row ---------------------------
  const pulse = document.querySelector('[data-dash-pulse]');
  const planSection = document.querySelector('[data-plan-section]');
  function setPulse(key, value, label) {
    const item = pulse.querySelector(`[data-pulse="${key}"]`);
    item.hidden = value === null;
    if (value !== null) {
      item.querySelector('[data-pulse-value]').textContent = value;
      item.querySelector('[data-pulse-label]').textContent = label;
    }
    pulse.hidden = ![...pulse.children].some((child) => !child.hidden);
  }
  function showWidget(widget) {
    widget.hidden = false;
    planSection.hidden = false;
  }
  function widgetNote(text, className = 'dash-widget-note') {
    return make('p', text, className);
  }

  // Planning
  const tasksWidget = document.querySelector('[data-tasks-widget]');
  const tasksPreview = document.querySelector('[data-tasks-preview]');
  const tasksAdd = document.querySelector('[data-tasks-add]');
  document.addEventListener('voz:planning', (event) => {
    const data = event.detail || {};
    showWidget(tasksWidget);
    tasksPreview.replaceChildren();
    if (data.error) {
      tasksPreview.append(widgetNote(data.error));
      setPulse('tasks', null);
      return;
    }
    const goals = (data.goals || []).filter((goal) => goal.status !== 'archived');
    const pending = upcomingTasks(data, Infinity);
    const today = localDay(new Date());
    const overdue = pending.filter((task) => task.due_date && task.due_date < today).length;
    tasksAdd.hidden = !goals.length;
    if (!goals.length) {
      tasksPreview.append(
        widgetNote('Defina um objetivo e divida-o em tarefas para organizar seus estudos.'),
      );
      const start = make('button', 'Criar primeiro objetivo', 'text-action');
      start.type = 'button';
      start.dataset.openWorkspace = 'planning';
      start.dataset.workspaceCommand = 'goal';
      start.setAttribute('aria-haspopup', 'dialog');
      tasksPreview.append(start);
      setPulse('tasks', null);
      return;
    }
    if (!pending.length) {
      tasksPreview.append(widgetNote('Nenhuma tarefa pendente. Bom trabalho!'));
      setPulse('tasks', null);
      return;
    }
    const list = make('ul', null, 'dash-task-list');
    for (const task of pending.slice(0, 4)) {
      const item = make('li');
      if (task.due_date && task.due_date < today) item.classList.add('is-overdue');
      item.append(make('span', task.title, 'dash-task-title'));
      const meta = [task.goalTitle];
      if (task.due_date)
        meta.unshift(
          task.due_date < today
            ? `Atrasada desde ${dateLabel(task.due_date)}`
            : `Até ${dateLabel(task.due_date)}`,
        );
      item.append(make('small', meta.filter(Boolean).join(' · ')));
      list.append(item);
    }
    tasksPreview.append(list);
    if (pending.length > 4)
      tasksPreview.append(widgetNote(`E mais ${plural(pending.length - 4, 'tarefa', 'tarefas')}.`));
    setPulse(
      'tasks',
      String(pending.length),
      `${pending.length === 1 ? 'tarefa pendente' : 'tarefas pendentes'}${overdue ? ` (${overdue} ${overdue === 1 ? 'atrasada' : 'atrasadas'})` : ''}`,
    );
  });

  // Flashcards
  const cardsWidget = document.querySelector('[data-cards-widget]');
  const cardsPreview = document.querySelector('[data-cards-preview]');
  const cardsReview = document.querySelector('[data-cards-review]');
  document.addEventListener('voz:flashcards', (event) => {
    const data = event.detail || {};
    // While the workspace is filtered by lesson or set, the numbers are not the whole picture.
    if (data.filtered) return;
    showWidget(cardsWidget);
    cardsPreview.replaceChildren();
    if (data.error) {
      cardsPreview.append(widgetNote(data.error));
      cardsReview.hidden = true;
      setPulse('cards', null);
      return;
    }
    const due = Number(data.dueTotal) || 0;
    cardsReview.hidden = due === 0;
    const figure = make('p', null, 'dash-figure');
    figure.append(
      make('strong', String(due)),
      ` ${due === 1 ? 'cartão para revisar hoje' : 'cartões para revisar hoje'}`,
    );
    cardsPreview.append(figure);
    if (!due)
      cardsPreview.append(
        widgetNote('Nada para revisar agora. As próximas revisões aparecem aqui no dia certo.'),
      );
    else if (data.next) {
      const next = make('blockquote', null, 'dash-next-card');
      next.append(make('small', 'Primeiro da fila'), make('span', data.next));
      cardsPreview.append(next);
    }
    setPulse(
      'cards',
      due ? String(due) : null,
      due === 1 ? 'cartão para revisar' : 'cartões para revisar',
    );
  });

  // Calendar: its own small query for the next two weeks (the workspace shows whole months).
  const eventsWidget = document.querySelector('[data-events-widget]');
  const eventsPreview = document.querySelector('[data-events-preview]');
  let calendarEnabled = false;
  let agendaVersion = 0;
  async function loadAgenda() {
    if (!calendarEnabled) return;
    const version = ++agendaVersion;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 15);
    try {
      const page = await listCalendar({
        from: start.toISOString(),
        to: end.toISOString(),
        fromDay: localDay(start),
        toDay: localDay(end),
        offset: 0,
      });
      if (version !== agendaVersion) return;
      renderAgenda(upcomingAgenda(page.items || [], now));
    } catch (error) {
      if (version !== agendaVersion) return;
      eventsPreview.replaceChildren(widgetNote(error.message || 'Agenda indisponível no momento.'));
    }
  }
  function renderAgenda(items) {
    showWidget(eventsWidget);
    eventsPreview.replaceChildren();
    if (!items.length) {
      eventsPreview.append(widgetNote('Nada agendado para os próximos 14 dias.'));
      return;
    }
    const list = make('ul', null, 'dash-agenda-list');
    for (const item of items) {
      const entry = make('li');
      const when = make('time', null, 'dash-agenda-when');
      if (item.kind === 'task') {
        const day = new Date(`${item.date}T00:00:00`);
        when.dateTime = item.date;
        when.append(make('span', WEEKDAYS[day.getDay()]), make('strong', String(day.getDate())));
        entry.append(
          when,
          make('span', item.title, 'dash-agenda-title'),
          make('small', 'Prazo de tarefa'),
        );
      } else {
        const startAt = new Date(item.startsAt);
        when.dateTime = item.startsAt;
        when.append(
          make('span', WEEKDAYS[startAt.getDay()]),
          make('strong', String(startAt.getDate())),
        );
        entry.append(
          when,
          make('span', item.title, 'dash-agenda-title'),
          make(
            'small',
            startAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          ),
        );
      }
      list.append(entry);
    }
    eventsPreview.append(list);
  }
  void isFeatureEnabled('calendar')
    .then((enabled) => {
      calendarEnabled = enabled;
      return loadAgenda();
    })
    .catch(() => {});

  // Study time
  const week = document.querySelector('[data-week-widget]');
  const figure = document.querySelector('[data-week-figure]');
  const progress = document.querySelector('[data-week-progress]');
  const days = document.querySelector('[data-week-days]');
  const timerState = document.querySelector('[data-timer-state]');
  const timerClock = document.querySelector('[data-timer-clock]');
  const timerToggle = document.querySelector('[data-timer-toggle]');
  let running = false;
  document.addEventListener('voz:study-overview', (event) => {
    const data = event.detail || {};
    week.hidden = false;
    if (data.error) {
      figure.textContent = data.error;
      return;
    }
    const minutes = Math.floor(Number(data.weekSeconds) / 60);
    const goal = Number(data.goalMinutes) || 0;
    figure.replaceChildren(
      make('strong', `${minutes} min`),
      goal ? ` de ${goal} min nesta semana` : ' estudados nesta semana',
    );
    progress.hidden = !goal;
    progress.value = goal ? Math.min(100, Math.round((minutes / goal) * 100)) : 0;
    progress.setAttribute(
      'aria-label',
      goal ? `Meta semanal: ${minutes} de ${goal} minutos` : 'Meta semanal desativada',
    );
    days.replaceChildren();
    const most = Math.max(1, ...(data.days || []).map((day) => Number(day.seconds) || 0));
    const today = localDay(new Date());
    for (const day of data.days || []) {
      const dayMinutes = Math.floor(Number(day.seconds) / 60);
      const date = new Date(`${day.date}T00:00:00`);
      const item = make('li');
      if (day.date === today) item.classList.add('is-today');
      const bar = make('span', null, 'dash-day-bar');
      bar.style.setProperty(
        '--fill',
        String(Math.round(((Number(day.seconds) || 0) / most) * 100)),
      );
      bar.setAttribute('aria-hidden', 'true');
      item.append(bar, make('span', WEEKDAYS[date.getDay()], 'dash-day-label'));
      item.setAttribute(
        'aria-label',
        `${WEEKDAYS[date.getDay()]} ${dateLabel(day.date).slice(0, 5)}: ${dayMinutes} min`,
      );
      days.append(item);
    }
    setPulse('week', `${minutes}`, goal ? `de ${goal} min na semana` : 'min estudados na semana');
  });
  document.addEventListener('voz:study-clock', (event) => {
    const state = event.detail || {};
    week.hidden = false;
    running = Boolean(state.running);
    const seconds = state.mode === 'reading' ? state.elapsed : Math.ceil(state.remaining || 0);
    timerClock.textContent = clockLabel(Math.max(0, Number(seconds) || 0));
    timerClock.closest('.dash-timer').classList.toggle('is-running', running);
    const mode =
      { reading: 'Estudo livre', pomodoro: 'Foco de 25 minutos', break: 'Pausa' }[state.mode] ||
      'Sessão';
    const text = running
      ? `${mode} em andamento.`
      : state.session
        ? `${mode} pausado.`
        : 'Nenhuma sessão em andamento.';
    if (timerState.textContent !== text) timerState.textContent = text;
    timerToggle.textContent = running ? 'Pausar' : state.session ? 'Retomar' : 'Iniciar sessão';
    timerToggle.disabled = Boolean(state.busy);
  });
  timerToggle.addEventListener('click', () => {
    document.dispatchEvent(
      new CustomEvent('voz:tracking-command', { detail: { action: running ? 'pause' : 'start' } }),
    );
  });

  // Annotations
  const notesWidget = document.querySelector('[data-notes-widget]');
  const notesSummary = document.querySelector('[data-notes-summary]');
  document.addEventListener('voz:notes', (event) => {
    const data = event.detail || {};
    notesWidget.hidden = false;
    notesSummary.textContent = data.error
      ? data.error
      : data.total
        ? `${plural(data.total, 'anotação salva', 'anotações salvas')} nas suas aulas.`
        : 'Destaque trechos da transcrição de uma aula para encontrá-los aqui.';
  });

  return { openWorkspace };
}
