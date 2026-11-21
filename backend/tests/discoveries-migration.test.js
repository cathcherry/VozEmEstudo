import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';
import {
  addConfirmedLesson,
  completeInvestigation,
  createDiscoveriesDatabase,
  discoveriesMigrationSql,
  discoveryApi,
  insertLesson,
  migratePrerequisites,
  multiRevisionId,
  multiSegments,
} from './fixtures/discoveries-db.fixture.js';

// Real SQL (PGlite) for Milestone 6: investigations, verified evidence, discoveries and the
// server-owned collection. No mock of the rules: every assertion goes through the functions.
const migration = discoveriesMigrationSql();
const a = identities.a.id;
const b = identities.b.id;
const A = resourceIds.materialA;
const B = resourceIds.materialB;
const EXPLANATION = 'A energia muda de forma, mas a quantidade total continua a mesma.';
const quote0 = { segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia' };
const read = (path) => readFileSync(new URL(`../../database/${path}`, import.meta.url), 'utf8');

async function migrated() {
  const f = await createDiscoveriesDatabase();
  return { ...f, api: discoveryApi(f.call) };
}
const unlocksOf = async (db, user) =>
  (await db.query('select collectible_id, source_id, investigation_id, discovery_id from public.collection_unlocks where user_id=$1 order by collectible_id', [user])).rows;
const ids = (rows) => rows.map((r) => r.collectible_id ?? r.id).sort();
/** Moves a discovery's recording time back, as if the student came back days later. */
const age = (db, id, days) =>
  db.query(`update public.discoveries set created_at = created_at - interval '${days} days' where id = $1`, [id]);

test('migration is guarded, transactional, additive and server-only', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /DISCOVERIES_ABORT: faltam pré-requisitos/);
  assert.match(migration, /DISCOVERIES_ABORT: estruturas de descobertas ja existem/);
  assert.doesNotMatch(migration, /\b(drop\s+(table|column|constraint|function|trigger|policy|index)|truncate\s+(table\s+)?public|create or replace|alter table public\.(materials|study_annotations|transcription))/i);
  const tables = ['investigations', 'investigation_evidence', 'investigation_links', 'discoveries', 'discovery_versions',
    'discovery_reflections', 'discovery_connections', 'discovery_revisits', 'collection_unlocks', 'desk_layouts'];
  for (const name of tables) assert.match(migration, new RegExp(`alter table public\\.${name} enable row level security`));
  assert.match(migration, /revoke all on table public\.investigations,[\s\S]*?from public, anon, authenticated;/);
  for (const [, name, header] of migration.matchAll(/create function public\.(\w+_admin)\(([^$]*?)as \$\$/g))
    assert.match(header, /security invoker set search_path = ''/, name);
  assert.match(migration, /revoke all on function public\.collection_award\(\), public\.discovery_record_revisit\(\),/);
});

test('guard refuses without prerequisites and refuses to run twice; existing rows are untouched', async () => {
  const f = await createAcademicDatabase();
  try {
    await assert.rejects(f.db.exec(migration), /DISCOVERIES_ABORT: faltam pré-requisitos: study_annotations/);
    await f.db.exec('rollback');
    assert.equal((await f.db.query("select to_regclass('public.investigations') t")).rows[0].t, null);
    await migratePrerequisites(f.db);
    const before = (await f.db.query('select * from public.materials order by id')).rows;
    await f.db.exec(migration);
    assert.deepEqual((await f.db.query('select * from public.materials order by id')).rows, before);
    await assert.rejects(f.db.exec(migration), /DISCOVERIES_ABORT: estruturas de descobertas ja existem/);
    await f.db.exec('rollback');
  } finally {
    await f.db.close();
  }
});

test('the source is the latest confirmed revision of the own lesson; unconfirmed or foreign lessons are refused', async () => {
  const f = await migrated();
  try {
    const source = await f.api.source(a, A);
    assert.equal(source.revisionId, multiRevisionId);
    assert.equal(source.revision, 2);
    assert.deepEqual(source.segments.map((s) => s.text), multiSegments);
    assert.deepEqual(source.lessonQuestions, ['Questão sintética?']);
    await assert.rejects(f.api.source(b, A), /DISCOVERY_NOT_FOUND/, 'another account sees nothing');
    const draft = await insertLesson(f.db, a, { title: 'Rascunho', subject: 'Física' });
    await assert.rejects(f.api.source(a, draft), /DISCOVERY_REVISION_UNCONFIRMED/);
    await assert.rejects(f.api.start(a, draft, 'Pergunta sem revisão?'), /DISCOVERY_REVISION_UNCONFIRMED/);
    await assert.rejects(f.api.start(a, A, 'Pergunta?', { sourceRevisionId: randomUUID() }), /DISCOVERY_SOURCE_CHANGED/);
    await assert.rejects(f.api.start(b, A, 'Pergunta alheia?'), /DISCOVERY_NOT_FOUND/);
  } finally {
    await f.db.close();
  }
});

test('investigation saves are idempotent by request id and versioned', async () => {
  const f = await migrated();
  try {
    const started = await f.api.start(a, A, 'Por que a energia é conservada?');
    const id = started.investigation.id;
    assert.equal(started.investigation.version, 1);
    assert.equal(started.investigation.status, 'open');
    assert.equal(started.canComplete, false);
    const request = randomUUID();
    const body = { explanation: 'curta', explored: true };
    const first = await f.api.save(a, id, 1, body, request);
    assert.equal(first.investigation.version, 2);
    assert.equal(first.investigation.explored, true);
    const replay = await f.api.save(a, id, 1, body, request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.investigation.version, 2, 'a retry does not write twice');
    await assert.rejects(f.api.save(a, id, 1, { explanation: 'outra' }, request), /DISCOVERY_REQUEST_CONFLICT/);
    await assert.rejects(f.api.save(a, id, 1, { explanation: 'velha' }), /DISCOVERY_VERSION_CONFLICT/);
    await assert.rejects(f.api.save(b, id, 2, { explanation: 'invasão' }), /DISCOVERY_NOT_FOUND/);
    await assert.rejects(f.api.save(a, id, 2, { question: 'x' }), /DISCOVERY_INVALID_INPUT/);
    assert.equal(first.investigation.explainedAt, null, 'a short text is not yet an explanation');
  } finally {
    await f.db.close();
  }
});

test('evidence is verified against the confirmed snapshot exactly like annotation anchors', async () => {
  const f = await migrated();
  try {
    const { investigation } = await f.api.start(a, A, 'Como a energia se conserva?');
    const id = investigation.id;
    const ok = await f.api.evidence(a, id, { ...quote0, note: 'O conceito central' });
    assert.equal(ok.evidence.length, 1);
    assert.equal(ok.evidence[0].sourceRevision, 2);
    assert.equal(ok.evidence[0].startMs, 0);
    const multi = await f.api.evidence(a, id, {
      segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada.\nUma afirmação',
    });
    assert.equal(multi.evidence.length, 2);
    // Code points: "trânsito" in segment 2.
    await f.api.evidence(a, id, { segmentPosition: 2, startOffset: 19, endOffset: 27, quote: 'trânsito' });
    for (const [body, label] of [
      [{ ...quote0, quote: 'energia' }, 'case differs'],
      [{ ...quote0, quote: 'Energia é' }, 'longer than the offsets'],
      [{ segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada. Uma afirmação' }, 'wrong separator'],
      [{ segmentPosition: 0, startOffset: 0, endOffset: 500, quote: multiSegments[0] }, 'past the segment'],
      [{ segmentPosition: 7, startOffset: 0, endOffset: 3, quote: 'Ene' }, 'missing segment'],
      [{ segmentPosition: 1, startOffset: 0, endSegmentPosition: 0, endOffset: 3, quote: 'Uma' }, 'backwards'],
      [{ segmentPosition: 'x', startOffset: 0, endOffset: 3, quote: 'Ene' }, 'not a number'],
    ])
      await assert.rejects(f.api.evidence(a, id, body), /DISCOVERY_ANCHOR_CONFLICT/, label);
    await assert.rejects(f.api.evidence(a, id, quote0), /DISCOVERY_EVIDENCE_DUPLICATE/);
    // Idempotent by id: the same body returns the saved state, another body is refused.
    const evidenceId = randomUUID();
    const body = { segmentPosition: 1, startOffset: 0, endOffset: 3, quote: 'Uma' };
    await f.api.evidence(a, id, body, evidenceId);
    const replay = await f.api.evidence(a, id, body, evidenceId);
    assert.equal(replay.replayed, true);
    assert.equal(replay.evidence.length, 4);
    await assert.rejects(f.api.evidence(a, id, { ...body, note: 'x' }, evidenceId), /DISCOVERY_REQUEST_CONFLICT/);
    await assert.rejects(f.api.evidence(b, id, quote0), /DISCOVERY_NOT_FOUND/);
    // Unconfirming the revision (only possible in the database) stops new evidence.
    await f.db.query('delete from public.transcription_confirmations where transcription_version_id = $1', [multiRevisionId]);
    await assert.rejects(f.api.evidence(a, id, { segmentPosition: 2, startOffset: 0, endOffset: 5, quote: 'Calor' }), /DISCOVERY_REVISION_UNCONFIRMED/);
    const rows = (await f.db.query('select count(*)::int n from public.investigation_evidence')).rows[0].n;
    assert.equal(rows, 4, 'nothing refused was written');
  } finally {
    await f.db.close();
  }
});

test('completion needs a question, verified evidence and an own explanation; it creates a versioned discovery', async () => {
  const f = await migrated();
  try {
    const { investigation } = await f.api.start(a, A, 'O que é energia?', { body: { reflection: 'Ainda tenho dúvidas sobre calor.' } });
    const id = investigation.id;
    await assert.rejects(f.api.complete(a, id), /DISCOVERY_EVIDENCE_REQUIRED/);
    const withEvidence = await f.api.evidence(a, id, quote0);
    await assert.rejects(f.api.complete(a, id), /DISCOVERY_EXPLANATION_REQUIRED/);
    await f.api.save(a, id, 1, { explanation: EXPLANATION });
    const done = await f.api.complete(a, id);
    assert.equal(done.replayed, false);
    assert.equal(done.discovery.id, id, 'the discovery shares the investigation id');
    assert.equal(done.discovery.title, 'O que é energia?');
    assert.equal(done.discovery.explanation, EXPLANATION);
    assert.equal(done.discovery.subject, 'Física');
    assert.equal(done.evidence[0].id, withEvidence.evidenceId);
    assert.deepEqual(done.reflections.map((r) => r.text), ['Ainda tenho dúvidas sobre calor.']);
    assert.deepEqual(ids(done.newUnlocks), ['stamp.first-investigation', 'stamp.first-reflection']);
    const again = await f.api.complete(a, id);
    assert.equal(again.replayed, true);
    assert.deepEqual(again.newUnlocks, []);
    await assert.rejects(f.api.save(a, id, 3, { explanation: 'depois' }), /DISCOVERY_INVESTIGATION_COMPLETED/);
    // The discovery evolves; every version is kept.
    const edited = await f.api.update(a, id, 1, { explanation: `${EXPLANATION} Ela se transforma em calor.` });
    assert.equal(edited.discovery.version, 2);
    assert.deepEqual(edited.history.map((h) => h.version), [2, 1]);
    await assert.rejects(f.api.update(a, id, 1, { title: 'Velha versão' }), /DISCOVERY_VERSION_CONFLICT/);
    await assert.rejects(f.api.update(a, id, 2, { explanation: 'curta' }), /DISCOVERY_INVALID_INPUT/);
    // A discovery keeps at least one piece of evidence.
    await assert.rejects(f.api.removeEvidence(a, id, withEvidence.evidenceId), /DISCOVERY_EVIDENCE_REQUIRED/);
    const list = await f.api.list(a);
    assert.equal(list.length, 1);
    assert.equal(list[0].evidenceCount, 1);
    assert.deepEqual(await f.api.list(b), []);
  } finally {
    await f.db.close();
  }
});

test('unlocks are idempotent, server-owned, keep their source event and are never lost', async () => {
  const f = await migrated();
  try {
    const { investigation } = await f.api.start(a, A, 'Energia some?');
    const id = investigation.id;
    const firstEvidence = await f.api.evidence(a, id, quote0);
    assert.deepEqual(ids(firstEvidence.newUnlocks), ['stamp.first-evidence']);
    const stamp = firstEvidence.newUnlocks[0];
    assert.equal(stamp.event, 'evidence_verified');
    assert.equal(stamp.sourceId, firstEvidence.evidenceId);
    assert.equal(stamp.investigationId, id);
    assert.equal(stamp.materialId, A);
    assert.equal(stamp.lessonTitle, 'Aula sintética a');
    assert(stamp.occurredAt);
    const second = await f.api.evidence(a, id, { segmentPosition: 2, startOffset: 0, endOffset: 5, quote: 'Calor' });
    assert.deepEqual(second.newUnlocks, [], 'the second quote unlocks nothing new');
    // Removing the first quote does not take the stamp back.
    await f.api.removeEvidence(a, id, firstEvidence.evidenceId);
    assert.deepEqual(ids(await unlocksOf(f.db, a)), ['stamp.first-evidence']);
    // Explanation stamp once, even if the explanation is rewritten.
    const explained = await f.api.save(a, id, 1, { explanation: EXPLANATION });
    assert.deepEqual(ids(explained.newUnlocks), ['stamp.own-explanation']);
    const rewritten = await f.api.save(a, id, 2, { explanation: `${EXPLANATION} Reescrita.` });
    assert.deepEqual(rewritten.newUnlocks, []);
    await f.api.complete(a, id);
    const rows = await unlocksOf(f.db, a);
    assert.deepEqual(ids(rows), ['stamp.first-evidence', 'stamp.first-investigation', 'stamp.own-explanation']);
    assert.equal(rows.find((r) => r.collectible_id === 'stamp.first-evidence').source_id, firstEvidence.evidenceId);
    // The collection points the early stamp to the discovery recorded later.
    const collection = await f.api.collection(a);
    assert.equal(collection.unlocks.find((u) => u.id === 'stamp.first-evidence').currentDiscoveryId, id);
    assert.equal(collection.counts.investigations, 1);
    // Unlocks cannot be rewritten or awarded by hand.
    await assert.rejects(f.db.query("update public.collection_unlocks set occurred_at = now() where user_id = $1", [a]), /COLLECTION_IMMUTABLE/);
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role service_role');
        await tx.query("update public.collection_unlocks set collectible_id = 'stamp.revisit'");
      }),
      /permission denied/,
    );
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await tx.exec('set local role service_role');
        await tx.query('select public.collection_award()');
      }),
      /permission denied|trigger functions can only be called as triggers/,
    );
    // Deleting the lesson removes its investigations and discoveries, never the memories.
    await f.db.query('delete from public.materials where id = $1', [A]);
    const kept = await f.api.collection(a);
    assert.deepEqual(ids(kept.unlocks), ['stamp.first-evidence', 'stamp.first-investigation', 'stamp.own-explanation']);
    assert(kept.unlocks.every((u) => u.lessonTitle === 'Aula sintética a' && u.currentDiscoveryId === null));
    assert.deepEqual(await f.api.list(a), []);
  } finally {
    await f.db.close();
  }
});

test('thresholds unlock desk objects from the n-th learning event', async () => {
  const f = await migrated();
  try {
    const completed = [];
    for (const [n, q] of ['Primeira?', 'Segunda?', 'Terceira?'].entries()) {
      const { investigation } = await f.api.start(a, A, q);
      await f.api.evidence(a, investigation.id, { segmentPosition: n, startOffset: 0, endOffset: 3, quote: multiSegments[n].slice(0, 3) });
      await f.api.save(a, investigation.id, 1, { explanation: EXPLANATION });
      const done = await f.api.complete(a, investigation.id);
      completed.push({ id: investigation.id, unlocks: ids(done.newUnlocks) });
    }
    assert.deepEqual(completed[2].unlocks, ['object.magnifying-glass']);
    const glass = (await unlocksOf(f.db, a)).find((r) => r.collectible_id === 'object.magnifying-glass');
    assert.equal(glass.source_id, completed[2].id, 'the third investigation is the source');
    // Ten verified quotes (over all investigations) → specimen jar.
    const { investigation } = await f.api.start(a, A, 'Muitas evidências?');
    let jar = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const result = await f.api.evidence(a, investigation.id, { segmentPosition: 1, startOffset: offset, endOffset: offset + 1, quote: multiSegments[1][offset] });
      jar = jar.concat(ids(result.newUnlocks));
    }
    assert.deepEqual(jar, ['object.specimen-box']);
  } finally {
    await f.db.close();
  }
});

test('connections across subjects, meaningful revisits (rate-limited, a day later) and the globe', async () => {
  const f = await migrated();
  try {
    const history = await addConfirmedLesson(f.db, a, { title: 'Revolução Industrial', subject: 'História', segments: ['A máquina a vapor usava carvão.'] });
    const physics2 = await addConfirmedLesson(f.db, a, { title: 'Termodinâmica', subject: 'física ', segments: ['Calor flui do quente para o frio.'] });
    const chemistry = await addConfirmedLesson(f.db, a, { title: 'Combustão', subject: 'Química', segments: ['A combustão libera energia.'] });
    const make = (material, revisionId, question, text) =>
      completeInvestigation(f.api, a, material, { question, revisionId, explanation: EXPLANATION,
        quote: { segmentPosition: 0, startOffset: 0, endOffset: text.length, quote: text } });
    const energy = await make(A, multiRevisionId, 'Energia se conserva?', multiSegments[0]);
    const steam = await make(history.materialId, history.revisionId, 'Por que o vapor mudou a indústria?', 'A máquina a vapor usava carvão.');
    const heat = await make(physics2.materialId, physics2.revisionId, 'Para onde vai o calor?', 'Calor flui do quente para o frio.');
    // Same subject (case and spaces normalized): a connection, but not the cross-subject stamp.
    const same = await f.api.connect(a, energy.id, heat.id, 'Os dois falam de calor');
    assert.deepEqual(same.newUnlocks, []);
    assert.equal(same.connections[0].acrossSubjects, false);
    const across = await f.api.connect(a, energy.id, steam.id, 'O carvão guarda energia');
    assert.deepEqual(ids(across.newUnlocks), ['stamp.connection']);
    assert.equal(across.connections.find((c) => c.otherId === steam.id).acrossSubjects, true);
    // Connecting the same pair from the other side returns it.
    const reverse = await f.api.connect(a, steam.id, energy.id);
    assert.equal(reverse.replayed, true);
    assert.equal((await f.db.query('select count(*)::int n from public.discovery_connections')).rows[0].n, 2);
    await assert.rejects(f.api.connect(a, energy.id, energy.id), /DISCOVERY_CONNECTION_INVALID/);
    await assert.rejects(f.api.connect(b, energy.id, steam.id), /DISCOVERY_NOT_FOUND/);
    // Third subject → globe; third connection → cover.
    const fire = await make(chemistry.materialId, chemistry.revisionId, 'O que a combustão libera?', 'A combustão libera energia.');
    const collection = await f.api.collection(a);
    assert(ids(collection.unlocks).includes('object.globe'));
    assert.equal(collection.unlocks.find((u) => u.id === 'object.globe').sourceId, fire.id);
    const third = await f.api.connect(a, fire.id, energy.id);
    assert.deepEqual(ids(third.newUnlocks), ['cover.matcha-linen']);

    // Revisits: a change on the day of recording is not a revisit.
    const sameDay = await f.api.reflect(a, energy.id, 'Hoje entendi melhor a conservação.');
    assert.deepEqual(sameDay.revisits, []);
    // Two days later: the first change counts once for that day; further changes the same day do not.
    await age(f.db, energy.id, 2);
    const later = await f.api.update(a, energy.id, 1, { explanation: `${EXPLANATION} Revisitei.` });
    assert.equal(later.revisits.length, 1);
    assert.equal(later.revisits[0].kind, 'explanation');
    assert.deepEqual(ids(later.newUnlocks), ['stamp.revisit']);
    const again = await f.api.reflect(a, energy.id, 'Mais uma ideia no mesmo dia.');
    assert.equal(again.revisits.length, 1, 'one revisit per discovery and day');
    assert.deepEqual(again.newUnlocks, []);
    // New evidence on an older discovery is also a revisit.
    await age(f.db, steam.id, 3);
    const newEvidence = await f.api.evidence(a, steam.id, { segmentPosition: 0, startOffset: 2, endOffset: 9, quote: 'máquina' });
    assert.equal((await f.api.discovery(a, steam.id)).revisits[0].kind, 'evidence');
    assert.deepEqual(newEvidence.newUnlocks, []);
    await age(f.db, heat.id, 4);
    const pressed = await f.api.reflect(a, heat.id, 'Voltei para ligar com a combustão.');
    assert.deepEqual(ids(pressed.newUnlocks), ['object.pressed-flower-jar']);
  } finally {
    await f.db.close();
  }
});

test('apply step links only what the account already has, by reference', async () => {
  const f = await migrated();
  try {
    const { investigation } = await f.api.start(a, A, 'Como aplicar conservação?');
    const id = investigation.id;
    // An answered question of the lesson, an own flashcard, an own highlight; B's flashcard.
    const session = randomUUID();
    await f.db.query("insert into public.quiz_sessions(id,user_id,material_id,batch_id,feedback_mode) values($1,$2,$3,$4,'immediate')", [session, a, A, resourceIds.batchA]);
    const card = (await f.db.query("insert into public.study_flashcards(user_id,material_id,front_text,back_text) values($1,$2,'O que se conserva?','A energia') returning id", [a, A])).rows[0].id;
    const foreignCard = (await f.db.query("insert into public.study_flashcards(user_id,material_id,front_text,back_text) values($1,$2,'Alheio','x') returning id", [b, B])).rows[0].id;
    const note = await f.call('study_save_annotation_range_admin', [a, randomUUID(), A, 0, randomUUID(), JSON.stringify({
      sourceRevisionId: multiRevisionId, segmentPosition: 2, startOffset: 0, endOffset: 5, quote: 'Calor', noteText: 'Ligação',
    })]);
    await assert.rejects(f.api.link(a, id, 'question', resourceIds.questionA), /DISCOVERY_LINK_INVALID/, 'not answered yet');
    await f.db.query('insert into public.quiz_session_answers(session_id,user_id,batch_id,question_id,selected_index,is_correct) values($1,$2,$3,$4,1,true)', [session, a, resourceIds.batchA, resourceIds.questionA]);
    const options = await f.api.linkOptions(a, id);
    assert.deepEqual(options.questions.map((q) => q.id), [resourceIds.questionA]);
    assert.deepEqual(options.flashcards.map((c) => c.id), [card]);
    assert.deepEqual(options.annotations.map((n) => n.id), [note.id]);
    for (const [kind, ref] of [['question', resourceIds.questionA], ['flashcard', card], ['annotation', note.id]])
      await f.api.link(a, id, kind, ref);
    const twice = await f.api.link(a, id, 'flashcard', card);
    assert.equal(twice.replayed, true);
    assert.equal(twice.links.length, 3);
    assert.deepEqual(twice.links.map((l) => l.target.label), ['Questão sintética?', 'O que se conserva?', 'Calor']);
    await assert.rejects(f.api.link(a, id, 'flashcard', foreignCard), /DISCOVERY_LINK_INVALID/);
    await assert.rejects(f.api.link(a, id, 'question', resourceIds.questionB), /DISCOVERY_LINK_INVALID/);
    await assert.rejects(f.api.linkOptions(b, id), /DISCOVERY_NOT_FOUND/);
    // By reference: an edit of the card shows up, nothing was copied.
    await f.db.query("update public.study_flashcards set front_text = 'Editado depois' where id = $1", [card]);
    const view = await f.api.get(a, id);
    assert.equal(view.links.find((l) => l.kind === 'flashcard').target.label, 'Editado depois');
    const removed = await f.api.link(a, id, 'flashcard', card, true);
    assert.equal(removed.links.length, 2);
  } finally {
    await f.db.close();
  }
});

test('desk placement accepts only unlocked objects in known slots, versioned and idempotent', async () => {
  const f = await migrated();
  try {
    await assert.rejects(f.api.layout(a, 0, [{ slot: 'desk-left', objectId: 'object.desk-lamp' }]), /COLLECTION_NOT_UNLOCKED/);
    // Unlock the magnifying glass with three investigations.
    for (const [n, q] of ['Um?', 'Dois?', 'Três?'].entries())
      await completeInvestigation(f.api, a, A, { question: q, revisionId: multiRevisionId, explanation: EXPLANATION,
        quote: { segmentPosition: n, startOffset: 0, endOffset: 2, quote: multiSegments[n].slice(0, 2) } });
    const request = randomUUID();
    const items = [{ slot: 'desk-left', objectId: 'object.magnifying-glass' }];
    const saved = await f.api.layout(a, 0, items, request);
    assert.deepEqual(saved.layout.items, items);
    assert.equal(saved.layout.version, 1);
    const replay = await f.api.layout(a, 0, items, request);
    assert.equal(replay.replayed, true);
    await assert.rejects(f.api.layout(a, 0, items), /DISCOVERY_VERSION_CONFLICT/);
    for (const bad of [
      [{ slot: 'ceiling', objectId: 'object.magnifying-glass' }],
      [{ slot: 'desk-left', objectId: 'stamp.first-evidence' }],
      [{ slot: 'desk-left', objectId: 'object.magnifying-glass' }, { slot: 'window', objectId: 'object.magnifying-glass' }],
      [{ slot: 'desk-left', objectId: 'object.magnifying-glass', extra: 1 }],
      ['desk-left'],
    ])
      await assert.rejects(f.api.layout(a, 1, bad), /COLLECTION_LAYOUT_INVALID/, JSON.stringify(bad));
    const moved = await f.api.layout(a, 1, [{ slot: 'window', objectId: 'object.magnifying-glass' }]);
    assert.equal(moved.layout.version, 2);
    const cleared = await f.api.layout(a, 2, []);
    assert.deepEqual(cleared.layout.items, []);
    // B has nothing unlocked and cannot place A's object.
    await assert.rejects(f.api.layout(b, 0, items), /COLLECTION_NOT_UNLOCKED/);
    assert.deepEqual((await f.api.collection(b)).unlocks, []);
  } finally {
    await f.db.close();
  }
});

test('privacy: another account sees and changes nothing; browsers have no access at all', async () => {
  const f = await migrated();
  try {
    const done = await completeInvestigation(f.api, a, A, { question: 'Privada?', revisionId: multiRevisionId, explanation: EXPLANATION, quote: quote0 });
    for (const attempt of [
      () => f.api.get(b, done.id),
      () => f.api.discovery(b, done.id),
      () => f.api.update(b, done.id, 1, { title: 'Invasão' }),
      () => f.api.reflect(b, done.id, 'Invasão'),
      () => f.api.evidence(b, done.id, quote0),
      () => f.api.removeEvidence(b, done.id, randomUUID()),
      () => f.api.complete(b, done.id),
      () => f.api.link(b, done.id, 'question', resourceIds.questionB),
    ])
      await assert.rejects(attempt(), /DISCOVERY_NOT_FOUND/);
    assert.deepEqual(await f.api.list(b), []);
    const theirs = await f.api.collection(b);
    assert.deepEqual(theirs.unlocks, []);
    assert.equal(theirs.counts.evidence, 0);
    // B's own discovery cannot be connected to A's.
    const own = await completeInvestigation(f.api, b, B, { question: 'Minha?', revisionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', explanation: EXPLANATION,
      quote: { segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia' } });
    await assert.rejects(f.api.connect(b, own.id, done.id), /DISCOVERY_NOT_FOUND/);
    await assert.rejects(f.api.connect(a, done.id, own.id), /DISCOVERY_NOT_FOUND/);
    for (const role of ['authenticated', 'anon']) {
      await assert.rejects(
        f.db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query('select * from public.collection_unlocks');
        }),
        /permission denied/,
        role,
      );
      await assert.rejects(
        f.db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query('select public.collection_get_admin($1)', [a]);
        }),
        /permission denied/,
        role,
      );
    }
  } finally {
    await f.db.close();
  }
});

test('concurrent duplicates (retries, parallel tabs) leave one row and one unlock', async () => {
  const f = await migrated();
  try {
    const { investigation } = await f.api.start(a, A, 'Duas abas?');
    const id = investigation.id;
    const evidenceId = randomUUID();
    // PGlite has one connection, so these are serialized like the row locks serialize them in Postgres.
    const results = await Promise.allSettled([
      f.api.evidence(a, id, quote0, evidenceId),
      f.api.evidence(a, id, quote0, evidenceId),
      f.api.evidence(a, id, quote0),
    ]);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected']);
    assert.match(results[2].reason.message, /DISCOVERY_EVIDENCE_DUPLICATE/);
    await f.api.save(a, id, 1, { explanation: EXPLANATION });
    const completions = await Promise.all([f.api.complete(a, id), f.api.complete(a, id)]);
    assert.deepEqual(completions.map((c) => c.replayed), [false, true]);
    const counts = (await f.db.query("select collectible_id, count(*)::int n from public.collection_unlocks where user_id=$1 group by 1", [a])).rows;
    assert(counts.every((row) => row.n === 1));
    assert.equal((await f.db.query('select count(*)::int n from public.discoveries')).rows[0].n, 1);
  } finally {
    await f.db.close();
  }
});

test('preflight and postflight checks run read-only; the documented rollback removes everything new', async () => {
  const f = await createAcademicDatabase();
  const row = (results, key) => results.find((r) => r.rows[0] && key in r.rows[0]).rows[0];
  try {
    const { db } = f;
    await migratePrerequisites(db);
    const pre = await db.exec(read('checks/discoveries-preflight.sql'));
    const prereq = row(pre, 'has_materials');
    assert(Object.values(prereq).every(Boolean), JSON.stringify(prereq));
    assert(Object.values(row(pre, 'investigations_must_be_null')).every((value) => value === null));
    const before = row(pre, 'confirmations');
    await db.exec(migration);
    const post = await db.exec(read('checks/discoveries-postflight.sql'));
    const objects = row(post, 'has_investigations');
    assert(Object.values(objects).every((value) => value === true), JSON.stringify(objects));
    const tables = post.find((r) => r.rows[0] && 'rls_enabled' in r.rows[0]).rows;
    assert.equal(tables.length, 10);
    for (const t of tables) assert(t.rls_enabled && t.hidden_from_browser && t.hidden_from_anon && t.unlocks_not_updatable, JSON.stringify(t));
    const functions = post.find((r) => r.rows[0] && 'server_only' in r.rows[0]).rows;
    assert(functions.length >= 20);
    for (const fn of functions) assert(fn.server_only && fn.hidden_from_anon && fn.security_invoker && fn.fixed_search_path, JSON.stringify(fn));
    assert.equal(row(post, 'award_not_callable').award_not_callable, true);
    const counts = row(post, 'investigations_must_be_0');
    for (const key of ['materials', 'confirmations', 'annotations']) assert.equal(Number(counts[key]), Number(before[key]), key);
    // Section 3 of the rollback document (its SQL block), run after the export.
    const rollback = read('rollback/discoveries-rollback.md').split('## 3.')[1].match(/```sql\n([\s\S]*?)```/)[1];
    await db.exec(rollback);
    const left = (await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'investigation\\_%' or p.proname like 'discovery\\_%' or p.proname like 'collection\\_%' or p.proname like 'desk\\_%')")).rows[0].n;
    assert.equal(left, 0, 'no function left behind');
    const again = await db.exec(read('checks/discoveries-preflight.sql'));
    assert(Object.values(row(again, 'investigations_must_be_null')).every((value) => value === null));
    await db.exec(migration);
    assert.equal(PERMISSION_DECLARATION.version.length > 0, true);
  } finally {
    await f.db.close();
  }
});
