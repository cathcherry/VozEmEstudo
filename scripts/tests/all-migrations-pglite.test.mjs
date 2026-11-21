import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAcademicDatabase } from '../../backend/tests/fixtures/academic-db.fixture.js';
import { identities, resourceIds } from '../../backend/tests/fixtures/ownership.fixture.js';
import { featureSchema, optionalSchema } from '../../backend/src/diagnostics/readiness.js';

test('all candidate migrations coexist, preserve legacy rows and support E10→E12 across owners', async () => {
  const { db } = await createAcademicDatabase();
  try {
    const legacyTables = ['materials', 'audio_files', 'transcriptions', 'transcription_segments', 'transcription_versions', 'summary_versions', 'question_batches', 'questions', 'processing_jobs'];
    const snapshot = async () => Object.fromEntries(await Promise.all(legacyTables.map(async (table) => {
      // E03 adds nullable links; compare only the pre-existing material columns.
      const columns = table === 'materials' ? 'id,user_id,title,subject,status,created_at,updated_at' : '*';
      return [table, (await db.query(`select ${columns} from public.${table} order by id`)).rows];
    })));
    const before = await snapshot();
    await db.exec(await readFile(new URL('../../database/checks/first-test-inventory.sql', import.meta.url), 'utf8'));
    const migrations = [...new Set([...Object.values(featureSchema), ...Object.values(optionalSchema)].map((entry) => entry.migration))].sort();
    for (const file of migrations) {
      await db.exec(await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), 'utf8'));
    }
    // Additive migrations may add columns (with defaults); every pre-existing column and value of
    // every legacy row must be unchanged.
    const after = await snapshot();
    const previousColumns = (table, rows) =>
      rows.map((row, index) =>
        Object.fromEntries(Object.keys(before[table][index] || row).map((key) => [key, row[key]])),
      );
    for (const table of legacyTables) assert.equal(after[table].length, before[table].length, table);
    assert.deepEqual(
      Object.fromEntries(legacyTables.map((table) => [table, previousColumns(table, after[table])])),
      before,
      'legacy content and media references must survive every migration',
    );
    // The manifest used by startup must match the actual combined SQL schema.
    for (const entry of [...Object.values(featureSchema), ...Object.values(optionalSchema)]) {
      for (const [table, columns] of Object.entries(entry.tables)) await db.query(`select ${columns} from public.${table} limit 0`);
    }
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const a = identities.a.id, b = identities.b.id;
    const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
    await db.query("insert into public.quiz_sessions(id,user_id,material_id,batch_id,feedback_mode) values($1,$2,$3,$4,'deferred')", [sessionId, a, resourceIds.materialA, resourceIds.batchA]);
    await assert.rejects(call('quiz_finish_session_admin', [a, sessionId]), /QUIZ_INCOMPLETE/);
    await assert.rejects(call('quiz_submit_answer_admin', [b, sessionId, resourceIds.questionA, 0]), /QUIZ_SESSION_NOT_FOUND/);
    const answer = await call('quiz_submit_answer_admin', [a, sessionId, resourceIds.questionA, 0]);
    assert.equal(answer.recorded, true);
    assert(!Object.hasOwn(answer, 'correctIndex'), 'deferred feedback must not leak the answer');
    assert.equal((await call('quiz_finish_session_admin', [a, sessionId])).status, 'completed');
    await assert.rejects(call('quiz_create_review_session_admin', [b, sessionId, 'immediate']), /QUIZ_SESSION_NOT_FOUND/);
    const reviewId = await call('quiz_create_review_session_admin', [a, sessionId, 'immediate']);
    const reviewed = await call('quiz_submit_answer_admin', [a, reviewId, resourceIds.questionA, 1]);
    assert.equal(reviewed.correct, true);
    assert.equal((await call('quiz_finish_session_admin', [a, reviewId])).status, 'completed');
    assert.equal((await db.query('select count(*)::int n from public.questions')).rows[0].n, before.questions.length);
    const tables = [...new Set(Object.values(featureSchema).flatMap((entry) => Object.keys(entry.tables)))].filter((name) => name !== 'materials');
    for (const table of tables) {
      const rights = (await db.query(`select c.relrowsecurity rls,
        has_table_privilege('anon',c.oid,'SELECT') anon_read,
        has_table_privilege('authenticated',c.oid,'SELECT') browser_read,
        has_table_privilege('service_role',c.oid,'SELECT') server_read
        from pg_class c where c.oid=$1::regclass`, ['public.' + table])).rows[0];
      assert.deepEqual(rights, { rls: true, anon_read: false, browser_read: false, server_read: true }, table);
    }
    // Inventory itself must be executable before and after rollout and return no user data.
    await db.exec(await readFile(new URL('../../database/checks/first-test-inventory.sql', import.meta.url), 'utf8'));
  } finally {
    await db.close();
  }
});
