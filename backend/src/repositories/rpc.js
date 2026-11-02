import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { AppError } from '../domain/errors.js';

const failures = {
  MATERIAL_NOT_FOUND: [404, 'Material não encontrado.'],
  TRANSCRIPTION_NOT_FOUND: [404, 'Transcrição não encontrada.'],
  REVISION_NOT_FOUND: [404, 'Revisão não encontrada.'],
  REVISION_CONFLICT: [409, 'A revisão atual mudou. Reabra a transcrição e confira a nova revisão.'],
  SEGMENT_NOT_FOUND: [404, 'Trecho não encontrado.'],
  PERMISSION_REQUIRED: [
    422,
    'Confirme a declaração de permissão vigente antes de processar a gravação.',
  ],
  POLICY_VERSION_MISMATCH: [
    503,
    'A configuração da declaração precisa ser atualizada antes de processar.',
  ],
  TRANSCRIPTION_CONFIRMATION_REQUIRED: [
    409,
    'Confira e confirme esta revisão da transcrição antes de gerar materiais.',
  ],
  SOURCE_REVISION_REQUIRED: [409, 'Selecione a revisão confirmada que será usada na geração.'],
  SOURCE_REVISION_MISMATCH: [409, 'A fonte da tarefa não corresponde à revisão confirmada.'],
  IDEMPOTENCY_CONFLICT: [409, 'Esta operação já foi registrada com escolhas diferentes.'],
  MATERIAL_ALREADY_PROCESSED: [
    409,
    'Esta aula já foi transcrita. Abra a transcrição para conferir.',
  ],
  INVALID_JOB_TYPE: [400, 'Tipo de tarefa inválido.'],
  INVALID_GENERATION: [502, 'A geração não atende ao contrato esperado.'],
  IMMUTABLE_REVISION: [409, 'Uma revisão histórica não pode ser alterada.'],
};
export async function rpc(name, parameters) {
  const { data, error, status } = await getAdminSupabase().rpc(name, parameters);
  if (error) {
    const failure = failures[error.message];
    if (failure) throw new AppError(error.message, failure[1], failure[0]);
    if (['PGRST202', '42883', '42P01', '42703'].includes(error.code)) {
      throw new AppError(
        'SCHEMA_UPGRADE_REQUIRED',
        'Esta versão requer a migration E02 em ambiente autorizado. Nenhum processamento foi iniciado.',
        503,
      );
    }
    if (
      status === 0 ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      ['40001', '40003', '40P01', '55P03', '57014', '53300', '57P01'].includes(error.code) ||
      error.code?.startsWith('08')
    ) {
      throw new AppError(
        'DATABASE_TEMPORARY_ERROR',
        'O banco está temporariamente indisponível. Tente novamente.',
        503,
        { retryable: true },
      );
    }
    throw error;
  }
  return data;
}
