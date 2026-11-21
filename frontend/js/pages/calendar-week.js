// Planejar › Calendário › Semana: study blocks on a time grid (07:00–23:00), task deadlines on
// top of each day. Moving never needs dragging: each block has a "Mover" menu (30 min earlier or
// later, previous or next day). On narrow screens the grid becomes a list of days.
import { localDay } from '../utils/calendar-export.js';

export const DAY_START = 7; // first hour shown
export const DAY_END = 23; // last hour shown
const MINUTE = 60_000;

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** Monday 00:00 (local) of the week that contains `date`. */
export function weekStartOf(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
/** The API range for a week: [Monday 00:00, next Monday 00:00). */
export function weekRange(start) {
  return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
}

/** New start/end after moving by `minutes`, keeping the duration (local clock, DST-safe). */
export function moveEvent(item, minutes) {
  const start = new Date(item.startsAt);
  const end = new Date(item.endsAt);
  const days = minutes % 1440 === 0 ? minutes / 1440 : 0;
  if (days) {
    start.setDate(start.getDate() + days);
    end.setDate(end.getDate() + days);
  } else {
    start.setTime(start.getTime() + minutes * MINUTE);
    end.setTime(end.getTime() + minutes * MINUTE);
  }
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Side-by-side lanes for overlapping blocks of one day: [{item, lane, lanes}]. */
export function layoutDay(events) {
  const sorted = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const placed = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((entry) => entry.lane + 1));
    for (const entry of cluster) entry.lanes = lanes;
    cluster = [];
  };
  for (const item of sorted) {
    const start = Date.parse(item.startsAt);
    if (start >= clusterEnd) close();
    const busy = new Set(cluster.filter((entry) => Date.parse(entry.item.endsAt) > start).map((entry) => entry.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    const entry = { item, lane, lanes: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, Date.parse(item.endsAt));
  }
  close();
  return placed;
}

/** Position on the grid, as fractions of the visible hours (clamped). */
function span(item, day) {
  const dayStart = new Date(`${day}T00:00:00`);
  const from = Math.max(Date.parse(item.startsAt), dayStart.getTime() + DAY_START * 3600_000);
  const to = Math.min(Date.parse(item.endsAt), dayStart.getTime() + DAY_END * 3600_000);
  const total = (DAY_END - DAY_START) * 3600_000;
  const top = (from - dayStart.getTime() - DAY_START * 3600_000) / total;
  return { top: Math.max(0, Math.min(1, top)), height: Math.max(0, (to - from) / total) };
}

/**
 * Renders the week into `container`. `onEdit(item, button)` opens the editor; `onMove(item,
 * minutes, button)` saves a move; `onCompose(day, button)` schedules on that day.
 */
export function renderWeek(container, { items, weekStart, locale = 'pt-BR', onEdit, onMove, onCompose }) {
  const time = (iso) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const root = make('div', null, 'calendar-week');
  const hours = make('div', null, 'week-hours');
  hours.setAttribute('aria-hidden', 'true');
  hours.append(make('span', null, 'week-hours-head'));
  for (let hour = DAY_START; hour < DAY_END; hour += 1) hours.append(make('span', `${String(hour).padStart(2, '0')}:00`));
  root.append(hours);
  const today = localDay(new Date());
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStart, i);
    const day = localDay(date);
    const column = make('section', null, 'week-day');
    if (day === today) column.classList.add('is-today');
    const heading = make('h4', date.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }));
    column.setAttribute('aria-label', date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }));
    const head = make('div', null, 'week-day-head');
    head.append(heading);
    const add = make('button', '+', 'week-add');
    add.type = 'button';
    add.setAttribute('aria-label', `Agendar em ${date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}`);
    add.addEventListener('click', () => onCompose?.(day, add));
    head.append(add);
    column.append(head);
    const tasks = items.filter((item) => item.kind === 'task' && item.date === day);
    if (tasks.length) {
      const list = make('ul', null, 'week-tasks');
      for (const task of tasks) list.append(make('li', `Prazo: ${task.title}`));
      column.append(list);
    }
    const body = make('ol', null, 'week-day-body');
    const events = items.filter(
      (item) => item.kind !== 'task' && localDay(new Date(item.startsAt)) === day,
    );
    if (!events.length) body.append(make('li', 'Livre', 'week-free'));
    for (const { item, lane, lanes } of layoutDay(events)) {
      const block = make('li', null, 'week-event');
      const where = span(item, day);
      block.style.setProperty('--top', String(where.top));
      block.style.setProperty('--height', String(where.height));
      block.style.setProperty('--lane', String(lane));
      block.style.setProperty('--lanes', String(lanes));
      const open = make('button', null, 'week-event-open');
      open.type = 'button';
      open.append(make('strong', item.title), make('span', `${time(item.startsAt)} – ${time(item.endsAt)}`));
      open.setAttribute('aria-label', `${item.title}, ${time(item.startsAt)} a ${time(item.endsAt)}. Editar horário`);
      open.addEventListener('click', () => onEdit?.(item, open));
      const menu = make('details', null, 'week-move');
      const summary = make('summary');
      summary.append(make('span', '⋯', 'week-move-icon'), make('span', 'Mover', 'week-move-text'));
      summary.firstChild.setAttribute('aria-hidden', 'true');
      summary.setAttribute('aria-label', `Mover ${item.title}`);
      const options = make('div', null, 'week-move-options');
      for (const [label, minutes] of [
        ['30 min mais cedo', -30],
        ['30 min mais tarde', 30],
        ['Dia anterior', -1440],
        ['Dia seguinte', 1440],
      ]) {
        const button = make('button', label);
        button.type = 'button';
        button.addEventListener('click', () => {
          menu.open = false;
          onMove?.(item, minutes, summary);
        });
        options.append(button);
      }
      menu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menu.open) {
          menu.open = false;
          summary.focus();
        }
      });
      menu.append(summary, options);
      block.append(open, menu);
      body.append(block);
    }
    column.append(body);
    root.append(column);
  }
  container.replaceChildren(root);
  return root;
}
