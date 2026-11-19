import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';

const read = (file) =>
  readFileSync(new URL('../../database/migrations/' + file, import.meta.url), 'utf8');

test('material_videos can be created before E05, and E05 still applies afterwards', async () => {
  const sql = read('20261119150000_material_videos_table.sql');
  assert.doesNotMatch(sql, /\b(drop|truncate|delete from|storage\.buckets|create policy)\b/i);
  const f = await createAcademicDatabase();
  try {
    const before = Number((await f.db.query('select count(*) n from public.materials')).rows[0].n);
    await f.db.exec(sql);
    await f.db.exec(sql);
    assert(
      await f.db
        .query("select to_regclass('public.material_videos') is not null as ok")
        .then((r) => r.rows[0].ok),
    );
    assert.equal(
      Number((await f.db.query('select count(*) n from public.materials')).rows[0].n),
      before,
    );
    // The browser roles cannot read the table.
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select * from public.material_videos');
      }),
      /permission denied/,
    );
    // E03 then E05 still apply on top: E05 skips the key that already exists.
    await f.db.exec(read('20261104190000_catalog_units.sql'));
    await f.db.exec(read('20261104203000_study_planning.sql'));
    assert(
      await f.db
        .query("select to_regclass('public.study_goals') is not null as ok")
        .then((r) => r.rows[0].ok),
    );
    assert.equal(
      Number(
        (
          await f.db.query(
            "select count(*) n from pg_constraint where conname = 'materials_id_user_planning_unique'",
          )
        ).rows[0].n,
      ),
      1,
    );
  } finally {
    await f.db.close();
  }
});
