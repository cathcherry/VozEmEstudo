import test from 'node:test';
import assert from 'node:assert/strict';
import { weeksOf, level, formatMinutes } from '../js/pages/study-stats.js';

test('weeks start on Monday; the first one may be partial', () => {
  const days = [
    { date: '2026-11-14', seconds: 600 }, // Saturday
    { date: '2026-11-15', seconds: 0 }, // Sunday
    { date: '2026-11-16', seconds: 1200 }, // Monday
    { date: '2026-11-17', seconds: 0 },
    { date: '2026-11-18', seconds: 1800 },
  ];
  assert.deepEqual(weeksOf(days), [
    { start: '2026-11-14', seconds: 600, studied: 1 },
    { start: '2026-11-16', seconds: 3000, studied: 2 },
  ]);
});

test('year map levels and readable durations', () => {
  assert.deepEqual([0, 60, 900, 1800, 3600].map(level), [0, 1, 2, 3, 4]);
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(35 * 60), '35 min');
  assert.equal(formatMinutes(125 * 60), '2 h 05 min');
  assert.equal(formatMinutes(180 * 60), '3 h');
});
