// Início: an overview of what to study next. Every card reads a small summary from the API and
// links to the page where that tool lives (Planejar or Revisar). A card for a tool that is
// switched off never appears; an empty card says in one sentence what the tool is for and offers
// one first step.
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listCalendar, listAnnotations } from '../api/learning-tools.api.js';
import { getPlanning } from '../api/planning.api.js';
import { listFlashcards } from '../api/flashcard.api.js';
import { getStudyOverview } from '../api/study.api.js';
import { localDay, itemOnDay } from '../utils/calendar-export.js';
import { sortedPlanningTasks, dateLabel } from '../utils/planning-view.js';
import { t, intlLocale } from '../i18n/i18n.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const link = (text, href, className = 'secondary-action button-link') => {
  const node = make('a', text, className);
  node.href = href;
  return node;
};
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
// Portuguese keeps its own short names; other languages use the browser's (Intl).
const weekdayShort = (date) =>
  intlLocale() === 'pt-BR'
    ? WEEKDAYS[date.getDay()]
    : date.toLocaleDateString(intlLocale(), { weekday: 'short' });
/** Day and month (dd/mm in Portuguese, the interface language's order elsewhere). */
const shortDay = (isoDate) =>
  intlLocale() === 'pt-BR' || !isoDate
    ? dateLabel(isoDate).slice(0, 5)
    : new Date(`${isoDate}T00:00:00`).toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit' });
const weekdayLetter = (date) =>
  intlLocale() === 'pt-BR'
    ? WEEKDAYS[date.getDay()].charAt(0).toUpperCase()
    : date.toLocaleDateString(intlLocale(), { weekday: 'narrow' });

/** Pending tasks of active goals, first by deadline, with the goal title. */
export function upcomingTasks({ goals = [], tasks = [] }, limit = 4) {
  const titles = new Map(goals.map((goal) => [goal.id, goal.title]));
  const active = new Set(goals.filter((goal) => goal.status === 'active').map((goal) => goal.id));
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
  const today = document.querySelector('[data-today]');
  if (today) {
    const text = new Date().toLocaleDateString(intlLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    today.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  }
  const planSection = document.querySelector('[data-plan-section]');
  function show(widget) {
    widget.hidden = false;
    if (widget.closest('[data-plan-section]')) planSection.hidden = false;
  }
  function count(selector, value) {
    const badge = document.querySelector(selector);
    badge.hidden = !value;
    badge.textContent = value ? String(value) : '';
  }
  const note = (text) => make('p', text, 'dash-card-note');
  const failed = (host, error, what) =>
    host.replaceChildren(note(error?.message || `Não foi possível carregar ${what}.`));

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
      const todayKey = localDay(new Date());
      count('[data-tasks-count]', pending.length);
      if (!goals.length) {
        tasksPreview.replaceChildren(
          note(t('home.planningIntro')),
        );
        tasksActions.replaceChildren(
          link(t('home.firstGoal'), './planejar.html?criar=objetivo#tarefas'),
        );
        return;
      }
      if (!pending.length) {
        tasksPreview.replaceChildren(
          note(t('home.noPendingTasks')),
        );
        tasksActions.replaceChildren(
          link(t('home.addTask'), './planejar.html?criar=tarefa#tarefas'),
        );
        return;
      }
      const list = make('ul', null, 'dash-task-list');
      for (const task of pending.slice(0, 3)) {
        const item = make('li');
        const late = task.due_date && task.due_date < todayKey;
        if (late) item.classList.add('is-overdue');
        item.append(make('span', task.title, 'dash-task-title'));
        const meta = [task.goalTitle];
        if (task.due_date)
          meta.unshift(
            late
              ? t('home.overdue', { date: shortDay(task.due_date) })
              : t('home.dueBy', { date: shortDay(task.due_date) }),
          );
        item.append(make('small', meta.filter(Boolean).join(' · ')));
        list.append(item);
      }
      tasksPreview.replaceChildren(list);
      if (pending.length > 3)
        tasksPreview.append(note(t('home.moreTasks', { count: pending.length - 3 })));
      tasksActions.replaceChildren(
        link(t('home.addTask'), './planejar.html?criar=tarefa#tarefas'),
      );
    } catch (error) {
      failed(tasksPreview, error, 'as tarefas');
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
      const dueCount = Number(due.total) || 0;
      const total = Number(all.total) || 0;
      count('[data-cards-count]', dueCount);
      if (!total) {
        cardsPreview.replaceChildren(
          note(t('home.cardsIntro')),
        );
        cardsActions.replaceChildren(link(t('home.chooseLesson'), './historico.html'));
        return;
      }
      const figure = make('p', null, 'dash-figure');
      figure.append(
        make('strong', String(dueCount)),
        ` ${t('home.cardsToday', { count: dueCount })}`,
      );
      cardsPreview.replaceChildren(figure);
      if (dueCount && due.cards?.[0]) {
        const next = make('blockquote', null, 'dash-next-card');
        next.append(make('small', t('home.firstInQueue')), make('span', due.cards[0].front_text));
        cardsPreview.append(next);
        cardsActions.replaceChildren(
          link(
            t('home.reviewCards', { count: dueCount }),
            './revisar.html?acao=revisar#flashcards',
          ),
        );
      } else {
        cardsPreview.append(
          note(
            t('home.allReviewed', { count: total }),
          ),
        );
        cardsActions.replaceChildren();
      }
    } catch (error) {
      failed(cardsPreview, error, 'os flashcards');
    }
  }

  // ---- Calendar: this month at a glance, then the next items ----------------------------
  const eventsWidget = document.querySelector('[data-events-widget]');
  const eventsPreview = document.querySelector('[data-events-preview]');
  const eventsActions = document.querySelector('[data-events-actions]');
  const monthTitle = document.querySelector('[data-agenda-month]');
  function miniMonth(now, items) {
    const year = now.getFullYear();
    const month = now.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const todayKey = localDay(now);
    let marked = 0;
    // Visual summary only; the list below and the calendar page carry the details.
    const grid = make('div', null, 'dash-mini-month');
    grid.setAttribute('aria-hidden', 'true');
    // Monday first: 2024-01-01 was a Monday.
    for (let i = 0; i < 7; i += 1)
      grid.append(make('span', weekdayLetter(new Date(2024, 0, 1 + i)), 'dash-mini-weekday'));
    for (let day = 1; day <= days; day++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cell = make('span', String(day), 'dash-mini-day');
      if (day === 1)
        cell.style.gridColumnStart = String(((new Date(year, month, 1).getDay() + 6) % 7) + 1);
      if (key === todayKey) cell.classList.add('is-today');
      if (key < todayKey) cell.classList.add('is-past');
      if (items.some((item) => itemOnDay(item, key))) {
        cell.classList.add('has-items');
        if (key >= todayKey) marked++;
      }
      grid.append(cell);
    }
    const summary = make(
      'p',
      marked
        ? t('home.markedDays', { count: marked })
        : t('home.nothingScheduled'),
      'sr-only',
    );
    return [grid, summary];
  }
  async function loadAgenda() {
    show(eventsWidget);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const twoWeeks = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 15);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = twoWeeks > monthEnd ? twoWeeks : monthEnd;
    monthTitle.textContent = now
      .toLocaleDateString(intlLocale(), { month: 'long' })
      .replace(/^./, (c) => c.toUpperCase());
    try {
      const page = await listCalendar({
        from: start.toISOString(),
        to: end.toISOString(),
        fromDay: localDay(start),
        toDay: localDay(end),
        offset: 0,
      });
      const items = page.items || [];
      const upcoming = upcomingAgenda(items, now, 3);
      eventsPreview.replaceChildren(...miniMonth(now, items));
      if (!upcoming.length) {
        eventsPreview.append(note(t('home.planWhen')));
      } else {
        const list = make('ul', null, 'dash-agenda-list');
        for (const item of upcoming) {
          const entry = make('li');
          const date =
            item.kind === 'task' ? new Date(`${item.date}T00:00:00`) : new Date(item.startsAt);
          const when = make('time', null, 'dash-agenda-when');
          when.dateTime = item.kind === 'task' ? item.date : item.startsAt;
          when.append(
            make('strong', String(date.getDate())),
            make('span', weekdayShort(date)),
          );
          const copy = make('span', null, 'dash-agenda-copy');
          copy.append(
            make('span', item.title, 'dash-agenda-title'),
            make(
              'small',
              item.kind === 'task'
                ? t('home.taskDeadline')
                : date.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }),
            ),
          );
          entry.append(when, copy);
          list.append(entry);
        }
        eventsPreview.append(list);
      }
      eventsActions.replaceChildren(
        link(t('home.scheduleStudy'), './planejar.html?criar=horario#calendario'),
      );
    } catch (error) {
      failed(eventsPreview, error, 'a agenda');
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
      const figure = make('p', null, 'dash-figure');
      figure.append(make('strong', `${minutes}`), goal ? t('home.weekOf', { goal }) : t('home.weekMinutes'));
      weekBody.replaceChildren(figure);
      if (goal) {
        const progress = make('progress', null, 'dash-week-progress');
        progress.max = 100;
        progress.value = Math.min(100, Math.round((minutes / goal) * 100));
        progress.setAttribute('aria-label', t('home.weekGoalLabel', { minutes, goal }));
        weekBody.append(progress);
      }
      if (!minutes) {
        // No empty chart: say what this measures.
        weekBody.append(note(t('home.weekIntro')));
        return;
      }
      const days = make('ol', null, 'dash-week-days');
      days.setAttribute('aria-label', t('home.minutesPerDay'));
      const most = Math.max(1, ...(data.days || []).map((day) => Number(day.seconds) || 0));
      const todayKey = localDay(new Date());
      for (const day of data.days || []) {
        const date = new Date(`${day.date}T00:00:00`);
        const item = make('li');
        if (day.date === todayKey) item.classList.add('is-today');
        const bar = make('span', null, 'dash-day-bar');
        bar.style.setProperty(
          '--fill',
          String(Math.round(((Number(day.seconds) || 0) / most) * 100)),
        );
        bar.setAttribute('aria-hidden', 'true');
        item.append(
          bar,
          make('span', weekdayLetter(date), 'dash-day-label'),
        );
        item.setAttribute(
          'aria-label',
          `${weekdayShort(date)} ${shortDay(day.date)}: ${Math.floor(Number(day.seconds) / 60)} min`,
        );
        days.append(item);
      }
      weekBody.append(days);
    } catch (error) {
      weekBody.replaceChildren(note(error?.message || t('home.weekUnavailable')));
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
        ? t('home.notesSaved', { count: total })
        : t('home.notesIntro');
      notesLink.textContent = total ? t('common.seeAllF') : t('home.howToNote');
      notesLink.href = total ? './revisar.html#anotacoes' : './ajuda.html#anotacoes';
    } catch (error) {
      notesSummary.textContent = error?.message || t('home.notesUnavailable');
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
