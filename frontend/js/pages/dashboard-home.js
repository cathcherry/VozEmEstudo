// Início: an overview of what to study next. Every card reads a small summary from the API and
// links to the page where that tool lives (Planejar or Revisar). A card for a tool that is
// switched off never appears, and an empty card explains what the tool is for and how to start.
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listCalendar, listAnnotations } from '../api/learning-tools.api.js';
import { getPlanning } from '../api/planning.api.js';
import { listFlashcards } from '../api/flashcard.api.js';
import { getStudyOverview } from '../api/study.api.js';
import { localDay } from '../utils/calendar-export.js';
import { sortedPlanningTasks, dateLabel } from '../utils/planning-view.js';
import { ninoNote } from '../utils/material-ui.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const link = (text, href, className = 'text-action') => {
  const node = make('a', text, className);
  node.href = href;
  return node;
};
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Pending tasks of active goals, first by deadline, with the goal title. */
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
  function show(widget) {
    widget.hidden = false;
    if (widget.closest('[data-plan-section]')) planSection.hidden = false;
  }
  /** One primary action (or none) and at most one secondary link per card. */
  function actions(host, primary, secondary) {
    host.replaceChildren();
    if (primary) host.append(link(primary[0], primary[1], 'secondary-action button-link'));
    if (secondary) host.append(link(secondary[0], secondary[1]));
  }
  const empty = (host, text, pose = 'rest') =>
    host.replaceChildren(ninoNote(text, pose, { className: 'dash-empty' }));
  const failed = (host, error, what) =>
    host.replaceChildren(
      make('p', error?.message || `Não foi possível carregar ${what}.`, 'dash-widget-note'),
    );

  // ---- Planning ------------------------------------------------------------------------
  const tasksWidget = document.querySelector('[data-tasks-widget]');
  const tasksPreview = document.querySelector('[data-tasks-preview]');
  const tasksActions = document.querySelector('[data-tasks-actions]');
  async function loadTasks() {
    show(tasksWidget);
    try {
      const data = await getPlanning();
      const goals = (data.goals || []).filter((goal) => goal.status !== 'archived');
      const pending = upcomingTasks(data, Infinity);
      const today = localDay(new Date());
      if (!goals.length) {
        empty(
          tasksPreview,
          'Organize seus estudos: defina um objetivo e divida-o em tarefas.',
          'reading',
        );
        actions(tasksActions, [
          'Criar primeiro objetivo',
          './planejar.html?criar=objetivo#tarefas',
        ]);
        setPulse('tasks', null);
        return;
      }
      if (!pending.length) {
        empty(
          tasksPreview,
          'Nenhuma tarefa pendente. Adicione a próxima etapa de um objetivo.',
          'celebrate',
        );
        actions(
          tasksActions,
          ['Adicionar tarefa', './planejar.html?criar=tarefa#tarefas'],
          ['Ver objetivos', './planejar.html#tarefas'],
        );
        setPulse('tasks', null);
        return;
      }
      const list = make('ul', null, 'dash-task-list');
      for (const task of pending.slice(0, 4)) {
        const item = make('li');
        const late = task.due_date && task.due_date < today;
        if (late) item.classList.add('is-overdue');
        item.append(make('span', task.title, 'dash-task-title'));
        const meta = [task.goalTitle];
        if (task.due_date)
          meta.unshift(
            late ? `Atrasada desde ${dateLabel(task.due_date)}` : `Até ${dateLabel(task.due_date)}`,
          );
        item.append(make('small', meta.filter(Boolean).join(' · ')));
        list.append(item);
      }
      tasksPreview.replaceChildren(list);
      if (pending.length > 4)
        tasksPreview.append(
          make(
            'p',
            `E mais ${plural(pending.length - 4, 'tarefa', 'tarefas')}.`,
            'dash-widget-note',
          ),
        );
      actions(
        tasksActions,
        ['Ver todas as tarefas', './planejar.html#tarefas'],
        ['Adicionar tarefa', './planejar.html?criar=tarefa#tarefas'],
      );
      const overdue = pending.filter((task) => task.due_date && task.due_date < today).length;
      setPulse(
        'tasks',
        String(pending.length),
        `${pending.length === 1 ? 'tarefa pendente' : 'tarefas pendentes'}${overdue ? ` (${overdue} ${overdue === 1 ? 'atrasada' : 'atrasadas'})` : ''}`,
      );
    } catch (error) {
      failed(tasksPreview, error, 'as tarefas');
      actions(tasksActions, ['Abrir Planejar', './planejar.html#tarefas']);
    }
  }

  // ---- Flashcards ----------------------------------------------------------------------
  const cardsWidget = document.querySelector('[data-cards-widget]');
  const cardsPreview = document.querySelector('[data-cards-preview]');
  const cardsActions = document.querySelector('[data-cards-actions]');
  async function loadCards() {
    show(cardsWidget);
    try {
      const [due, all] = await Promise.all([
        listFlashcards('due', {}),
        listFlashcards('all', { status: 'active' }),
      ]);
      const count = Number(due.total) || 0;
      if (!Number(all.total)) {
        empty(
          cardsPreview,
          'Crie cartões a partir do resumo de uma aula para começar a revisar.',
          'reading',
        );
        actions(
          cardsActions,
          ['Escolher uma aula', './historico.html'],
          ['Criar cartão', './revisar.html?acao=criar#flashcards'],
        );
        setPulse('cards', null);
        return;
      }
      const figure = make('p', null, 'dash-figure');
      figure.append(
        make('strong', String(count)),
        ` ${count === 1 ? 'cartão para revisar hoje' : 'cartões para revisar hoje'}`,
      );
      cardsPreview.replaceChildren(figure);
      if (count && due.cards?.[0]) {
        const next = make('blockquote', null, 'dash-next-card');
        next.append(make('small', 'Primeiro da fila'), make('span', due.cards[0].front_text));
        cardsPreview.append(next);
        actions(
          cardsActions,
          [
            `Revisar ${plural(count, 'cartão', 'cartões')}`,
            './revisar.html?acao=revisar#flashcards',
          ],
          ['Ver todos os cartões', './revisar.html#flashcards'],
        );
      } else {
        cardsPreview.append(
          make(
            'p',
            `Tudo revisado por hoje. Você tem ${plural(Number(all.total), 'cartão', 'cartões')}; as próximas revisões aparecem aqui no dia certo.`,
            'dash-widget-note',
          ),
        );
        actions(cardsActions, null, ['Ver todos os cartões', './revisar.html#flashcards']);
      }
      setPulse(
        'cards',
        count ? String(count) : null,
        count === 1 ? 'cartão para revisar' : 'cartões para revisar',
      );
    } catch (error) {
      failed(cardsPreview, error, 'os flashcards');
      actions(cardsActions, ['Abrir Revisar', './revisar.html#flashcards']);
    }
  }

  // ---- Calendar ------------------------------------------------------------------------
  const eventsWidget = document.querySelector('[data-events-widget]');
  const eventsPreview = document.querySelector('[data-events-preview]');
  const eventsActions = document.querySelector('[data-events-actions]');
  async function loadAgenda() {
    show(eventsWidget);
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
      const items = upcomingAgenda(page.items || [], now);
      if (!items.length) {
        empty(
          eventsPreview,
          'Planeje quando você pretende estudar: reserve um horário na agenda.',
          'rest',
        );
        actions(
          eventsActions,
          ['Agendar estudo', './planejar.html?criar=horario#calendario'],
          ['Ver calendário', './planejar.html#calendario'],
        );
        return;
      }
      const list = make('ul', null, 'dash-agenda-list');
      for (const item of items) {
        const entry = make('li');
        const when = make('time', null, 'dash-agenda-when');
        const date =
          item.kind === 'task' ? new Date(`${item.date}T00:00:00`) : new Date(item.startsAt);
        when.dateTime = item.kind === 'task' ? item.date : item.startsAt;
        when.append(make('span', WEEKDAYS[date.getDay()]), make('strong', String(date.getDate())));
        entry.append(
          when,
          make('span', item.title, 'dash-agenda-title'),
          make(
            'small',
            item.kind === 'task'
              ? 'Prazo de tarefa'
              : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          ),
        );
        list.append(entry);
      }
      eventsPreview.replaceChildren(list);
      actions(
        eventsActions,
        ['Ver calendário', './planejar.html#calendario'],
        ['Agendar estudo', './planejar.html?criar=horario#calendario'],
      );
    } catch (error) {
      failed(eventsPreview, error, 'a agenda');
      actions(eventsActions, ['Abrir calendário', './planejar.html#calendario']);
    }
  }

  // ---- Study time ----------------------------------------------------------------------
  const week = document.querySelector('[data-week-widget]');
  const weekBody = document.querySelector('[data-week-body]');
  async function loadWeek() {
    week.hidden = false;
    try {
      const data = await getStudyOverview();
      const minutes = Math.floor(Number(data.weekSeconds) / 60);
      const goal = Number(data.goalMinutes) || 0;
      weekBody.replaceChildren();
      if (!minutes) {
        // No empty chart: explain what this measures and how to start.
        weekBody.append(
          ninoNote(
            goal
              ? `Meta da semana: ${goal} min. Use o cronômetro enquanto estuda para registrar seu tempo.`
              : 'Use o cronômetro enquanto estuda para acompanhar seu tempo e definir uma meta semanal.',
            'laptop',
            { className: 'dash-empty' },
          ),
        );
        weekBody.append(
          link('Cronometrar uma sessão', './planejar.html#tempo', 'secondary-action button-link'),
        );
        setPulse('week', null);
        return;
      }
      const figure = make('p', null, 'dash-week-figure');
      figure.append(
        make('strong', `${minutes} min`),
        goal ? ` de ${goal} min nesta semana` : ' estudados nesta semana',
      );
      weekBody.append(figure);
      if (goal) {
        const progress = make('progress', null, 'dash-week-progress');
        progress.max = 100;
        progress.value = Math.min(100, Math.round((minutes / goal) * 100));
        progress.setAttribute('aria-label', `Meta semanal: ${minutes} de ${goal} minutos`);
        weekBody.append(progress);
      }
      const days = make('ol', null, 'dash-week-days');
      days.setAttribute('aria-label', 'Minutos de estudo por dia');
      const most = Math.max(1, ...(data.days || []).map((day) => Number(day.seconds) || 0));
      const today = localDay(new Date());
      for (const day of data.days || []) {
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
          `${WEEKDAYS[date.getDay()]} ${dateLabel(day.date).slice(0, 5)}: ${Math.floor(Number(day.seconds) / 60)} min`,
        );
        days.append(item);
      }
      weekBody.append(days);
      setPulse(
        'week',
        String(minutes),
        goal ? `de ${goal} min na semana` : 'min estudados na semana',
      );
    } catch (error) {
      weekBody.replaceChildren(
        make('p', error?.message || 'Tempo de estudo indisponível.', 'dash-widget-note'),
      );
    }
  }

  // ---- Annotations ---------------------------------------------------------------------
  const notesWidget = document.querySelector('[data-notes-widget]');
  const notesSummary = document.querySelector('[data-notes-summary]');
  const notesLink = document.querySelector('[data-notes-link]');
  async function loadNotes() {
    notesWidget.hidden = false;
    try {
      const page = await listAnnotations({ offset: 0 });
      const total = Number(page.total) || 0;
      notesSummary.textContent = total
        ? `${plural(total, 'anotação salva', 'anotações salvas')} nas suas aulas.`
        : 'Destaque trechos da transcrição de uma aula e escreva notas; elas ficam reunidas aqui.';
      notesLink.textContent = total ? 'Ver anotações' : 'Como anotar';
      notesLink.href = total ? './revisar.html#anotacoes' : './ajuda.html#anotacoes';
    } catch (error) {
      notesSummary.textContent = error?.message || 'Anotações indisponíveis.';
    }
  }

  void getFeatureFlags()
    .then((flags) => {
      if (flags.planning) void loadTasks();
      if (flags.flashcards) void loadCards();
      if (flags.calendar) void loadAgenda();
      if (flags.study_tracking) void loadWeek();
      if (flags.annotations) void loadNotes();
    })
    .catch(() => {});
}
