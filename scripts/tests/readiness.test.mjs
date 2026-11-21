import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessChecks, featureSchema, readinessFlagErrors, runReadinessChecks } from '../../backend/src/diagnostics/readiness.js';

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
  // The knowledge-map cache is optional: never a readiness requirement.
  assert(!results.some((r) => r.label.includes('knowledge_maps')));
  assert.deepEqual(readinessFlagErrors(flags), []);
  assert.match(readinessFlagErrors({ multi_lesson: true }).join(' '), /FEATURE_MULTI_LESSON exige FEATURE_CATALOG_UNITS/);
});
