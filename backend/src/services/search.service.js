import { z } from 'zod';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';

/**
 * Search across the signed-in person's own lessons: titles/disciplines, question statements and
 * transcript segments. Accent- and case-insensitive. Answer keys, explanations and other people's
 * materials are never read. No migration is needed: the database pre-filters with ILIKE and the
 * service confirms every hit (and its ownership) in JavaScript.
 */
export const fold = (value = '') =>
  String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

/**
 * ILIKE pre-filter: escapes wildcards and turns letters that may carry an accent into "_" (any one
 * character), so "acao" also reaches "ação". The exact accent-insensitive match is checked later.
 */
export function likePattern(query) {
  const escaped = fold(query)
    .replace(/[\\%_]/g, (char) => `\\${char}`)
    .replace(/[aeiouc]/g, '_');
  return `%${escaped}%`;
}

export function snippet(text, query, radius = 70) {
  const value = String(text || '');
  const index = fold(value).indexOf(fold(query));
  if (index < 0) return value.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(value.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${value.slice(start, end).trim()}${end < value.length ? '…' : ''}`;
}

export const validateSearch = (query) =>
  z
    .object({
      q: z.string().trim().min(2).max(100),
      scope: z.enum(['all', 'lessons', 'questions', 'transcripts']).default('all'),
    })
    .strict()
    .parse(query);

const LIMITS = { lessons: 50, questions: 50, transcripts: 60, perLesson: 5, scan: 600 };

export function buildSearchService(db = getAdminSupabase) {
  return async function search(userId, input) {
    const { q, scope } = validateSearch(input);
    const needle = fold(q);
    const includes = (text) => fold(text).includes(needle);
    const client = db();
    const { data: materials, error } = await client
      .from('materials')
      .select('id,title,subject,created_at')
      .eq('user_id', userId);
    if (error) throw error;
    const owned = new Map((materials || []).map((m) => [m.id, m]));
    const ids = [...owned.keys()];
    const result = { query: q, lessons: [], questions: [], transcripts: [] };
    if (!ids.length) return result;

    if (scope === 'all' || scope === 'lessons')
      result.lessons = [...owned.values()]
        .filter((m) => includes(m.title) || includes(m.subject))
        .slice(0, LIMITS.lessons)
        .map((m) => ({
          materialId: m.id,
          title: m.title,
          subject: m.subject,
          createdAt: m.created_at,
        }));

    if (scope === 'all' || scope === 'questions') {
      const { data: batches, error: batchError } = await client
        .from('question_batches')
        .select('id,material_id,created_at')
        .in('material_id', ids);
      if (batchError) throw batchError;
      const ownedBatches = new Map(
        (batches || []).filter((b) => owned.has(b.material_id)).map((b) => [b.id, b]),
      );
      if (ownedBatches.size) {
        // Only statements are selected: the answer key never leaves the database here.
        const { data: questions, error: questionError } = await client
          .from('questions')
          .select('id,batch_id,position,statement')
          .in('batch_id', [...ownedBatches.keys()])
          .ilike('statement', likePattern(q))
          .limit(LIMITS.scan);
        if (questionError) throw questionError;
        result.questions = (questions || [])
          .filter((question) => ownedBatches.has(question.batch_id) && includes(question.statement))
          .slice(0, LIMITS.questions)
          .map((question) => {
            const batch = ownedBatches.get(question.batch_id);
            const material = owned.get(batch.material_id);
            return {
              questionId: question.id,
              batchId: batch.id,
              materialId: material.id,
              lessonTitle: material.title,
              number: question.position + 1,
              statement: question.statement,
            };
          });
      }
    }

    if (scope === 'all' || scope === 'transcripts') {
      const { data: transcriptions, error: transcriptionError } = await client
        .from('transcriptions')
        .select('id,material_id')
        .in('material_id', ids);
      if (transcriptionError) throw transcriptionError;
      const ownedTranscriptions = new Map(
        (transcriptions || [])
          .filter((t) => owned.has(t.material_id))
          .map((t) => [t.id, t.material_id]),
      );
      if (ownedTranscriptions.size) {
        const { data: segments, error: segmentError } = await client
          .from('transcription_segments')
          .select('transcription_id,position,start_ms,end_ms,current_text')
          .in('transcription_id', [...ownedTranscriptions.keys()])
          .ilike('current_text', likePattern(q))
          .limit(LIMITS.scan);
        if (segmentError) throw segmentError;
        const byLesson = new Map();
        for (const segment of segments || []) {
          const materialId = ownedTranscriptions.get(segment.transcription_id);
          if (!materialId || !includes(segment.current_text)) continue;
          if (!byLesson.has(materialId)) byLesson.set(materialId, []);
          byLesson.get(materialId).push(segment);
        }
        result.transcripts = [...byLesson.entries()]
          .map(([materialId, hits]) => {
            const material = owned.get(materialId);
            hits.sort((a, b) => a.position - b.position);
            return {
              materialId,
              lessonTitle: material.title,
              subject: material.subject,
              total: hits.length,
              hits: hits.slice(0, LIMITS.perLesson).map((segment) => ({
                position: segment.position,
                startMs: segment.start_ms,
                endMs: segment.end_ms,
                snippet: snippet(segment.current_text, q),
              })),
            };
          })
          .sort((a, b) => b.total - a.total)
          .slice(0, LIMITS.transcripts);
      }
    }
    return result;
  };
}
export const searchOwnLibrary = buildSearchService();
