// Milestone C — integrated learning material of several confirmed lessons (FEATURE_MULTI_LESSON,
// migration 20261121170000_multi_lesson.sql; optional cache 20261121171000_knowledge_map_cache.sql).
// A request: resolve the selection → canonical generation key over ALL source revisions →
// begin_generation_admin (start / join / reuse, daily budget) → multi_lesson_attach_admin (frozen
// source snapshot + queued job). The worker runs the job (jobs/multi-lesson-runner.js).
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../domain/errors.js';
import { generationKey } from '../domain/generation-key.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { callGenerationRpc } from './generation-reuse.service.js';
import { MULTI_LESSON_PROMPT_VERSION } from '../prompts/multi-lesson.v1.js';
import { MAX_SOURCES } from './multi-lesson-generation.service.js';
import * as repository from '../repositories/multi-lesson.repository.js';

export const MULTI_LESSON_TASK = 'summary';
export const MULTI_LESSON_MAX_ATTEMPTS = 2;
const OUTPUTS = ['summary', 'questions', 'flashcards'];

const uuid = z.string().uuid();
const selection = z
  .object({
    kind: z.enum(['lessons', 'unit', 'units', 'subject']),
    ids: z.array(uuid).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.kind === 'unit' || value.kind === 'subject') && value.ids.length !== 1)
      ctx.addIssue({ code: 'custom', message: 'Escolha uma unidade ou disciplina.' });
    if (value.kind === 'units' && value.ids.length > 20)
      ctx.addIssue({ code: 'custom', message: 'Escolha no máximo 20 unidades.' });
  });
const schemas = {
  preview: z.object({ selection }).strict(),
  create: z
    .object({
      id: uuid,
      requestId: uuid,
      title: z.string().trim().min(1).max(160),
      selection,
      outputs: z.array(z.enum(OUTPUTS)).min(1).max(3),
      settings: z
        .object({
          questionCount: z.number().int().min(1).max(20).optional(),
          flashcardCount: z.number().int().min(1).max(30).optional(),
          focus: z.string().trim().max(200).optional(),
        })
        .strict()
        .optional(),
      // The revisions the student saw in the preview: a change in between is refused, not hidden.
      expectedRevisionIds: z.array(uuid).max(MAX_SOURCES).optional(),
      reuse: z.boolean().optional(),
    })
    .strict(),
};

/** Provider and model of the task, pinned on the record so the worker uses the key's model. */
export function multiLessonModel() {
  const snapshot = getAiRegistry().snapshot(MULTI_LESSON_TASK);
  return {
    provider: snapshot.provider,
    model: snapshot.model || 'default',
    family: `${snapshot.provider}:${snapshot.model || 'default'}`.slice(0, 80),
  };
}

const sameSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

export function buildMultiLessonService(repo = repository) {
  async function resolve(user, sel) {
    const resolved = await repo.resolveSources(user.id, sel.kind, [...new Set(sel.ids)]);
    return { ...resolved, limit: MAX_SOURCES, tooMany: resolved.included.length > MAX_SOURCES };
  }

  async function begin(user, data, sources, model, allowReuse) {
    const settings = { outputs: data.outputs, ...(data.settings || {}) };
    if (!data.outputs.includes('questions')) delete settings.questionCount;
    if (!data.outputs.includes('flashcards')) delete settings.flashcardCount;
    const key = generationKey({
      scope: `user:${user.id}`,
      sources,
      kind: 'multi_lesson',
      settings,
      promptVersion: MULTI_LESSON_PROMPT_VERSION,
      modelFamily: model.family,
    });
    return callGenerationRpc('begin_generation_admin', {
      p_user_id: user.id,
      p_key: key,
      p_scope_kind: 'user',
      p_scope_id: user.id,
      p_kind: 'multi_lesson',
      p_sources: sources,
      p_prompt_version: MULTI_LESSON_PROMPT_VERSION,
      p_model_family: model.family,
      p_material_id: null,
      p_allow_reuse: allowReuse,
      p_daily_limit: env.aiDailyGenerationLimit,
    });
  }

  const attach = (user, data, model, begun) =>
    repo.attachRequest({
      p_user_id: user.id,
      p_id: data.id,
      p_request_id: data.requestId,
      p_title: data.title,
      p_kind: data.selection.kind,
      p_ids: [...new Set(data.selection.ids)],
      p_outputs: [...new Set(data.outputs)],
      p_settings: { ...(data.settings || {}), ai: { provider: model.provider, model: model.model } },
      p_generation_id: begun.generation.id,
      p_decision: begun.decision,
      p_max_attempts: MULTI_LESSON_MAX_ATTEMPTS,
    });

  return {
    async preview(user, body) {
      const data = schemas.preview.parse(body);
      return resolve(user, data.selection);
    },
    async create(user, body) {
      const data = schemas.create.parse(body);
      const resolved = await resolve(user, data.selection);
      const sources = resolved.included.map((item) => item.revisionId);
      if (!sources.length)
        throw new AppError(
          'MULTI_LESSON_NO_SOURCES',
          'Nenhuma aula da seleção tem a transcrição atual confirmada. Confira e confirme as transcrições antes.',
          409,
        );
      if (sources.length > MAX_SOURCES)
        throw new AppError(
          'MULTI_LESSON_TOO_MANY_SOURCES',
          `A seleção tem ${sources.length} aulas confirmadas; escolha no máximo ${MAX_SOURCES}.`,
          409,
        );
      if (data.expectedRevisionIds && !sameSet(sources, data.expectedRevisionIds))
        throw new AppError('MULTI_LESSON_SOURCES_CHANGED', 'As aulas da seleção mudaram. Revise a lista e confirme de novo.', 409);
      const model = multiLessonModel();
      let begun = await begin(user, data, sources, model, Boolean(data.reuse));
      let record;
      try {
        record = await attach(user, data, model, begun);
      } catch (error) {
        if (error?.code === 'MULTI_LESSON_REUSE_UNAVAILABLE') {
          // The equivalent record was deleted: start a fresh one (the old result is superseded).
          begun = await begin(user, data, sources, model, false);
          record = await attach(user, data, model, begun);
        } else {
          // Never leave a started key blocked by a request that did not register.
          if (begun.decision === 'start')
            await callGenerationRpc('fail_generation_admin', {
              p_generation_id: begun.generation.id,
              p_error_code: String(error?.code || 'MULTI_LESSON_ATTACH_FAILED').slice(0, 80),
            }).catch(() => {});
          throw error;
        }
      }
      return {
        multiLesson: record,
        generation: { id: begun.generation.id, decision: begun.decision, reuseCount: begun.generation.reuse_count },
      };
    },
    get: (user, id) => repo.getMultiLesson(user.id, uuid.parse(id)),
    list: (user) => repo.listMultiLessons(user.id, 50),
    remove: (user, id) => repo.deleteMultiLesson(user.id, uuid.parse(id)),
  };
}

export const multiLessonService = buildMultiLessonService();
