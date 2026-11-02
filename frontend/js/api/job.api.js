import { apiFetch } from './http.js';

export const getJob = (id) => apiFetch(`/api/jobs/${id}`);
export const getJobEvents = (id) => apiFetch(`/api/jobs/${id}/events`);

export async function pollJob(jobId, { intervalMs = 2500, onUpdate } = {}) {
  while (true) {
    const job = await getJob(jobId);
    await onUpdate?.(job);
    if (['CONCLUIDA', 'FALHOU', 'CANCELADA'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
