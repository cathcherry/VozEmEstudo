import { createAcademicDatabase, revisionIds } from './academic-db.fixture.js';
import assert from 'node:assert/strict';
import { identities, resourceIds, createOwnershipFixture } from './ownership.fixture.js';
import { randomUUID } from 'node:crypto';

export function createSupabaseHttpFixture() {
  const supabaseOrigin = 'http://supabase.e00.invalid';
  const nativeFetch = globalThis.fetch;
  let tables, effects, signedRequests, failures, databasePromise, objects;

  function resetFixture() {
    databasePromise?.then(({ db }) => db.close()).catch(() => {});
    databasePromise = null;
    tables = createOwnershipFixture();
    tables.content_warnings = [];
    tables.transcription_segments = [];
    tables.material_permissions = [];
    tables.transcription_confirmations = [];
    effects = [];
    signedRequests = [];
    failures = {};
    objects = new Map();
  }

  async function getDatabase() {
    if (!databasePromise)
      databasePromise = createAcademicDatabase().then(async (database) => {
        await database.permit(identities.a, resourceIds.materialA);
        await database.permit(identities.b, resourceIds.materialB);
        await database.confirm(identities.a, resourceIds.materialA, revisionIds.a);
        await database.confirm(identities.b, resourceIds.materialB, revisionIds.b);
        return database;
      });
    return databasePromise;
  }
  async function fixtureRpc(name, parameters) {
    const { db } = await getDatabase();
    const keys = Object.keys(parameters);
    assert(/^[a-z_]+$/.test(name) && keys.every((key) => /^[a-z_]+$/.test(key)));
    const values = Object.values(parameters).map((value) =>
      value && typeof value === 'object' ? JSON.stringify(value) : value,
    );
    const row = await db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      const args = keys.map((key, index) => key + ' => $' + (index + 1)).join(',');
      return (await tx.query('select public.' + name + '(' + args + ') as data', values)).rows[0]
        .data;
    });
    if (
      ![
        'get_transcription_review_admin',
        'get_generation_source_admin',
        'require_material_permission_admin',
      ].includes(name)
    ) {
      for (const table of Object.keys(tables))
        tables[table] = (await db.query('select * from public.' + table)).rows;
      effects.push({ table: name, method: 'RPC', count: 1 });
    }
    return row;
  }
  function response(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function projectRow(table, row, select) {
    const result = structuredClone(row);
    if (table === 'materials' && select.includes('audio_files(')) {
      result.audio_files = tables.audio_files.filter((audio) => audio.material_id === row.id);
    }
    if (table === 'processing_jobs' && select.includes('materials!inner')) {
      result.materials = {
        user_id: tables.materials.find((material) => material.id === row.material_id)?.user_id,
      };
    }
    if (table === 'transcriptions' && select.includes('transcription_segments('))
      result.transcription_segments = tables.transcription_segments.filter(
        (segment) => segment.transcription_id === row.id,
      );
    if (table === 'question_batches' && select.includes('questions(')) {
      const columns = select.match(/questions\(([^)]+)\)/)[1];
      result.questions = tables.questions
        .filter((question) => question.batch_id === row.id)
        .map((question) =>
          columns === '*'
            ? { ...question }
            : Object.fromEntries(columns.split(',').map((column) => [column, question[column]])),
        );
    }
    return result;
  }

  // Simulate the HTTP adapter, not services/repositories: removing an ownership filter
  // from production code would return the foreign row and fail these tests.
  async function fixtureFetch(input, options = {}) {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== supabaseOrigin) {
      assert.equal(url.hostname, '127.0.0.1', 'Tests must not contact a real external service');
      return nativeFetch(input, options);
    }
    const headers = new Headers(
      options.headers || (input instanceof Request ? input.headers : undefined),
    );
    if (url.pathname === '/auth/v1/user') {
      const identity = Object.values(identities).find(
        (user) => headers.get('authorization') === `Bearer ${user.token}`,
      );
      return identity
        ? response({ id: identity.id, email: `${identity.id}@example.test` })
        : response({ message: 'Invalid fixture token' }, 401);
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      const body = JSON.parse(options.body);
      signedRequests.push({ path: decodeURIComponent(url.pathname), expiresIn: body.expiresIn });
      return response({
        signedURL: `/object/sign/audios/fixture.wav?token=e00-synthetic-signature`,
      });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      try {
        return response(await fixtureRpc(url.pathname.split('/').at(-1), JSON.parse(options.body)));
      } catch (error) {
        return response({ code: error.code || 'FIXTURE_RPC_ERROR', message: error.message }, 400);
      }
    }
    if (
      (url.pathname.startsWith('/storage/v1/object/authenticated/audios/') ||
        url.pathname.startsWith('/storage/v1/object/audios/')) &&
      (!options.method || options.method === 'GET')
    ) {
      const key = decodeURIComponent(
        url.pathname.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?audios\//, ''),
      );
      effects.push({ table: 'storage', method: 'DOWNLOAD', count: 1 });
      return objects.has(key)
        ? new Response(new Uint8Array(1024), { headers: { 'Content-Type': 'audio/wav' } })
        : response({ message: 'Object not found' }, 404);
    }
    if (url.pathname.startsWith('/storage/v1/object/info/')) {
      const key = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/info\/(?:audios|study-videos)\//, ''));
      return objects.has(key)
        ? response(objects.get(key))
        : response({ message: 'Object not found', statusCode: '404' }, 404);
    }
    if (url.pathname === '/storage/v1/object/move' && options.method === 'POST') {
      const { sourceKey, destinationKey } = JSON.parse(options.body);
      if (!objects.has(sourceKey))
        return response({ message: 'Object not found', statusCode: '404' }, 404);
      objects.set(destinationKey, objects.get(sourceKey));
      objects.delete(sourceKey);
      return response({});
    }
    if (url.pathname.startsWith('/storage/v1/object/') && options.method === 'DELETE') {
      if (failures.storage_remove) return response({ message: failures.storage_remove }, 503);
      const { prefixes } = JSON.parse(options.body);
      for (const key of prefixes) objects.delete(key);
      effects.push({ table: 'storage', method: 'REMOVE', count: prefixes.length });
      return response({});
    }
    if (url.pathname.startsWith('/storage/v1/object/') && options.method === 'POST')
      return response({});
    assert(url.pathname.startsWith('/rest/v1/'), 'Unexpected fixture endpoint');
    const table = url.pathname.split('/').at(-1);
    // Additive E07 and AI-provider tables are absent in the legacy E00/E02 database fixture.
    if (['material_videos', 'ai_job_executions'].includes(table) && !Object.hasOwn(tables, table))
      return response({ code: '42P01', message: 'relation does not exist' }, 404);
    assert(Object.hasOwn(tables, table), `Unexpected fixture table: ${table}`);
    if (failures[table])
      return response({ message: failures[table], code: 'FIXTURE_FAILURE' }, 500);
    let rows = tables[table].filter((row) =>
      [...url.searchParams].every(([column, value]) => {
        if (!value.startsWith('eq.')) return true;
        const actual =
          column === 'materials.user_id'
            ? tables.materials.find((material) => material.id === row.material_id)?.user_id
            : row[column];
        return String(actual) === value.slice(3);
      }),
    );
    const method = options.method || 'GET';
    if (method === 'PATCH') {
      const patch = JSON.parse(options.body);
      if (databasePromise && rows.length) {
        const { db } = await databasePromise;
        const columns = Object.keys(patch);
        assert(columns.every((column) => /^[a-z_]+$/.test(column)));
        try {
          await db.transaction(async (tx) => {
            await tx.exec('set local role service_role');
            for (const row of rows) {
              const values = Object.values(patch).map((value) =>
                value && typeof value === 'object' ? JSON.stringify(value) : value,
              );
              await tx.query(
                'update public.' +
                  table +
                  ' set ' +
                  columns.map((column, index) => column + '=$' + (index + 1)).join(',') +
                  ' where id=$' +
                  (columns.length + 1),
                [...values, row.id],
              );
            }
          });
        } catch (error) {
          return response({ code: error.code, message: error.message }, 400);
        }
      }
      rows.forEach((row) => Object.assign(row, patch));
      if (rows.length) effects.push({ table, method, count: rows.length });
    } else if (method === 'DELETE') {
      tables[table] = tables[table].filter((row) => !rows.includes(row));
      if (rows.length) effects.push({ table, method, count: rows.length });
    } else if (method === 'POST') {
      const body = JSON.parse(options.body);
      rows = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: randomUUID(),
        ...(table === 'materials' ? { status: 'PENDENTE' } : {}),
        ...row,
      }));
      tables[table].push(...rows);
      effects.push({ table, method, count: rows.length });
    }
    const data = rows.map((row) => projectRow(table, row, url.searchParams.get('select') || '*'));
    return response(
      headers.get('accept')?.includes('application/vnd.pgrst.object') ? data[0] : data,
    );
  }

  resetFixture();
  return {
    origin: supabaseOrigin,
    fetch: fixtureFetch,
    reset: resetFixture,
    getDatabase,
    close: async () => {
      if (databasePromise) await (await databasePromise).db.close();
    },
    get state() {
      return { tables, effects, signedRequests, failures, objects };
    },
  };
}
