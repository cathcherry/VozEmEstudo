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
import { getPlayback, removeOriginalVideo } from '../api/playback.api.js';
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
const segmentsContainer = $('[data-transcription-segments]');
const transcriptMessage = $('[data-transcription-message]');
const transcriptPlayer = initTranscriptPlayer({
  container: segmentsContainer,
  toolbar: $('[data-transcript-player-toolbar]'),
  player,
});
let playbackIdentity = '', renewBusy = false, lastRenewedAt = 0, playbackRequest = 0;
let materialToolsInitialized = false;
if (materialId) void initStudyTrackingPanel({ materialId }).catch((error) => {
  const panel = $('[data-study-tracking-panel]');
  if (panel && !panel.hidden) panel.textContent = error.message || 'Progresso indisponível.';
});
// One delegated listener keeps both existing follow controls in agreement.
const followAudio = $('[data-follow-audio]');
const toolbarFollow = $('[data-transcript-player-toolbar] input[type="checkbox"]');
function syncFollowControls(event) {
  if (event.target !== followAudio && event.target !== toolbarFollow) return;
  followAudio.checked = toolbarFollow.checked = event.target.checked;
}
document.addEventListener('change', syncFollowControls);
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
  $('[data-follow-audio]').closest('label').hidden = !player.source || !hasUsefulTiming();
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
  if (job.status === 'AGUARDANDO_REPETICAO') return 'Aguardando nova tentativa…';
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
const tips = [
  'Organize suas aulas por disciplina e tags.',
  'Você pode personalizar o formato e a extensão dos resumos.',
  'Use as questões para praticar o conteúdo da aula.',
];
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
  $('[data-waiting-tip]').textContent = tips[Math.floor(seconds / 12) % tips.length];
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
    timestamp.title = player.source
      ? 'Reproduzir a partir deste trecho'
      : 'Timestamp do trecho';
    timestamp.addEventListener('click', () => {
      if (player.source) player.seekTo(segment.start_ms / 1000);
    });
    const textarea = document.createElement('textarea');
    textarea.value =
      keepDraft && drafts.has(segment.id) ? drafts.get(segment.id) : segment.current_text;
    textarea.rows = Math.max(2, Math.ceil(segment.current_text.length / 90));
    textarea.setAttribute('aria-label', `Trecho iniciado em ${formatTimestamp(segment.start_ms)}`);
    article.append(timestamp, textarea);
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
  $('[data-transcription-segments]').replaceChildren();
  await reload();
}
$('[data-save-transcription]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await saveEdits(); }
  catch (error) { setStatus(transcriptMessage, error.message, 'error'); }
  finally { button.disabled = false; }
});
function hasUsefulTiming() {
  const segments = currentMaterial?.transcription?.transcription_segments || [];
  return (
    segments.length > 1 &&
    segments.every((s) => s.end_ms > s.start_ms && s.end_ms - s.start_ms < 45000)
  );
}
function installCaptions() {
  player.video.querySelectorAll('track').forEach((n) => n.remove());
  if (player.captionUrl) URL.revokeObjectURL(player.captionUrl);
  if (!hasUsefulTiming()) return;
  const stamp = (ms) => new Date(Math.max(0, ms)).toISOString().slice(11, 23);
  const offset = player.media === player.video ? player.timelineStart * 1000 : 0;
  const cues = currentMaterial.transcription.transcription_segments
    .map(
      (s) =>
        `${stamp(s.start_ms + offset)} --> ${stamp(s.end_ms + offset)}\n${s.current_text.replaceAll('-->', '→').replaceAll('<', '‹')}\n`,
    )
    .join('\n');
  player.captionUrl = URL.createObjectURL(new Blob(['WEBVTT\n\n' + cues], { type: 'text/vtt' }));
  const track = document.createElement('track');
  track.kind = 'captions';
  track.srclang = 'pt';
  track.label = 'Português';
  track.src = player.captionUrl;
  track.default = true;
  player.video.append(track);
}
function renderPlayback(material, force = false) {
  const section = document.querySelector('[data-audio-section]');
  const kind = document.querySelector('[data-playback-kind]');
  const audioAvailable = Boolean(material.signedAudioUrl);
  const videoAvailable = Boolean(material.signedVideoUrl && material.video);
  kind.querySelector('[value="audio"]').disabled = !audioAvailable;
  kind.querySelector('[value="video"]').disabled = !videoAvailable;
  if (kind.value === 'video' && !videoAvailable) kind.value = 'audio';
  if (!audioAvailable && videoAvailable) kind.value = 'video';
  document.querySelector('[data-remove-video]').hidden = !videoAvailable;
  const originalLink = document.querySelector('[data-open-original-video]');
  originalLink.hidden = !videoAvailable;
  if (videoAvailable) originalLink.href = material.signedVideoUrl;
  else originalLink.removeAttribute('href');
  section.hidden = !audioAvailable && !videoAvailable;
  if (section.hidden) {
    stopTracking?.(); stopTracking = null;
    player.media.pause(); player.source = '';
    player.audio.removeAttribute('src'); player.video.removeAttribute('src');
    playbackIdentity = '';
    return;
  }
  const video = kind.value === 'video';
  const identity = `${materialId}:${kind.value}`;
  if (!force && identity === playbackIdentity && player.source) return;
  stopTracking?.(); stopTracking = null;
  waveformController?.abort();
  waveformController = new AbortController();
  player.setSource({
    src: video ? material.signedVideoUrl : material.signedAudioUrl,
    title: material.title, video, format: video ? 'mp4' : material.audio?.extension || 'áudio',
    duration: video ? (material.video.clipEndMs - material.video.clipStartMs) / 1000 : (material.audio?.duration_ms || 0) / 1000,
    timelineStart: video ? material.video.clipStartMs / 1000 : 0,
    timelineDuration: video ? (material.video.clipEndMs - material.video.clipStartMs) / 1000 : 0,
    preservePosition: Boolean(playbackIdentity),
  });
  playbackIdentity = identity;
  installCaptions();
  stopTracking = trackPlayback(player, materialId);
  if (!video) loadWaveform(material.signedAudioUrl, waveformController.signal).catch(() => {});
}

async function renewPlayback({ automatic = false } = {}) {
  if (!currentMaterial || renewBusy || (automatic && Date.now() - lastRenewedAt < 30000)) return;
  renewBusy = true; lastRenewedAt = Date.now();
  const version = ++playbackRequest;
  const button = document.querySelector('[data-refresh-playback]');
  button.disabled = true;
  const message = document.querySelector('[data-playback-status]');
  setStatus(message, 'Renovando acesso à mídia…');
  try {
    const result = await getPlayback(materialId);
    if (version !== playbackRequest) return;
    Object.assign(currentMaterial, result);
    renderPlayback(currentMaterial, true);
    $('[data-retry-media]').hidden = true;
    layout();
    document.querySelectorAll('.segment-timestamp').forEach((item) => { item.disabled = !player.source; });
    setStatus(message, 'Acesso renovado. Posição e velocidade preservadas.', 'success');
  } catch (error) {
    if (version === playbackRequest) setStatus(message, error.message || 'Não foi possível renovar. Tente novamente.', 'error');
  } finally { renewBusy = false; button.disabled = false; }
}
document.querySelector('[data-refresh-playback]').addEventListener('click', () => { void renewPlayback(); });
document.querySelector('[data-playback-kind]').addEventListener('change', () => renderPlayback(currentMaterial));
document.querySelector('[data-remove-video]').addEventListener('click', async (event) => {
  if (!confirm('Remover o vídeo guardado desta aula?')) return;
  const button = event.currentTarget;
  button.disabled = true; ++playbackRequest;
  try {
    await removeOriginalVideo(materialId);
    Object.assign(currentMaterial, { video: null, signedVideoUrl: null });
    renderPlayback(currentMaterial, true);
    document.querySelectorAll('.segment-timestamp').forEach((item) => { item.disabled = !player.source; });
    setStatus(document.querySelector('[data-playback-status]'), 'Vídeo removido.', 'success');
  } catch (error) { setStatus(document.querySelector('[data-playback-status]'), error.message, 'error'); }
  finally { button.disabled = false; }
});
const playbackRefreshTimer = setInterval(() => {
  if (player.source && !player.media.paused) void renewPlayback({ automatic: true });
}, 8 * 60 * 1000);

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

$('[data-retry-media]').addEventListener('click', () => { void renewPlayback(); });
function renderSummary(summary) {
  renderMarkdown($('[data-summary-text]'), summary?.text || '');
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
  $('[data-material-meta]').textContent = material.subject || '';
  const tags = document.createElement('ul');
  tags.className = 'material-tags';
  tags.setAttribute('aria-label', 'Tags');
  for (const tag of studyFor(materialId).tags) {
    const item = document.createElement('li');
    item.textContent = tag;
    tags.append(item);
  }
  $('[data-material-tags]').replaceChildren(tags);
  $('[data-organize-material]').href = './historico.html?edit=' + encodeURIComponent(materialId);
  renderPlayback(material);
  if (!material.transcription)
    updateWaiting({
      status: material.status,
      current_stage: material.current_stage,
      created_at: material.created_at,
    });
  else {
    $('[data-transcription-revision]').textContent = material.transcription.current_revision;
    renderSegments(material.transcription);
  }
  installCaptions();
  scientificReview.render(material);
  $('[data-save-transcription]').disabled = busy || !material.transcription;
  if (!materialToolsInitialized) {
    materialToolsInitialized = true;
    void initMaterialTools({ materialId, context: () => currentMaterial, segments: segmentsContainer }).catch((error) => {
      const panel = $('[data-material-tools]');
      panel.hidden = false;
      panel.textContent = error.message || 'Ferramentas indisponíveis.';
    });
  }
  const summaries = material.summaries || [],
    summary = summaries.find((s) => s.is_current) || summaries[0];
  renderSummary(summary);
  $('[data-regenerate-summary]').textContent = summary ? 'Novo resumo' : 'Gerar resumo';
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
  $('[data-question-batches]').replaceChildren();
  (material.questionBatches || []).forEach((batch, i, batches) => {
    const row = document.createElement('details'),
      heading = document.createElement('summary'),
      link = document.createElement('a');
    row.className = 'question-batch-row';
    const answered = (batch.questions || []).filter(
      (q) => studyFor(materialId).answers[q.id],
    ).length;
    heading.textContent = `${batch.generated_count} questões · Conjunto ${batches.length - i}${answered ? ` · ${answered} respondidas` : ''}`;
    link.className = 'small-action';
    link.textContent = 'Responder questões';
    link.href = `./responder.html?material=${encodeURIComponent(materialId)}&batch=${encodeURIComponent(batch.id)}`;
    row.append(heading, link);
    $('[data-question-batches]').append(row);
  });
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
async function reload() {
  const material = await getMaterial(materialId);
  render(material);
  return material;
}
$('[data-complete-review]').addEventListener('click', () => {
  const saved = completeReview(materialId, !studyFor(materialId).completed);
  $('[data-review-message]').textContent = saved
    ? (isStudySyncEnabled() ? 'Andamento salvo neste navegador e aguardando sincronização com a conta.' : 'Seu andamento foi salvo neste navegador.')
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
    format: ({ bullets: 'topics' })[options.format] || options.format,
    length: ({ brief: 'short', intermediate: 'standard' })[options.length] || options.length,
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
  const generationFields = [...document.querySelectorAll('[data-summary-form] select, [data-summary-form] button, [data-more-questions-form] select, [data-more-questions-form] button')];
  const previousDisabled = generationFields.map((field) => field.disabled);
  generationFields.forEach((field) => { field.disabled = true; });
  $('[data-save-transcription]').disabled = true;
  $('[data-open-questions]').disabled = true;
  const message = messages[kind];
  setStatus(message, kind === 'summary' ? 'Gerando resumo…' : 'Gerando questões…');
  try {
    const job =
      kind === 'summary'
        ? await regenerateSummary(materialId, source, pending.get(operation), { format: options.format, length: options.length })
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
    generationFields.forEach((field, index) => { field.disabled = previousDisabled[index]; });
    scientificReview.setBusy(false);
    $('[data-save-transcription]').disabled = !currentMaterial?.transcription;
    $('[data-open-questions]').disabled = false;
  }
}
$('[data-summary-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  $('[data-summary-dialog]').close();
  generate('summary', { format: data.get('format'), length: data.get('length') });
});
$('[data-more-questions-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  $('[data-questions-dialog]').close();
  generate('questions', { count: Number($('#more-question-count').value) });
});
$('[data-open-export]').addEventListener('click', () => {
  $('[data-export-note]').textContent = hasUnsavedEdits()
    ? 'As alterações ainda não confirmadas não serão exportadas.'
    : '';
  $('[name=summary]').disabled = !currentMaterial.summaries?.length;
  $('[name=notes]').disabled = !studyFor(materialId).notes;
  $('[data-export-dialog]').showModal();
});
$('[data-export-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget),
    parts = ['# ' + currentMaterial.title];
  if (data.has('transcription'))
    parts.push(
      '## Transcrição\n\n' +
        currentMaterial.transcription.transcription_segments
          .map((s) => s.current_text)
          .join('\n\n'),
    );
  if (data.has('summary'))
    parts.push(
      '## Resumo\n\n' +
        (currentMaterial.summaries?.find((s) => s.is_current)?.text ||
          currentMaterial.summaries?.[0]?.text ||
          ''),
    );
  if (data.has('notes') && studyFor(materialId).notes)
    parts.push('## Minhas anotações\n\n' + studyFor(materialId).notes);
  const text = parts.join('\n\n'),
    format = data.get('format');
  if (parts.length === 1) {
    $('[data-export-note]').textContent = 'Escolha pelo menos um conteúdo.';
    return;
  }
  if (format === 'pdf') {
    $('[data-export-dialog]').close();
    const print = document.createElement('article');
    print.dataset.printExport = '';
    renderMarkdown(print, text);
    document.body.append(print);
    document.body.classList.add('print-export');
    window.print();
    document.body.classList.remove('print-export');
    print.remove();
  } else {
    const a = document.createElement('a'),
      url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.href = url;
    a.download = currentMaterial.title.replace(/[^\p{L}\p{N} _-]/gu, '') + '.' + format;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('[data-export-dialog]').close();
  }
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
  document.removeEventListener('change', syncFollowControls);
  waveformController?.abort();
  player.destroy();
  if (player.captionUrl) URL.revokeObjectURL(player.captionUrl);
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
