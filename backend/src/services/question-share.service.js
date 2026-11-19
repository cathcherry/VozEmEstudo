import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError } from '../domain/errors.js';
import { rpc } from '../repositories/rpc.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';

const uuid = z.string().uuid();
const token = z.string().regex(/^[0-9a-f]{64}$/);
// The browser generates 256 random bits; only their SHA-256 is stored.
export const hashListToken = (value) => createHash('sha256').update(value).digest('hex');

export const validateListShare = (body) =>
  z
    .object({
      id: uuid,
      requestId: uuid,
      token,
      days: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    })
    .strict()
    .parse(body);

/** Whitelists the public worksheet: statements and options only, never keys or sources. */
export function publicWorksheet(snapshot) {
  return {
    kind: 'question_list',
    title: String(snapshot.title || 'Lista de questões'),
    materialTitle: String(snapshot.materialTitle || ''),
    subject: snapshot.subject ? String(snapshot.subject) : null,
    revision: Number(snapshot.revision) || null,
    expiresAt: snapshot.expiresAt || null,
    questions: (snapshot.questions || []).map((q, index) => ({
      number: Number(q.number) || index + 1,
      statement: String(q.statement || ''),
      options: Array.isArray(q.options) ? q.options.map(String) : [],
    })),
  };
}

function dbError(error) {
  if (!error) return;
  if (['42P01', '42703', 'PGRST205'].includes(error.code))
    throw new AppError('AUTHORING_SCHEMA_REQUIRED', 'O compartilhamento de listas ainda não foi habilitado no banco.', 503);
  throw error;
}

export function buildQuestionShareService({ db = getAdminSupabase, call = rpc, owned = getOwnedMaterial } = {}) {
  return {
    async create(userId, materialId, batchId, body) {
      const data = validateListShare(body);
      await owned(userId, uuid.parse(materialId));
      return call('create_question_list_share_admin', {
        p_user_id: userId,
        p_id: data.id,
        p_material_id: materialId,
        p_batch_id: uuid.parse(batchId),
        p_request_id: data.requestId,
        p_hash: hashListToken(data.token),
        p_days: data.days,
        p_permission_version: PERMISSION_DECLARATION.version,
      });
    },
    async list(userId, materialId, batchId) {
      await owned(userId, uuid.parse(materialId));
      const { data, error } = await db()
        .from('question_list_shares')
        .select('id,created_at,expires_at,revoked_at,expiry_days')
        .eq('user_id', userId)
        .eq('material_id', materialId)
        .eq('batch_id', uuid.parse(batchId))
        .order('created_at', { ascending: false });
      dbError(error);
      return { shares: data || [] };
    },
    async revoke(userId, materialId, batchId, shareId) {
      const { data, error } = await db()
        .from('question_list_shares')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', uuid.parse(shareId))
        .eq('user_id', userId)
        .eq('material_id', uuid.parse(materialId))
        .eq('batch_id', uuid.parse(batchId))
        .select('id')
        .maybeSingle();
      dbError(error);
      if (!data) throw new AppError('AUTHORING_NOT_FOUND', 'Link não encontrado.', 404);
      return data;
    },
    async resolve(body) {
      const value = z.object({ token }).strict().parse(body).token;
      const snapshot = await call('resolve_question_list_share_admin', { p_hash: hashListToken(value) });
      if (!snapshot) throw new AppError('SHARE_UNAVAILABLE', 'Link indisponível, expirado ou revogado.', 404);
      return publicWorksheet(snapshot);
    },
  };
}
export const questionShareService = buildQuestionShareService();
