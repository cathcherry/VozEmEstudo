import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import {
  addConfirmedLesson,
  completeInvestigation,
  createDiscoveriesDatabase,
  discoveryApi,
  multiRevisionId,
  multiSegments,
} from './fixtures/discoveries-db.fixture.js';

// 3.6 Milestone E: 20261124090000_discovery_archive.sql replaces discovery_list_admin so the
// archive can show each card's state and the connections between cards. Real SQL (PGlite).
const read = (path) => readFileSync(new URL(`../../database/${path}`, import.meta.url), 'utf8');
const migration = read('migrations/20261124090000_discovery_archive.sql');
const a = identities.a.id;
const b = identities.b.id;
const A = resourceIds.materialA;
const EXPLANATION = 'A energia muda de forma, mas a quantidade total continua a mesma.';

async function setup() {
  const f = await createDiscoveriesDatabase();
  return { ...f, api: discoveryApi(f.call) };
}

test('migration is guarded, transactional and replaces only the list function', async () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /DISCOVERY_ARCHIVE_ABORT/);
  const statements = migration.replace(/--.*$/gm, '');
  assert.doesNotMatch(statements, /\b(drop|truncate|alter table|create table|create trigger|insert into|update public|delete from)\b/i);
  assert.deepEqual([...statements.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]), ['discovery_list_admin']);
  assert.match(statements, /security invoker set search_path = ''/);

  // Without the discoveries migration it refuses to run.
  const bare = await createDiscoveriesDatabase({ migrate: false });
  try {
    await assert.rejects(bare.db.exec(migration), /DISCOVERY_ARCHIVE_ABORT/);
    await bare.db.exec('rollback');
  } finally {
    await bare.db.close();
  }
});

test('the list keeps every field and adds question, reflections, connections and the first revisit', async () => {
  const f = await setup();
  try {
    const history = await addConfirmedLesson(f.db, a, { title: 'Revolução Industrial', subject: 'História', segments: ['A máquina a vapor usava carvão.'] });
    const energy = await completeInvestigation(f.api, a, A, { question: 'Energia se conserva?', revisionId: multiRevisionId, explanation: EXPLANATION,
      quote: { segmentPosition: 0, startOffset: 0, endOffset: [...multiSegments[0]].length, quote: multiSegments[0] } });
    const steam = await completeInvestigation(f.api, a, history.materialId, { question: 'Por que o vapor mudou a indústria?', revisionId: history.revisionId, explanation: EXPLANATION,
      quote: { segmentPosition: 0, startOffset: 0, endOffset: 9, quote: 'A máquina' } });
    const before = await f.api.list(a);
    await f.db.exec(migration);
    const after = await f.api.list(a);
    // Every field returned before is returned unchanged.
    for (const [index, row] of before.entries())
      for (const [key, value] of Object.entries(row)) assert.deepEqual(after[index][key], value, key);
    const card = (rows, id) => rows.find((row) => row.id === id);
    assert.equal(card(after, energy.id).question, 'Energia se conserva?');
    assert.equal(card(after, energy.id).reflectionCount, 0);
    assert.deepEqual(card(after, energy.id).connections, []);
    assert.equal(card(after, energy.id).firstRevisitAt, null);

    await f.api.reflect(a, energy.id, 'Antes eu achava que a energia sumia.');
    await f.api.connect(a, energy.id, steam.id, 'O carvão guarda energia');
    await f.db.query("update public.discoveries set created_at = created_at - interval '2 days' where id = $1", [steam.id]);
    await f.api.reflect(a, steam.id, 'Voltei dois dias depois para ligar com a energia.');
    const rows = await f.api.list(a);
    assert.equal(card(rows, energy.id).reflectionCount, 1);
    // The connection appears on both cards, with the other side and whether it crosses subjects.
    assert.deepEqual(card(rows, energy.id).connections.map((c) => [c.otherId, c.acrossSubjects]), [[steam.id, true]]);
    assert.deepEqual(card(rows, steam.id).connections.map((c) => [c.otherId, c.acrossSubjects]), [[energy.id, true]]);
    assert(card(rows, steam.id).firstRevisitAt, 'revisit recorded by the unchanged trigger');
    assert.equal(card(rows, energy.id).firstRevisitAt, null);
    // Applying it again changes nothing; another account still sees nothing.
    await f.db.exec(migration);
    assert.deepEqual(await f.api.list(a), rows);
    assert.deepEqual(await f.api.list(b), []);
    // Still server only.
    const rights = (await f.db.query(`select has_function_privilege('authenticated', 'public.discovery_list_admin(uuid)', 'execute') browser,
      has_function_privilege('anon', 'public.discovery_list_admin(uuid)', 'execute') anon,
      has_function_privilege('service_role', 'public.discovery_list_admin(uuid)', 'execute') server`)).rows[0];
    assert.deepEqual(rights, { browser: false, anon: false, server: true });
  } finally {
    await f.db.close();
  }
});

test('the documented rollback restores the previous list function', async () => {
  const f = await setup();
  try {
    await completeInvestigation(f.api, a, A, { question: 'Energia se conserva?', revisionId: multiRevisionId, explanation: EXPLANATION,
      quote: { segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia' } });
    const before = await f.api.list(a);
    await f.db.exec(migration);
    const rollback = read('rollback/discovery-archive-rollback.md').match(/```sql\n([\s\S]*?)```/)[1];
    await f.db.exec(rollback);
    assert.deepEqual(await f.api.list(a), before);
    assert.equal((await f.db.query("select has_function_privilege('authenticated', 'public.discovery_list_admin(uuid)', 'execute') x")).rows[0].x, false);
  } finally {
    await f.db.close();
  }
});
