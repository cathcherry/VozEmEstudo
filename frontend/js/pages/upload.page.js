import { getPublicConfig } from '../api/config.js';
import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { createMaterialWithUpload, processMaterial } from '../api/material.api.js';
import { MEDIA_EXTENSIONS, mediaExtension, inspectMedia, convertMedia } from '../api/media.api.js';
import { saveTags } from '../utils/study-store.js';
import { MediaPlayer, timeLabel } from '../utils/media-player.js';
import { retainOriginalVideo } from '../api/playback.api.js';

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
let declaration, reviewedChoices;
let videoRetentionEnabled = false;
try {
  const config = await getPublicConfig();
  declaration = config.permissionDeclaration;
  videoRetentionEnabled = config.featureFlags?.mp4_retention === true;
} catch {
  /* Keep upload blocked when configuration is unavailable. */
}
if (declaration?.text)
  document.querySelector('[data-permission-label]').textContent = declaration.text;
const player = new MediaPlayer(document.querySelector('[data-upload-player]'), {
  trim: true,
  onRangeChange: updateRange,
});

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
          ? fileInput
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
    ? `${timeLabel(range.start, true)} – ${timeLabel(range.end, true)} · ${timeLabel(range.end - range.start, true)} de áudio`
    : '';
  if (ready && nextButton.disabled)
    setStatus(
      fileMessage,
      'Escolha um trecho de até 54 minutos para transcrever. Você ainda pode exportar um recorte maior.',
      'error',
    );
  else if (ready)
    setStatus(
      fileMessage,
      'Gravação pronta. Ajuste o trecho ou continue com o arquivo inteiro.',
      'success',
    );
}
async function chooseFile() {
  const token = ++generation;
  analysisController?.abort();
  info = null;
  document.querySelector('[data-video-retention-choice]').hidden = true;
  document.querySelector('#keep-original-video').checked = false;
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
  document.querySelector('[data-file-description]').textContent = sourceFile
    ? `${sourceFile.name} · ${(sourceFile.size / 1024 / 1024).toFixed(1)} MB`
    : 'Nenhum arquivo selecionado.';
  document.querySelector('[data-selected-file]').textContent = sourceFile?.name || '';
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
    setStatus(fileMessage, message, 'error');
    return;
  }
  editor.hidden = false;
  objectUrl = URL.createObjectURL(sourceFile);
  const video = ['mp4', 'webm', 'mov'].includes(mediaExtension(sourceFile));
  player.setSource({
    src: objectUrl,
    title: sourceFile.name,
    video,
    format: mediaExtension(sourceFile),
  });
  setStatus(fileMessage, 'Lendo a gravação e preparando a forma de onda…');
  analysisController = new AbortController();
  try {
    const result = await inspectMedia(sourceFile, analysisController.signal);
    if (token !== generation) return;
    info = result;
    document.querySelector('[data-video-retention-choice]').hidden =
      !videoRetentionEnabled || !result.hasVideo || mediaExtension(sourceFile) !== 'mp4';
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
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
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
  downloadButton.textContent = 'Preparando recorte…';
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
    downloadButton.textContent = 'Baixar trecho';
    updateRange();
  }
});
form.addEventListener('reset', (event) => {
  if (busy) {
    event.preventDefault();
    return;
  }
  setTimeout(() => {
    chooseFile();
    setStep(1);
    setStatus(status, '');
    document.querySelectorAll('[data-retry-actions]').forEach((node) => node.remove());
    document.querySelector('.upload-progress .loading-indicator').hidden = false;
    document.querySelector('.upload-progress h2').textContent = 'Preparando seu material';
  }, 0);
});
async function startProcessing() {
  if (reviewedChoices?.retainVideo) {
    setStatus(status, 'Guardando o MP4 original sem alterações…');
    await retainOriginalVideo(createdMaterial.id, { file: reviewedChoices.file,
      durationMs: reviewedChoices.sourceDurationMs, range: reviewedChoices.range });
  }
  const job = await processMaterial(createdMaterial.id);
  location.href = `./material.html?id=${encodeURIComponent(createdMaterial.id)}&job=${encodeURIComponent(job.jobId)}&from=upload`;
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
    retainVideo: videoRetentionEnabled && info.hasVideo && mediaExtension(sourceFile) === 'mp4' &&
      document.querySelector('#keep-original-video').checked,
    sourceDurationMs: info.durationMs,
    permissionAccepted: permissionInput.checked,
    permissionVersion: declaration.version,
    range: Object.freeze({ ...range }),
    file: sourceFile,
    tags: document.querySelector('#upload-tags').value,
  });
  const choices = [
    ['Título', reviewedChoices.title],
    ['Disciplina', reviewedChoices.subject || 'Sem disciplina'],
    [
      'Arquivo e formato',
      sourceFile.name +
        ' · ' +
        mediaExtension(sourceFile).toUpperCase() +
        (info.hasVideo ? ' (somente o áudio será transcrito)' : ''),
    ],
    [
      'Duração e recorte',
      timeLabel(range.start, true) +
        ' – ' +
        timeLabel(range.end, true) +
        ' · ' +
        timeLabel(range.end - range.start, true),
    ],
    [
      'Conservação',
      (reviewedChoices.retainAudio ? 'Guardar o áudio do trecho. ' : 'Remover o áudio após transcrever. ') +
        (reviewedChoices.retainVideo ? 'Guardar também o MP4 original inteiro, incluindo partes fora do recorte.' : 'Não guardar o vídeo original.'),
    ],
    [
      'Questões',
      reviewedChoices.questionCount + ' questões, após conferir e confirmar a transcrição',
    ],
    ['Permissão', 'Declaração confirmada por você'],
  ];
  const list = document.querySelector('[data-upload-choice-list]');
  list.replaceChildren();
  for (const [label, value] of choices) {
    const term = document.createElement('dt'),
      detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    list.append(term, detail);
  }
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
    setStatus(
      status,
      info.hasVideo
        ? 'Extraindo o áudio do trecho escolhido…'
        : 'Preparando o áudio do trecho escolhido…',
    );
    const clip = await convertMedia(file, range, 'wav');
    setStatus(status, 'Enviando o áudio preparado…');
    createdMaterial = await createMaterialWithUpload({
      ...fields,
      file: clip.file,
      durationMs: clip.durationMs,
    });
    saveTags(createdMaterial.id, fields.tags);
    setStatus(status, 'Áudio enviado. Iniciando a transcrição…');
    await startProcessing();
  } catch (error) {
    if (!createdMaterial) {
      setStep(2);
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
      document.querySelector('.upload-progress .loading-indicator').hidden = true;
      document.querySelector('.upload-progress h2').textContent = 'Seu áudio foi salvo';
      const actions = document.createElement('div');
      actions.className = 'form-actions';
      actions.dataset.retryActions = '';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'primary-action';
      retry.textContent = fields.retainVideo ? 'Concluir envio e iniciar transcrição' : 'Tentar processamento';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          await startProcessing();
        } catch (e) {
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

