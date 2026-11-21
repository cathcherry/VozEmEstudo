import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStartOf, weekRange, moveEvent, layoutDay } from '../js/pages/calendar-week.js';

test('weeks start on Monday at local midnight', () => {
  const sunday = new Date(2026, 10, 22, 18, 30);
  const start = weekStartOf(sunday);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 16);
  assert.equal(start.getHours(), 0);
  const range = weekRange(start);
  assert.equal(Date.parse(range.to) - Date.parse(range.from), 7 * 86_400_000);
});

test('moving keeps the duration: 30 minutes, or a whole day on the local clock', () => {
  const item = { startsAt: new Date(2026, 10, 18, 14, 0).toISOString(), endsAt: new Date(2026, 10, 18, 15, 30).toISOString() };
  const later = moveEvent(item, 30);
  assert.equal(new Date(later.startsAt).getHours(), 14);
  assert.equal(new Date(later.startsAt).getMinutes(), 30);
  assert.equal(Date.parse(later.endsAt) - Date.parse(later.startsAt), 90 * 60_000);
  const nextDay = moveEvent(item, 1440);
  assert.equal(new Date(nextDay.startsAt).getDate(), 19);
  assert.equal(new Date(nextDay.startsAt).getHours(), 14);
  const before = moveEvent(item, -1440);
  assert.equal(new Date(before.endsAt).getDate(), 17);
});

test('overlapping blocks share the column side by side; separate ones use the full width', () => {
  const at = (h, m = 0) => new Date(2026, 10, 18, h, m).toISOString();
  const placed = layoutDay([
    { id: 'a', startsAt: at(9), endsAt: at(10) },
    { id: 'b', startsAt: at(9, 30), endsAt: at(11) },
    { id: 'c', startsAt: at(10), endsAt: at(10, 30) },
    { id: 'd', startsAt: at(14), endsAt: at(15) },
  ]);
  const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
  assert.deepEqual([by.a.lane, by.b.lane, by.c.lane], [0, 1, 0]);
  assert.equal(by.a.lanes, 2);
  assert.equal(by.c.lanes, 2);
  assert.deepEqual([by.d.lane, by.d.lanes], [0, 1]);
});
