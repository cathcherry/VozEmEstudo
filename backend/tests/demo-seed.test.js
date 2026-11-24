import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { validateNewFlashcardSet } from '../src/validators/flashcard-generation.validator.js';
import { demoMediaUrl, demoSetId } from '../src/services/demo.service.js';

// The real seed of the three demonstration lessons, loaded into the real migration (PGlite), and
// a participant's copy of each: complete, confirmed, with the canonical media path, and cards that
// pass the app's own set validation. No AI anywhere.
const read = (path) => readFileSync(new URL(`../../database/${path}`, import.meta.url), 'utf8');

test('the three demo lessons seed, copy and validate end to end', async () => {
  const f = await createAcademicDatabase();
  try {
    await migrateStudyAuthoring(f.db);
    await f.db.exec('alter table auth.users add column created_at timestamptz not null default now()');
    await f.db.exec(read('migrations/20261125100000_public_testing.sql'));
    const seed = read('seeds/demo_lessons.sql');
    await f.db.exec(seed);
    await f.db.exec(seed); // idempotent
    const lessons = (await f.db.query('select id, slug, audio_storage_path, video_storage_path, audio_size_bytes from public.demo_lessons order by sort_order')).rows;
    assert.deepEqual(lessons.map((l) => l.slug), ['crase', 'vacinas', 'internet']);
    for (const lesson of lessons) {
      const file = new URL(`../../database/demo-lessons/${lesson.slug}/audio.mp3`, import.meta.url);
      assert.equal(statSync(file).size, Number(lesson.audio_size_bytes), `${lesson.slug} audio size`);
      assert.equal(demoMediaUrl(lesson.audio_storage_path), `/demo-media/${lesson.slug}/audio.mp3`);
    }
    assert.equal(demoMediaUrl(lessons[2].video_storage_path), '/demo-media/internet/video.mp4');
    assert.equal(demoMediaUrl('demo/../secret/audio.mp3'), null);

    await f.db.exec("update public.public_testing_config set enabled = true, registration_starts_at = '2026-11-01' where id = 1");
    const user = randomUUID();
    await f.db.query("insert into auth.users(id, created_at) values ($1, '2026-11-25')", [user]);
    const version = (await f.db.query('select public.current_permission_version() v')).rows[0].v;
    for (const lesson of lessons) {
      const copy = await f.call('demo_lesson_materialize_admin', [user, lesson.id]);
      assert.equal(copy.created, true);
      const review = await f.call('get_transcription_review_admin', [user, copy.materialId, version]);
      assert.equal(review.state, 'ready_to_generate', lesson.slug);
      const counts = (await f.db.query(
        `select (select count(*) from public.transcription_segments s join public.transcriptions t on t.id = s.transcription_id where t.material_id = $1) segs,
                (select count(*) from public.questions q join public.question_batches b on b.id = q.batch_id where b.material_id = $1) qs,
                (select count(*) from public.summary_versions where material_id = $1 and is_current) sums,
                (select count(*) from public.processing_jobs where material_id = $1 and status <> 'CONCLUIDA') open_jobs`,
        [copy.materialId],
      )).rows[0];
      assert(Number(counts.segs) >= 20, `${lesson.slug} segments`);
      assert.equal(Number(counts.qs), 8, `${lesson.slug} questions`);
      assert.equal(Number(counts.sums), 1);
      assert.equal(Number(counts.open_jobs), 0, 'nothing is queued for the worker');
      // The cards the API will save through the regular set service pass its validation.
      const set = validateNewFlashcardSet({
        id: demoSetId(user, copy.materialId),
        name: copy.flashcards.name,
        materialId: copy.materialId,
        sourceRevisionId: copy.sourceRevisionId,
        config: { demo: true },
        cards: copy.flashcards.cards.map((card) => ({
          front: card.front,
          back: card.back,
          ...(card.evidence ? { evidence: card.evidence } : {}),
          sourceSegments: (card.sourceSegments || []).map((s) => ({ position: s.position, startMs: s.startMs ?? null, endMs: s.endMs ?? null })),
        })),
      });
      assert.equal(set.cards.length, 10);
      assert.equal(demoSetId(user, copy.materialId), demoSetId(user, copy.materialId), 'stable set id');
    }
    // Nothing was charged for opening demos.
    assert.equal(Number((await f.db.query('select count(*) n from public.usage_ledger')).rows[0].n), 0);
  } finally {
    await f.db.close();
  }
});
