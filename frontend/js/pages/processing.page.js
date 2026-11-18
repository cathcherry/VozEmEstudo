import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getMaterial } from '../api/material.api.js';
import { pollJob } from '../api/job.api.js';
await initAuthenticatedShell();
const params = new URLSearchParams(location.search),
  id = params.get('id'),
  jobId = params.get('job');
const $ = (selector) => document.querySelector(selector);
let started = Date.now(),
  timer;
const tips = [
  'Organize suas aulas por disciplina e tags.',
  'Personalize o formato e a extensão dos seus resumos.',
  'Pratique o conteúdo da aula com questões.',
];
function update(job) {
  if (job.created_at) started = new Date(job.created_at).getTime();
  $('[data-wait-status]').textContent =
    {
      TRANSCRICAO: 'Transcrevendo o áudio…',
      FINALIZACAO: 'Finalizando a transcrição…',
      VALIDACAO: 'Preparando o áudio…',
    }[job.current_stage] || 'Na fila…';
}
function failed(error) {
  $('[data-wait-spinner]').hidden = true;
  $('[data-wait-status]').textContent = error.message || 'Não foi possível concluir a transcrição.';
  $('[data-wait-retry]').hidden = false;
}
$('[data-wait-retry]').addEventListener('click', () => location.reload());
async function run() {
  if (!id) {
    location.replace('./historico.html');
    return;
  }
  timer = setInterval(() => {
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000)),
      minutes = Math.floor(seconds / 60);
    $('[data-wait-elapsed]').textContent = minutes
      ? `Iniciado há ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
      : 'Iniciado há poucos segundos';
    $('[data-wait-tip]').textContent = tips[Math.floor(seconds / 12) % tips.length];
  }, 1000);
  if (jobId) {
    const result = await pollJob(jobId, { onUpdate: update });
    if (result.status !== 'CONCLUIDA')
      throw Error(result.error_message || 'A transcrição não foi concluída.');
  }
  const material = await getMaterial(id);
  if (material.transcription)
    location.replace(`./material.html?id=${encodeURIComponent(id)}&from=upload`);
  else throw Error('A transcrição ainda não está disponível. Tente novamente.');
}
run().catch(failed);
window.addEventListener('pagehide', () => clearInterval(timer));
