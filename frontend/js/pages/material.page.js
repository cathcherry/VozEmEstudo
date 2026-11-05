import { initTranscriptionReview } from '../utils/transcription-review.js';
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
import { getJob, getJobEvents, pollJob } from '../api/job.api.js';
import { statusLabel } from '../utils/material-ui.js';
import { studyFor, visitMaterial, completeReview, trackPlayback } from '../utils/study-store.js';
import { tagList } from '../utils/library-ui.js';
import { MediaPlayer } from '../utils/media-player.js';

await initAuthenticatedShell();
const params = new URLSearchParams(location.search);
const materialId = params.get('id');
const initialJobId = params.get('job');
if (!materialId) location.href = './historico.html';

const titleEl = document.querySelector('[data-material-title]');
const metaEl = document.querySelector('[data-material-meta]');
const statusEl = document.querySelector('[data-material-status]');
const processingText = document.querySelector('[data-processing-status]');
const eventList = document.querySelector('[data-processing-events]');
const segmentsContainer = document.querySelector('[data-transcription-segments]');
const transcriptMessage = document.querySelector('[data-transcription-message]');
const audioPlayer = new MediaPlayer(document.querySelector('[data-audio-player]'));
let waveformController, stopTracking;
let currentMaterial,
  editingRevision,
  generationBusy = false;
const pendingGeneration = new Map();
let questionCountInitialized = false;
let originalSegmentText = new Map();
let didInitialScroll = false,
  visited = false;
function hasUnsavedEdits() {
  return [...document.querySelectorAll('.transcription-segment')].some(
    (node) =>
      node.querySelector('textarea').value.trim() !==
      originalSegmentText.get(node.dataset.segmentId),
  );
}
const scientificReview = initTranscriptionReview({
  materialId,
  currentMaterial: () => currentMaterial,
  reload,
  hasUnsavedEdits,
});
const reviewButton = document.querySelector('[data-complete-review]');
function updateReview() {
  const complete = studyFor(materialId).completed;
  reviewButton.setAttribute('aria-pressed', String(complete));
  reviewButton.textContent = complete ? 'Revisão concluída · desfazer' : 'Marcar revisão concluída';
}
reviewButton.addEventListener('click', () => {
  const saved = completeReview(materialId, !studyFor(materialId).completed);
  updateReview();
  document.querySelector('[data-review-message]').textContent = saved
    ? 'Seu andamento foi salvo neste navegador.'
    : 'Não foi possível salvar o andamento neste navegador.';
});
document.querySelector('[data-organize-material]').href =
  './historico.html?edit=' + encodeURIComponent(materialId);
const workflow = document.querySelector('.workflow-steps');
workflow.hidden = params.get('from') !== 'upload';
function updateWorkflow(done) {
  workflow.querySelectorAll('[data-workflow-step]').forEach((item) => {
    const number = Number(item.dataset.workflowStep);
    const current = !done && number === 3;
    item.classList.toggle('current', current);
    item.classList.toggle('completed', done || number < 3);
    if (current) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.querySelector('.step-number').textContent = done || number < 3 ? '✓' : number;
  });
}

function jobLabel(job) {
  const stages = {
    VALIDACAO: 'Validando',
    TRANSCRICAO: 'Transcrevendo',
    RESUMO: 'Gerando resumo',
    QUESTOES: 'Gerando questões',
    FINALIZACAO: 'Finalizando',
  };
  if (job.status === 'CONCLUIDA') return 'Processamento concluído.';
  if (job.status === 'FALHOU') return job.error_message || 'O processamento falhou.';
  if (job.status === 'CANCELADA') return 'Processamento cancelado.';
  if (job.status === 'AGUARDANDO_REPETICAO')
    return 'Falha temporária. O sistema tentará novamente.';
  return stages[job.current_stage] || 'Aguardando processamento...';
}

async function renderJob(jobId) {
  if (!jobId) return;
  try {
    const events = await getJobEvents(jobId);
    eventList.innerHTML = '';
    events.forEach((event) => {
      const li = document.createElement('li');
      li.textContent = `${formatDate(event.created_at)} — ${event.message || event.stage || event.status}`;
      eventList.appendChild(li);
    });
  } catch {
    /* Job events are optional; preserve material content when the event endpoint fails. */
  }
}

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
  originalSegmentText = new Map();
  (transcription.transcription_segments || []).forEach((segment, index) => {
    originalSegmentText.set(segment.id, segment.current_text);
    const article = document.createElement('article');
    article.className = 'transcription-segment';
    article.dataset.segmentId = segment.id;
    article.dataset.segmentPosition = segment.position ?? index;
    const timestamp = document.createElement('button');
    timestamp.type = 'button';
    timestamp.className = 'segment-timestamp';
    timestamp.textContent = `${formatTimestamp(segment.start_ms)}–${formatTimestamp(segment.end_ms)}`;
    timestamp.title = currentMaterial?.signedAudioUrl
      ? 'Reproduzir a partir deste trecho'
      : 'Timestamp do trecho';
    timestamp.addEventListener('click', () => {
      if (audioPlayer.source) audioPlayer.seekTo(segment.start_ms / 1000);
    });
    const textarea = document.createElement('textarea');
    textarea.value =
      keepDraft && drafts.has(segment.id) ? drafts.get(segment.id) : segment.current_text;
    textarea.rows = Math.max(2, Math.ceil(segment.current_text.length / 90));
    textarea.setAttribute('aria-label', `Trecho iniciado em ${formatTimestamp(segment.start_ms)}`);
    article.append(timestamp, textarea);
    segmentsContainer.appendChild(article);
  });
}

function renderMaterial(material) {
  currentMaterial = material;
  if (!questionCountInitialized && [3, 5, 10, 20].includes(material.initial_question_count)) {
    document.querySelector('#more-question-count').value = String(material.initial_question_count);
    questionCountInitialized = true;
  }
  if (!visited) {
    visitMaterial(materialId);
    visited = true;
  }
  updateReview();
  document.querySelector('[data-material-tags]').replaceChildren(tagList(material));
  titleEl.textContent = material.title;
  metaEl.textContent = `${material.subject || 'Sem disciplina'} · criado em ${formatDate(material.created_at)}`;
  statusEl.textContent =
    material.review?.state === 'awaiting_review' && material.status !== 'PROCESSANDO'
      ? 'Aguardando confirmação'
      : statusLabel(material);
  updateWorkflow(['PRONTO', 'PARCIAL'].includes(material.status));
  processingText.textContent =
    material.status === 'PRONTO'
      ? 'Material pronto para estudar.'
      : material.status === 'PARCIAL'
        ? 'A transcrição está disponível. Confira os materiais abaixo.'
        : material.current_stage
          ? jobLabel({ current_stage: material.current_stage, status: material.status })
          : statusLabel(material);

  if (material.review?.state === 'awaiting_review' && material.status !== 'PROCESSANDO')
    processingText.textContent = 'Transcrição pronta para conferência. Aguardando confirmação.';
  else if (
    material.review?.state === 'ready_to_generate' &&
    material.status !== 'PROCESSANDO' &&
    material.status !== 'PRONTO'
  )
    processingText.textContent = 'Pronto para gerar resumo e questões desta revisão.';

  const audioSection = document.querySelector('[data-audio-section]');
  if (material.signedAudioUrl) {
    audioSection.hidden = false;
    if (audioPlayer.source !== material.signedAudioUrl) {
      const wasPlaying = !audioPlayer.media.paused;
      stopTracking?.();
      waveformController?.abort();
      waveformController = new AbortController();
      audioPlayer.setSource({
        src: material.signedAudioUrl,
        title: material.title,
        format: material.audio?.extension || 'áudio',
        duration: (material.audio?.duration_ms || 0) / 1000,
      });
      stopTracking = trackPlayback(audioPlayer, materialId);
      if (wasPlaying)
        audioPlayer.media.addEventListener('loadedmetadata', () => audioPlayer.play(), {
          once: true,
        });
      loadWaveform(material.signedAudioUrl, waveformController.signal).catch(() => {});
    }
  } else {
    audioSection.hidden = true;
    stopTracking?.();
    stopTracking = null;
    audioPlayer.media.pause();
  }

  const transcription = material.transcription;
  const transcriptionSection = document.querySelector('[data-transcription-section]');
  transcriptionSection.hidden = !transcription;
  if (transcription) {
    document.querySelector('[data-transcription-revision]').textContent =
      transcription.current_revision;
    renderSegments(transcription);
  }

  scientificReview.render(material);

  const summarySection = document.querySelector('[data-summary-section]');
  const currentSummary = material.summaries?.find((s) => s.is_current) || material.summaries?.[0];
  summarySection.hidden = !currentSummary;
  if (currentSummary) {
    document.querySelector('[data-summary-text]').textContent = currentSummary.text;
    document.querySelector('[data-summary-meta]').textContent =
      `Versão ${currentSummary.version} · baseada na revisão ${currentSummary.source_transcription_revision}${currentSummary.stale ? ' · a revisão atual mudou' : ''}`;
  }

  const questionsSection = document.querySelector('[data-questions-section]');
  const batches = material.questionBatches || [];
  questionsSection.hidden = !transcription;
  const batchesEl = document.querySelector('[data-question-batches]');
  batchesEl.innerHTML = '';
  if (!batches.length) {
    const note = document.createElement('p');
    note.className = 'plain-note';
    note.textContent = 'Ainda não há questões. Gere um novo lote usando a transcrição desta aula.';
    batchesEl.append(note);
  }
  batches.forEach((batch, index) => {
    const block = document.createElement('article');
    block.className = 'question-batch-card';
    block.innerHTML = `<h3>Lote ${batches.length - index}</h3><p>${batch.generated_count} questões · revisão de origem ${batch.source_transcription_revision}${batch.stale ? ' · <strong>a revisão atual mudou</strong>' : ''}</p><a class="small-action">Responder este lote</a>`;
    block.querySelector('a').href =
      `./responder.html?material=${encodeURIComponent(material.id)}&batch=${encodeURIComponent(batch.id)}`;
    batchesEl.appendChild(block);
  });
  const latest = batches[0];
  const answerLink = document.querySelector('[data-answer-latest]');
  answerLink.hidden = !latest;
  if (latest)
    answerLink.href = `./responder.html?material=${encodeURIComponent(material.id)}&batch=${encodeURIComponent(latest.id)}`;
  document.querySelector('[data-material-tab="transcription"]').hidden = !transcription;
  document.querySelector('[data-material-tab="summary"]').hidden = !currentSummary;
  document.querySelector('[data-material-tab="questions"]').hidden = !transcription;
  if (!didInitialScroll && location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target && !target.hidden) {
      didInitialScroll = true;
      requestAnimationFrame(() => {
        target.scrollIntoView();
        const focus = target.querySelector('select,input,button') || target;
        if (focus === target) focus.tabIndex = -1;
        focus.focus({ preventScroll: true });
      });
    }
  }
}

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
    if (!signal.aborted && audioPlayer.source === url) audioPlayer.setPeaks(peaks);
  } finally {
    await context.close();
  }
}
window.addEventListener('beforeunload', () => {
  stopTracking?.();
  waveformController?.abort();
  audioPlayer.destroy();
});

async function reload() {
  const material = await getMaterial(materialId);
  renderMaterial(material);
  return material;
}

await reload().catch((error) => {
  titleEl.textContent = 'Não foi possível abrir o material';
  metaEl.textContent = error.message;
  processingText.textContent = 'Volte à Biblioteca para tentar novamente.';
});

if (initialJobId) {
  const initial = await getJob(initialJobId).catch(() => null);
  if (initial) {
    if (initial.status !== 'CONCLUIDA') processingText.textContent = jobLabel(initial);
    updateWorkflow(initial.status === 'CONCLUIDA');
    if (document.querySelector('.processing-details').open) await renderJob(initialJobId);
    if (!['CONCLUIDA', 'FALHOU', 'CANCELADA'].includes(initial.status)) {
      pollJob(initialJobId, {
        onUpdate: async (job) => {
          if (processingText.textContent !== jobLabel(job))
            processingText.textContent = jobLabel(job);
          statusEl.textContent =
            job.status === 'CONCLUIDA'
              ? 'Pronto'
              : job.status === 'FALHOU'
                ? 'Com erro'
                : job.status === 'CANCELADA'
                  ? 'Cancelado'
                  : 'Processando';
          updateWorkflow(job.status === 'CONCLUIDA');
          if (document.querySelector('.processing-details').open) await renderJob(initialJobId);
        },
      })
        .then(async () => {
          await reload();
        })
        .catch((e) => {
          processingText.textContent = e.message;
        });
    }
  }
}

document.querySelector('.processing-details')?.addEventListener('toggle', () => {
  if (initialJobId && document.querySelector('.processing-details').open) renderJob(initialJobId);
});

document.querySelector('[data-save-transcription]')?.addEventListener('click', async () => {
  const transcription = currentMaterial?.transcription;
  if (!transcription) return;
  const edits = [];
  document.querySelectorAll('.transcription-segment').forEach((node) => {
    const id = node.dataset.segmentId;
    const text = node.querySelector('textarea').value.trim();
    if (text !== originalSegmentText.get(id)) edits.push({ id, text });
  });
  if (!edits.length) {
    setStatus(transcriptMessage, 'Nenhuma alteração para salvar.', '');
    return;
  }
  try {
    setStatus(transcriptMessage, 'Salvando nova revisão...', '');
    const result = await saveTranscriptionEdits(materialId, editingRevision, edits);
    setStatus(
      transcriptMessage,
      `Transcrição salva como revisão ${result.revision}. Confira e confirme a nova revisão para gerar novamente; os materiais anteriores permanecem ligados à fonte original.`,
      'success',
    );
    originalSegmentText = new Map();
    segmentsContainer.replaceChildren();
    await reload();
  } catch (error) {
    setStatus(transcriptMessage, error.message, 'error');
  }
});

document.querySelector('[data-show-versions]')?.addEventListener('click', async () => {
  const panel = document.querySelector('[data-version-panel]');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  const list = document.querySelector('[data-version-list]');
  list.textContent = 'Carregando versões...';
  try {
    const versions = await getTranscriptionVersions(materialId);
    list.innerHTML = '';
    versions.forEach((version) => {
      const row = document.createElement('div');
      row.className = 'version-row';
      row.innerHTML = `<span><strong>Revisão ${version.revision}</strong> · ${version.origin} · ${formatDate(version.created_at)}</span><button type="button" class="small-action">Restaurar</button>`;
      row.querySelector('button').disabled =
        version.revision === currentMaterial.transcription.current_revision;
      row.querySelector('button').addEventListener('click', async () => {
        const restoreButton = row.querySelector('button');
        if (restoreButton.disabled) return;
        if (
          !confirm(
            `Restaurar o conteúdo da revisão ${version.revision}? Uma nova revisão será criada.${hasUnsavedEdits() ? ' Suas alterações não salvas serão descartadas.' : ''}`,
          )
        )
          return;
        try {
          restoreButton.disabled = true;
          await restoreTranscriptionVersion(materialId, version.revision);
          segmentsContainer.replaceChildren();
          originalSegmentText = new Map();
          await reload();
          panel.hidden = true;
        } catch (error) {
          alert(error.message);
          restoreButton.disabled = false;
        }
      });
      list.appendChild(row);
    });
  } catch (error) {
    list.textContent = error.message;
  }
});

async function runGeneration(kind, count, message) {
  if (generationBusy) return;
  const sourceRevisionId = scientificReview.sourceRevisionId();
  const summaryOptions = {
    format: document.querySelector('[data-summary-format]').value,
    length: document.querySelector('[data-summary-length]').value,
  };
  const operation = kind + ':' + sourceRevisionId + ':' + (count || '') +
    (kind === 'summary' ? ':' + JSON.stringify(summaryOptions) : '');
  let key = pendingGeneration.get(operation);
  if (!key) {
    key = crypto.randomUUID();
    pendingGeneration.set(operation, key);
  }
  generationBusy = true;
  scientificReview.setBusy(true);
  try {
    setStatus(message, 'Enfileirando geração da revisão confirmada…');
    const job =
      kind === 'summary'
        ? await regenerateSummary(materialId, sourceRevisionId, key, summaryOptions)
        : await generateQuestions(materialId, count, sourceRevisionId, key);
    const result = await pollJob(job.jobId, {
      onUpdate: (state) => {
        if (kind === 'summary') processingText.textContent = jobLabel(state);
        else setStatus(message, jobLabel(state));
      },
    });
    if (result.status !== 'CONCLUIDA') {
      pendingGeneration.delete(operation);
      throw new Error(result.error_message || 'A geração não foi concluída. Tente novamente.');
    }
    pendingGeneration.delete(operation);
    setStatus(message, kind === 'summary' ? 'Resumo gerado.' : 'Novo lote gerado.', 'success');
    await reload();
  } finally {
    generationBusy = false;
    scientificReview.setBusy(false);
  }
}
for (const button of document.querySelectorAll('[data-regenerate-summary],[data-generate-summary]'))
  button.addEventListener('click', () => {
    if (button.disabled) return;
    runGeneration('summary', null, processingText).catch((error) => {
      setStatus(processingText, error.message, 'error');
    });
  });
document.querySelector('[data-more-questions-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  if (button.disabled) return;
  const message = document.querySelector('[data-more-questions-message]');
  try {
    await runGeneration(
      'questions',
      Number(document.querySelector('#more-question-count').value),
      message,
    );
  } catch (error) {
    setStatus(message, error.message, 'error');
  }
});

