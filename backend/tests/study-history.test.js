import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyHistory, localDate, queryStart } from '../src/domain/study-history.js';
import { buildStudyService } from '../src/services/study.service.js';
import { validateHistoryQuery } from '../src/validators/study.validator.js';

const now = new Date('2026-11-21T12:00:00Z');

test('sessions count on the local day they started, in the account time zone', () => {
  const history = buildStudyHistory(
    [
      // 01:30 UTC on the 21st is still the 20th in São Paulo (UTC-3).
      { material_id: 'l1', started_at: '2026-11-21T01:30:00Z', total_seconds: 1500 },
      { material_id: 'l1', started_at: '2026-11-21T10:00:00Z', total_seconds: 600 },
      { material_id: 'l2', started_at: '2026-11-21T11:00:00Z', total_seconds: 300 },
      { material_id: null, started_at: '2026-11-19T15:00:00Z', total_seconds: 900 },
      { material_id: 'l3', started_at: '2026-11-21T11:30:00Z', total_seconds: 0 }, // nothing credited
      { material_id: 'old', started_at: '2026-08-01T12:00:00Z', total_seconds: 999 }, // before the range
    ],
    { days: 84, timeZone: 'America/Sao_Paulo', now, goalMinutes: 150 },
  );
  assert.equal(history.days.length, 84);
  assert.equal(history.to, '2026-11-21');
  assert.equal(history.from, '2026-08-30');
  const day = (iso) => history.days.find((d) => d.date === iso);
  assert.deepEqual(day('2026-11-21'), { date: '2026-11-21', seconds: 900, sessions: 2 });
  assert.deepEqual(day('2026-11-20'), { date: '2026-11-20', seconds: 1500, sessions: 1 });
  assert.equal(day('2026-11-19').seconds, 900);
  assert.deepEqual(history.topLessons, [
    { materialId: 'l1', seconds: 2100 },
    { materialId: 'l2', seconds: 300 },
  ]);
  assert.equal(history.goalMinutes, 150);
  assert.equal(localDate(new Date('2026-11-21T02:59:00Z'), 'America/Sao_Paulo'), '2026-11-20');
  assert(queryStart(84, now) < '2026-08-30T00:00:00Z');
});

test('history is always the signed-in account; only 12 weeks or a year can be asked for', async () => {
  const calls = [];
  const service = buildStudyService({
    getSettings: async (userId) => (calls.push(['settings', userId]), { goalMinutes: 120, timezone: 'UTC' }),
    listSessionsSince: async (userId, since) => (calls.push(['sessions', userId, since]), []),
  });
  const year = await service.history('owner', { days: '371' }, now);
  assert.equal(year.days.length, 371);
  assert(calls.every((call) => call[1] === 'owner'));
  assert.equal((await service.history('owner', {}, now)).days.length, 84);
  assert.throws(() => validateHistoryQuery({ days: '5000' }));
  assert.throws(() => validateHistoryQuery({ days: '84', userId: 'someone' }));
});
