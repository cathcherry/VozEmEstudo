import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { formatDate, formatTimestamp } from '../utils/format.js';
import {
  getMaterial,
  saveTranscriptionEdits,
  getTranscriptionVersions,
  restoreTranscriptionVersion,
  regenerateSummary,
  generateQuestions,
} from '../api/material.api.js';
import { pollJob } from '../api/job.api.js';
import { initTranscriptionReview } from '../utils/transcription-review.js';
import { studyFor, visitMaterial, completeReview, trackPlayback } from '../utils/study-store.js';
import { MediaPlayer } from '../utils/media-player.js';
import { initTranscriptPlayer } from '../utils/transcript-player.js';
import { getPlayback, getCaptions, removeOriginalVideo } from '../api/playback.api.js';
import { PlayerCaptions } from '../utils/captions.js';
import { speakControls, speechLang } from '../utils/speech.js';
import { initStudyTrackingPanel } from './study-tracking-panel.js';
import { isStudySyncEnabled } from '../utils/study-sync.js';
import { initMaterialTools } from './material-tools.js';
import { renderMarkdown } from '../utils/markdown.js';

await initAuthenticatedShell();
const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search),
  materialId = params.get('id');
if (!materialId) location.replace('./historico.html');
let currentMaterial,
  editingRevision,
  original = new Map(),
  reviewOpened = false,
  busy = false,
  editing = false,
  stopTracking,
  waveformController;
let activeTab =
  { '#resumo': 'summary', '#questoes': 'questions', '#gerar-questoes': 'questions' }[
    location.hash
  ] || 'transcription';
let waitingSince,
  initialRender = true;
const pending = new Map();
const player = new MediaPlayer($('[data-audio-player]'), {
  onError: () => {
    $('[data-retry-media]').hidden = false;
    void renewPlayback({ automatic: true });
  },
});
const captions = new PlayerCaptions(player, { storage: window.VozAppearance?.storage });
const captionWords = new Map(); // revision -> validated real word timings ([] = segment only)
// Compact audio/video switcher and fullscreen live inside the player's own control bar.
const playbackChoice = $('[data-playback-choice]');
player.root
  .querySelector('.player-controls')
  .insertBefore(playbackChoice, player.root.querySelector('.caption-control'));
const fullscreenButton = document.createElement('button');
fullscreenButton.type = 'button';
fullscreenButton.className = 'player-icon player-fullscreen';
fullscreenButton.innerHTML =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
player.root.querySelector('.player-controls').append(fullscreenButton);
function syncFullscreen() {
  const active = document.fullscreenElement === player.root;
  fullscreenButton.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Tela cheia');
  fullscreenButton.title = fullscreenButton.getAttribute('aria-label');
  fullscreenButton.hidden = player.media !== player.video || !document.fullscreenEnabled;
}
fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    // The whole player goes fullscreen so captions and controls stay with the video.
    else await player.root.requestFullscreen();
  } catch {
    /* Fullscreen can be refused by the browser; the inline player keeps working. */
  }
});
document.addEventListener('fullscreenchange', syncFullscreen);
const kindValue = () => $('[name="playback-kind"]:checked')?.value || 'audio';
const setKind = (value) => {
  const input = $(`[name="playback-kind"][value="${value}"]`);
  if (input) input.checked = true;
};
async function loadCaptions(material) {
  const transcription = material.transcription;
  if (!transcription) return captions.setTranscript([], []);
  const revision = transcription.current_revision;
  captions.setTranscript(
    transcription.transcription_segments || [],
    captionWords.get(revision) || [],
  );
  if (captionWords.has(revision)) return;
  captionWords.set(revision, []);
  try {
    const result = await getCaptions(materialId);
    if (result.revision !== currentMaterial?.transcription?.current_revision) return;
    captionWords.set(revision, result.words || []);
    captions.setTranscript(
      currentMaterial.transcription.transcription_segments || [],
      captionWords.get(revision),
    );
  } catch {
    /* Without the endpoint or data, segment captions remain available. */
  }
}
// Read-aloud with the browser's own voices, in the language recognized for this recording.
const lessonLang = () => speechLang(currentMaterial?.transcription?.language);
const readBlocks = (container) =>
  [...container.children].flatMap((el) =>
    el.matches('ul, ol')
      ? [...el.children].map((li) => ({ element: li, text: li.textContent }))
      : [{ element: el, text: el.textContent }],
  );
const summarySpeech = speakControls({
  blocks: () => readBlocks($('[data-summary-text]')),
  lang: lessonLang,
  label: 'Ouvir resumo',
});
if (summarySpeech)
  $('[data-summary-section] .panel-toolbar-actions').prepend(summarySpeech.element);
const segmentsContainer = $('[data-transcription-segments]');
const transcriptMessage = $('[data-transcription-message]');
const transcriptPlayer = initTranscriptPlayer({
  container: segmentsContainer,
  toolbar: $('[data-transcript-player-toolbar]'),
  player,
});
let playbackIdentity = '',
  renewBusy = false,
  lastRenewedAt = 0,
  playbackRequest = 0;
let materialToolsInitialized = false;
if (materialId)
  void initStudyTrackingPanel({ materialId }).catch((error) => {
    const panel = $('[data-study-tracking-panel]');
    if (panel && !panel.hidden) panel.textContent = error.message || 'Progresso indisponível.';
  });
const messages = {
  summary: $('[data-summary-message]'),
  questions: $('[data-more-questions-message]'),
};
const scientificReview = initTranscriptionReview({
  materialId,
  currentMaterial: () => currentMaterial,
  reload,
  hasUnsavedEdits,
  saveEdits,
  onOpen: () => {
    reviewOpened = true;
    activeTab = 'transcription';
    layout();
  },
  onConfirmed: () => {
    activeTab = 'summary';
    layout();
    const heading = $('[data-summary-section] h2');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
});
function hasUnsavedEdits() {
  return [...document.querySelectorAll('.transcription-segment')].some(
    (n) => n.querySelector('textarea').value.trim() !== original.get(n.dataset.segmentId),
  );
}
function ready() {
  return currentMaterial?.review?.state === 'ready_to_generate';
}
/** Editing is the mode while a revision awaits confirmation, or when the user chose to edit. */
function isEditing() {
  return Boolean(currentMaterial?.transcription) && (!ready() || editing);
}
function changedSegments() {
  return [...document.querySelectorAll('.transcription-segment')].filter(
    (n) => n.querySelector('textarea').value.trim() !== original.get(n.dataset.segmentId),
  ).length;
}
function updateEditStatus() {
  const count = changedSegments(),
    revision = currentMaterial?.transcription?.current_revision ?? '—';
  $('[data-edit-status]').textContent =
    `Editando a revisão ${revision}` +
    (count ? ` · ${count} ${count === 1 ? 'trecho alterado' : 'trechos alterados'}` : '');
  $('[data-cancel-edit]').textContent = ready() ? 'Cancelar' : 'Descartar alterações';
  $('[data-cancel-edit]').hidden = !ready() && !count;
  $('[data-save-transcription]').disabled = busy || !count;
}
function layout() {
  if (!currentMaterial) return;
  const transcript = Boolean(currentMaterial.transcription);
  const waiting = !transcript;
  $('[data-processing-section]').hidden = !waiting;
  $('[data-review-welcome]').hidden = waiting || ready() || reviewOpened;
  const showContent = transcript && (ready() || reviewOpened);
  $('.material-tabs').hidden = !showContent || !ready();
  $('[data-material-actions]').hidden = !showContent;
  $('[data-study-footer]').hidden = !showContent || !ready() || !currentMaterial.summaries?.length;
  for (const name of ['transcription', 'summary', 'questions']) {
    const tab = $(`[data-material-tab="${name}"]`);
    tab.setAttribute('aria-selected', String(activeTab === name));
    tab.tabIndex = activeTab === name ? 0 : -1;
    $(`[data-${name}-section]`).hidden = !showContent || activeTab !== name;
  }
  $('[data-open-export]').hidden = !transcript;
  $('[data-follow-control]').hidden = !player.source || !hasUsefulTiming();
  const mode = isEditing() ? 'editing' : 'reading';
  $('[data-transcription-section]').dataset.mode = mode;
  $('[data-edit-bar]').hidden = mode !== 'editing';
  $('[data-edit-transcription]').hidden = mode === 'editing' || !ready();
  // Confirmation belongs to editing: a pending revision, or edits that will create one.
  $('.confirmation-footer').hidden = mode !== 'editing';
  const status = $('[data-material-status]');
  const label = !transcript ? 'Processando' : !ready() ? 'Revisão pendente' : '';
  status.textContent = label;
  status.hidden = !label;
  status.dataset.state = !transcript ? 'processing' : 'review';
  if (mode === 'editing') updateEditStatus();
}
function selectTab(name, focus = false) {
  if (!ready() && name !== 'transcription') return;
  activeTab = name;
  layout();
  history.replaceState(
    null,
    '',
    '#' + { transcription: 'transcricao', summary: 'resumo', questions: 'questoes' }[name],
  );
  if (focus) $(`[data-material-tab="${name}"]`).focus();
}
const tabs = [...document.querySelectorAll('[data-material-tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.materialTab));
  tab.addEventListener('keydown', (e) => {
    let next;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      selectTab(tabs[next].dataset.materialTab, true);
    }
  });
});
function jobLabel(job) {
  if (job.status === 'FALHOU')
    return job.error_message || 'Não foi possível concluir. Tente novamente.';
  if (job.status === 'CANCELADA') return 'Processamento cancelado';
  // Without an error the job is only waiting for the external transcription to be polled again.
  if (job.status === 'AGUARDANDO_REPETICAO' && job.error_code) return 'Aguardando nova tentativa…';
  return (
    {
      VALIDACAO: 'Preparando o áudio…',
      TRANSCRICAO: 'Transcrevendo o áudio…',
      FINALIZACAO: 'Finalizando a transcrição…',
      RESUMO: 'Gerando resumo…',
      QUESTOES: 'Gerando questões…',
    }[job.current_stage] || 'Na fila…'
  );
}
function updateWaiting(job) {
  waitingSince ||= job.created_at || currentMaterial?.created_at || new Date().toISOString();
  $('[data-processing-status]').textContent = jobLabel(job);
  if (job.events) {
    const list = $('[data-processing-events]');
    list.replaceChildren();
    for (const event of job.events) {
      const item = document.createElement('li');
      item.textContent = event.message;
      list.append(item);
    }
  }
  $('[data-processing-spinner]').hidden = ['FALHOU', 'CANCELADA'].includes(job.status);
}
const clock = setInterval(() => {
  if ($('[data-processing-section]').hidden) return;
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(waitingSince || Date.now()).getTime()) / 1000),
  );
  $('[data-elapsed]').textContent =
    seconds < 60
      ? 'Iniciado há poucos segundos'
      : `Iniciado há ${Math.floor(seconds / 60)} ${seconds < 120 ? 'minuto' : 'minutos'}`;
}, 1000);
function renderSegments(transcription) {
  const drafts = new Map(
    [...document.querySelectorAll('.transcription-segment')].map((node) => [
      node.dataset.segmentId,
      node.querySelector('textarea').value,
    ]),
  );
  const keepDraft = hasUnsavedEdits() && editingRevision === transcription.current_revision;
  if (hasUnsavedEdits() && editingRevision !== transcription.current_revision) {
    setStatus(
      transcriptMessage,
      'Há outra revisão no servidor. Suas alterações locais foram mantidas; salve para conferir o conflito ou recarregue explicitamente.',
      'error',
    );
    return;
  }
  editingRevision = transcription.current_revision;
  segmentsContainer.innerHTML = '';
  original = new Map();
  (transcription.transcription_segments || []).forEach((segment, index) => {
    original.set(segment.id, segment.current_text);
    const article = document.createElement('article');
    article.className = 'transcription-segment';
    article.dataset.segmentId = segment.id;
    article.dataset.startMs = segment.start_ms;
    article.dataset.endMs = segment.end_ms;
    article.dataset.segmentPosition = segment.position ?? index;
    const timestamp = document.createElement('button');
    timestamp.type = 'button';
    timestamp.className = 'segment-timestamp';
    timestamp.textContent = `${formatTimestamp(segment.start_ms)}–${formatTimestamp(segment.end_ms)}`;
    timestamp.disabled = !player.source;
    timestamp.title = player.source ? 'Reproduzir a partir deste trecho' : 'Timestamp do trecho';
    timestamp.addEventListener('click', () => {
      if (player.source) player.seekTo(segment.start_ms / 1000);
    });
    // Reading shows plain text; editing shows the same segment as a field. Both stay in the DOM so
    // drafts, search and the review flow keep working across mode switches.
    const text = document.createElement('p');
    text.className = 'segment-text';
    text.textContent = segment.current_text;
    const textarea = document.createElement('textarea');
    textarea.value =
      keepDraft && drafts.has(segment.id) ? drafts.get(segment.id) : segment.current_text;
    textarea.rows = Math.max(2, Math.ceil(segment.current_text.length / 90));
    textarea.setAttribute('aria-label', `Trecho iniciado em ${formatTimestamp(segment.start_ms)}`);
    article.append(timestamp, text, textarea);
    segmentsContainer.appendChild(article);
  });
  transcriptPlayer.refresh();
}

async function saveEdits() {
  if (busy) return;
  const edits = [...document.querySelectorAll('.transcription-segment')]
    .map((n) => ({ id: n.dataset.segmentId, text: n.querySelector('textarea').value.trim() }))
    .filter((e) => e.text !== original.get(e.id));
  if (!edits.length) return;
  await saveTranscriptionEdits(materialId, editingRevision, edits);
  original = new Map();
  editing = false;
  $('[data-transcription-segments]').replaceChildren();
  await reload();
}
function discardEdits() {
  document.querySelectorAll('.transcription-segment').forEach((n) => {
    n.querySelector('textarea').value = original.get(n.dataset.segmentId) ?? '';
  });
  segmentsContainer.dispatchEvent(new Event('input'));
}
$('[data-edit-transcription]').addEventListener('click', () => {
  editing = true;
  layout();
  const first = $('.transcription-segment textarea');
  first?.focus({ preventScroll: true });
});
$('[data-cancel-edit]').addEventListener('click', () => {
  if (changedSegments() && !confirm('Descartar as alterações não salvas?')) return;
  discardEdits();
  editing = false;
  layout();
  $(ready() ? '[data-edit-transcription]' : '[data-confirm-transcription]')?.focus();
});
segmentsContainer.addEventListener('input', () => {
  if (isEditing()) updateEditStatus();
});
$('[data-save-transcription]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await saveEdits();
  } catch (error) {
    setStatus(transcriptMessage, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
function hasUsefulTiming() {
  const segments = currentMaterial?.transcription?.transcription_segments || [];
  return (
    segments.length > 1 &&
    segments.every((s) => s.end_ms > s.start_ms && s.end_ms - s.start_ms < 45000)
  );
}
function renderPlayback(material, force = false) {
  const section = document.querySelector('[data-audio-section]');
  const audioAvailable = Boolean(material.signedAudioUrl);
  const videoAvailable = Boolean(material.signedVideoUrl && material.video);
  // Only offer a switch when both formats really exist.
  playbackChoice.hidden = !(audioAvailable && videoAvailable);
  $('[name="playback-kind"][value="audio"]').disabled = !audioAvailable;
  $('[name="playback-kind"][value="video"]').disabled = !videoAvailable;
  if (kindValue() === 'video' && !videoAvailable) setKind('audio');
  if (!audioAvailable && videoAvailable) setKind('video');
  document.querySelector('[data-remove-video]').hidden = !videoAvailable;
  const originalLink = document.querySelector('[data-open-original-video]');
  originalLink.hidden = !videoAvailable;
  if (videoAvailable) originalLink.href = material.signedVideoUrl;
  else originalLink.removeAttribute('href');
  section.hidden = !audioAvailable && !videoAvailable;
  if (section.hidden) {
    stopTracking?.();
    stopTracking = null;
    player.media.pause();
    player.source = '';
    player.audio.removeAttribute('src');
    player.video.removeAttribute('src');
    playbackIdentity = '';
    return;
  }
  const video = kindValue() === 'video';
  const identity = `${materialId}:${kindValue()}`;
  if (!force && identity === playbackIdentity && player.source) return;
  stopTracking?.();
  stopTracking = null;
  waveformController?.abort();
  waveformController = new AbortController();
  player.setSource({
    src: video ? material.signedVideoUrl : material.signedAudioUrl,
    title: material.title,
    video,
    format: video ? 'mp4' : material.audio?.extension || 'áudio',
    duration: video
      ? (material.video.clipEndMs - material.video.clipStartMs) / 1000
      : (material.audio?.duration_ms || 0) / 1000,
    timelineStart: video ? material.video.clipStartMs / 1000 : 0,
    timelineDuration: video ? (material.video.clipEndMs - material.video.clipStartMs) / 1000 : 0,
    preservePosition: Boolean(playbackIdentity),
  });
  playbackIdentity = identity;
  syncFullscreen();
  captions.render();
  stopTracking = trackPlayback(player, materialId);
  if (!video) loadWaveform(material.signedAudioUrl, waveformController.signal).catch(() => {});
}

async function renewPlayback({ automatic = false } = {}) {
  if (!currentMaterial || renewBusy || (automatic && Date.now() - lastRenewedAt < 30000)) return;
  renewBusy = true;
  lastRenewedAt = Date.now();
  const version = ++playbackRequest;
  const message = document.querySelector('[data-playback-status]');
  setStatus(message, 'Atualizando o link de reprodução…');
  try {
    const result = await getPlayback(materialId);
    if (version !== playbackRequest) return;
    Object.assign(currentMaterial, result);
    renderPlayback(currentMaterial, true);
    $('[data-retry-media]').hidden = true;
    layout();
    document.querySelectorAll('.segment-timestamp').forEach((item) => {
      item.disabled = !player.source;
    });
    setStatus(message, 'Link atualizado. Posição e velocidade preservadas.', 'success');
  } catch (error) {
    if (version === playbackRequest)
      setStatus(message, error.message || 'Não foi possível renovar. Tente novamente.', 'error');
  } finally {
    renewBusy = false;
  }
}
playbackChoice.addEventListener('change', () => renderPlayback(currentMaterial));
document.querySelector('[data-remove-video]').addEventListener('click', async (event) => {
  if (!confirm('Remover o vídeo guardado desta aula?')) return;
  const button = event.currentTarget;
  button.disabled = true;
  ++playbackRequest;
  try {
    await removeOriginalVideo(materialId);
    Object.assign(currentMaterial, { video: null, signedVideoUrl: null });
    renderPlayback(currentMaterial, true);
    document.querySelectorAll('.segment-timestamp').forEach((item) => {
      item.disabled = !player.source;
    });
    setStatus(document.querySelector('[data-playback-status]'), 'Vídeo removido.', 'success');
  } catch (error) {
    setStatus(document.querySelector('[data-playback-status]'), error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
const playbackRefreshTimer = setInterval(
  () => {
    if (player.source && !player.media.paused) void renewPlayback({ automatic: true });
  },
  8 * 60 * 1000,
);

async function loadWaveform(url, signal) {
  const bytes = await fetch(url, { signal }).then((response) => {
    if (!response.ok) throw new Error('AUDIO_UNAVAILABLE');
    return response.arrayBuffer();
  });
  if (signal.aborted) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes),
      samples = buffer.getChannelData(0),
      peaks = [],
      count = 180;
    for (let i = 0; i < count; i++) {
      let peak = 0;
      const from = Math.floor((i * samples.length) / count),
        to = Math.floor(((i + 1) * samples.length) / count),
        stride = Math.max(1, Math.floor((to - from) / 1000));
      for (let j = from; j < to; j += stride) peak = Math.max(peak, Math.abs(samples[j]));
      peaks.push(peak);
    }
    if (!signal.aborted && player.source === url) player.setPeaks(peaks);
  } finally {
    await context.close();
  }
}

$('[data-retry-media]').addEventListener('click', () => {
  void renewPlayback();
});
function renderSummary(summary) {
  summarySpeech?.speaker.stop();
  renderMarkdown($('[data-summary-text]'), summary?.text || '');
  $('[data-summary-text]').hidden = !summary;
  if (summarySpeech) summarySpeech.element.hidden = !summary;
  $('[data-summary-meta]').textContent = summary
    ? [
        `Versão ${summary.version}`,
        summary.created_at ? formatDate(summary.created_at) : '',
        summary.stale ? 'baseado em uma revisão anterior da transcrição' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Ainda não há resumo desta aula.';
}
function render(material) {
  currentMaterial = material;
  if (initialRender) {
    visitMaterial(materialId);
    initialRender = false;
    if (params.has('from') && !ready()) activeTab = 'transcription';
  }
  $('[data-material-title]').textContent = material.title;
  $('[data-material-title]').removeAttribute('aria-busy');
  document.title = material.title + ' | Voz em Estudo';
  $('[data-material-meta]').textContent = material.subject || 'Sem disciplina';
  const tagList = studyFor(materialId).tags;
  const tags = document.createElement('ul');
  tags.className = 'material-tags';
  tags.setAttribute('aria-label', 'Tags');
  for (const tag of tagList) {
    const item = document.createElement('li');
    item.textContent = tag;
    tags.append(item);
  }
  $('[data-material-tags]').replaceChildren(...(tagList.length ? [tags] : []));
  $('[data-organize-material]').href = './historico.html?edit=' + encodeURIComponent(materialId);
  renderPlayback(material);
  if (!material.transcription)
    updateWaiting({
      status: material.status,
      current_stage: material.current_stage,
      created_at: material.created_at,
    });
  else renderSegments(material.transcription);
  void loadCaptions(material);
  scientificReview.render(material);
  if (!materialToolsInitialized) {
    materialToolsInitialized = true;
    void initMaterialTools({
      materialId,
      context: () => currentMaterial,
      segments: segmentsContainer,
    }).catch((error) => {
      const panel = $('[data-material-tools]');
      panel.hidden = false;
      panel.textContent = error.message || 'Ferramentas indisponíveis.';
    });
  }
  const summaries = material.summaries || [],
    summary = summaries.find((s) => s.is_current) || summaries[0];
  renderSummary(summary);
  $('[data-regenerate-summary]').textContent = summary ? 'Gerar novamente' : 'Gerar resumo';
  $('[data-summary-history]').hidden = summaries.length < 2;
  $('[data-summary-version-list]').replaceChildren();
  summaries.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'text-action';
    b.type = 'button';
    b.textContent = `Versão ${s.version}`;
    b.addEventListener('click', () => {
      renderSummary(s);
      $('[data-summary-history]').open = false;
    });
    $('[data-summary-version-list]').append(b);
  });
  renderQuestionBatches(material.questionBatches || []);
  $('[data-complete-review]').setAttribute('aria-pressed', String(studyFor(materialId).completed));
  $('[data-complete-review]').textContent = studyFor(materialId).completed
    ? 'Revisão concluída · desfazer'
    : 'Marcar revisão concluída';
  if (material.initial_question_count && !$('#more-question-count').dataset.initialized) {
    $('#more-question-count').value = String(material.initial_question_count);
    $('#more-question-count').dataset.initialized = 'true';
  }
  layout();
  if (location.hash === '#gerar-questoes' && ready() && !$('#more-question-count').dataset.opened) {
    $('#more-question-count').dataset.opened = 'true';
    $('[data-questions-dialog]').showModal();
    $('#more-question-count').focus();
  }
}
/**
 * Each batch shows its real questions and the locally recorded result of each one, so an
 * "answered" count is always backed by something the student can review.
 */
function renderQuestionBatches(batches) {
  const answers = studyFor(materialId).answers;
  const container = $('[data-question-batches]');
  container.replaceChildren();
  const total = batches.reduce(
    (sum, b) => sum + (b.questions?.length || b.generated_count || 0),
    0,
  );
  $('[data-questions-meta]').textContent = batches.length
    ? `${batches.length} ${batches.length === 1 ? 'conjunto' : 'conjuntos'} · ${total} questões`
    : 'Ainda não há questões desta aula.';
  batches.forEach((batch, i) => {
    const questions = batch.questions || [];
    const results = questions.map((q) => answers[q.id]);
    const answered = results.filter(Boolean).length;
    const correct = results.filter((r) => r?.correct).length;
    const count = questions.length || batch.generated_count || 0;
    const card = document.createElement('article');
    card.className = 'question-batch-card question-batch-row';
    const head = document.createElement('div');
    head.className = 'question-batch-head';
    const title = document.createElement('h3');
    title.textContent = `Conjunto ${batches.length - i}`;
    const meta = document.createElement('p');
    meta.textContent = answered
      ? `${answered} de ${count} respondidas · ${correct} ${correct === 1 ? 'acerto' : 'acertos'}`
      : `${count} questões · ainda não respondidas`;
    if (batch.stale) meta.textContent += ' · revisão anterior';
    const link = document.createElement('a');
    link.className = answered && answered < count ? 'primary-action' : 'secondary-action';
    link.textContent = !answered
      ? 'Responder'
      : answered < count
        ? 'Continuar'
        : 'Responder de novo';
    link.href = `./responder.html?material=${encodeURIComponent(materialId)}&batch=${encodeURIComponent(batch.id)}`;
    head.append(title, meta, link);
    const listen = questions.length
      ? speakControls({
          blocks: () =>
            [...card.querySelectorAll('.question-list li')].map((li, n) => ({
              element: li,
              text: `Questão ${n + 1}. ${li.querySelector('span').textContent}`,
            })),
          lang: lessonLang,
          label: 'Ouvir questões',
        })
      : null;
    if (listen) head.append(listen.element);
    const progress = document.createElement('div');
    progress.className = 'question-batch-progress';
    progress.setAttribute('aria-hidden', 'true');
    progress.style.setProperty('--answered', String(count ? answered / count : 0));
    progress.style.setProperty('--correct', String(count ? correct / count : 0));
    card.append(head, progress);
    if (questions.length) {
      const list = document.createElement('ol');
      list.className = 'question-list';
      questions.forEach((q, index) => {
        const item = document.createElement('li');
        const result = results[index];
        item.dataset.result = result ? (result.correct ? 'correct' : 'wrong') : 'pending';
        const text = document.createElement('span');
        text.textContent = q.statement;
        const badge = document.createElement('span');
        badge.className = 'question-result';
        badge.textContent = result
          ? result.correct
            ? '✓ Acertou'
            : '✗ Errou'
          : '– Não respondida';
        item.append(text, badge);
        list.append(item);
      });
      card.append(list);
    }
    container.append(card);
  });
}
async function reload() {
  const material = await getMaterial(materialId);
  render(material);
  return material;
}
$('[data-complete-review]').addEventListener('click', () => {
  const saved = completeReview(materialId, !studyFor(materialId).completed);
  $('[data-review-message]').textContent = saved
    ? isStudySyncEnabled()
      ? 'Andamento salvo neste navegador e aguardando sincronização com a conta.'
      : 'Seu andamento foi salvo neste navegador.'
    : 'Não foi possível salvar o andamento neste navegador.';
  render(currentMaterial);
});
$('[data-show-versions]').addEventListener('click', async () => {
  const dialog = $('[data-version-panel]'),
    list = $('[data-version-list]');
  dialog.showModal();
  list.textContent = 'Abrindo versões…';
  try {
    const versions = await getTranscriptionVersions(materialId);
    list.replaceChildren();
    versions.forEach((v) => {
      const row = document.createElement('div'),
        b = document.createElement('button');
      row.className = 'version-row';
      row.append(document.createTextNode(`Revisão ${v.revision} · ${formatDate(v.created_at)}`));
      b.type = 'button';
      b.className = 'text-action';
      b.textContent = 'Restaurar';
      b.disabled = v.revision === editingRevision;
      b.addEventListener('click', async () => {
        if (!confirm('Restaurar esta versão? Alterações não salvas serão descartadas.')) return;
        b.disabled = true;
        try {
          await restoreTranscriptionVersion(materialId, v.revision);
          original = new Map();
          $('[data-transcription-segments]').replaceChildren();
          await reload();
          dialog.close();
        } catch (e) {
          setStatus($('[data-transcription-message]'), e.message, 'error');
          b.disabled = false;
        }
      });
      row.append(b);
      list.append(row);
    });
  } catch (e) {
    list.textContent = e.message;
  }
});
$('[data-open-warnings]').addEventListener('click', () => $('[data-warning-panel]').showModal());
$('[data-regenerate-summary]').addEventListener('click', () => {
  if (!busy) $('[data-summary-dialog]').showModal();
});
$('[data-open-questions]').addEventListener('click', () => {
  if (!busy) $('[data-questions-dialog]').showModal();
});
function normalizeSummaryOptions(options) {
  return {
    format: { bullets: 'topics' }[options.format] || options.format,
    length: { brief: 'short', intermediate: 'standard' }[options.length] || options.length,
    // Plain language is opt-in; omitted otherwise so the request keeps its legacy shape.
    ...(options.readingLevel === 'simple' ? { readingLevel: 'simple' } : {}),
  };
}
async function generate(kind, options) {
  if (busy) return;
  if (kind === 'summary') options = normalizeSummaryOptions(options);
  const source = scientificReview.sourceRevisionId(),
    operation = JSON.stringify([kind, source, options]);
  if (!pending.has(operation)) pending.set(operation, crypto.randomUUID());
  busy = true;
  scientificReview.setBusy(true);
  const generationFields = [
    ...document.querySelectorAll(
      '[data-summary-form] select, [data-summary-form] button, [data-more-questions-form] select, [data-more-questions-form] button',
    ),
  ];
  const previousDisabled = generationFields.map((field) => field.disabled);
  generationFields.forEach((field) => {
    field.disabled = true;
  });
  $('[data-save-transcription]').disabled = true;
  $('[data-open-questions]').disabled = true;
  const message = messages[kind];
  setStatus(message, kind === 'summary' ? 'Gerando resumo…' : 'Gerando questões…');
  try {
    const job =
      kind === 'summary'
        ? await regenerateSummary(materialId, source, pending.get(operation), {
            format: options.format,
            length: options.length,
            ...(options.readingLevel ? { readingLevel: options.readingLevel } : {}),
          })
        : await generateQuestions(materialId, options.count, source, pending.get(operation));
    const result = await pollJob(job.jobId, {
      onUpdate: (state) => setStatus(message, jobLabel(state)),
    });
    if (result.status !== 'CONCLUIDA') {
      pending.delete(operation);
      throw Error(result.error_message || 'Não foi possível concluir. Tente novamente.');
    }
    pending.delete(operation);
    await reload();
    setStatus(message, '');
  } catch (e) {
    setStatus(message, e.message, 'error');
  } finally {
    busy = false;
    generationFields.forEach((field, index) => {
      field.disabled = previousDisabled[index];
    });
    scientificReview.setBusy(false);
    $('[data-save-transcription]').disabled = !currentMaterial?.transcription;
    $('[data-open-questions]').disabled = false;
  }
}
$('[data-summary-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  $('[data-summary-dialog]').close();
  generate('summary', {
    format: data.get('format'),
    length: data.get('length'),
    readingLevel: data.get('readingLevel'),
  });
});
$('[data-more-questions-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  $('[data-questions-dialog]').close();
  generate('questions', { count: Number($('#more-question-count').value) });
});
$('[data-open-export]').addEventListener('click', () => {
  $('[data-export-dialog]').showModal();
});
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedEdits()) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('pagehide', () => {
  clearInterval(clock);
  clearInterval(playbackRefreshTimer);
  stopTracking?.();
  transcriptPlayer.destroy();
  waveformController?.abort();
  captions.destroy();
  document.removeEventListener('fullscreenchange', syncFullscreen);
  player.destroy();
});
await reload().catch((e) => {
  $('[data-material-title]').textContent = 'Não foi possível abrir a aula';
  $('[data-material-meta]').textContent = e.message;
});
if (currentMaterial && !currentMaterial.transcription) {
  const jobId = params.get('job') || currentMaterial.activeJobId;
  if (jobId)
    pollJob(jobId, { onUpdate: updateWaiting })
      .then(() => reload())
      .catch((e) => {
        $('[data-processing-status]').textContent = e.message;
      });
  else {
    const interval = setInterval(async () => {
      try {
        await reload();
        if (
          currentMaterial.transcription ||
          ['ERRO', 'FALHOU', 'CANCELADA'].includes(currentMaterial.status)
        )
          clearInterval(interval);
      } catch (e) {
        $('[data-processing-status]').textContent = e.message;
      }
    }, 4000);
    window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  }
}
