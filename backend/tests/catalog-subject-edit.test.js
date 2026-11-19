import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';

const origin = 'http://catalog.e03.invalid';
// Configuration is read when modules load, so it is set before importing the repository.
Object.assign(process.env, {
  SUPABASE_URL: origin,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_catalog_fixture',
  SUPABASE_SECRET_KEY: 'catalog-fixture-server-key',
});
const repository = await import('../src/repositories/catalog.repository.js');
const { buildCatalogService } = await import('../src/services/catalog.service.js');

/** Minimal PostgREST stand-in: eq/is filters, GET/PATCH/DELETE returning rows, on real SQL. */
function restOver(db) {
  return async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    assert(url.origin === origin && url.pathname.startsWith('/rest/v1/'));
    const table = url.pathname.split('/').at(-1);
    assert(/^[a-z_]+$/.test(table));
    const where = [],
      values = [];
    for (const [column, value] of url.searchParams) {
      if (column === 'select') continue;
      assert(/^[a-z_]+$/.test(column));
      if (value === 'is.null') where.push(`${column} is null`);
      else if (value.startsWith('eq.')) {
        values.push(value.slice(3));
        where.push(`${column}::text = $${values.length}`);
      } else throw new Error('Unsupported filter ' + value);
    }
    const condition = where.length ? ' where ' + where.join(' and ') : '';
    const method = options.method || 'GET';
    let sql;
    if (method === 'PATCH') {
      const patch = JSON.parse(options.body);
      const sets = Object.keys(patch).map((column) => {
        values.push(patch[column]);
        return `${column} = $${values.length}`;
      });
      sql = `update public.${table} set ${sets.join(', ')}${condition} returning *`;
    } else if (method === 'DELETE')
      sql = ['delete', `from public.${table}${condition} returning *`].join(' ');
    else sql = `select * from public.${table}${condition}`;
    try {
      const rows = (await db.query(sql, values)).rows;
      const single = new Headers(options.headers).get('accept')?.includes('vnd.pgrst.object');
      if (single && rows.length > 1)
        return Response.json({ code: 'PGRST116', message: 'multiple rows' }, { status: 406 });
      if (single && !rows.length)
        return Response.json({ code: 'PGRST116', message: 'no rows' }, { status: 406 });
      return Response.json(single ? rows[0] : rows);
    } catch (error) {
      return Response.json({ code: error.code, message: error.message }, { status: 400 });
    }
  };
}

const count = async (db, sql, params) => Number((await db.query(sql, params)).rows[0].n);

test('subjects: rename syncs lesson labels; remove keeps lessons and drops units', async (t) => {
  const f = await createAcademicDatabase();
  const nativeFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await f.db.close();
  });
  const { db } = f;
  await db.exec(
    readFileSync(
      new URL('../../database/migrations/20261104190000_catalog_units.sql', import.meta.url),
      'utf8',
    ),
  );
  globalThis.fetch = restOver(db);
  const a = identities.a.id,
    b = identities.b.id;
  const subject = (
    await db.query(
      "insert into public.study_subjects(user_id,name,normalized_name) values($1,'Geografia','geografia') returning id",
      [a],
    )
  ).rows[0].id;
  const unit = (
    await db.query(
      "insert into public.study_units(user_id,subject_id,title,normalized_title) values($1,$2,'Vegetação','vegetação') returning id",
      [a, subject],
    )
  ).rows[0].id;
  await db.query(
    "update public.materials set subject='Geografia', subject_id=$1, unit_id=$2 where id=$3",
    [subject, unit, resourceIds.materialA],
  );
  const service = buildCatalogService(repository);
  const lesson = async () =>
    (
      await db.query('select subject, subject_id, unit_id from public.materials where id=$1', [
        resourceIds.materialA,
      ])
    ).rows[0];

  const renamed = await service.updateSubject(a, subject, { name: '  Geografia   do Brasil ' });
  assert.equal(renamed.name, 'Geografia do Brasil');
  assert.deepEqual(await lesson(), {
    subject: 'Geografia do Brasil',
    subject_id: subject,
    unit_id: unit,
  });
  await assert.rejects(service.updateSubject(b, subject, { name: 'Invasão' }), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(service.updateSubject(a, subject, { name: '' }));
  const other = (
    await db.query(
      "insert into public.study_subjects(user_id,name,normalized_name) values($1,'História','história') returning id",
      [a],
    )
  ).rows[0].id;
  await assert.rejects(service.updateSubject(a, other, { name: 'geografia do brasil' }), {
    code: 'CATALOG_DUPLICATE',
  });

  await assert.rejects(service.deleteSubject(b, subject), { code: 'NOT_FOUND' });
  const removed = await service.deleteSubject(a, subject);
  assert.deepEqual(removed, { id: subject, unassignedMaterials: 1, deletedUnits: 1 });
  assert.deepEqual(await lesson(), { subject: null, subject_id: null, unit_id: null });
  assert.equal(
    await count(db, 'select count(*) n from public.materials where id=$1', [resourceIds.materialA]),
    1,
    'the lesson itself is never deleted',
  );
  assert.equal(
    await count(db, 'select count(*) n from public.study_units where subject_id=$1', [subject]),
    0,
  );
  await assert.rejects(service.deleteSubject(a, subject), { code: 'NOT_FOUND' });
  assert.equal(
    await count(db, 'select count(*) n from public.study_subjects where id=$1', [other]),
    1,
    'other subjects stay',
  );
});
