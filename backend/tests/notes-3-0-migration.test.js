import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAcademicDatabase, revisionIds } from './fixtures/academic-db.fixture.js';
import { migrateLearningTools } from './fixtures/learning-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import {
  notesMigrationSql,
  addMultiSegmentRevision,
  multiRevisionId,
  multiSegments,
} from './fixtures/notes-db.fixture.js';

const migration = notesMigrationSql();
const a = identities.a.id;
const b = identities.b.id;
const A = resourceIds.materialA;
const B = resourceIds.materialB;
const doc = (blocks) => ({ type: 'doc', schemaVersion: 1, blocks });

test('Notes 3.0 migration is guarded, transactional, additive and server-only', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /NOTES_3_0_ABORT: aplicar e verificar E02 e E14/);
  assert.match(migration, /NOTES_3_0_ABORT: estruturas ja existem/);
  assert.doesNotMatch(
    migration,
    /\b(drop\s+(table|column|constraint|function|trigger|policy|index)|truncate|create or replace|delete from)\b/i,
  );
  // The E14 functions are not redefined.
  assert.doesNotMatch(migration, /create function public\.study_save_annotation_admin\(/);
  assert.doesNotMatch(migration, /create function public\.study_list_annotations_admin\(/);
  assert.match(migration, /alter table public\.study_notebooks enable row level security/);
  assert.match(
    migration,
    /revoke all on table public\.study_notebooks from public, anon, authenticated/,
  );
  for (const fn of [
    'study_save_annotation_range_admin',
    'study_get_notebook_admin',
    'study_save_notebook_admin',
  ])
    assert.match(migration, new RegExp(`create function public\\.${fn}\\([^)]*\\)\\s*returns jsonb language (plpgsql|sql)[^$]*security invoker set search_path = ''`));
});

test('preflight guard: refuses without E14 and refuses to run twice', async () => {
  const f = await createAcademicDatabase();
  try {
    await assert.rejects(f.db.exec(migration), /NOTES_3_0_ABORT: aplicar e verificar E02 e E14/);
    await f.db.exec('rollback');
    assert.equal((await f.db.query("select to_regclass('public.study_notebooks') t")).rows[0].t, null);
    await migrateLearningTools(f.db);
    await f.db.exec(migration);
    await assert.rejects(f.db.exec(migration), /NOTES_3_0_ABORT: estruturas ja existem/);
    await f.db.exec('rollback');
  } finally {
    await f.db.close();
  }
});

test('existing annotations survive, are backfilled to single-segment ranges and the E14 API keeps working', async () => {
  const f = await createAcademicDatabase();
  try {
    const { db, call } = f;
    await migrateLearningTools(db);
    // Rows created BEFORE the migration, through the E14 function.
    const highlight = randomUUID(),
      note = randomUUID(),
      removed = randomUUID();
    await call('study_save_annotation_admin', [a, highlight, A, 0, randomUUID(), JSON.stringify({
      sourceRevisionId: revisionIds.a, segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia', noteText: 'Antiga', color: 'green',
    })]);
    await call('study_save_annotation_admin', [a, note, A, 0, randomUUID(), JSON.stringify({ sourceRevisionId: revisionIds.a, noteText: 'Nota solta' })]);
    await call('study_save_annotation_admin', [a, removed, A, 0, randomUUID(), JSON.stringify({ sourceRevisionId: revisionIds.a, segmentPosition: 0, startOffset: 8, endOffset: 9, quote: 'é' })]);
    await call('study_save_annotation_admin', [a, removed, A, 1, randomUUID(), JSON.stringify({ deleted: true })]);
    const before = (await db.query('select * from public.study_annotations order by id')).rows;
    assert.equal(before.length, 3);

    await db.exec(migration);

    const after = (await db.query('select * from public.study_annotations order by id')).rows;
    assert.equal(after.length, before.length);
    for (const [index, row] of before.entries()) {
      for (const [key, value] of Object.entries(row))
        assert.deepEqual(after[index][key], value, `${key} of a pre-existing row is unchanged`);
      assert.equal(after[index].anchor_version, 1);
      assert.equal(after[index].visibility, 'private');
      assert.equal(after[index].end_segment_position, row.segment_position, 'explicit backfill');
    }
    const byId = Object.fromEntries(after.map((row) => [row.id, row]));
    assert.equal(byId[highlight].end_segment_position, 0);
    assert.equal(byId[note].end_segment_position, null, 'a note without anchor stays without anchor');
    assert(byId[removed].deleted_at, 'soft-deleted rows stay soft-deleted');

    // E14 API after the migration: edit an old row, create a new one (trigger keeps the invariant).
    const edited = await call('study_save_annotation_admin', [a, highlight, A, 1, randomUUID(), JSON.stringify({ noteText: 'Editada' })]);
    assert.equal(edited.version, 2);
    assert.equal(edited.end_segment_position, 0);
    const fresh = await call('study_save_annotation_admin', [a, randomUUID(), A, 0, randomUUID(), JSON.stringify({
      sourceRevisionId: revisionIds.a, segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia',
    })]);
    assert.equal(fresh.end_segment_position, 0);
    assert.equal(fresh.anchor_version, 1);
    const listed = await call('study_list_annotations_admin', [a, A, '', 0]);
    assert.equal(listed.total, 3, 'deleted row still hidden');
    assert(listed.notes.every((row) => 'end_segment_position' in row));
    // A v2 edit of a pre-existing row is the same note-only patch.
    const v2edit = await call('study_save_annotation_range_admin', [a, highlight, A, 2, randomUUID(), JSON.stringify({ color: 'blue' })]);
    assert.equal(v2edit.color, 'blue');
    assert.equal(v2edit.quote, 'Energia');
  } finally {
    await f.db.close();
  }
});

async function migrated() {
  const f = await createAcademicDatabase();
  await migrateLearningTools(f.db);
  await f.db.exec(migration);
  await f.permit(identities.a, A);
  await f.permit(identities.b, B);
  await addMultiSegmentRevision(f.db, a, A);
  await f.confirm(identities.b, B, revisionIds.b);
  return f;
}
const anchor = (extra) => ({ sourceRevisionId: multiRevisionId, color: 'yellow', noteText: '', ...extra });

test('multi-segment anchors are validated against the confirmed snapshot', async () => {
  const f = await migrated();
  try {
    const save = (body, user = a, material = A) =>
      f.call('study_save_annotation_range_admin', [user, randomUUID(), material, 0, randomUUID(), JSON.stringify(body)]);
    const two = await save(anchor({
      segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13,
      quote: 'é conservada.\nUma afirmação', noteText: 'Comentário sobre dois trechos',
    }));
    assert.deepEqual([two.segment_position, two.start_offset, two.end_segment_position, two.end_offset], [0, 8, 1, 13]);
    assert.equal(two.anchor_version, 2);
    assert.equal(two.source_revision, 2);
    assert.equal(two.visibility, 'private');
    const three = await save(anchor({
      segmentPosition: 0, startOffset: 0, endSegmentPosition: 2, endOffset: 5,
      quote: `${multiSegments[0]}\n${multiSegments[1]}\nCalor`,
    }));
    assert.equal(three.end_segment_position, 2);
    const single = await save(anchor({ segmentPosition: 2, startOffset: 8, endOffset: 15, quote: 'energia' }));
    assert.equal(single.end_segment_position, 2, 'single-segment through v2');
    // Offsets are code points: "trânsito" has a combining-free â.
    await save(anchor({ segmentPosition: 2, startOffset: 19, endOffset: 27, quote: 'trânsito' }));

    for (const [label, body] of [
      ['space instead of the segment break', { segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada. Uma afirmação' }],
      ['quote of other words', { segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada.\nUma conclusão' }],
      ['end offset beyond the end segment', { segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 100, quote: 'é conservada.\nUma afirmação' }],
      ['end segment that does not exist', { segmentPosition: 1, startOffset: 0, endSegmentPosition: 3, endOffset: 2, quote: `${multiSegments[1]}\n${multiSegments[2]}\nxx` }],
      ['start at the very end of its segment', { segmentPosition: 0, startOffset: 21, endSegmentPosition: 1, endOffset: 3, quote: '\nUma' }],
      ['end before start', { segmentPosition: 1, startOffset: 0, endSegmentPosition: 0, endOffset: 3, quote: 'Uma' }],
      ['span longer than 50 segments', { segmentPosition: 0, startOffset: 0, endSegmentPosition: 60, endOffset: 1, quote: 'E' }],
      ['negative offset', { segmentPosition: 0, startOffset: -1, endSegmentPosition: 1, endOffset: 3, quote: 'x' }],
    ])
      await assert.rejects(save(anchor(body)), /LEARNING_ANCHOR_CONFLICT/, label);

    // A revision of another material, even owned by someone else, is not found.
    await assert.rejects(
      save(anchor({ sourceRevisionId: revisionIds.b, segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia' })),
      /LEARNING_NOT_FOUND/,
    );
    // Anchors need a revision the owner confirmed (revision 1 of A was never confirmed here).
    await assert.rejects(
      save(anchor({ sourceRevisionId: revisionIds.a, segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia' })),
      /LEARNING_REVISION_UNCONFIRMED/,
    );
    // Plain notes do not need an anchor.
    assert.equal((await save({ sourceRevisionId: revisionIds.a, noteText: 'Só texto' })).end_segment_position, null);
    // Anchors are immutable once saved.
    await assert.rejects(
      f.call('study_save_annotation_range_admin', [a, two.id, A, 1, randomUUID(), JSON.stringify({ endSegmentPosition: 2 })]),
      /LEARNING_ANCHOR_IMMUTABLE/,
    );
    // The table refuses inconsistent ranges even from the server role.
    await assert.rejects(
      f.db.query('update public.study_annotations set end_segment_position = segment_position - 1 where id=$1', [two.id]),
      /study_annotations_anchor_range_check/,
    );
  } finally {
    await f.db.close();
  }
});

test('accounts are isolated for annotations and notebooks, including RLS for browsers', async () => {
  const f = await migrated();
  try {
    const { call, db } = f;
    const highlight = await call('study_save_annotation_range_admin', [a, randomUUID(), A, 0, randomUUID(), JSON.stringify(anchor({
      segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada.\nUma afirmação',
    }))]);
    await call('study_save_notebook_admin', [a, A, 0, randomUUID(), JSON.stringify({ title: 'Caderno A', doc: doc([{ id: 'p1', type: 'paragraph', text: 'Privado' }]) })]);
    // B cannot read or write A's lesson notebook, nor A's annotation.
    await assert.rejects(call('study_get_notebook_admin', [b, A]), /LEARNING_NOT_FOUND/);
    await assert.rejects(call('study_save_notebook_admin', [b, A, 1, randomUUID(), JSON.stringify({ doc: doc([]) })]), /LEARNING_NOT_FOUND/);
    await assert.rejects(
      call('study_save_annotation_range_admin', [b, highlight.id, A, 1, randomUUID(), JSON.stringify({ noteText: 'invasão' })]),
      /LEARNING_NOT_FOUND/,
    );
    await assert.rejects(
      call('study_save_annotation_range_admin', [b, highlight.id, B, 1, randomUUID(), JSON.stringify({ noteText: 'invasão' })]),
      /LEARNING_NOT_FOUND/,
      'cannot reach a foreign annotation through an owned material',
    );
    // B's own notebook cannot reference A's annotation.
    await assert.rejects(
      call('study_save_notebook_admin', [b, B, 0, randomUUID(), JSON.stringify({ doc: doc([{ id: 'r', type: 'annotation_ref', annotationId: highlight.id, sourceRevisionId: multiRevisionId }]) })]),
      /LEARNING_REFERENCE_INVALID/,
    );
    const emptyB = await call('study_get_notebook_admin', [b, B]);
    assert.equal(emptyB.notebook, null);
    assert.deepEqual(emptyB.references, []);

    // Browsers (authenticated role) have no table or function privileges at all.
    const asBrowser = (user, sql, params = []) =>
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
        return (await tx.query(sql, params)).rows;
      });
    await assert.rejects(asBrowser(a, 'select * from public.study_notebooks'), /permission denied/);
    await assert.rejects(asBrowser(a, 'select * from public.study_annotations'), /permission denied/);
    await assert.rejects(asBrowser(a, 'select public.study_get_notebook_admin($1,$2)', [a, A]), /permission denied/);
    await assert.rejects(asBrowser(b, 'select public.study_save_notebook_admin($1,$2,0,$3,$4)', [b, B, randomUUID(), JSON.stringify({ doc: doc([]) })]), /permission denied/);
    await assert.rejects(asBrowser(b, 'select public.study_save_annotation_range_admin($1,$2,$3,0,$4,$5)', [b, randomUUID(), B, randomUUID(), '{}']), /permission denied/);
    // Even if a deployment granted SELECT, RLS shows each account only its own notebook.
    await db.exec('grant select on public.study_notebooks to authenticated');
    assert.equal((await asBrowser(b, 'select id from public.study_notebooks')).length, 0);
    assert.equal((await asBrowser(a, 'select id from public.study_notebooks')).length, 1);
    await db.exec('revoke select on public.study_notebooks from authenticated');
  } finally {
    await f.db.close();
  }
});

test('notebooks: optimistic concurrency, idempotent retry, concurrent writers, limits and schema', async () => {
  const f = await migrated();
  try {
    const { call, db } = f;
    const save = (version, requestId, body, user = a, material = A) =>
      call('study_save_notebook_admin', [user, material, version, requestId, JSON.stringify(body)]);
    const first = { title: 'Fotossíntese', doc: doc([{ id: 'h', type: 'heading', level: 2, text: 'Ideias' }]) };
    const request = randomUUID();
    await assert.rejects(save(1, randomUUID(), first), /LEARNING_VERSION_CONFLICT/, 'no notebook yet: version must be 0');
    const created = await save(0, request, first);
    assert.equal(created.notebook.version, 1);
    assert.equal(created.notebook.visibility, 'private');
    assert.equal(created.notebook.scope, 'material');
    assert.equal(created.replayed, false);
    assert(!('last_body_hash' in created.notebook), 'internal hash is not returned');
    // Retry of the same request (lost response): same state, no new version.
    const replay = await save(0, request, first);
    assert.equal(replay.replayed, true);
    assert.equal(replay.notebook.version, 1);
    await assert.rejects(save(0, request, { ...first, title: 'Outro' }), /LEARNING_REQUEST_CONFLICT/);
    // A stale version is a conflict, never a silent overwrite.
    await assert.rejects(save(0, randomUUID(), first), /LEARNING_VERSION_CONFLICT/);

    // Two devices write from the same version: exactly one wins, the other gets a conflict.
    const results = await Promise.allSettled([
      save(1, randomUUID(), { title: 'Aparelho 1', doc: doc([]) }),
      save(1, randomUUID(), { title: 'Aparelho 2', doc: doc([]) }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /LEARNING_VERSION_CONFLICT/);
    const current = await call('study_get_notebook_admin', [a, A]);
    assert.equal(current.notebook.version, 2);

    // Schema, HTML and size limits (defense in depth; the API validates first).
    for (const [label, body, code] of [
      ['unknown block type', { doc: doc([{ id: 'x', type: 'iframe', src: 'x' }]) }, /LEARNING_NOTEBOOK_INVALID/],
      ['script tag in a paragraph', { doc: doc([{ id: 'x', type: 'paragraph', text: 'oi <script>alert(1)</script>' }]) }, /LEARNING_NOTEBOOK_INVALID/],
      ['html nested in a list item', { doc: doc([{ id: 'x', type: 'checklist', items: [{ text: '<img src=x onerror=1>', checked: false }] }]) }, /LEARNING_NOTEBOOK_INVALID/],
      ['html in the title', { title: '<b>t</b>', doc: doc([]) }, /LEARNING_NOTEBOOK_INVALID/],
      ['not a document', { doc: { type: 'html', blocks: [] } }, /LEARNING_NOTEBOOK_INVALID/],
      ['too many blocks', { doc: doc(Array.from({ length: 301 }, (_, i) => ({ id: `b${i}`, type: 'paragraph', text: '' }))) }, /LEARNING_NOTEBOOK_TOO_LARGE/],
      ['too many bytes', { doc: doc([{ id: 'x', type: 'paragraph', text: 'a'.repeat(260000) }]) }, /LEARNING_NOTEBOOK_TOO_LARGE/],
    ])
      await assert.rejects(save(2, randomUUID(), body), code, label);
    // "a < b" is ordinary text, not markup.
    const math = await save(2, randomUUID(), { doc: doc([{ id: 'm', type: 'paragraph', text: 'Se a < b e b > c' }]) });
    assert.equal(math.notebook.version, 3);
    assert.equal((await db.query('select count(*)::int n from public.study_notebooks')).rows[0].n, 1, 'one notebook per lesson');
  } finally {
    await f.db.close();
  }
});

test('references keep the revision they were made in and stay readable after a new revision', async () => {
  const f = await migrated();
  try {
    const { call, db } = f;
    const highlight = await call('study_save_annotation_range_admin', [a, randomUUID(), A, 0, randomUUID(), JSON.stringify(anchor({
      segmentPosition: 1, startOffset: 4, endSegmentPosition: 2, endOffset: 5, quote: 'afirmação citada pode ser refutada.\nCalor', noteText: 'Ligação',
    }))]);
    const ref = { id: 'r1', type: 'annotation_ref', annotationId: highlight.id, sourceRevisionId: multiRevisionId, sourceRevision: 2 };
    await assert.rejects(
      call('study_save_notebook_admin', [a, A, 0, randomUUID(), JSON.stringify({ doc: doc([{ ...ref, sourceRevisionId: revisionIds.a }]) })]),
      /LEARNING_REFERENCE_INVALID/,
      'the reference must carry the revision of the annotation',
    );
    const saved = await call('study_save_notebook_admin', [a, A, 0, randomUUID(), JSON.stringify({ doc: doc([ref]) })]);
    assert.equal(saved.currentRevision, 2);
    assert.equal(saved.currentRevisionId, multiRevisionId);
    assert.equal(saved.references.length, 1);
    assert.equal(saved.references[0].source_revision, 2);
    assert.equal(saved.references[0].quote, 'afirmação citada pode ser refutada.\nCalor');
    assert.equal(saved.references[0].start_ms, 3000, 'start time from the immutable snapshot');
    // The lesson moves to revision 3: the reference still resolves, now to an older revision.
    const transcription = (await db.query('select id from public.transcriptions where material_id=$1', [A])).rows[0].id;
    await db.query("insert into public.transcription_versions(transcription_id,revision,origin,full_text,segments_snapshot) values($1,3,'ASR','Novo texto','[]')", [transcription]);
    await db.query('update public.transcriptions set current_revision=3 where id=$1', [transcription]);
    // The annotation is deleted afterwards: the quote stays readable in the notebook.
    await call('study_save_annotation_range_admin', [a, highlight.id, A, 1, randomUUID(), JSON.stringify({ deleted: true })]);
    const later = await call('study_get_notebook_admin', [a, A]);
    assert.equal(later.currentRevision, 3);
    assert.equal(later.references[0].source_revision, 2);
    assert.equal(later.references[0].deleted, true);
    assert.equal(later.references[0].quote, 'afirmação citada pode ser refutada.\nCalor');
    // Deleting the lesson removes its notebook (cascade), never another lesson's.
    await db.query('delete from public.materials where id=$1', [A]);
    assert.equal((await db.query('select count(*)::int n from public.study_notebooks')).rows[0].n, 0);
  } finally {
    await f.db.close();
  }
});
