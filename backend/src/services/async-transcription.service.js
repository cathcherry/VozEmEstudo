import { AppError } from '../domain/errors.js';
import { assertTranscriptionResult } from '../ai/contracts/transcription.js';

export const SUBMIT_LIMIT = 3;
const iso = (ms) => new Date(ms).toISOString();

function failure(code, message) {
  return new AppError(code, message, 502, { retryable: false });
}

/**
 * Advances one external transcription by at most a few short steps and returns either
 * { status: 'waiting', delayMs } (the worker releases the job and polls later) or
 * { status: 'completed' }. State lives in the execution row, so a restarted or duplicate worker
 * resumes from the last durable step instead of resubmitting.
 */
export function createAsyncTranscriptionRunner({ store, persist, now = () => Date.now() }) {
  return async function advance(
    execution,
    provider,
    { loadAudio, durationMs = 0, pollIntervalMs = 15000, maxWaitMs = 3 * 60 * 60 * 1000 },
  ) {
    let current = execution;
    async function move(from, patch) {
      const next = await store.transition(current.id, from, patch);
      // null: another worker already advanced this execution; continue from its durable state.
      current = next || (await store.get(current.job_id));
      return Boolean(next);
    }
    async function fail(code, message) {
      await store.transition(current.id, current.state, { state: 'failed', error_code: code });
      throw failure(code, message);
    }

    for (let step = 0; step < 6; step += 1) {
      switch (current.state) {
        case 'completed':
          return { status: 'completed' };
        case 'failed':
          throw failure(current.error_code || 'ASR_FAILED', 'A transcrição externa falhou.');
        case 'pending': {
          // Uploading is not billed transcription; repeating it after a crash is harmless.
          const uploadRef = await provider.upload(await loadAudio());
          await move('pending', { state: 'uploaded', upload_ref: uploadRef });
          break;
        }
        case 'uploaded': {
          if (current.submit_count >= SUBMIT_LIMIT)
            return fail('ASR_SUBMIT_LIMIT', 'O provedor de transcrição não aceitou o envio.');
          // Persist the intent first: if the connection drops after the provider accepted the
          // request, the next run finds 'submitting' and looks the transcript up instead.
          if (
            !(await move('uploaded', {
              state: 'submitting',
              submit_count: current.submit_count + 1,
            }))
          )
            break;
          let externalJobId;
          try {
            externalJobId = await provider.submit(current.upload_ref, {
              model: current.requested_model,
              settings: current.settings || {},
            });
          } catch (error) {
            if (!error.retryable)
              await store.transition(current.id, 'submitting', {
                state: 'failed',
                error_code: error.code || 'ASR_FAILED',
              });
            throw error;
          }
          await move('submitting', {
            state: 'processing',
            external_job_id: externalJobId,
            submitted_at: iso(now()),
            deadline_at: iso(now() + maxWaitMs),
          });
          return { status: 'waiting', delayMs: pollIntervalMs };
        }
        case 'submitting': {
          const found = await provider.findSubmission(current.upload_ref);
          if (found)
            await move('submitting', {
              state: 'processing',
              external_job_id: found,
              submitted_at: iso(now()),
              deadline_at: iso(now() + maxWaitMs),
            });
          else await move('submitting', { state: 'uploaded' });
          break;
        }
        case 'processing': {
          if (current.deadline_at && Date.parse(current.deadline_at) < now())
            return fail('ASR_TIMEOUT', 'A transcrição excedeu o tempo máximo de espera.');
          const outcome = await provider.poll(current.external_job_id, {
            model: current.requested_model,
            durationMs,
          });
          if (outcome.state === 'processing') {
            await store.transition(current.id, 'processing', {
              poll_count: current.poll_count + 1,
            });
            return { status: 'waiting', delayMs: pollIntervalMs };
          }
          if (outcome.state === 'failed')
            return fail(
              outcome.code || 'ASR_FAILED',
              'O provedor não conseguiu transcrever o áudio.',
            );
          const result = assertTranscriptionResult(outcome.result);
          if (!result.text.trim())
            return fail('ASR_EMPTY_RESULT', 'O provedor retornou uma transcrição vazia.');
          // Idempotent: a repeated completion returns the stored transcription without duplicates.
          await persist(result);
          await move('processing', {
            state: 'completed',
            actual_model: result.metadata.actualModel,
            poll_count: current.poll_count + 1,
          });
          return { status: 'completed' };
        }
        default:
          throw new Error('Estado de execução desconhecido.');
      }
    }
    throw new Error('A execução de IA não avançou.');
  };
}
