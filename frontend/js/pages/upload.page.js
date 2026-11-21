import { getPublicConfig } from '../api/config.js';
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { createMaterialWithUpload, processMaterial } from '../api/material.api.js';
import { MEDIA_EXTENSIONS, mediaExtension, inspectMedia, convertMedia } from '../api/media.api.js';
import { tagInput } from '../utils/tag-input.js';
import { saveTags } from '../utils/study-store.js';
import { MediaPlayer, timeLabel } from '../utils/media-player.js';
import { retainOriginalVideo } from '../api/playback.api.js';
import { describeProcessing } from '../utils/processing-disclosure.js';
import { toast, dismissToast } from '../utils/toast.js';

await initAuthenticatedShell();
const form = document.querySelector('.transcription-form'),
  fileInput = document.querySelector('#audio-file');
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
let tooLong = false;
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
  return `${value.toLocaleString((globalThis.VOZ_LOCALE || 'pt-BR'), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}
const STEP_STATE_LABELS = {
  active: ' — em andamento',
  done: ' — concluído',
  error: ' — não concluído',
};
/** Marks one real client-side upload step; earlier visible steps become complete. */
const percent = (fraction) => `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100)}%`;
/**
 * Upload percentage on a native progress bar. The stage title is the live region; the percentage is
 * not announced on every chunk (screen readers can read the bar on demand).
 */
function showPercent(fraction) {
  const bar = document.querySelector('[data-upload-progress-bar]');
  bar.hidden = false;
  bar.value = Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
  bar.setAttribute('aria-valuetext', percent(fraction));
}
function progress(text, stepName) {
  const title = document.querySelector('[data-upload-progress-title]');
  if (title.textContent !== text) title.textContent = text;
  const bar = document.querySelector('[data-upload-progress-bar]');
  if (bar) {
    bar.hidden = true;
    bar.value = 0;
  }
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
    'Não feche esta página até o envio terminar.';
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
  format: 'Somente arquivos MP4',
  disabled: 'Ainda não ativado neste servidor',
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
    VIDEO_NOTES[availability] || '';
}
document.querySelector('[data-change-file]').addEventListener('click', () => fileInput.click());
document.querySelector('[data-edit-upload]').addEventListener('click', () => {
  reviewPanel.hidden = true;
  document.querySelector('[data-identification-fields]').hidden = false;
  document.querySelector('[data-identification-actions]').hidden = false;
});
const LANGUAGE_NAMES = {
  auto: 'Detectar automaticamente',
  pt: 'Português',
  en: 'Inglês',
  es: 'Espanhol',
  zh: 'Chinês (mandarim)',
  yue: 'Chinês (cantonês)',
  en_us: 'Inglês (Estados Unidos)',
  en_uk: 'Inglês (Reino Unido)',
  en_au: 'Inglês (Austrália)',
  no: 'Norueguês',
  nn: 'Norueguês (nynorsk)',
};
function languageName(code) {
  if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
  try {
    const name = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(code.replace('_', '-'));
    return name ? name[0].toLocaleUpperCase('pt-BR') + name.slice(1) : code;
  } catch {
    return code;
  }
}
/** Spoken language of the recording (not the interface language); only when the ASR can take it. */
function setupRecordingLanguage(choice) {
  const field = document.querySelector('[data-recording-language-field]'),
    select = document.querySelector('#recording-language');
  const options = Array.isArray(choice?.options) ? choice.options : [];
  field.hidden = !options.length;
  // "Detectar automaticamente" and Portuguese first, then every other language by its Portuguese name.
  const pinned = ['auto', 'pt'].filter((code) => options.includes(code));
  const others = options
    .filter((code) => !pinned.includes(code))
    .sort((a, b) => languageName(a).localeCompare(languageName(b), 'pt-BR'));
  select.replaceChildren(...[...pinned, ...others].map((code) => new Option(languageName(code), code)));
  if (options.includes(choice.default)) select.value = choice.default;
}
let declaration, reviewedChoices;
let videoRetentionEnabled = false;
try {
  const config = await getPublicConfig();
  declaration = config.permissionDeclaration;
  videoRetentionEnabled = config.featureFlags?.mp4_retention === true;
  setupRecordingLanguage(config.recordingLanguages);
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
const icon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
/** Trimming lives in the player: waveform handles plus one compact row of time fields. */
function compactTrimControls() {
  const root = player.root,
    fields = root.querySelector('.trim-fields');
  for (const [selector, label, paths] of [
    [
      '[data-preview-trim]',
      'Ouvir trecho',
      '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    ],
    [
      '[data-reset-trim]',
      'Usar arquivo inteiro',
      '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/>',
    ],
  ]) {
    const button = root.querySelector(selector);
    button.className = 'icon-action';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon(paths);
  }
  fields.querySelectorAll('label > span').forEach((span) => span.classList.add('sr-only'));
  const separator = document.createElement('span');
  separator.className = 'trim-separator';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = '–';
  const [startField, endField] = fields.querySelectorAll('label');
  fields.insertBefore(separator, endField);
  const scissors = document.createElement('span');
  scissors.className = 'trim-glyph';
  scissors.innerHTML = icon(
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  );
  fields.insertBefore(scissors, startField);
  fields.append(downloadButton);
  fields.classList.add('trim-inline');
  root.querySelector('.player-controls').insertBefore(fields, root.querySelector('.player-speed'));
}
compactTrimControls();

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
  const exceeds = Boolean(ready && nextButton.disabled);
  if (exceeds && !tooLong) toast('O trecho pode ter até 54 minutos.', { type: 'error' });
  tooLong = exceeds;
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
  document.querySelector('[data-step1-actions]').hidden = true;
  if (!sourceFile) return;
  const validType = MEDIA_EXTENSIONS.includes(mediaExtension(sourceFile));
  const validSize = sourceFile.size > 0 && sourceFile.size <= 100 * 1024 * 1024;
  if (!validType || !validSize) {
    const message = !validType
      ? 'Use MP4, MP3, WAV, M4A, AAC, OGG, FLAC, WebM ou MOV.'
      : 'Escolha um arquivo com conteúdo e até 100 MB.';
    fileInput.setCustomValidity(message);
    dropzone.dataset.state = 'error';
    toast(message, { type: 'error' });
    return;
  }
  dismissToast();
  document.querySelector('[data-step1-actions]').hidden = false;
  const focusWasInDropzone = dropzone.contains(document.activeElement);
  dropzone.hidden = true;
  editor.hidden = false;
  objectUrl = URL.createObjectURL(sourceFile);
  const video = ['mp4', 'webm', 'mov'].includes(mediaExtension(sourceFile));
  editor.dataset.kind = video ? 'video' : 'audio';
  setFileState('loading');
  // Keep keyboard users in the component once the drop surface is replaced by the file view.
  if (focusWasInDropzone)
    document.querySelector('[data-change-file]').focus({ preventScroll: true });
  player.setSource({
    src: objectUrl,
    title: sourceFile.name,
    video,
    format: mediaExtension(sourceFile),
  });
  analysisController = new AbortController();
  try {
    const result = await inspectMedia(sourceFile, analysisController.signal);
    if (token !== generation) return;
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
    setFileState('error');
    toast(error.message || 'Não foi possível preparar a gravação.', {
      type: 'error',
      duration: 0,
      action: { label: 'Tentar de novo', onClick: chooseFile },
    });
  }
}
fileInput.addEventListener('change', chooseFile);
nextButton.addEventListener('click', () => {
  if (!nextButton.disabled && info) {
    updateRange();
    if (!nextButton.disabled) {
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
  downloadButton.setAttribute('aria-busy', 'true');
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
  } catch (error) {
    if (selectedGeneration === generation) toast(error.message, { type: 'error' });
  } finally {
    exporting = false;
    downloadButton.removeAttribute('aria-busy');
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
    dismissToast();
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
      onProgress: showPercent,
    });
  }
  progress('Iniciando a transcrição…', 'start');
  const job = await processMaterial(createdMaterial.id, {
    recordingLanguage: reviewedChoices?.recordingLanguage || null,
  });
  progress('Envio concluído. Abrindo o acompanhamento…');
  document.querySelectorAll('[data-upload-step]').forEach((item) => {
    if (!item.hidden) setStepState(item, 'done');
  });
  location.href = `./processando.html?id=${encodeURIComponent(createdMaterial.id)}&job=${encodeURIComponent(job.jobId)}&from=upload`;
}
document.querySelector('[data-review-upload]').addEventListener('click', () => {
  if (busy || !form.reportValidity() || !info || !sourceFile) return;
  if (!declaration?.version) {
    toast('A declaração de permissão não carregou. Recarregue a página.', { type: 'error' });
    return;
  }
  const range = player.getRange();
  reviewedChoices = Object.freeze({
    id: crypto.randomUUID(),
    title: document.querySelector('#class-title').value.trim(),
    subject: document.querySelector('#subject').value.trim(),
    questionCount: Number(document.querySelector('[name="question-count"]:checked').value),
    retainAudio: document.querySelector('#keep-original-audio').checked,
    retainVideo:
      videoRetentionAvailability() === 'available' &&
      document.querySelector('#keep-original-video').checked,
    recordingLanguage: document.querySelector('[data-recording-language-field]').hidden
      ? null
      : document.querySelector('#recording-language').value,
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
    ...(reviewedChoices.recordingLanguage
      ? [['Idioma', languageName(reviewedChoices.recordingLanguage)]]
      : []),
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
    // Keep the two-column grid even: storage spans the row only when it would sit alone.
    const wide =
      label === 'Título' || (label === 'Armazenamento' && !reviewedChoices.recordingLanguage);
    if (wide) group.className = 'wide';
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
    const clip = await convertMedia(file, range, 'speech');
    progress('Enviando o áudio…', 'upload');
    createdMaterial = await createMaterialWithUpload({
      ...fields,
      file: clip.file,
      durationMs: clip.durationMs,
      onProgress: showPercent,
    });
    saveTags(createdMaterial.id, fields.tags);
    await startProcessing();
  } catch (error) {
    if (!createdMaterial) {
      setStep(2);
      document.querySelector('[data-identification-fields]').hidden = false;
      document.querySelector('[data-identification-actions]').hidden = false;
      toast(error.message || 'Não foi possível enviar a gravação. Tente novamente.', {
        type: 'error',
      });
    } else {
      toast(error.message || 'Não foi possível concluir o envio.', { type: 'error' });
      const failedStep = document.querySelector('[data-upload-step][data-state="active"]');
      if (failedStep) setStepState(failedStep, 'error');
      document.querySelector('.upload-progress .loading-indicator').hidden = true;
      document.querySelector('[data-upload-progress]').dataset.state = 'error';
      document.querySelector('.upload-progress h2').textContent = 'Seu áudio foi salvo';
      document.querySelector('[data-upload-progress-note]').textContent =
        'Tente de novo agora ou continue depois pela aula.';
      const actions = document.createElement('div');
      actions.className = 'form-actions wizard-actions';
      actions.dataset.retryActions = '';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'primary-action';
      retry.textContent = fields.retainVideo ? 'Concluir envio' : 'Tentar processamento';
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
          toast(e.message, { type: 'error' });
          retry.disabled = false;
        }
      });
      const link = document.createElement('a');
      link.className = 'secondary-action button-link';
      link.textContent = 'Abrir aula';
      link.href = `./material.html?id=${encodeURIComponent(createdMaterial.id)}`;
      actions.append(link, retry);
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
