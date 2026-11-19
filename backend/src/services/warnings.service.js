import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../domain/errors.js';
import { env } from '../config/env.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { getVersion } from '../repositories/transcription.repository.js';
import {
  saveWarnings,
  getWarningAnalysis,
  requirePermission,
} from '../repositories/review.repository.js';
import { validateWarningRequest } from '../validators/review.validator.js';
import { validateWarningPayload } from '../validators/llm-output.validator.js';
import {
  buildWarningMessages,
  WARNING_PROMPT_VERSION,
  WARNING_TYPES,
} from '../prompts/warnings.v1.js';

export async function evaluateWarnings(userId, material, source, analysisId = randomUUID()) {
  const existing = await getWarningAnalysis(material.id, analysisId);
  if (existing.length) {
    if (
      existing.length !== 3 ||
      existing.some((warning) => warning.sourceRevisionId !== source.id)
    ) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'Esta tentativa de análise pertence a outra revisão.',
        409,
      );
    }
    return existing;
  }
  const llm = getAiRegistry().text('warnings');
  const warnings = await Promise.all(
    WARNING_TYPES.map(async (type) => {
      let result,
        model = llm.model;
      try {
        if (type === 'topic_alignment' && !material.subject?.trim()) {
          result = {
            state: 'insufficient',
            reason: 'Não há disciplina informada para comparar com a transcrição.',
            guidance: 'Informe a disciplina ou confira manualmente a relação com o tema.',
            segments: [],
          };
        } else if (env.mockExternalServices) {
          result = {
            state: 'insufficient',
            reason: 'Análise simulada; nenhum provedor verificou este conteúdo.',
            guidance: 'Confira a transcrição e o contexto da aula.',
            segments: [],
          };
        } else {
          ({ data: result, model } = await llm.completeJson({
            messages: buildWarningMessages(type, source, material.subject),
            maxTokens: 1200,
          }));
        }
        result = validateWarningPayload(result, source);
      } catch {
        result = {
          state: 'error',
          reason: 'A análise deste aviso não pôde ser concluída.',
          guidance: 'Confira manualmente o conteúdo ou tente a análise novamente.',
          segmentRefs: [],
        };
      }
      return {
        type,
        state: result.state,
        explanation: result.reason,
        guidance: result.guidance,
        segmentRefs: result.segmentRefs || [],
        model: env.mockExternalServices ? 'mock' : model,
        promptVersion: WARNING_PROMPT_VERSION,
        subject: material.subject || null,
      };
    }),
  );
  return saveWarnings(userId, material.id, source.id, analysisId, warnings);
}
export async function refreshWarnings(userId, materialId, input) {
  const { sourceRevisionId, idempotencyKey } = validateWarningRequest(input);
  const material = await getOwnedMaterial(userId, materialId);
  await requirePermission(userId, materialId);
  const source = await getVersion(materialId, sourceRevisionId);
  return evaluateWarnings(userId, material, source, idempotencyKey);
}

export function initialWarningAnalysisId(jobId, sourceId) {
  const hash = createHash('sha256')
    .update(jobId + ':' + sourceId + ':' + WARNING_PROMPT_VERSION)
    .digest('hex');
  return (
    hash.slice(0, 8) +
    '-' +
    hash.slice(8, 12) +
    '-4' +
    hash.slice(13, 16) +
    '-8' +
    hash.slice(17, 20) +
    '-' +
    hash.slice(20, 32)
  );
}
