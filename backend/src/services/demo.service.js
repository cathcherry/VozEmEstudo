// Shared demonstration lessons of the public testing program. The canonical lesson (one audio file,
// one verified transcript, one set of materials) lives in public.demo_lessons; opening it gives the
// participant a private, lightweight copy of the text rows (see demo_lesson_materialize_admin), so
// their attempts, notes, cards and progress stay their own. Nothing here calls an AI provider and no
// media file is copied: the copy's audio row points to the single canonical file.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rpc } from '../repositories/rpc.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { flashcardSetService } from './flashcard-set.service.js';
import { listSets } from '../repositories/flashcard-set.repository.js';
import { publicTestingEnabled } from './testing.service.js';
import { logger } from '../utils/logger.js';

const uuid = z.string().uuid();

/** Stable UUID for the participant's demo card set: a retried open never creates a second set. */
export function demoSetId(userId, materialId) {
  const hex = createHash('sha256').update(`demo-set:${userId}:${materialId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function list(userId) {
  if (!publicTestingEnabled()) return [];
  return rpc('demo_lessons_list_admin', { p_user_id: userId });
}

async function ensureFlashcards(userId, opened) {
  if (!isFeatureEnabled('flashcards') || !isFeatureEnabled('flashcard_sets')) return;
  const deck = opened.flashcards;
  if (!deck?.cards?.length || !opened.sourceRevisionId) return;
  const existing = await listSets(userId, opened.materialId).catch(() => []);
  if (existing?.length) return;
  try {
    await flashcardSetService.create(userId, {
      id: demoSetId(userId, opened.materialId),
      name: String(deck.name || 'Cartões da aula').slice(0, 160),
      materialId: opened.materialId,
      sourceRevisionId: opened.sourceRevisionId,
      config: { demo: true },
      cards: deck.cards.slice(0, 100).map((card) => ({
        front: card.front,
        back: card.back,
        ...(card.evidence ? { evidence: card.evidence } : {}),
        sourceSegments: (card.sourceSegments || []).slice(0, 5).map((s) => ({
          position: s.position,
          startMs: s.startMs ?? null,
          endMs: s.endMs ?? null,
        })),
      })),
    });
  } catch (error) {
    // The lesson is usable without cards; the next open tries again (stable set id).
    logger.error('DEMO_FLASHCARDS_FAILED', { code: error?.code || 'unknown' });
  }
}

/** Opens (and on first use, copies) a demo lesson for the participant. Returns its material id. */
export async function open(userId, demoId) {
  if (!publicTestingEnabled()) return null;
  const id = uuid.parse(demoId);
  const opened = await rpc('demo_lesson_materialize_admin', { p_user_id: userId, p_demo_id: id });
  // Cards come from the canonical deck through the regular set service (no AI). A first open that
  // failed half way is completed on the next one (stable set id, existing sets are kept).
  await ensureFlashcards(userId, opened);
  return { materialId: opened.materialId, created: Boolean(opened.created) };
}

/**
 * Canonical demo media are original, openly licensed files shipped with the app
 * (database/demo-lessons/<slug>/) and served by the API at /demo-media/<slug>/<file>: one copy for
 * everyone, no Storage upload, no Supabase egress. `demo/<slug>/<file>` → `/demo-media/<slug>/<file>`.
 */
export function demoMediaUrl(path) {
  const match = /^demo\/([a-z0-9-]+)\/(audio\.mp3|video\.mp4)$/.exec(String(path || ''));
  return match ? `/demo-media/${match[1]}/${match[2]}` : null;
}

/** Playback for a demo copy in the same shape as the regular playback (audio, optional video). */
export function demoPlayback(copy, durationMs) {
  const signedAudioUrl = demoMediaUrl(copy.audioPath);
  const signedVideoUrl = copy.videoPath ? demoMediaUrl(copy.videoPath) : null;
  return {
    signedAudioUrl,
    video: signedVideoUrl
      ? { originalName: `${copy.slug}.mp4`, sizeBytes: null, durationMs: Number(durationMs) || null, clipStartMs: 0, clipEndMs: Number(durationMs) || null }
      : null,
    signedVideoUrl,
  };
}

/** Demo copy metadata of a material (canonical file paths and credits), or null. */
export async function copyOf(userId, materialId) {
  if (!publicTestingEnabled()) return null;
  return rpc('demo_copy_of_admin', { p_user_id: userId, p_material_id: materialId }).catch(() => null);
}
