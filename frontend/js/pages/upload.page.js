import { getPublicConfig } from '../api/config.js';
import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { createMaterialWithUpload, processMaterial } from '../api/material.api.js';
import { MEDIA_EXTENSIONS, mediaExtension, inspectMedia, convertMedia } from '../api/media.api.js';
import { tagInput } from '../utils/tag-input.js';
import { saveTags } from '../utils/study-store.js';
import { MediaPlayer, timeLabel } from '../utils/media-player.js';
import { retainOriginalVideo } from '../api/playback.api.js';
import { describeProcessing } from '../utils/processing-disclosure.js';

await initAuthenticatedShell();
const form = document.querySelector('.transcription-form'),
  fileInput = document.querySelector('#audio-file');
const fileMessage = document.querySelector('[data-file-message]'),
  status = document.querySelector('[data-transcription-status]');
const nextButton = document.querySelector('[data-wizard-next]'),
  downloadButton = document.querySelector('[data-download-clip]');
const editor = document.querySelector('[data-upload-editor]'),
  dropzone = document.querySelector('[data-dropzone]');
let step = 1,
  busy = false,
  exporting = false,
  createdMaterial = null,
  sourceFile = null,
  info = null,
  objectUrl = '',
  analysisController,
  generation = 0;
const permissionInput = document.querySelector('#permission-declaration');
const reviewPanel = document.querySelector('[data-upload-review]');
const tags = tagInput(document.querySelector('#upload-tags'));
let preparationTimer;
function shortName(name) {
  return name.length > 55 ? name.slice(0, 32) + '…' + name.slice(-19) : name;
}
function durationLabel(seconds) {
  if (seconds > 0 && seconds < 1) return 'Menos de 1 segundo';
  const total = Math.floor(seconds),
    minutes = Math.floor(total / 60),
    rest = total % 60;
  return (
    [
      minutes ? `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}` : '',
      rest ? `${rest} ${rest === 1 ? 'segundo' : 'segundos'}` : '',
    ]
      .filter(Boolean)
      .join(' e ') || '0 segundos'
  );
}
function sizeLabel(bytes) {
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}
const STEP_STATE_LABELS = { active: ' — em andamento', done: ' — concluído', error: ' — não concluído' };
/** Marks one real client-side upload step; earlier visible steps become complete. */
function progress(text, stepName) {
  document.querySelector('[data-upload-progress-title]').textContent = text;
  setStatus(status, '');
  if (!stepName) return;
  let reached = false;
  for (const item of document.querySelectorAll('[data-upload-step]')) {
    const current = item.dataset.uploadStep === stepName;
    const state = current ? 'active' : reached || item.hidden ? '' : 'done';
    if (current) reached = true;
    setStepState(item, state);
  }
}
function setStepState(item, state) {
  if (state) item.dataset.state = state;
  else delete item.dataset.state;
  if (state === 'active') item.setAttribute('aria-current', 'step');
  else item.removeAttribute('aria-current');
  item.querySelector('[data-step-state]').textContent = STEP_STATE_LABELS[state] || '';
}
function resetProgress() {
  document.querySelectorAll('[data-upload-step]').forEach((item) => setStepState(item, ''));
  document.querySelector('.upload-progress .loading-indicator').hidden = false;
  document.querySelector('[data-upload-progress]').dataset.state = 'busy';
  document.querySelector('[data-upload-progress-title]').textContent = 'Preparando o áudio…';
  document.querySelector('[data-upload-progress-note]').textContent =
    'Mantenha esta página aberta até o envio terminar.';
}
function fileDetails() {
  if (!sourceFile) return '';
  const parts = [mediaExtension(sourceFile).toUpperCase(), sizeLabel(sourceFile.size)];
  if (info) parts.push(timeLabel(info.durationMs / 1000));
  return parts.join(' · ');
}
function setFileState(state) {
  editor.dataset.state = state;
  const details = document.querySelector('[data-file-details]');
  details.textContent = fileDetails();
  if (state === 'loading') {
    const note = document.createElement('span');
    note.className = 'file-analysis';
    note.textContent = 'analisando…';
    details.append(' · ', note);
  }
}
const VIDEO_NOTES = Object.freeze({
  available: 'O arquivo inteiro, incluindo as partes fora do trecho. Não é enviado à IA.',
  format: 'Disponível somente para arquivos MP4.',
  disabled:
    'Indisponível no momento: o armazenamento de vídeos ainda não foi ativado neste servidor.',
});
/** Video retention is shown for every video and explains itself when it cannot be offered. */
function videoRetentionAvailability() {
  if (!info?.hasVideo || !sourceFile) return 'none';
  if (mediaExtension(sourceFile) !== 'mp4') return 'format';
  return videoRetentionEnabled ? 'available' : 'disabled';
}
function updateVideoRetentionChoice() {
  const availability = videoRetentionAvailability(),
    choice = document.querySelector('[data-video-retention-choice]'),
    input = document.querySelector('#keep-original-video');
  choice.hidden = availability === 'none';
  input.disabled = availability !== 'available';
  if (input.disabled) input.checked = false;
  choice.classList.toggle('is-unavailable', availability !== 'available');
  document.querySelector('[data-video-retention-note]').textContent =
    VIDEO_NOTES[availability] || VIDEO_NOTES.available;
}
document.querySelector('[data-change-file]').addEventListener('click', () => fileInput.click());
document.querySelector('[data-edit-upload]').addEventListener('click', () => {
  reviewPanel.hidden = true;
  document.querySelector('[data-identification-fields]').hidden = false;
  document.querySelector('[data-identification-actions]').hidden = false;
});
let declaration, reviewedChoices;
let videoRetentionEnabled = false;
try {
  const config = await getPublicConfig();
  declaration = config.permissionDeclaration;
  videoRetentionEnabled = config.featureFlags?.mp4_retention === true;
  if (config.processingDisclosure)
    document.querySelector('[data-provider-disclosure]').textContent = describeProcessing(
      config.processingDisclosure,
    );
} catch {
  /* Keep upload blocked when configuration is unavailable. */
}
if (declaration?.text)
  document.querySelector('[data-permission-label]').textContent = declaration.text;
const player = new MediaPlayer(document.querySelector('[data-upload-player]'), {
  trim: true,
  onRangeChange: updateRange,
});
// Export sits with the other trim actions so the selected file reads as one component.
player.root.querySelector('.trim-fields').append(downloadButton);

function setStep(next, moveFocus = true) {
  player.media.pause();
  step = next;
  document.querySelectorAll('[data-wizard-panel]').forEach((panel) => {
    const active = Number(panel.dataset.wizardPanel) === step;
    panel.hidden = !active;
    panel.disabled = !active;
  });
  document.querySelectorAll('[data-workflow-step]').forEach((item) => {
    const number = Number(item.dataset.workflowStep);
    item.classList.toggle('current', number === step);
    item.classList.toggle('completed', number < step);
    if (number === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.querySelector('.step-number').textContent = number < step ? '✓' : number;
  });
  if (moveFocus) {
    const target =
      step === 2
        ? document.querySelector('#class-title')
        : step === 1
          ? sourceFile && !editor.hidden
            ? document.querySelector('[data-change-file]')
            : fileInput
          : document.querySelector('[data-wizard-panel="3"] legend');
    if (target.tagName === 'LEGEND') target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}
function updateRange() {
  const range = player.getRange();
  if (
    reviewedChoices &&
    (range.start !== reviewedChoices.range.start || range.end !== reviewedChoices.range.end)
  ) {
    reviewedChoices = null;
    reviewPanel.hidden = true;
    document.querySelector('[data-review-upload]').hidden = false;
  }
  const ready = info && range.end > range.start;
  nextButton.disabled = !ready || range.end - range.start > (info?.maxTranscriptionSeconds || 3276);
  downloadButton.disabled = !ready || exporting;
  document.querySelector('[data-selected-range]').textContent = ready
    ? `Trecho ${timeLabel(range.start)} – ${timeLabel(range.end)} · ${durationLabel(range.end - range.start)}`
    : '';
  if (ready && nextButton.disabled)
    setStatus(
      fileMessage,
      'Escolha um trecho de até 54 minutos para transcrever. Você ainda pode exportar um recorte maior.',
      'error',
    );
  else if (ready) setStatus(fileMessage, '', 'success');
}
async function chooseFile() {
  const token = ++generation;
  analysisController?.abort();
  info = null;
  document.querySelector('#keep-original-video').checked = false;
  updateVideoRetentionChoice();
  createdMaterial = null;
  reviewedChoices = null;
  reviewPanel.hidden = true;
  permissionInput.checked = false;
  nextButton.disabled = true;
  downloadButton.disabled = true;
  editor.hidden = true;
  player.media.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = '';
  sourceFile = fileInput.files?.[0] || null;
  fileInput.setCustomValidity('');
  dropzone.hidden = false;
  delete dropzone.dataset.state;
  document.querySelector('[data-selected-file]').textContent = shortName(sourceFile?.name || '');
  document.querySelector('[data-selected-file]').title = sourceFile?.name || '';
  document.querySelector('[data-file-name]').textContent = shortName(sourceFile?.name || '');
  document.querySelector('[data-file-name]').title = sourceFile?.name || '';
  document.querySelector('[data-selected-range]').textContent = '';
  if (!sourceFile) {
    setStatus(fileMessage, '');
    return;
  }
  const validType = MEDIA_EXTENSIONS.includes(mediaExtension(sourceFile));
  const validSize = sourceFile.size > 0 && sourceFile.size <= 100 * 1024 * 1024;
  if (!validType || !validSize) {
    const message = !validType
      ? 'Use MP4, MP3, WAV, M4A, AAC, OGG, FLAC, WebM ou MOV.'
      : 'Escolha um arquivo com conteúdo e até 100 MB.';
    fileInput.setCustomValidity(message);
    dropzone.dataset.state = 'error';
    setStatus(fileMessage, `${shortName(sourceFile.name)}: ${message}`, 'error');
    return;
  }
  const focusWasInDropzone = dropzone.contains(document.activeElement);
  dropzone.hidden = true;
  editor.hidden = false;
  objectUrl = URL.createObjectURL(sourceFile);
  const video = ['mp4', 'webm', 'mov'].includes(mediaExtension(sourceFile));
  editor.dataset.kind = video ? 'video' : 'audio';
  setFileState('loading');
  // Keep keyboard users in the component once the drop surface is replaced by the file view.
  if (focusWasInDropzone) document.querySelector('[data-change-file]').focus({ preventScroll: true });
  player.setSource({
    src: objectUrl,
    title: sourceFile.name,
    video,
    format: mediaExtension(sourceFile),
  });
  clearTimeout(preparationTimer);
  preparationTimer = setTimeout(() => {
    if (token === generation && !info) setStatus(fileMessage, 'Preparando prévia…');
  }, 1200);
  analysisController = new AbortController();
  try {
    const result = await inspectMedia(sourceFile, analysisController.signal);
    if (token !== generation) return;
    clearTimeout(preparationTimer);
    info = result;
    editor.dataset.kind = result.hasVideo ? 'video' : 'audio';
    setFileState('ready');
    updateVideoRetentionChoice();
    player.setSource({
      src: objectUrl,
      title: sourceFile.name,
      video: result.hasVideo,
      duration: result.durationMs / 1000,
      peaks: result.peaks,
      format: mediaExtension(sourceFile),
    });
    updateRange();
  } catch (error) {
    if (token !== generation || error.name === 'AbortError') return;
    clearTimeout(preparationTimer);
    setFileState('error');
    setStatus(fileMessage, error.message || 'Não foi possível preparar a gravação.', 'error');
    const retry = document.createElement('button');
    retry.className = 'text-action';
    retry.type = 'button';
    retry.textContent = 'Tentar novamente';
    retry.addEventListener('click', chooseFile);
    fileMessage.append(' ', retry);
  }
}
fileInput.addEventListener('change', chooseFile);
nextButton.addEventListener('click', () => {
  if (!nextButton.disabled && info) {
    updateRange();
    if (!nextButton.disabled) {
      setStatus(status, '');
      setStep(2);
    }
  }
});
document.querySelectorAll('[data-wizard-back]').forEach((button) =>
  button.addEventListener('click', () => {
    if (!busy) {
      reviewedChoices = null;
      reviewPanel.hidden = true;
      document.querySelector('[data-review-upload]').hidden = false;
      setStatus(status, '');
      setStep(1);
    }
  }),
);
for (const name of ['dragenter', 'dragover'])
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
dropzone.addEventListener('dragleave', (event) => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging');
});
// The whole surface opens the file picker; the native input stays the keyboard target.
dropzone.addEventListener('click', (event) => {
  if (!busy && !event.target.closest('label, input')) fileInput.click();
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
  if (busy || !event.dataTransfer?.files?.length) return;
  const data = new DataTransfer();
  data.items.add(event.dataTransfer.files[0]);
  fileInput.files = data.files;
  chooseFile();
});
downloadButton.addEventListener('click', async () => {
  if (!info || !sourceFile || exporting) return;
  exporting = true;
  downloadButton.disabled = true;
  downloadButton.querySelector('.download-label').textContent = 'Preparando…';
  player.media.pause();
  const file = sourceFile,
    range = player.getRange(),
    selectedGeneration = generation;
  try {
    const clip = await convertMedia(file, range, info.hasVideo ? 'mp4' : 'mp3');
    if (selectedGeneration !== generation) return;
    const url = URL.createObjectURL(clip.file),
      link = document.createElement('a');
    link.href = url;
    link.download = clip.file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(fileMessage, 'Recorte pronto para download.', 'success');
  } catch (error) {
    if (selectedGeneration === generation) setStatus(fileMessage, error.message, 'error');
  } finally {
    exporting = false;
    downloadButton.querySelector('.download-label').textContent = 'Baixar trecho';
    updateRange();
  }
});
form.addEventListener('reset', (event) => {
  if (busy) {
    event.preventDefault();
    return;
  }
  if (!confirm('Recomeçar e apagar o preenchimento desta aula?')) {
    event.preventDefault();
    return;
  }
  tags.reset();
  setTimeout(() => {
    document.querySelector('[data-identification-fields]').hidden = false;
    document.querySelector('[data-identification-actions]').hidden = false;
    chooseFile();
    setStep(1);
    setStatus(status, '');
    document.querySelectorAll('[data-retry-actions]').forEach((node) => node.remove());
    resetProgress();
  }, 0);
});
async function startProcessing() {
  if (reviewedChoices?.retainVideo) {
    progress('Guardando o vídeo original…', 'video');
    await retainOriginalVideo(createdMaterial.id, {
      file: reviewedChoices.file,
      durationMs: reviewedChoices.sourceDurationMs,
      range: reviewedChoices.range,
    });
  }
  progress('Iniciando a transcrição…', 'start');
  const job = await processMaterial(createdMaterial.id);
  progress('Envio concluído. Abrindo o acompanhamento…');
  document.querySelectorAll('[data-upload-step]').forEach((item) => {
    if (!item.hidden) setStepState(item, 'done');
  });
  location.href = `./processando.html?id=${encodeURIComponent(createdMaterial.id)}&job=${encodeURIComponent(job.jobId)}&from=upload`;
}
document.querySelector('[data-review-upload]').addEventListener('click', () => {
  if (busy || !form.reportValidity() || !info || !sourceFile) return;
  if (!declaration?.version) {
    setStatus(
      status,
      'A declaração de permissão não está disponível. Recarregue a página antes de enviar.',
      'error',
    );
    return;
  }
  const range = player.getRange();
  reviewedChoices = Object.freeze({
    id: crypto.randomUUID(),
    title: document.querySelector('#class-title').value.trim(),
    subject: document.querySelector('#subject').value.trim(),
    questionCount: Number(document.querySelector('#question-count').value),
    retainAudio: document.querySelector('#keep-original-audio').checked,
    retainVideo:
      videoRetentionAvailability() === 'available' &&
      document.querySelector('#keep-original-video').checked,
    sourceDurationMs: info.durationMs,
    permissionAccepted: permissionInput.checked,
    permissionVersion: declaration.version,
    range: Object.freeze({ ...range }),
    file: sourceFile,
    tags: tags.value(),
  });
  const storage = [
    reviewedChoices.retainAudio ? 'Guardar o áudio do trecho' : 'Apagar o áudio após transcrever',
  ];
  if (info.hasVideo)
    storage.push(
      reviewedChoices.retainVideo ? 'guardar o MP4 original inteiro' : 'não guardar o vídeo',
    );
  const choices = [
    ['Título', reviewedChoices.title],
    ['Disciplina', reviewedChoices.subject || 'Sem disciplina'],
    ['Tags', reviewedChoices.tags || 'Sem tags'],
    ['Arquivo', shortName(sourceFile.name) + ' · ' + mediaExtension(sourceFile).toUpperCase()],
    ['Trecho', timeLabel(range.start) + ' → ' + timeLabel(range.end)],
    ['Duração', durationLabel(range.end - range.start)],
    ['Questões', reviewedChoices.questionCount + ' questões'],
    ['Armazenamento', storage.join('; ')],
  ];
  const list = document.querySelector('[data-upload-choice-list]');
  list.replaceChildren();
  for (const [label, value] of choices) {
    const group = document.createElement('div'),
      term = document.createElement('dt'),
      detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    if (label === 'Arquivo') detail.title = sourceFile.name;
    if (['Título', 'Armazenamento'].includes(label)) group.className = 'wide';
    group.append(term, detail);
    list.append(group);
  }
  document.querySelector('[data-identification-fields]').hidden = true;
  document.querySelector('[data-identification-actions]').hidden = true;
  reviewPanel.hidden = false;
  document.querySelector('[data-review-upload]').hidden = true;
  const heading = document.querySelector('#upload-review-title');
  heading.tabIndex = -1;
  heading.focus();
});
form.addEventListener('input', () => {
  if (busy) return;
  reviewedChoices = null;
  reviewPanel.hidden = true;
  document.querySelector('[data-review-upload]').hidden = false;
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  if (step === 1) {
    if (info && !nextButton.disabled) setStep(2);
    return;
  }
  if (step !== 2 || !reviewedChoices || !form.reportValidity() || !info || !sourceFile) return;
  const title = document.querySelector('#class-title').value.trim();
  if (!title) {
    document.querySelector('#class-title').setCustomValidity('Informe um título para a aula.');
    document.querySelector('#class-title').reportValidity();
    return;
  }
  const fields = reviewedChoices;
  const range = fields.range,
    file = fields.file;
  busy = true;
  createdMaterial = null;
  resetProgress();
  document.querySelector('[data-upload-step="video"]').hidden = !fields.retainVideo;
  setStep(3);
  try {
    const latest = (await getPublicConfig({ refresh: true })).permissionDeclaration;
    if (latest?.version !== fields.permissionVersion) {
      declaration = latest;
      permissionInput.checked = false;
      reviewedChoices = null;
      reviewPanel.hidden = true;
      document.querySelector('[data-review-upload]').hidden = false;
      if (latest?.text) document.querySelector('[data-permission-label]').textContent = latest.text;
      throw new Error('A declaração mudou. Leia e confirme novamente antes de enviar.');
    }
    progress(
      info.hasVideo ? 'Extraindo o áudio do trecho escolhido…' : 'Preparando o áudio…',
      'prepare',
    );
    const clip = await convertMedia(file, range, 'wav');
    progress('Enviando o áudio…', 'upload');
    createdMaterial = await createMaterialWithUpload({
      ...fields,
      file: clip.file,
      durationMs: clip.durationMs,
    });
    saveTags(createdMaterial.id, fields.tags);
    await startProcessing();
  } catch (error) {
    if (!createdMaterial) {
      setStep(2);
      document.querySelector('[data-identification-fields]').hidden = false;
      document.querySelector('[data-identification-actions]').hidden = false;
      setStatus(
        status,
        error.message || 'Não foi possível enviar a gravação. Tente novamente.',
        'error',
      );
    } else {
      setStatus(
        status,
        `O áudio foi salvo. Falta concluir o envio adicional ou iniciar o processamento. ${error.message || ''}`,
        'error',
      );
      const failedStep = document.querySelector('[data-upload-step][data-state="active"]');
      if (failedStep) setStepState(failedStep, 'error');
      document.querySelector('.upload-progress .loading-indicator').hidden = true;
      document.querySelector('[data-upload-progress]').dataset.state = 'error';
      document.querySelector('.upload-progress h2').textContent = 'Seu áudio foi salvo';
      document.querySelector('[data-upload-progress-note]').textContent =
        'Você pode tentar de novo agora ou abrir a aula salva e continuar depois.';
      const actions = document.createElement('div');
      actions.className = 'form-actions';
      actions.dataset.retryActions = '';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'primary-action';
      retry.textContent = fields.retainVideo ? 'Concluir envio e iniciar transcrição' : 'Tentar processamento';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        document.querySelector('.upload-progress .loading-indicator').hidden = false;
        document.querySelector('[data-upload-progress]').dataset.state = 'busy';
        try {
          await startProcessing();
        } catch (e) {
          const activeStep = document.querySelector('[data-upload-step][data-state="active"]');
          if (activeStep) setStepState(activeStep, 'error');
          document.querySelector('.upload-progress .loading-indicator').hidden = true;
          document.querySelector('[data-upload-progress]').dataset.state = 'error';
          setStatus(status, e.message, 'error');
          retry.disabled = false;
        }
      });
      const link = document.createElement('a');
      link.className = 'secondary-action button-link';
      link.textContent = 'Abrir material salvo';
      link.href = `./material.html?id=${encodeURIComponent(createdMaterial.id)}`;
      actions.append(retry, link);
      document.querySelector('[data-wizard-panel="3"]').append(actions);
    }
  } finally {
    busy = false;
  }
});
document
  .querySelector('#class-title')
  .addEventListener('input', (event) => event.target.setCustomValidity(''));
window.addEventListener('beforeunload', () => {
  analysisController?.abort();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  player.destroy();
});
setStep(1, false);
