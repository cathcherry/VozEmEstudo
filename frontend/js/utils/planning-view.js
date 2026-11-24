export function progressForGoal(goal, tasks) {
  const linked = tasks.filter((task) => task.goal_id === goal.id);
  const completed = linked.filter((task) => Boolean(task.completed_at)).length;
  return { completed, total: linked.length };
}

export function dateLabel(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** A calendar day as YYYY-MM-DD in this device's time zone (deadlines are calendar days). */
export function localIsoDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Noon of an ISO day, so adding days never trips over a daylight-saving change. */
function dayDate(isoDay) {
  const [y, m, d] = String(isoDay).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addIsoDays(isoDay, days) {
  const date = dayDate(isoDay);
  date.setDate(date.getDate() + days);
  return localIsoDay(date);
}

/** Whole days from `today` to `isoDay` (negative when it has passed). */
export function daysUntil(isoDay, today = localIsoDay()) {
  return Math.round((dayDate(isoDay) - dayDate(today)) / 86400000);
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAYS_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

/** "qui., 26/11" (and the year when it is not the current one). */
export function shortDayLabel(isoDay, today = localIsoDay()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(isoDay || ''))) return '';
  const date = dayDate(isoDay);
  const [y, m, d] = String(isoDay).slice(0, 10).split('-');
  const year = y === today.slice(0, 4) ? '' : `/${y}`;
  return `${WEEKDAYS_SHORT[date.getDay()]}, ${d}/${m}${year}`;
}

/** "quinta-feira, 26/11" for hints. */
export function longDayLabel(isoDay, today = localIsoDay()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(isoDay || ''))) return '';
  const date = dayDate(isoDay);
  return `${WEEKDAYS[date.getDay()]}, ${shortDayLabel(isoDay, today).split(', ')[1]}`;
}

/**
 * How close a deadline is, in words (never colour alone):
 * { state: 'none'|'done'|'overdue'|'today'|'soon'|'later', text, date }.
 */
export function deadlineState(isoDay, { done = false, today = localIsoDay() } = {}) {
  if (!isoDay) return { state: 'none', text: '', date: '' };
  const date = shortDayLabel(isoDay, today);
  if (done) return { state: 'done', text: '', date };
  const days = daysUntil(isoDay, today);
  if (days < 0)
    return { state: 'overdue', text: days === -1 ? 'venceu ontem' : `venceu há ${-days} dias`, date };
  if (days === 0) return { state: 'today', text: 'vence hoje', date };
  if (days === 1) return { state: 'soon', text: 'vence amanhã', date };
  if (days < 7) return { state: 'soon', text: `faltam ${days} dias`, date };
  return { state: 'later', text: '', date };
}

// Word end that also works after accented letters ("amanhã", "sábado").
const word = (source) => new RegExp(`^(?:${source})(?![\\p{L}\\d])`, 'u');
const NAMED_DAYS = [
  [word('(?:o\\s+|a\\s+)?hoje'), 0],
  [word('(?:o\\s+|a\\s+)?depois\\s+de\\s+amanh[ãa]'), 2],
  [word('(?:o\\s+|a\\s+)?amanh[ãa]'), 1],
  [word('(?:a\\s+|o\\s+)?(?:pr[óo]xima\\s+semana|semana\\s+que\\s+vem)'), 7],
];
const WEEKDAY_WORDS = [
  [word('domingo'), 0], [word('segunda(?:-feira)?'), 1], [word('ter[çc]a(?:-feira)?'), 2],
  [word('quarta(?:-feira)?'), 3], [word('quinta(?:-feira)?'), 4], [word('sexta(?:-feira)?'), 5],
  [word('s[áa]bado'), 6],
];

/**
 * Reads a deadline written in the goal itself ("… até quinta-feira", "para amanhã", "até 30/11").
 * Returns { date: 'YYYY-MM-DD', phrase } or null. Weekdays mean the next one (today counts).
 */
export function deadlineFromText(text, today = localIsoDay()) {
  const source = String(text || '').toLowerCase();
  const marker = /(?<![\p{L}\d])(?:até|para|pra|prazo:?)\s+(?:(?:a|o|esta|este|nesta|neste|na|no|essa|esse)\s+)?/gu;
  let match;
  while ((match = marker.exec(source))) {
    const rest = source.slice(match.index + match[0].length);
    for (const [pattern, offset] of NAMED_DAYS) {
      const found = rest.match(pattern);
      if (found) return { date: addIsoDays(today, offset), phrase: (match[0] + found[0]).trim() };
    }
    for (const [pattern, weekday] of WEEKDAY_WORDS) {
      const found = rest.match(pattern);
      if (found) {
        const current = dayDate(today).getDay();
        return { date: addIsoDays(today, (weekday - current + 7) % 7), phrase: (match[0] + found[0]).trim() };
      }
    }
    const numeric = rest.match(/^(?:o\s+dia\s+|dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (numeric) {
      const [, d, m, y] = numeric;
      let year = y ? Number(y.length === 2 ? `20${y}` : y) : Number(today.slice(0, 4));
      let iso = `${year}-${pad(Number(m))}-${pad(Number(d))}`;
      const check = dayDate(iso);
      if (check.getDate() !== Number(d) || check.getMonth() + 1 !== Number(m)) continue;
      if (!y && iso < today) { year += 1; iso = `${year}-${pad(Number(m))}-${pad(Number(d))}`; }
      return { date: iso, phrase: (match[0] + numeric[0]).trim() };
    }
  }
  return null;
}

/** Shortcuts for the deadline field: tomorrow, the coming Friday and one week from today. */
export function quickDeadlines(today = localIsoDay()) {
  const current = dayDate(today).getDay();
  const friday = addIsoDays(today, ((5 - current + 7) % 7) || 7);
  return [
    { label: 'Amanhã', date: addIsoDays(today, 1) },
    { label: 'Sexta-feira', date: friday },
    { label: 'Em uma semana', date: addIsoDays(today, 7) },
  ];
}

export function sortedPlanningTasks(tasks, { filter = 'all', sort = 'due' } = {}) {
  const filtered = tasks.filter((task) => {
    if (filter === 'pending') return !task.completed_at;
    if (filter === 'completed') return Boolean(task.completed_at);
    return true;
  });
  return [...filtered].sort((a, b) => {
    if (sort === 'manual')
      return (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        || (a.created_at || '').localeCompare(b.created_at || '')
        || a.id.localeCompare(b.id);
    if (sort === 'title') return a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id);
    if (sort === 'recent')
      return (b.created_at || '').localeCompare(a.created_at || '') || a.id.localeCompare(b.id);
    const done = Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at));
    if (done) return done;
    const dateA = a.due_date || '9999-12-31';
    const dateB = b.due_date || '9999-12-31';
    return dateA.localeCompare(dateB) || (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id);
  });
}
