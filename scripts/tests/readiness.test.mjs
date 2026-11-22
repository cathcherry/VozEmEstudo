import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessChecks, featureSchema, optionalSchema, readinessFlagErrors, runReadinessChecks } from '../../backend/src/diagnostics/readiness.js';

function fixture({ missing, publicVideo = false } = {}) {
  const queries = [];
  const db = {
    from: (name) => ({ select: (columns, options) => {
      queries.push({ name, columns, options });
      return { error: name === missing ? { message: 'sensitive provider detail' } : null };
    } }),
    rpc: (name) => { assert.equal(name, 'current_permission_version'); return { data: 'test-version' }; },
    storage: { getBucket: (name) => ({ data: { public: name === 'study-videos' && publicVideo, file_size_limit: 104857600, allowed_mime_types: ['video/mp4'] } }) },
  };
  return { db, queries };
}

test('flags OFF tolerate absent optional modules and use metadata-only HEAD reads', async () => {
  const { db, queries } = fixture({ missing: 'study_annotations' });
  const results = await runReadinessChecks(createReadinessChecks(db, {}, 'audios', 'test-version'));
  assert(results.every((r) => r.ok));
  assert(!queries.some((q) => q.name === 'study_annotations'));
  assert(queries.every((q) => q.options.head === true && !q.options.count));
});

test('active modules fail safely for missing schema and public video bucket', async () => {
  const { db } = fixture({ missing: 'study_annotations', publicVideo: true });
  const flags = Object.fromEntries(Object.keys(featureSchema).map((key) => [key, true]));
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  assert(results.some((r) => !r.ok && r.label.includes('annotations')));
  assert(results.some((r) => !r.ok && r.label.includes('study-videos')));
  assert(!JSON.stringify(results).includes('sensitive provider detail'));
});

test('timeouts and thrown provider errors become bounded, redacted failures', async () => {
  const results = await runReadinessChecks([
    { label: 'hung', run: () => new Promise(() => {}) },
    { label: 'secret', run: () => { throw new Error('private-token'); } },
    { label: 'healthy', run: () => ({ data: null }) },
  ], 10);
  assert.deepEqual(results.map((r) => r.ok), [false, false, true]);
  assert(!JSON.stringify(results).includes('private-token'));
  assert(readinessFlagErrors({ social_basic: true }).length);
  assert(readinessFlagErrors({ quiz_review: true }).length);
  assert.deepEqual(readinessFlagErrors({ quiz_v2: true, quiz_review: true }), []);
});

test('newer modules are probed: study_authoring, flashcard_sets and AssemblyAI tables', async () => {
  const { db } = fixture({ missing: 'study_flashcard_sets' });
  const flags = { study_authoring: true, flashcards: true, flashcard_sets: true };
  const results = await runReadinessChecks(
    createReadinessChecks(db, flags, 'audios', 'test-version', { asrProvider: 'assemblyai' }),
  );
  for (const name of ['question_list_shares', 'ai_job_executions', 'transcription_word_alignments'])
    assert(results.some((r) => r.label.includes(name)), name);
  assert(results.some((r) => !r.ok && r.label.includes('study_flashcard_sets')));
  assert.deepEqual(readinessFlagErrors(flags), []);
  assert.match(readinessFlagErrors({ flashcard_sets: true }).join(' '), /FEATURE_FLASHCARDS/);
  // Without AssemblyAI the AI tables are not required.
  const plain = createReadinessChecks(db, {}, 'audios', 'test-version', { asrProvider: 'huggingface' });
  assert(!plain.some((check) => check.label.includes('ai_job_executions')));
});

test('classrooms: tables are probed and the flag needs flashcard sets', async () => {
  const { db } = fixture({ missing: 'classroom_members' });
  const flags = { flashcards: true, flashcard_sets: true, classrooms: true };
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  for (const name of ['classrooms', 'classroom_invites', 'classroom_submissions', 'classroom_lessons', 'classroom_shared_items'])
    assert(results.some((r) => r.ok && r.label.includes(`: ${name} `)), name);
  assert(results.some((r) => !r.ok && r.label.includes('classroom_members')));
  assert.deepEqual(readinessFlagErrors(flags), []);
  assert.match(readinessFlagErrors({ classrooms: true }).join(' '), /FEATURE_CLASSROOMS exige FEATURE_FLASHCARD_SETS/);
});

test('multi-lesson: its tables and generation reuse are probed; the flag needs catalog units', async () => {
  const { db } = fixture({ missing: 'multi_lesson_jobs' });
  const flags = { catalog_units: true, multi_lesson: true };
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  for (const name of ['ai_generations', 'multi_lesson_materials'])
    assert(results.some((r) => r.ok && r.label.includes(`multi_lesson: ${name} `)), name);
  assert(results.some((r) => !r.ok && r.label.includes('multi_lesson_jobs')));
  // The knowledge-map cache and the exports are optional: reported, never a readiness requirement.
  for (const name of ['knowledge_maps', 'multi_lesson_exports']) {
    const probe = results.find((r) => r.label.includes(name));
    assert(probe, `${name} is probed`);
    assert.equal(probe.optional, true, `${name} is optional`);
  }
  assert.deepEqual(readinessFlagErrors(flags), []);
  assert.match(readinessFlagErrors({ multi_lesson: true }).join(' '), /FEATURE_MULTI_LESSON exige FEATURE_CATALOG_UNITS/);
});

test('discoveries: investigations, evidence, discoveries, unlocks and desk are probed; the flag needs annotations', async () => {
  const { db } = fixture({ missing: 'collection_unlocks' });
  const flags = { annotations: true, discoveries: true };
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  for (const name of ['investigations', 'investigation_evidence', 'discoveries', 'desk_layouts'])
    assert(results.some((r) => r.ok && r.label.includes(`discoveries: ${name} `)), name);
  assert(results.some((r) => !r.ok && r.label.includes('collection_unlocks')));
  assert.deepEqual(readinessFlagErrors(flags), []);
  assert.match(readinessFlagErrors({ discoveries: true }).join(' '), /FEATURE_DISCOVERIES exige FEATURE_ANNOTATIONS/);
});

test('journal: journals and journal pages are probed only with the flag on; no flag dependency', async () => {
  const { db } = fixture({ missing: 'journal_pages' });
  const off = createReadinessChecks(db, {}, 'audios', 'test-version');
  assert(!off.some((check) => check.label.includes('journal')), 'not probed with the flag off');
  const flags = { journal: true };
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  assert(results.some((r) => r.ok && r.label.includes('journal: journals ')));
  assert(results.some((r) => !r.ok && r.label.includes('journal_pages') && r.label.includes('20261124100000_journals.sql')));
  assert.deepEqual(readinessFlagErrors(flags), []);
});

test('classroom contributions: an optional probe that reports but never blocks', async () => {
  assert.equal(optionalSchema.classroom_contributions.flag, 'classrooms');
  const { db } = fixture({ missing: 'classroom_contributions' });
  const off = createReadinessChecks(db, { flashcards: true, flashcard_sets: true }, 'audios', 'test-version');
  assert(!off.some((check) => check.label.includes('classroom_contributions')), 'not probed with the flag off');
  const flags = { flashcards: true, flashcard_sets: true, classrooms: true };
  const results = await runReadinessChecks(createReadinessChecks(db, flags, 'audios', 'test-version'));
  const probe = results.find((r) => r.label.includes('classroom_contributions'));
  assert.equal(probe.ok, false);
  assert.equal(probe.optional, true);
  assert.match(probe.label, /20261122090000_classroom_contributions\.sql/);
  assert(results.filter((r) => !r.optional).every((r) => r.ok), 'required probes are unaffected');
});

test('flashcards 3.0: the private flashcard-media bucket is checked only with the flag on', async () => {
  const bucket = (data) => ({ from: () => ({ select: async () => ({ data: [], error: null }) }), rpc: async () => ({ data: 'v', error: null }), storage: { getBucket: async () => ({ data, error: null }) } });
  const flags = { flashcards: true, flashcard_sets: true, flashcards_v3: true };
  const label = 'Bucket flashcard-media';
  assert(!createReadinessChecks(bucket({}), { flashcards: true }, 'audios', 'v').some((c) => c.label.startsWith(label)));
  const ok = await runReadinessChecks(createReadinessChecks(bucket({ public: false, file_size_limit: 2097152 }), flags, 'audios', 'v'));
  assert.equal(ok.find((r) => r.label.startsWith(label)).ok, true);
  const open = await runReadinessChecks(createReadinessChecks(bucket({ public: true, file_size_limit: 2097152 }), flags, 'audios', 'v'));
  assert.equal(open.find((r) => r.label.startsWith(label)).ok, false, 'a public media bucket fails readiness');
});
