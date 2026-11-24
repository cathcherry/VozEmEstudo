import test from 'node:test';
import assert from 'node:assert/strict';
import { readCanonicalLessons, seedDemoLessons } from '../src/services/demo-seed.service.js';

// Boot-time seed: the three lesson files map to demo_lessons rows; a second run changes nothing.
function fakeClient() {
  const rows = new Map();
  let writes = 0;
  return {
    rows,
    get writes() { return writes; },
    from() {
      return {
        select: async () => ({ data: [...rows.values()].map((r) => JSON.parse(JSON.stringify(r))), error: null }),
        upsert: async (row, options) => {
          assert.equal(options.onConflict, 'slug');
          writes += 1;
          const rest = { ...row };
          delete rest.updated_at;
          // Postgres jsonb reorders keys: simulate it.
          rest.content = Object.fromEntries(Object.entries(rest.content).reverse());
          rows.set(row.slug, JSON.parse(JSON.stringify(rest)));
          return { error: null };
        },
      };
    },
  };
}

test('demo lessons autoseed is complete and idempotent', async () => {
  const lessons = readCanonicalLessons();
  assert.deepEqual(lessons.map((l) => l.slug), ['crase', 'vacinas', 'internet']);
  for (const l of lessons) {
    assert.match(l.audio_storage_path, /^demo\/[a-z0-9-]+\/audio\.mp3$/);
    assert(l.content.segments.length >= 20 && l.content.questions && l.content.flashcards && l.content.summary);
    assert(l.audio_size_bytes > 0 && l.duration_ms > 0);
  }
  assert.equal(lessons[2].video_storage_path, 'demo/internet/video.mp4');
  const client = fakeClient();
  const first = await seedDemoLessons({ client });
  assert.deepEqual(first.inserted, ['crase', 'vacinas', 'internet']);
  const second = await seedDemoLessons({ client });
  assert.deepEqual(second.unchanged, ['crase', 'vacinas', 'internet']);
  assert.equal(client.writes, 3);
  client.rows.get('crase').title = 'velho';
  assert.deepEqual((await seedDemoLessons({ client })).updated, ['crase']);
});
