import { env } from '../config/env.js';
import { createTextCompletion } from '../integrations/llm/groq.client.js';
import { buildSummaryMessages, SUMMARY_PROMPT_VERSION } from '../prompts/summary.v1.js';
import { createSummaryVersion } from '../repositories/summary.repository.js';

export async function generateSummary(job, source) {
  const text = await createTextCompletion({
    messages: buildSummaryMessages(source.full_text, job.params),
    maxTokens:
      job.params?.length === 'detailed' ? 3600 : job.params?.length === 'brief' ? 900 : 1800,
  });
  if (!text) throw new Error('Resumo vazio retornado pelo modelo.');
  return createSummaryVersion(job.material_id, {
    text,
    jobId: job.id,
    model: env.groqModel,
    promptVersion: SUMMARY_PROMPT_VERSION,
  });
}
