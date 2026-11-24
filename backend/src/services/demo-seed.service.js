// Boot-time seed of the canonical demonstration lessons (public testing). Reads
// database/demo-lessons/<slug>/lesson.json shipped with the release and upserts each lesson by slug,
// so every environment gets the same three lessons on deploy without pasting SQL. Idempotent: rows
// whose content did not change are left alone. Never blocks startup: failures are logged only.
// Same mapping as scripts/demo-lessons/build-seed-sql.mjs (the SQL seed for manual use).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';

export const DEMO_LESSONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/demo-lessons');
const ORDER = ['crase', 'vacinas', 'internet'];

/** The demo_lessons rows described by the lesson files, in display order. */
export function readCanonicalLessons(dir = DEMO_LESSONS_DIR) {
  if (!existsSync(dir)) return [];
  const slugs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name) && existsSync(path.join(dir, entry.name, 'lesson.json')))
    .map((entry) => entry.name)
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return slugs.map((slug, index) => {
    const lesson = JSON.parse(readFileSync(path.join(dir, slug, 'lesson.json'), 'utf8'));
    if (lesson.slug !== slug) throw new Error(`slug mismatch in ${slug}`);
    const media = lesson.media || {};
    return {
      slug,
      version: Number(lesson.version) || 1,
      title: lesson.title,
      subject: lesson.subject,
      description: lesson.description || '',
      language: lesson.language || 'pt',
      cover: lesson.cover || {},
      duration_ms: Number(lesson.durationMs),
      audio_storage_path: `demo/${slug}/${media.audio || 'audio.mp3'}`,
      audio_mime: media.audioMime || 'audio/mpeg',
      audio_size_bytes: Number(media.sizeBytes),
      video_storage_path: media.video ? `demo/${slug}/${media.video}` : null,
      video_mime: media.video ? media.videoMime || 'video/mp4' : null,
      content: {
        segments: lesson.segments,
        words: lesson.words ?? null,
        summary: lesson.summary,
        questions: lesson.questions,
        flashcards: lesson.flashcards,
        credits: lesson.credits,
      },
      published: true,
      sort_order: index,
    };
  });
}

// jsonb does not keep key order, so compare with sorted keys.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const FIELDS = ['version', 'title', 'subject', 'description', 'language', 'cover', 'duration_ms', 'audio_storage_path', 'audio_mime', 'audio_size_bytes', 'video_storage_path', 'video_mime', 'content', 'published', 'sort_order'];

/** Upserts the canonical lessons. Returns { inserted, updated, unchanged } slugs. */
export async function seedDemoLessons({ client = getAdminSupabase(), dir = DEMO_LESSONS_DIR } = {}) {
  const lessons = readCanonicalLessons(dir);
  const result = { inserted: [], updated: [], unchanged: [] };
  if (!lessons.length) return result;
  const { data: existing, error } = await client.from('demo_lessons').select(['slug', ...FIELDS].join(','));
  if (error) throw error;
  const bySlug = new Map((existing || []).map((row) => [row.slug, row]));
  for (const lesson of lessons) {
    const current = bySlug.get(lesson.slug);
    if (current && FIELDS.every((field) => same(current[field] ?? null, lesson[field] ?? null))) {
      result.unchanged.push(lesson.slug);
      continue;
    }
    const { error: upsertError } = await client
      .from('demo_lessons')
      .upsert({ ...lesson, updated_at: new Date().toISOString() }, { onConflict: 'slug' });
    if (upsertError) throw upsertError;
    (current ? result.updated : result.inserted).push(lesson.slug);
  }
  return result;
}

/** Called once after the server starts listening. */
export async function autoseedDemoLessons() {
  if (!isFeatureEnabled('public_testing') || process.env.DEMO_LESSONS_AUTOSEED === 'false') return null;
  try {
    const result = await seedDemoLessons();
    logger.info('DEMO_LESSONS_SEEDED', result);
    return result;
  } catch (error) {
    logger.error('DEMO_LESSONS_SEED_FAILED', { code: error?.code || 'unknown', message: String(error?.message || '').slice(0, 200) });
    return null;
  }
}
