// Private classrooms (Milestone E). Every operation is one server-only database function that
// checks membership and role itself (classroom_require_admin); the account always comes from the
// authenticated request, never from the body. Nothing here is public or indexable.
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError } from '../domain/errors.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';

const uuid = z.string().uuid();
const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().max(max).optional().nullable();
// Invitation codes: 12 characters without ambiguous ones (no 0/O, 1/I/L), shown as XXXX-XXXX-XXXX.
// The browser generates them (about 60 random bits); only their SHA-256 is stored.
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE = new RegExp(`^[${INVITE_ALPHABET}]{12}$`);
export const normalizeInviteCode = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
const code = z.string().max(40).transform(normalizeInviteCode).pipe(z.string().regex(CODE));
export const hashInviteCode = (value) =>
  createHash('sha256').update(normalizeInviteCode(value)).digest('hex');

export const SUBMISSION_STATUSES = Object.freeze([
  'submitted',
  'approved_for_processing',
  'processing',
  'transcription_confirmed',
  'published',
  'rejected',
  'withdrawn',
]);

// What a member can offer the class (20261122090000_classroom_contributions.sql).
export const CONTRIBUTION_KINDS = Object.freeze(['flashcard_set', 'integrated_material']);
export const CONTRIBUTIONS_SCHEMA_REQUIRED = 'CLASSROOM_CONTRIBUTIONS_SCHEMA_REQUIRED';

const schemas = {
  create: z
    .object({
      id: uuid,
      name: text(120),
      description: optionalText(2000),
      displayName: text(80).optional(),
    })
    .strict(),
  update: z
    .object({
      name: text(120).optional(),
      description: optionalText(2000),
      archived: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0),
  invite: z
    .object({
      id: uuid,
      requestId: uuid,
      code,
      days: z.number().int().min(1).max(30),
      maxUses: z.number().int().min(1).max(500),
    })
    .strict(),
  join: z.object({ code, displayName: text(80).optional() }).strict(),
  role: z.object({ role: z.enum(['assistant', 'student']) }).strict(),
  lesson: z
    .object({
      id: uuid,
      materialId: uuid,
      revisionId: uuid,
      summaryId: uuid.optional().nullable(),
      questionBatchIds: z.array(uuid).max(10).optional(),
      title: text(200).optional(),
    })
    .strict(),
  submission: z.object({ id: uuid, materialId: uuid, note: optionalText(1000) }).strict(),
  transition: z
    .object({
      to: z.enum(SUBMISSION_STATUSES),
      requestId: uuid,
      revisionId: uuid.optional().nullable(),
      note: optionalText(1000),
    })
    .strict(),
  share: z.object({ id: uuid, setId: uuid, note: optionalText(1000) }).strict(),
  contribution: z
    .object({
      id: uuid,
      kind: z.enum(CONTRIBUTION_KINDS),
      itemId: uuid,
      note: optionalText(1000),
    })
    .strict(),
  review: z
    .object({
      decision: z.enum(['approved', 'rejected']),
      requestId: uuid,
      feedback: optionalText(1000),
    })
    .strict(),
  resource: z
    .object({
      id: uuid,
      title: text(160),
      url: z
        .string()
        .max(2048)
        .regex(/^https:\/\/\S+$/),
      description: optionalText(1000),
    })
    .strict(),
};

const failures = {
  CLASSROOM_NOT_FOUND: [404, 'Turma ou item não encontrado.'],
  CLASSROOM_FORBIDDEN: [403, 'Seu papel nesta turma não permite esta ação.'],
  CLASSROOM_ARCHIVED: [409, 'Esta turma está arquivada. Reative-a para fazer alterações.'],
  CLASSROOM_INVALID_INPUT: [400, 'Confira os dados enviados.'],
  CLASSROOM_REQUEST_CONFLICT: [409, 'Este envio já foi usado com outros dados. Atualize a página.'],
  CLASSROOM_LIMIT: [409, 'O limite desta turma foi atingido.'],
  CLASSROOM_INVITE_LIMIT: [409, 'Revogue convites antigos antes de criar novos.'],
  CLASSROOM_INVITE_INVALID: [404, 'Convite inválido, expirado ou revogado.'],
  CLASSROOM_INVITE_FULL: [409, 'Este convite já atingiu o número máximo de usos.'],
  CLASSROOM_REMOVED: [403, 'Você foi removido desta turma. Peça um novo convite ao professor.'],
  CLASSROOM_OWNER_CANNOT_LEAVE: [409, 'O professor não pode sair da própria turma; arquive-a.'],
  CLASSROOM_ALREADY_PUBLISHED: [409, 'Esta aula já está publicada nesta turma.'],
  CLASSROOM_ALREADY_SUBMITTED: [409, 'Esta gravação já foi enviada para esta turma.'],
  CLASSROOM_ALREADY_SHARED: [409, 'Este conjunto já está compartilhado nesta turma.'],
  CLASSROOM_REVISION_NOT_FOUND: [404, 'Revisão da transcrição não encontrada.'],
  CLASSROOM_CONTENT_MISMATCH: [
    409,
    'O resumo e as listas precisam ser da mesma revisão publicada desta aula.',
  ],
  CLASSROOM_ILLEGAL_TRANSITION: [409, 'Esta etapa não pode ser feita agora.'],
  CLASSROOM_PROCESSING_REQUIRED: [409, 'Processe a gravação antes desta etapa.'],
  CLASSROOM_STUDENT_CONFIRMATION_REQUIRED: [
    409,
    'O aluno precisa conferir e confirmar a transcrição antes da sua confirmação.',
  ],
  CLASSROOM_TEACHER_CONFIRMATION_REQUIRED: [409, 'Confirme a transcrição antes de publicar.'],
  TRANSCRIPTION_CONFIRMATION_REQUIRED: [
    409,
    'Confira e confirme esta revisão da transcrição antes de publicar.',
  ],
  REVISION_CONFLICT: [409, 'A transcrição mudou. Reabra o envio e confira a revisão atual.'],
  MATERIAL_NOT_FOUND: [404, 'Material não encontrado.'],
  FLASHCARD_NOT_FOUND: [404, 'Conjunto de flashcards não encontrado.'],
  MULTI_LESSON_NOT_FOUND: [404, 'Material integrado não encontrado.'],
  CLASSROOM_ITEM_NOT_READY: [409, 'Este material integrado ainda não está pronto.'],
  CLASSROOM_ITEM_UNAVAILABLE: [
    409,
    'O item não está mais disponível: o autor o arquivou, apagou ou ele deixou de estar pronto.',
  ],
  PERMISSION_REQUIRED: [
    422,
    'Confirme a declaração de permissão desta gravação antes de enviá-la.',
  ],
  POLICY_VERSION_MISMATCH: [503, 'A declaração de permissão precisa ser atualizada no servidor.'],
};

/** Calls one classroom database function and maps its errors to scoped HTTP answers. */
export function createClassroomCaller(db = getAdminSupabase) {
  return async function call(name, params, { schema = 'classrooms' } = {}) {
    const { data, error, status } = await db().rpc(name, params);
    if (!error) return data;
    const failure = failures[error.message];
    if (failure) throw new AppError(error.message, failure[1], failure[0]);
    if (['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(error.code))
      throw schema === 'contributions'
        ? new AppError(
            CONTRIBUTIONS_SCHEMA_REQUIRED,
            'Contribuições e materiais integrados nas turmas ainda não foram habilitados no banco.',
            503,
          )
        : new AppError(
            'CLASSROOMS_SCHEMA_REQUIRED',
            'As turmas ainda não foram habilitadas no banco.',
            503,
          );
    if (error.code === '22P02')
      throw new AppError('CLASSROOM_INVALID_INPUT', failures.CLASSROOM_INVALID_INPUT[1], 400);
    if (status === 0 || status >= 500 || error.code?.startsWith('08'))
      throw new AppError(
        'DATABASE_TEMPORARY_ERROR',
        'O banco está temporariamente indisponível. Tente novamente.',
        503,
        { retryable: true },
      );
    throw error;
  };
}

/** The name shown to the class: chosen in the form, else the profile name, else a neutral one. */
export function memberName(user, chosen) {
  const meta = user?.user_metadata || {};
  const name = String(chosen || meta.display_name || meta.full_name || meta.name || '').trim();
  return (name || 'Participante').slice(0, 80);
}

export function buildClassroomService(call = createClassroomCaller()) {
  const id = (value) => uuid.parse(value);
  const contributions = { schema: 'contributions' };
  function contribute(user, classId, body) {
    const data = schemas.contribution.parse(body);
    return call(
      'classroom_contribute_admin',
      {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_id: data.id,
        p_kind: data.kind,
        p_item_id: data.itemId,
        p_note: data.note ?? null,
      },
      contributions,
    );
  }
  return {
    list: (user) => call('classroom_list_mine_admin', { p_user_id: user.id }),
    create(user, body) {
      const data = schemas.create.parse(body);
      return call('classroom_create_admin', {
        p_user_id: user.id,
        p_id: data.id,
        p_name: data.name,
        p_description: data.description ?? null,
        p_display_name: memberName(user, data.displayName),
      });
    },
    get: (user, classId) =>
      call('classroom_get_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    update(user, classId, body) {
      const data = schemas.update.parse(body);
      return call('classroom_update_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_name: data.name ?? null,
        p_description: data.description === undefined ? null : (data.description ?? ''),
        p_status: data.archived === undefined ? null : data.archived ? 'archived' : 'active',
      });
    },
    members: (user, classId) =>
      call('classroom_list_members_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    leave: (user, classId) =>
      call('classroom_leave_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    removeMember: (user, classId, memberId) =>
      call('classroom_remove_member_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_member_id: id(memberId),
      }),
    setRole(user, classId, memberId, body) {
      const { role } = schemas.role.parse(body);
      return call('classroom_set_member_role_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_member_id: id(memberId),
        p_role: role,
      });
    },
    invites: (user, classId) =>
      call('classroom_list_invites_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    createInvite(user, classId, body) {
      const data = schemas.invite.parse(body);
      return call('classroom_create_invite_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_id: data.id,
        p_request_id: data.requestId,
        p_hash: hashInviteCode(data.code),
        p_days: data.days,
        p_max_uses: data.maxUses,
      });
    },
    revokeInvite: (user, classId, inviteId) =>
      call('classroom_revoke_invite_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_invite_id: id(inviteId),
      }),
    join(user, body) {
      const data = schemas.join.parse(body);
      return call('classroom_join_admin', {
        p_user_id: user.id,
        p_hash: hashInviteCode(data.code),
        p_display_name: memberName(user, data.displayName),
      });
    },
    lessons: (user, classId) =>
      call('classroom_list_lessons_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    lesson: (user, classId, lessonId) =>
      call('classroom_get_lesson_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_lesson_id: id(lessonId),
      }),
    publish(user, classId, body) {
      const data = schemas.lesson.parse(body);
      return call('classroom_publish_lesson_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_id: data.id,
        p_body: {
          materialId: data.materialId,
          revisionId: data.revisionId,
          summaryId: data.summaryId ?? null,
          questionBatchIds: data.questionBatchIds ?? [],
          ...(data.title ? { title: data.title } : {}),
        },
      });
    },
    unpublish: (user, classId, lessonId) =>
      call('classroom_unpublish_lesson_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_lesson_id: id(lessonId),
      }),
    submissions: (user, classId) =>
      call('classroom_list_submissions_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    submission: (user, classId, submissionId) =>
      call('classroom_get_submission_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_submission_id: id(submissionId),
      }),
    submit(user, classId, body) {
      const data = schemas.submission.parse(body);
      return call('classroom_submit_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_id: data.id,
        p_material_id: data.materialId,
        p_note: data.note ?? null,
        p_permission_version: PERMISSION_DECLARATION.version,
      });
    },
    transition(user, classId, submissionId, body) {
      const data = schemas.transition.parse(body);
      return call('classroom_transition_submission_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_submission_id: id(submissionId),
        p_to_status: data.to,
        p_request_id: data.requestId,
        p_revision_id: data.revisionId ?? null,
        p_note: data.note ?? null,
      });
    },
    sharedSets: (user, classId) =>
      call('classroom_list_shared_flashcard_sets_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
      }),
    sharedSet: (user, classId, sharedId) =>
      call('classroom_get_shared_flashcard_set_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_shared_id: id(sharedId),
      }),
    // With the contributions migration a student's set waits for review (staff share at once);
    // without it, the original direct sharing keeps working.
    async shareSet(user, classId, body) {
      const data = schemas.share.parse(body);
      try {
        return await contribute(user, classId, {
          id: data.id,
          kind: 'flashcard_set',
          itemId: data.setId,
          note: data.note,
        });
      } catch (error) {
        if (error.code !== CONTRIBUTIONS_SCHEMA_REQUIRED) throw error;
      }
      return call('classroom_share_item_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_id: data.id,
        p_kind: 'flashcard_set',
        p_item_id: data.setId,
      });
    },
    contributions: (user, classId) =>
      call(
        'classroom_list_contributions_admin',
        { p_user_id: user.id, p_classroom_id: id(classId) },
        contributions,
      ),
    contribute: (user, classId, body) => contribute(user, classId, body),
    contribution: (user, classId, contributionId) =>
      call(
        'classroom_get_contribution_admin',
        { p_user_id: user.id, p_classroom_id: id(classId), p_contribution_id: id(contributionId) },
        contributions,
      ),
    reviewContribution(user, classId, contributionId, body) {
      const data = schemas.review.parse(body);
      return call(
        'classroom_review_contribution_admin',
        {
          p_user_id: user.id,
          p_classroom_id: id(classId),
          p_contribution_id: id(contributionId),
          p_decision: data.decision,
          p_request_id: data.requestId,
          p_feedback: data.feedback ?? null,
        },
        contributions,
      );
    },
    endContribution: (user, classId, contributionId) =>
      call(
        'classroom_end_contribution_admin',
        { p_user_id: user.id, p_classroom_id: id(classId), p_contribution_id: id(contributionId) },
        contributions,
      ),
    integratedMaterials: (user, classId) =>
      call(
        'classroom_list_integrated_materials_admin',
        { p_user_id: user.id, p_classroom_id: id(classId) },
        contributions,
      ),
    integratedMaterial: (user, classId, contributionId) =>
      call(
        'classroom_get_integrated_material_admin',
        { p_user_id: user.id, p_classroom_id: id(classId), p_contribution_id: id(contributionId) },
        contributions,
      ),
    revokeShared: (user, classId, sharedId) =>
      call('classroom_revoke_shared_item_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_shared_id: id(sharedId),
      }),
    resources: (user, classId) =>
      call('classroom_list_resources_admin', { p_user_id: user.id, p_classroom_id: id(classId) }),
    addResource(user, classId, body) {
      const data = schemas.resource.parse(body);
      return call('classroom_add_resource_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_id: data.id,
        p_title: data.title,
        p_url: data.url,
        p_description: data.description ?? null,
      });
    },
    removeResource: (user, classId, resourceId) =>
      call('classroom_remove_resource_admin', {
        p_user_id: user.id,
        p_classroom_id: id(classId),
        p_resource_id: id(resourceId),
      }),
  };
}

export const classroomService = buildClassroomService();
