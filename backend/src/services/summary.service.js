import { getAiRegistry } from '../ai/provider-registry.js';
import { buildSummaryMessages, SUMMARY_PROMPT_VERSION } from '../prompts/summary.v1.js';
import { createSummaryVersion } from '../repositories/summary.repository.js';
import { validateSummaryOptions } from '../validators/summary-options.validator.js';

export async function generateSummary(job, source) {
  const options = validateSummaryOptions(job.params?.summaryOptions);
  const llm = getAiRegistry().text('summary', job.aiSnapshot || undefined);
  const { text, model } = await llm.completeText({
    messages: buildSummaryMessages(source.full_text, options),
    maxTokens: { short: 900, standard: 1800, detailed: 3500 }[options.length],
  });
  if (!text) throw new Error('Resumo vazio retornado pelo modelo.');
  return createSummaryVersion(job.material_id, {
    text,
    jobId: job.id,
    model,
    promptVersion: SUMMARY_PROMPT_VERSION,
  });
}
