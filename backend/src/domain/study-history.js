// Study history without new tables: daily totals built from `study_sessions.total_seconds`
// (the time the server credited to each session). A session counts on the local day it started,
// in the account's time zone; sessions crossing midnight are rare and capped at 24 h by the DB.

export const HISTORY_DAYS = Object.freeze([84, 371]); // 12 weeks, or a year view (53 weeks)

/** YYYY-MM-DD of `date` in `timeZone`. */
export function localDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * Totals per local day for the last `days` days (today included), the lessons studied most and
 * the first day still covered. Sessions without credited time are ignored.
 */
export function buildStudyHistory(sessions, { days, timeZone, now = new Date(), goalMinutes = 120 }) {
  const to = localDate(now, timeZone);
  const from = addDays(to, -(days - 1));
  const totals = new Map();
  const lessons = new Map();
  for (const session of sessions) {
    const seconds = Number(session.total_seconds) || 0;
    if (seconds <= 0) continue;
    const day = localDate(new Date(session.started_at), timeZone);
    if (day < from || day > to) continue;
    const entry = totals.get(day) || { seconds: 0, sessions: 0 };
    entry.seconds += seconds;
    entry.sessions += 1;
    totals.set(day, entry);
    if (session.material_id) lessons.set(session.material_id, (lessons.get(session.material_id) || 0) + seconds);
  }
  const list = [];
  for (let day = from; day <= to; day = addDays(day, 1))
    list.push({ date: day, seconds: totals.get(day)?.seconds || 0, sessions: totals.get(day)?.sessions || 0 });
  return {
    from,
    to,
    timezone: timeZone,
    goalMinutes,
    days: list,
    topLessons: [...lessons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([materialId, seconds]) => ({ materialId, seconds })),
  };
}

/** Start instant (UTC) safely before `from` in any time zone, for the database filter. */
export function queryStart(days, now = new Date()) {
  return new Date(now.getTime() - (days + 1) * 86_400_000).toISOString();
}
