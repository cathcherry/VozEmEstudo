import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createAcademicDatabase,
  revisionIds,
} from '../../backend/tests/fixtures/academic-db.fixture.js';
import { identities, resourceIds } from '../../backend/tests/fixtures/ownership.fixture.js';

test('E02 policy dependency and grants are audited without changing the migration', async (t) => {
  const fixture = await createAcademicDatabase();
  const { db } = fixture;
  try {
    await t.test(
      'prepared access catalog SQL is read-only and does not return fixture content',
      async () => {
        const catalog = await db.exec(
          await readFile(
            new URL('../../database/checks/gates-access.sql', import.meta.url),
            'utf8',
          ),
        );
        assert(catalog.some((result) => result.rows?.[0]?.rls_enabled === true));
        assert(catalog.some((result) => result.rows?.[0]?.migration_ledger_exists === false));
        assert(!JSON.stringify(catalog).includes('Energia é conservada.'));
      },
    );
    await fixture.permit(identities.a, resourceIds.materialA);
    await fixture.confirm(identities.a, resourceIds.materialA, revisionIds.a);
    await fixture.call('save_content_warnings_admin', [
      identities.a.id,
      resourceIds.materialA,
      revisionIds.a,
      randomUUID(),
      JSON.stringify(
        ['educational', 'topic_alignment', 'factual_suspicion'].map((type) => ({
          type,
          state: 'insufficient',
          explanation: 'Contexto fictício.',
          guidance: 'Confira a fonte.',
          segmentRefs: [],
          model: 'fixture',
          promptVersion: 'fixture',
        })),
      ),
    ]);
    await t.test(
      'missing legacy materials SELECT reproduces 42501 for every new RLS table',
      async () => {
        for (const table of [
          'material_permissions',
          'transcription_confirmations',
          'content_warnings',
        ]) {
          await assert.rejects(
            db.transaction(async (tx) => {
              // Reproduce the previously audited catalog: authenticated has no materials SELECT.
              await tx.exec('revoke select on public.materials from authenticated');
              await tx.exec('set local role authenticated');
              await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
                identities.a.id,
              ]);
              await tx.query(`select id from public.${table}`);
            }),
            (error) => error.code === '42501' && /materials/.test(error.message),
          );
        }
      },
    );
    await t.test(
      'proposed parent grant runs only in the disposable fixture, never in staging',
      async () => {
        await db.exec('revoke select on public.materials from authenticated');
        await db.exec(
          await readFile(
            new URL('../../database/proposals/e02-policy-parent-select.sql', import.meta.url),
            'utf8',
          ),
        );
        const grants = (
          await db.query(
            "select has_table_privilege('authenticated','public.materials','select') as client, has_table_privilege('anon','public.materials','select') as anonymous",
          )
        ).rows[0];
        assert.equal(grants.client, true);
        assert.equal(grants.anonymous, false);
      },
    );
    await t.test(
      'with the proposed grant in the fixture, A sees own rows and B sees none',
      async () => {
        for (const [user, expected] of [
          [identities.a, [1, 1, 3]],
          [identities.b, [0, 0, 0]],
        ]) {
          const counts = await db.transaction(async (tx) => {
            await tx.exec('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user.id]);
            const values = [];
            for (const table of [
              'material_permissions',
              'transcription_confirmations',
              'content_warnings',
            ])
              values.push(
                Number(
                  (await tx.query(`select count(*) as count from public.${table}`)).rows[0].count,
                ),
              );
            return values;
          });
          assert.deepEqual(counts, expected);
        }
      },
    );
    await t.test(
      'new and legacy server-only RPCs are denied to both public client roles',
      async () => {
        const result = await db.query(`select count(*) as exposed from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
        and (p.proname like '%_admin' or p.proname='claim_next_processing_job')
        and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`);
        assert.equal(Number(result.rows[0].exposed), 0);
      },
    );
  } finally {
    await db.close();
  }
});
