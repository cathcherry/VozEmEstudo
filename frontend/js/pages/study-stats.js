// "Seu ritmo" (Focar and Planejar › Tempo): the last 12 weeks against the weekly goal, the lessons
// studied most, and an optional year map. Numbers come from the time the server credited
// (GET /api/study/history); visiting pages never counts. No streaks: an empty week is just empty.
import { getStudyHistory } from '../api/study.api.js';
import { listMaterials } from '../api/material.api.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const locale = () => globalThis.VOZ_LOCALE || 'pt-BR';

/** "2 h 05 min", "35 min", "0 min". */
export function formatMinutes(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`;
}

const parse = (iso) => new Date(`${iso}T12:00:00Z`);
const shortDate = (iso) =>
  parse(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/** Groups days into weeks that start on Monday; the first week may be partial. */
export function weeksOf(days) {
  const weeks = [];
  for (const day of days) {
    const weekday = (parse(day.date).getUTCDay() + 6) % 7; // Monday = 0
    if (!weeks.length || weekday === 0) weeks.push({ start: day.date, seconds: 0, studied: 0 });
    const week = weeks.at(-1);
    week.seconds += day.seconds;
    if (day.seconds > 0) week.studied += 1;
  }
  return weeks;
}

/** Year map intensity: 0 none, then <15 min, <30, <60, 60+. */
export const level = (seconds) =>
  seconds <= 0 ? 0 : seconds < 900 ? 1 : seconds < 1800 ? 2 : seconds < 3600 ? 3 : 4;

function weekChart(weeks, goalSeconds) {
  const top = Math.max(goalSeconds, ...weeks.map((w) => w.seconds), 1);
  const best = weeks.reduce((a, b) => (b.seconds > a.seconds ? b : a), weeks[0]);
  const figure = make('figure', null, 'stats-chart');
  const caption = make(
    'figcaption',
    goalSeconds > 0
      ? `Horas por semana. Linha tracejada: meta de ${formatMinutes(goalSeconds)}; barras escuras atingiram a meta.`
      : 'Horas por semana.',
  );
  const plot = make('div', null, 'stats-plot');
  plot.style.setProperty('--goal', String(goalSeconds / top));
  plot.setAttribute('role', 'img');
  plot.setAttribute(
    'aria-label',
    `Últimas ${weeks.length} semanas. Melhor semana: ${formatMinutes(best.seconds)}. Meta: ${formatMinutes(goalSeconds)} por semana. A tabela abaixo tem todos os valores.`,
  );
  const goal = make('span', null, 'stats-goal');
  goal.setAttribute('aria-hidden', 'true');
  goal.hidden = !(goalSeconds > 0);
  const bars = make('ol', null, 'stats-bars');
  bars.setAttribute('aria-hidden', 'true');
  weeks.forEach((week, index) => {
    const item = make('li');
    if (week.seconds >= goalSeconds && goalSeconds > 0) item.classList.add('is-goal');
    const bar = make('span', null, 'stats-bar');
    bar.style.setProperty('--value', String(week.seconds / top));
    // Direct labels only where they help: the best week and the current one.
    const labelled = week === best || index === weeks.length - 1;
    if (labelled && week.seconds > 0) bar.append(make('span', formatMinutes(week.seconds), 'stats-value'));
    const tip = make('span', `Semana de ${shortDate(week.start)}: ${formatMinutes(week.seconds)}, ${week.studied} ${week.studied === 1 ? 'dia' : 'dias'} com estudo`, 'stats-tip');
    item.append(bar, tip, make('span', shortDate(week.start), 'stats-week'));
    bars.append(item);
  });
  plot.append(goal, bars);
  figure.append(caption, plot);
  return figure;
}

function weekTable(weeks, goalSeconds) {
  const details = make('details', null, 'stats-table');
  details.append(make('summary', 'Ver em tabela'));
  const table = make('table');
  const head = make('tr');
  for (const text of ['Semana de', 'Tempo', 'Dias com estudo', 'Meta']) head.append(make('th', text));
  head.querySelectorAll('th').forEach((th) => th.setAttribute('scope', 'col'));
  table.append(make('thead'), make('tbody'));
  table.tHead.append(head);
  for (const week of [...weeks].reverse()) {
    const row = make('tr');
    row.append(
      make('td', shortDate(week.start)),
      make('td', formatMinutes(week.seconds)),
      make('td', String(week.studied)),
      make('td', goalSeconds > 0 && week.seconds >= goalSeconds ? 'Atingida' : '—'),
    );
    table.tBodies[0].append(row);
  }
  details.append(table);
  return details;
}

function yearMap(history) {
  const wrap = make('div', null, 'stats-year');
  const days = history.days;
  const studied = days.filter((d) => d.seconds > 0);
  const total = studied.reduce((sum, d) => sum + d.seconds, 0);
  const grid = make('div', null, 'stats-year-grid');
  grid.setAttribute('role', 'img');
  grid.setAttribute(
    'aria-label',
    `Últimos 12 meses: ${studied.length} ${studied.length === 1 ? 'dia' : 'dias'} com estudo, ${formatMinutes(total)} no total.`,
  );
  // Rows are weekdays (Monday first); blank cells align the first column.
  const offset = (parse(days[0].date).getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i += 1) grid.append(make('span', null, 'stats-cell is-blank'));
  for (const day of days) {
    const cell = make('span', null, 'stats-cell');
    cell.dataset.level = String(level(day.seconds));
    cell.title = `${parse(day.date).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${formatMinutes(day.seconds)}`;
    grid.append(cell);
  }
  const scroller = make('div', null, 'stats-year-scroll');
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', 'Mapa do ano (role para os lados)');
  scroller.append(grid);
  const legend = make('p', null, 'stats-legend');
  legend.append(make('span', 'Menos'));
  for (const n of [0, 1, 2, 3, 4]) {
    const swatch = make('span', null, 'stats-cell');
    swatch.dataset.level = String(n);
    swatch.setAttribute('aria-hidden', 'true');
    legend.append(swatch);
  }
  legend.append(make('span', 'Mais (1 h ou mais por dia)'));
  wrap.append(scroller, legend);
  // Start at the most recent weeks.
  requestAnimationFrame(() => {
    scroller.scrollLeft = scroller.scrollWidth;
  });
  return wrap;
}

/** Renders the section into `container`; hides it when history is unavailable. */
export async function initStudyStats({ container, materials = null } = {}) {
  if (!container) return null;
  let history;
  try {
    history = await getStudyHistory(84);
  } catch {
    container.hidden = true;
    return null;
  }
  const goalSeconds = (history.goalMinutes || 0) * 60;
  const weeks = weeksOf(history.days).slice(-12);
  const total = weeks.reduce((sum, w) => sum + w.seconds, 0);
  const studiedDays = history.days.filter((d) => d.seconds > 0).length;
  const best = Math.max(...weeks.map((w) => w.seconds));
  const reached = weeks.filter((w) => goalSeconds > 0 && w.seconds >= goalSeconds).length;

  const heading = make('h2', 'Seu ritmo');
  heading.id = 'study-stats-title';
  container.setAttribute('aria-labelledby', heading.id);
  const intro = make('p', 'Últimas 12 semanas.', 'stats-intro');
  const tiles = make('dl', null, 'stats-tiles');
  const tile = (label, value) => {
    const box = make('div', null, 'stats-tile');
    box.append(make('dt', label), make('dd', value));
    tiles.append(box);
  };
  tile('Média por semana', formatMinutes(total / Math.max(1, weeks.length)));
  tile('Melhor semana', formatMinutes(best));
  tile('Semanas na meta', `${reached}/${weeks.length}`);
  tile('Dias com estudo', String(studiedDays));
  container.replaceChildren(heading, intro);
  if (!total) {
    container.append(make('p', 'Ainda não há tempo registrado nestas semanas. Comece um bloco de foco e ele aparece aqui.', 'stats-empty'));
    container.hidden = false;
    return history;
  }
  container.append(tiles, weekChart(weeks, goalSeconds), weekTable(weeks, goalSeconds));

  if (history.topLessons?.length) {
    const lessons = make('section', null, 'stats-lessons');
    lessons.append(make('h3', 'Aulas mais estudadas'));
    const list = make('ol');
    lessons.append(list);
    container.append(lessons);
    const fill = (all) => {
      const titles = new Map((all || []).map((m) => [m.id, m.title]));
      list.replaceChildren(
        ...history.topLessons.map((entry) => {
          const item = make('li');
          const title = titles.get(entry.materialId);
          if (title) {
            const link = make('a', title);
            link.href = `./material.html?id=${encodeURIComponent(entry.materialId)}`;
            item.append(link);
          } else item.append(make('span', 'Aula removida', 'stats-muted'));
          item.append(make('span', formatMinutes(entry.seconds), 'stats-muted'));
          return item;
        }),
      );
    };
    if (materials) fill(materials);
    else
      listMaterials()
        .then((result) => fill(Array.isArray(result) ? result : result?.materials))
        .catch(() => fill([]));
  }

  const yearButton = make('button', 'Ver o ano', 'secondary-action stats-year-toggle');
  yearButton.type = 'button';
  yearButton.setAttribute('aria-expanded', 'false');
  const yearSlot = make('div');
  yearSlot.hidden = true;
  yearButton.addEventListener('click', async () => {
    const open = yearButton.getAttribute('aria-expanded') !== 'true';
    yearButton.setAttribute('aria-expanded', String(open));
    yearButton.textContent = open ? 'Ocultar o ano' : 'Ver o ano';
    yearSlot.hidden = !open;
    if (open && !yearSlot.childElementCount) {
      yearSlot.append(make('p', 'Carregando o ano…', 'stats-muted'));
      try {
        yearSlot.replaceChildren(yearMap(await getStudyHistory(371)));
      } catch (error) {
        yearSlot.replaceChildren(make('p', error.message || 'Não foi possível carregar o ano agora.', 'stats-muted'));
      }
    }
  });
  container.append(yearButton, yearSlot);
  container.hidden = false;
  return history;
}
