import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getMaterial } from '../api/material.api.js';
import { pollJob } from '../api/job.api.js';
import { isQuotaError, limitsLink } from '../utils/public-testing.js';
await initAuthenticatedShell();
const params = new URLSearchParams(location.search),
  id = params.get('id'),
  jobId = params.get('job');
const $ = (selector) => document.querySelector(selector);
const screen = $('.processing-status');
let started = Date.now(),
  timer;

const STEP_STATE_LABELS = {
  active: ' — em andamento',
  done: ' — concluído',
  error: ' — não concluído',
};
const STEP_ORDER = ['upload', 'queue', 'transcribe', 'ready'];

/** Shows one real backend state: no percentages, only the stage the job reports. */
function show({ state, step, title, detail = '' }) {
  screen.dataset.processingState = state;
  // The title is a live region polled every few seconds: write only on change, so screen
  // readers announce real progress once instead of repeating the same sentence.
  if ($('[data-wait-status]').textContent !== title) $('[data-wait-status]').textContent = title;
  if ($('[data-wait-detail]').textContent !== detail) $('[data-wait-detail]').textContent = detail;
  $('[data-wait-detail]').hidden = !detail;
  const reached = STEP_ORDER.indexOf(step);
  for (const item of document.querySelectorAll('[data-processing-step]')) {
    const index = STEP_ORDER.indexOf(item.dataset.processingStep);
    const value =
      index < reached || (state === 'ready' && index === reached)
        ? 'done'
        : index === reached
          ? state === 'error'
            ? 'error'
            : 'active'
          : '';
    if (value) item.dataset.state = value;
    else delete item.dataset.state;
    if (value === 'active') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.querySelector('[data-step-state]').textContent = STEP_STATE_LABELS[value] || '';
  }
  const finished = state === 'ready' || state === 'error';
  $('[data-wait-spinner]').hidden = finished;
  $('[data-wait-leave]').hidden = finished;
  $('[data-wait-error-actions]').hidden = state !== 'error';
  if (finished) clearInterval(timer);
}

const RUNNING_TITLES = {
  VALIDACAO: 'Preparando o áudio…',
  TRANSCRICAO: 'Transcrevendo o áudio…',
  FINALIZACAO: 'Finalizando a transcrição…',
};
function update(job) {
  if (job.created_at) started = new Date(job.created_at).getTime();
  if (job.status === 'PENDENTE')
    show({ state: 'queued', step: 'queue', title: 'Na fila para transcrição' });
  // AGUARDANDO_REPETICAO has two meanings. With an error code it is a real retry after a
  // temporary failure. Without one, the audio is with the transcription service and the job is
  // only waiting to check again: that is normal progress, not a failure.
  else if (job.status === 'AGUARDANDO_REPETICAO' && job.error_code)
    show({
      state: 'running',
      step: 'transcribe',
      title: 'Aguardando nova tentativa',
      detail: `Houve uma falha temporária. Uma nova tentativa automática já está agendada (tentativa ${Math.min(
        (job.attempt_count || 0) + 1,
        job.max_attempts || 3,
      )} de ${job.max_attempts || 3}).`,
    });
  else if (job.status === 'AGUARDANDO_REPETICAO')
    show({
      state: 'running',
      step: 'transcribe',
      title: 'Transcrevendo o áudio…',
      detail: 'O áudio está com o serviço de transcrição. Esta página atualiza sozinha.',
    });
  else if (job.status === 'EM_EXECUCAO')
    show({
      state: 'running',
      step: 'transcribe',
      title: RUNNING_TITLES[job.current_stage] || 'Transcrevendo o áudio…',
    });
}
function failed(error) {
  const reached = document.querySelector('[data-processing-step][data-state="active"]');
  show({
    state: 'error',
    step: reached?.dataset.processingStep || 'transcribe',
    title: 'A transcrição não foi concluída',
    detail: error.message || 'Não foi possível concluir a transcrição.',
  });
  $('[data-wait-elapsed]').textContent = '';
  // Public testing: a transcription refused for the participant's limit links to the account.
  if (isQuotaError(error) && !$('[data-wait-error-actions] .testing-limits-link')) {
    const link = limitsLink();
    link.classList.add('text-action');
    $('[data-wait-error-actions]').append(link);
  }
  $('[data-wait-retry]').focus({ preventScroll: true });
}
$('[data-wait-retry]').addEventListener('click', () => location.reload());
async function run() {
  if (!id) {
    location.replace('./historico.html');
    return;
  }
  $('[data-wait-material]').href = `./material.html?id=${encodeURIComponent(id)}`;
  timer = setInterval(() => {
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000)),
      minutes = Math.floor(seconds / 60);
    $('[data-wait-elapsed]').textContent = minutes
      ? `Iniciado há ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
      : 'Iniciado há poucos segundos';
  }, 1000);
  if (jobId) {
    const result = await pollJob(jobId, { onUpdate: update });
    if (result.status !== 'CONCLUIDA')
      throw Object.assign(
        Error(
          result.status === 'CANCELADA'
            ? 'A transcrição foi cancelada.'
            : result.error_message || 'A transcrição não foi concluída.',
        ),
        { code: result.error_code || undefined },
      );
  }
  const material = await getMaterial(id);
  if (!material.transcription)
    throw Error('A transcrição ainda não está disponível. Tente novamente.');
  show({ state: 'ready', step: 'ready', title: 'Transcrição pronta', detail: 'Abrindo a aula…' });
  location.replace(`./material.html?id=${encodeURIComponent(id)}&from=upload`);
}
run().catch(failed);
window.addEventListener('pagehide', () => clearInterval(timer));
