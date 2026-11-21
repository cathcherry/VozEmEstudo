import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateClassrooms, createSet } from './fixtures/classroom-db.fixture.js';
import {
  addIntegratedMaterial,
  createClassWithMembers,
  createContributionsDatabase,
  identities,
  NAMES,
  readContributionsMigration,
  sha,
} from './fixtures/classroom-contributions-db.fixture.js';

const migration = readContributionsMigration();
const ids = Object.fromEntries(Object.entries(identities).map(([k, v]) => [k, v.id]));
const check = (name) =>
  readFileSync(
    new URL(`../../database/checks/classroom-contributions-${name}.sql`, import.meta.url),
    'utf8',
  );
/** 'ok' or the error raised by the database function (e.g. CLASSROOM_NOT_FOUND). */
const outcome = (promise) =>
  promise.then(
    () => 'ok',
    (error) => error.message,
  );

function api(f) {
  const { call } = f;
  return {
    contribute: (who, classId, kind, itemId, note = null, id = randomUUID()) =>
      call('classroom_contribute_admin', [ids[who], classId, id, kind, itemId, note]),
    review: (who, classId, contributionId, decision, feedback = null, requestId = randomUUID()) =>
      call('classroom_review_contribution_admin', [
        ids[who],
        classId,
        contributionId,
        decision,
        requestId,
        feedback,
      ]),
    end: (who, classId, contributionId) =>
      call('classroom_end_contribution_admin', [ids[who], classId, contributionId]),
    list: (who, classId) => call('classroom_list_contributions_admin', [ids[who], classId]),
    materials: (who, classId) =>
      call('classroom_list_integrated_materials_admin', [ids[who], classId]),
    detail: (who, classId, contributionId) =>
      call('classroom_get_contribution_admin', [ids[who], classId, contributionId]),
    material: (who, classId, contributionId) =>
      call('classroom_get_integrated_material_admin', [ids[who], classId, contributionId]),
    sharedSets: (who, classId) =>
      call('classroom_list_shared_flashcard_sets_admin', [ids[who], classId]),
    sharedSet: (who, classId, sharedId) =>
      call('classroom_get_shared_flashcard_set_admin', [ids[who], classId, sharedId]),
  };
}

test('contributions migration is guarded, additive, transactional and server-only', () => {
  assert.match(migration, /CLASSROOM_CONTRIBUTIONS_ABORT: faltam pré-requisitos/);
  assert.match(migration, /CLASSROOM_CONTRIBUTIONS_ABORT: estruturas de contribuições ja existem/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.doesNotMatch(
    migration,
    /\b(drop table|drop column|drop function|drop constraint|drop policy|drop trigger|truncate|delete from|create or replace)\b/i,
  );
  // Existing tables are never altered: only the new table is (RLS). Triggers are new objects.
  for (const [, table] of migration.matchAll(/alter table public\.([a-z_]+)/g))
    assert.equal(table, 'classroom_contributions', `alters an existing table: ${table}`);
  assert.match(migration, /alter table public\.classroom_contributions enable row level security/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /grant [^;]* to (anon|authenticated)/i);
  // Privacy boundary: no personal learning records are read.
  assert.doesNotMatch(
    migration,
    /study_flashcard_reviews|study_progress|study_sessions|study_time_credits|study_annotations|study_notebooks|quiz_session|transcription_segments|material_shares/,
  );
});

test('guard: refuses without multi-lesson or twice; read-only checks report the state', async () => {
  const f = await createAcademicDatabase();
  try {
    await migrateClassrooms(f);
    await assert.rejects(
      f.db.exec(migration),
      /CLASSROOM_CONTRIBUTIONS_ABORT: faltam pré-requisitos: .*multi_lesson_materials/,
    );
    await f.db.exec('rollback');
    assert.equal(
      (await f.db.query("select to_regclass('public.classroom_contributions') t")).rows[0].t,
      null,
    );
  } finally {
    await f.db.close();
  }
  const g = await createContributionsDatabase({ apply: false });
  try {
    const pre = (await g.db.query(check('preflight'))).rows[0];
    assert.equal(pre.prerequisites, true);
    assert.equal(pre.already_applied, false);
    const sharedBefore = (await g.db.query('select * from public.classroom_shared_items')).rows;
    await g.db.exec(migration);
    assert.deepEqual(
      (await g.db.query('select * from public.classroom_shared_items')).rows,
      sharedBefore,
    );
    const post = (await g.db.query(check('postflight'))).rows[0];
    for (const key of [
      'applied',
      'rls_enabled',
      'no_browser_access',
      'functions_server_only',
      'membership_trigger',
      'shared_item_trigger',
    ])
      assert.equal(post[key], true, key);
    assert.equal(Number(post.shared_items_after), Number(pre.shared_items_before));
    assert.equal(Number(post.integrated_materials_after), Number(pre.integrated_materials_before));
    assert.equal((await g.db.query(check('preflight'))).rows[0].already_applied, true);
    await assert.rejects(g.db.exec(migration), /CLASSROOM_CONTRIBUTIONS_ABORT: estruturas/);
    await g.db.exec('rollback');
  } finally {
    await g.db.close();
  }
});

test('integrated materials: shared read only, content only, revocable; private elsewhere', async () => {
  const f = await createContributionsDatabase();
  const c = api(f);
  try {
    const { classId } = await createClassWithMembers(f);
    const mineA = await addIntegratedMaterial(f.db, identities.a, { title: 'Ondas — revisão' });
    const mineB = await addIntegratedMaterial(f.db, identities.b, { title: 'Resumo do Bruno' });
    const queued = await addIntegratedMaterial(f.db, identities.b, { status: 'queued' });

    // Only one's own READY record, only in a class one belongs to.
    assert.equal(
      await outcome(c.contribute('b', classId, 'integrated_material', mineA.id)),
      'MULTI_LESSON_NOT_FOUND',
    );
    assert.equal(
      await outcome(c.contribute('b', classId, 'integrated_material', queued.id)),
      'CLASSROOM_ITEM_NOT_READY',
    );
    assert.equal(
      await outcome(c.contribute('e', classId, 'integrated_material', mineA.id)),
      'CLASSROOM_NOT_FOUND',
    );
    assert.equal(
      await outcome(c.contribute('a', classId, 'not_a_kind', mineA.id)),
      'CLASSROOM_INVALID_INPUT',
    );

    // The teacher shares directly; it is visible to every member at once.
    const shareId = randomUUID();
    const shared = await c.contribute('a', classId, 'integrated_material', mineA.id, null, shareId);
    assert.equal(shared.status, 'approved');
    assert.equal(shared.replayed, false);
    const replay = await c.contribute('a', classId, 'integrated_material', mineA.id, null, shareId);
    assert.equal(replay.replayed, true);
    assert.equal(
      await outcome(c.contribute('a', classId, 'integrated_material', mineA.id)),
      'CLASSROOM_ALREADY_SHARED',
    );
    for (const viewer of ['b', 'c', 'd']) {
      const list = await c.materials(viewer, classId);
      assert.deepEqual(
        list.map((m) => [m.title, m.author.displayName]),
        [['Ondas — revisão', NAMES.a]],
      );
      const read = await c.material(viewer, classId, shared.id);
      assert.equal(read.content.summary.sections[0].heading, 'Energia');
      assert.equal(read.content.questions[0].correctIndex, 0);
      assert.equal(read.content.flashcards[0].front, 'Onda');
      assert.deepEqual(read.content.questions[0].citations, [
        { lessonTitle: 'Ondas 1', position: 0, quote: 'A onda transporta energia.' },
      ]);
      assert.deepEqual(read.sources, [{ title: 'Ondas 1', revision: 3 }]);
      const text = JSON.stringify(read);
      for (const secret of [
        mineA.id,
        mineA.sourceId,
        mineA.revisionId,
        'PRIVATE-REPORT',
        'PRIVATE-FOCUS',
        'private-model',
        'promptVersions',
        'startMs',
        'materialId',
      ])
        assert(!text.includes(secret), `${viewer} must not read ${secret}`);
      // Only the owner learns the private record id from the contribution rows.
      assert.equal((await c.list(viewer, classId)).filter((x) => x.itemId === mineA.id).length, 0);
    }
    assert.equal((await c.list('a', classId)).find((x) => x.id === shared.id).itemId, mineA.id);
    // Non-members see nothing (no existence oracle).
    assert.equal(await outcome(c.materials('e', classId)), 'CLASSROOM_NOT_FOUND');
    assert.equal(await outcome(c.material('e', classId, shared.id)), 'CLASSROOM_NOT_FOUND');
    // The private record stays private everywhere else.
    await assert.rejects(
      f.call('multi_lesson_get_admin', [ids.b, mineA.id]),
      /MULTI_LESSON_NOT_FOUND/,
    );
    assert.equal(
      (await f.call('multi_lesson_get_admin', [ids.a, mineA.id])).settings.focus,
      'PRIVATE-FOCUS',
    );

    // Students can't revoke someone else's item; revocation removes access immediately.
    assert.equal(await outcome(c.end('b', classId, shared.id)), 'CLASSROOM_NOT_FOUND');
    const ended = await c.end('a', classId, shared.id);
    assert.equal(ended.status, 'revoked');
    assert.deepEqual(await c.materials('b', classId), []);
    assert.equal(await outcome(c.material('b', classId, shared.id)), 'CLASSROOM_NOT_FOUND');
    assert.equal(
      (await c.end('a', classId, shared.id)).status,
      'revoked',
      'ending twice is a no-op',
    );

    // A student's share waits for review: invisible to the class until approved.
    const proposed = await c.contribute(
      'b',
      classId,
      'integrated_material',
      mineB.id,
      'Fiz para a prova',
    );
    assert.equal(proposed.status, 'pending');
    assert.deepEqual(proposed.actions, ['withdraw']);
    assert.deepEqual(await c.materials('c', classId), []);
    assert.equal(await outcome(c.material('c', classId, proposed.id)), 'CLASSROOM_NOT_FOUND');
    for (const who of ['a', 'b']) {
      const preview = await c.detail(who, classId, proposed.id);
      assert.equal(preview.status, 'pending', `${who} previews`);
      assert.equal(preview.preview.content.flashcards[0].front, 'Onda');
      assert.doesNotMatch(JSON.stringify(preview.preview), /PRIVATE|materialId|revisionId/);
    }
    assert.equal(await outcome(c.detail('c', classId, proposed.id)), 'CLASSROOM_NOT_FOUND');
    assert.equal(await outcome(c.detail('e', classId, proposed.id)), 'CLASSROOM_NOT_FOUND');
    assert.deepEqual((await c.list('d', classId)).find((x) => x.id === proposed.id).actions, [
      'approve',
      'reject',
    ]);
    const approved = await c.review('d', classId, proposed.id, 'approved', 'Ótimo material!');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.feedback, 'Ótimo material!');
    assert.equal(approved.reviewedRole, 'assistant');
    assert.equal((await c.materials('c', classId)).length, 1);

    // Removal hides it at once, and a later re-join does not bring it back.
    await f.call('classroom_remove_member_admin', [ids.a, classId, ids.b]);
    assert.deepEqual(await c.materials('c', classId), []);
    assert.equal(await outcome(c.materials('b', classId)), 'CLASSROOM_NOT_FOUND');
    const code = 'REJOIN2222AA';
    await f.call('classroom_create_invite_admin', [
      ids.a,
      classId,
      randomUUID(),
      randomUUID(),
      sha(code),
      7,
      5,
    ]);
    await f.call('classroom_join_admin', [ids.b, sha(code), NAMES.b]);
    assert.deepEqual(await c.materials('c', classId), []);
    const mineNow = (await c.list('b', classId)).find((x) => x.id === proposed.id);
    assert.equal(mineNow.status, 'revoked');

    // Leaving withdraws a pending contribution.
    const pendingC = await c.contribute(
      'c',
      classId,
      'integrated_material',
      (await addIntegratedMaterial(f.db, identities.c)).id,
    );
    await f.call('classroom_leave_admin', [ids.c, classId]);
    assert.equal(
      (await c.list('a', classId)).find((x) => x.id === pendingC.id).status,
      'withdrawn',
    );

    // Deleting the private record removes the share with it.
    const again = await c.contribute('b', classId, 'integrated_material', mineB.id);
    assert.equal(again.status, 'pending');
    await f.call('multi_lesson_delete_admin', [ids.b, mineB.id]);
    assert.equal(
      (await c.list('a', classId)).some((x) => x.id === again.id),
      false,
    );
  } finally {
    await f.db.close();
  }
});

test('student flashcard contributions: review queue, feedback, sync with shared sets', async () => {
  const f = await createContributionsDatabase();
  const c = api(f);
  try {
    const { classId } = await createClassWithMembers(f);
    const setB = await createSet(f, identities.b, 'Ondas — Bruno', ['Onda?', 'Frequência?']);
    const setC = await createSet(f, identities.c, 'Carla — Óptica', ['Luz?']);
    const setD = await createSet(f, identities.d, 'Monitoria', ['Período?']);

    assert.equal(
      await outcome(c.contribute('c', classId, 'flashcard_set', setB)),
      'FLASHCARD_NOT_FOUND',
    );
    const pending = await c.contribute('b', classId, 'flashcard_set', setB, 'Revisei com cuidado');
    assert.equal(pending.status, 'pending');
    assert.equal(pending.cardCount, 2);
    assert.equal(pending.sharedId, null);
    const preview = await c.detail('d', classId, pending.id);
    assert.deepEqual(
      preview.preview.cards.map((x) => Object.keys(x).sort()),
      [
        ['back', 'front'],
        ['back', 'front'],
      ],
    );
    assert.deepEqual(await c.sharedSets('c', classId), [], 'pending sets are not shared yet');
    assert.equal(
      await outcome(c.contribute('b', classId, 'flashcard_set', setB)),
      'CLASSROOM_ALREADY_SHARED',
    );

    // Students see only their own contributions; managers see the queue.
    const rejected = await c.contribute('c', classId, 'flashcard_set', setC);
    assert.deepEqual(
      (await c.list('b', classId)).map((x) => x.id),
      [pending.id],
    );
    assert.deepEqual(
      (await c.list('c', classId)).map((x) => x.id),
      [rejected.id],
    );
    assert.deepEqual(
      new Set((await c.list('a', classId)).map((x) => x.id)),
      new Set([pending.id, rejected.id]),
    );
    assert.equal(await outcome(c.list('e', classId)), 'CLASSROOM_NOT_FOUND');

    // Only managers review; students cannot.
    assert.equal(
      await outcome(c.review('c', classId, pending.id, 'approved')),
      'CLASSROOM_FORBIDDEN',
    );
    assert.equal(
      await outcome(c.review('a', classId, pending.id, 'maybe')),
      'CLASSROOM_INVALID_INPUT',
    );
    assert.equal(
      await outcome(c.end('a', classId, pending.id)),
      'CLASSROOM_FORBIDDEN',
      'the reviewer rejects instead of withdrawing',
    );
    const requestId = randomUUID();
    const approved = await c.review(
      'a',
      classId,
      pending.id,
      'approved',
      'Bom trabalho',
      requestId,
    );
    assert.equal(approved.status, 'approved');
    assert.equal(
      (await c.review('a', classId, pending.id, 'approved', 'Bom trabalho', requestId)).replayed,
      true,
    );
    assert.equal(
      await outcome(c.review('a', classId, pending.id, 'rejected')),
      'CLASSROOM_ILLEGAL_TRANSITION',
    );
    // The approved set appears in the existing shared-set flows (content only).
    const sets = await c.sharedSets('c', classId);
    assert.deepEqual(
      sets.map((s) => [s.name, s.author.displayName]),
      [['Ondas — Bruno', NAMES.b]],
    );
    assert.equal(sets[0].sharedId, approved.sharedId);
    assert.equal((await c.sharedSet('c', classId, approved.sharedId)).cards.length, 2);

    // Rejection with a reason the student reads.
    const no = await c.review('d', classId, rejected.id, 'rejected', 'Faltam fontes nos cartões.');
    assert.equal(no.status, 'rejected');
    const seen = (await c.list('c', classId))[0];
    assert.equal(seen.feedback, 'Faltam fontes nos cartões.');
    assert.equal(seen.reviewedRole, 'assistant');
    assert.deepEqual(seen.actions, []);
    // A rejected item may be offered again (a new contribution).
    const retry = await c.contribute('c', classId, 'flashcard_set', setC);
    assert.equal(retry.status, 'pending');
    assert.deepEqual((await c.end('c', classId, retry.id)).status, 'withdrawn');

    // Staff contributions skip review and are shared at once.
    const direct = await c.contribute('d', classId, 'flashcard_set', setD);
    assert.equal(direct.status, 'approved');
    assert.equal((await c.sharedSets('b', classId)).length, 2);

    // Revoking through the existing function revokes the contribution too.
    await f.call('classroom_revoke_shared_item_admin', [ids.d, classId, direct.sharedId]);
    assert.equal((await c.list('a', classId)).find((x) => x.id === direct.id).status, 'revoked');
    // Ending the contribution revokes the shared row.
    await c.end('b', classId, approved.id);
    assert.deepEqual(await c.sharedSets('c', classId), []);
    assert.equal(
      await outcome(c.sharedSet('c', classId, approved.sharedId)),
      'CLASSROOM_NOT_FOUND',
    );

    // An item that disappeared before review cannot be approved.
    const late = await c.contribute('b', classId, 'flashcard_set', setB);
    await f.call('study_update_flashcard_set_admin', [ids.b, setB, null, 'archived']);
    assert.equal(
      await outcome(c.review('a', classId, late.id, 'approved')),
      'CLASSROOM_ITEM_UNAVAILABLE',
    );

    // The graph is enforced on every write, even from the server role.
    await assert.rejects(
      f.db.query("update public.classroom_contributions set status = 'approved' where id = $1", [
        no.id,
      ]),
      /CLASSROOM_ILLEGAL_TRANSITION/,
    );
    // Archived class: no new contributions, but people can still stop sharing.
    await f.call('classroom_update_admin', [ids.a, classId, null, null, 'archived']);
    assert.equal(
      await outcome(c.contribute('b', classId, 'flashcard_set', setB)),
      'CLASSROOM_ARCHIVED',
    );
    assert.equal((await c.end('b', classId, late.id)).status, 'withdrawn');
  } finally {
    await f.db.close();
  }
});

test('browsers have no access to the new table or functions', async () => {
  const f = await createContributionsDatabase();
  try {
    const rights = (
      await f.db.query(`select c.relrowsecurity rls,
        has_table_privilege('anon', c.oid, 'select') anon_read,
        has_table_privilege('authenticated', c.oid, 'select') browser_read
        from pg_class c where c.oid = 'public.classroom_contributions'::regclass`)
    ).rows[0];
    assert.deepEqual(rights, { rls: true, anon_read: false, browser_read: false });
    const exposed = (
      await f.db
        .query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'classroom\\_contribut%' or p.proname like 'classroom\\_%integrated%'
          or p.proname = 'classroom_review_contribution_admin' or p.proname = 'classroom_end_contribution_admin')
          and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`)
    ).rows;
    assert.deepEqual(exposed, []);
  } finally {
    await f.db.close();
  }
});
