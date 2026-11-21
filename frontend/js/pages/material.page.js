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
  renameSummary,
  renameQuestionList,
} from '../api/material.api.js';
import { getPublicConfig } from '../api/config.js';
import { initQuestionDialog, renderQuestionLists } from './question-lists.js';
import { initExportPanel } from './export-panel.js';
import { initListShare } from './list-share.js';
import { initFlashcardAuthoring } from './flashcard-authoring.js';
import { normalizeSummaryOptions, summaryName, summaryDetails } from '../utils/authoring.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState, ninoNote } from '../utils/material-ui.js';
import { pollJob } from '../api/job.api.js';
import { initTranscriptionReview } from '../utils/transcription-review.js';
import { studyFor, visitMaterial, completeReview, trackPlayback, updateStudy } from '../utils/study-store.js';
import { MediaPlayer } from '../utils/media-player.js';
import { initTranscriptPlayer } from '../utils/transcript-player.js';
import { getPlayback, getCaptions, removeOriginalVideo } from '../api/playback.api.js';
import { PlayerCaptions } from '../utils/captions.js';
import { speakControls, speechLang } from '../utils/speech.js';
import { isStudySyncEnabled } from '../utils/study-sync.js';
import { initMaterialTools } from './material-tools.js';
import { renderMarkdown } from '../utils/markdown.js';
import { lessonProgress, renderLessonSteps, lessonMode } from '../utils/lesson-steps.js';
import { listFlashcardSets } from '../api/flashcard.api.js';
import { listQuizSessions } from '../api/quiz-session.api.js';

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
const TAB_HASH = { transcription: 'transcricao', summary: 'resumo', questions: 'questoes', flashcards: 'flashcards', notes: 'anotacoes' };
const hashTab = { '#resumo': 'summary', '#questoes': 'questions', '#gerar-questoes': 'questions', '#anotacoes': 'notes', '#transcricao': 'transcription', '#flashcards': 'flashcards' }[location.hash];
let activeTab = hashTab || 'transcription';
// The preparation guide reopened from "Guia da aula" while the lesson is already in study mode.
let guideOpen = false;
let waitingSince,
  initialRender = true,
  displayedSummary = null;
const flags = await getFeatureFlags().catch(() => ({}));
const publicConfig = await getPublicConfig().catch(() => ({}));
// Custom list sizes only exist with the authoring migration; presets otherwise.
const maxQuestionCount = flags.study_authoring ? publicConfig.maxQuestionListCount || 40 : 20;
// Names need the study-authoring migration; without it the field is not offered.
if (!flags.study_authoring)
  document.querySelector('[data-summary-form] [name=label]').closest('label').hidden = true;
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
// A small speaker icon next to the version title; hidden or slowed down in Aparência.
const summarySpeech = speakControls({
  blocks: () => readBlocks($('[data-summary-text]')),
  lang: lessonLang,
  label: 'Ouvir resumo',
  icon: true,
});
if (summarySpeech) $('[data-summary-speech]').append(summarySpeech.element);
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
let materialToolsInitialized = false,
  notesEnabled = false;
// The focus timer for this lesson lives in the utility panel (utils/utility-shell.js).
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
  $('[data-material-tab="notes"]').hidden = !notesEnabled;
  if (activeTab === 'notes' && !notesEnabled) activeTab = 'transcription';
  const setsTab = Boolean(flags.flashcards && flags.flashcard_sets);
  $('[data-material-tab="flashcards"]').hidden = !setsTab;
  if (activeTab === 'flashcards' && !setsTab) activeTab = 'transcription';
  if (activeTab === 'flashcards' && ready()) void renderLessonSets();
  for (const name of ['transcription', 'summary', 'questions', 'flashcards', 'notes']) {
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
  updateLessonSteps();
}

// ---- Study path of this lesson ----------------------------------------------------------
// Flashcard sets and question attempts live outside the material, so they load once on demand.
let lessonExtras = { sets: null, attempted: false };
let lessonExtrasLoaded = false;
async function loadLessonExtras() {
  lessonExtrasLoaded = true;
  const [sets, sessions] = await Promise.all([
    flags.flashcards && flags.flashcard_sets
      ? listFlashcardSets(materialId).catch(() => null)
      : null,
    flags.quiz_v2 ? listQuizSessions().catch(() => []) : [],
  ]);
  lessonExtras = {
    sets: Array.isArray(sets) ? sets.length : null,
    attempted: sessions.some((session) => session.material_id === materialId),
  };
  updateLessonSteps();
}
function currentLessonMode() {
  const batches = currentMaterial?.questionBatches || [];
  const questionIds = new Set(batches.flatMap((batch) => (batch.questions || []).map((q) => q.id)));
  const study = studyFor(materialId);
  return lessonMode({
    ready: ready(),
    summaries: (currentMaterial?.summaries || []).length,
    lists: batches.length,
    answered: lessonExtras.attempted || Object.keys(study.answers || {}).some((id) => questionIds.has(id)),
    studied: Boolean(study.completed) || (study.intervals || []).length > 0,
    dismissed: Boolean(study.guideDismissed),
  });
}
// Preparation card: the guide while a lesson is being prepared, or when reopened on request.
function updatePreparation(mode) {
  const card = $('[data-lesson-prep]');
  const transcript = Boolean(currentMaterial?.transcription);
  const show = transcript && (mode === 'preparation' || guideOpen);
  card.hidden = !show;
  const guideButton = $('[data-open-lesson-guide]');
  guideButton.hidden = !transcript || !ready() || mode !== 'study' || guideOpen;
  guideButton.setAttribute('aria-expanded', String(guideOpen));
  if (!show) return false;
  const reopened = mode === 'study';
  $('[data-lesson-prep-title]').textContent = !ready()
    ? 'Prepare esta aula'
    : reopened
      ? 'Guia da aula'
      : 'Aula pronta para estudar';
  $('[data-lesson-prep-copy]').textContent = !ready()
    ? 'Confira o texto reconhecido, corrija o que estiver errado e confirme. Resumo, questões e flashcards usam a versão confirmada.'
    : reopened
      ? 'As etapas desta aula e o próximo passo sugerido.'
      : 'Transcrição confirmada. Gere um resumo, questões ou flashcards — ou comece a estudar direto.';
  $('[data-lesson-prep-close]').hidden = !reopened;
  $('[data-lesson-prep-footer]').hidden = !ready() || reopened;
  return true;
}
function updateLessonSteps() {
  const container = $('[data-lesson-steps]');
  if (!container) return;
  if (!currentMaterial?.transcription) {
    container.hidden = true;
    $('[data-lesson-prep]').hidden = true;
    return;
  }
  if (!updatePreparation(currentLessonMode())) {
    container.hidden = true;
    if (!lessonExtrasLoaded && ready()) void loadLessonExtras();
    return;
  }
  if (!lessonExtrasLoaded && ready()) void loadLessonExtras();
  const batches = currentMaterial.questionBatches || [];
  const questionIds = new Set(batches.flatMap((batch) => (batch.questions || []).map((q) => q.id)));
  const answers = studyFor(materialId).answers || {};
  const progress = lessonProgress({
    ready: ready(),
    summaries: (currentMaterial.summaries || []).length,
    lists: batches.length,
    answered: lessonExtras.attempted || Object.keys(answers).some((id) => questionIds.has(id)),
    flashcards: flags.flashcards && flags.flashcard_sets ? Boolean(lessonExtras.sets) : null,
  });
  // Before confirmation the page already offers "Conferir transcrição" / "Confirmar e continuar".
  if (!ready()) progress.next = null;
  let done = null;
  if (ready() && !progress.next) {
    done = document.createElement('p');
    done.className = 'lesson-next-copy';
    const title = document.createElement('strong');
    title.textContent = 'Aula estudada';
    const text = document.createElement('span');
    text.textContent = 'Revise os cartões e os erros nos próximos dias. ';
    done.append(title, text);
    if (flags.flashcards || flags.quiz_v2) {
      const link = document.createElement('a');
      link.href = './revisar.html';
      link.textContent = 'Ir para Revisar';
      text.append(link);
    }
  }
  renderLessonSteps(container, progress, { onStep: runLessonStep, done });
}
function runLessonStep(id) {
  const open = (tab, selector) => {
    selectTab(tab, true);
    if (selector) $(selector)?.click();
  };
  switch (id) {
    case 'view:transcription':
    case 'transcription':
      if (!ready() && !$('[data-review-welcome]').hidden) $('[data-check-transcription]').click();
      else selectTab('transcription', ready());
      break;
    case 'view:summary':
      open('summary');
      break;
    case 'summary':
      open('summary', '[data-regenerate-summary]');
      break;
    case 'view:questions':
      open('questions');
      break;
    case 'questions':
      open('questions', '[data-open-questions]');
      break;
    case 'answer': {
      const link = $('[data-question-batches] a[href*="responder.html"]');
      if (link) location.href = link.href;
      else open('questions');
      break;
    }
    case 'view:flashcards':
      open('flashcards');
      break;
    case 'flashcards':
      open('flashcards');
      void flashcardAuthoring?.open();
      break;
  }
}
function selectTab(name, focus = false) {
  if (!ready() && name !== 'transcription') return;
  activeTab = name;
  layout();
  history.replaceState(null, '', '#' + TAB_HASH[name]);
  // Coming back to the lesson opens the tab the student used last.
  if (ready() && studyFor(materialId).lastTab !== name) updateStudy(materialId, { lastTab: name });
  if (focus) $(`[data-material-tab="${name}"]`).focus();
}
$('[data-open-lesson-guide]').addEventListener('click', () => {
  guideOpen = true;
  layout();
  const title = $('[data-lesson-prep-title]');
  title.tabIndex = -1;
  title.focus();
});
$('[data-lesson-prep-close]').addEventListener('click', () => {
  guideOpen = false;
  layout();
  $('[data-open-lesson-guide]').focus();
});
$('[data-start-studying]').addEventListener('click', () => {
  updateStudy(materialId, { guideDismissed: true });
  guideOpen = false;
  layout();
  $(`[data-material-tab="${activeTab}"]`)?.focus();
});
// Flashcards tab: this lesson's card sets, with a way to review each one now.
let lessonSetsLoading = null;
async function renderLessonSets() {
  if (lessonSetsLoading) return lessonSetsLoading;
  const host = $('[data-lesson-sets]');
  const meta = $('[data-lesson-sets-meta]');
  lessonSetsLoading = (async () => {
    try {
      const sets = await listFlashcardSets(materialId);
      host.replaceChildren();
      const cards = sets.reduce((sum, set) => sum + (Number(set.card_count) || 0), 0);
      meta.textContent = sets.length
        ? `${sets.length} ${sets.length === 1 ? 'conjunto' : 'conjuntos'} · ${cards} ${cards === 1 ? 'cartão' : 'cartões'}`
        : '';
      if (!sets.length) {
        host.append(
          ninoNote('Transforme o resumo desta aula em cartões para revisar nos próximos dias.', 'reading', {
            title: 'Ainda não há flashcards desta aula',
            action: { label: 'Criar flashcards', onClick: () => void flashcardAuthoring?.open() },
          }),
        );
        return;
      }
      for (const set of sets) {
        const row = document.createElement('article');
        row.className = 'lesson-set-row';
        const title = document.createElement('h3');
        title.textContent = set.name;
        const info = document.createElement('p');
        const due = Number(set.due_count) || 0;
        info.textContent = `${Number(set.card_count) || 0} cartões · ${due ? `${due} para revisar hoje` : 'nada pendente hoje'}`;
        const review = document.createElement('a');
        review.className = due ? 'primary-action' : 'secondary-action';
        review.href = `./revisar.html?conjunto=${encodeURIComponent(set.id)}#flashcards`;
        review.textContent = due ? 'Revisar agora' : 'Abrir conjunto';
        const text = document.createElement('div');
        text.append(title, info);
        row.append(text, review);
        host.append(row);
      }
    } catch (error) {
      host.replaceChildren(ninoNote(error.message || 'Não foi possível carregar os flashcards.', 'curious'));
    } finally {
      lessonSetsLoading = null;
    }
  })();
  return lessonSetsLoading;
}
$('[data-create-lesson-flashcards]').addEventListener('click', () => void flashcardAuthoring?.open());
// The notes panel asks to show its tab (Comentar) or the transcript (Ir ao destaque).
document.addEventListener('voz:open-notes', () => {
  if (notesEnabled) selectTab('notes');
});
document.addEventListener('voz:open-transcript', () => selectTab('transcription'));
const tabs = [...document.querySelectorAll('[data-material-tab]')];
tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.materialTab));
  tab.addEventListener('keydown', (e) => {
    // Only the tabs on screen (Anotações is hidden when notes are off).
    const shown = tabs.filter((item) => !item.hidden);
    const index = shown.indexOf(tab);
    let next;
    if (e.key === 'ArrowRight') next = (index + 1) % shown.length;
    if (e.key === 'ArrowLeft') next = (index + shown.length - 1) % shown.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = shown.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      selectTab(shown[next].dataset.materialTab, true);
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
  // Live heading polled every few seconds: write only on change to avoid repeated announcements.
  const label = jobLabel(job);
  if ($('[data-processing-status]').textContent !== label)
    $('[data-processing-status]').textContent = label;
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
const summaryKey = (summary) => summary.id || `version-${summary.version}`;
function renderSummary(summary) {
  summarySpeech?.speaker.stop();
  displayedSummary = summary || null;
  renderMarkdown($('[data-summary-text]'), summary?.text || '');
  $('[data-summary-text]').hidden = !summary;
  const emptySummary = $('[data-summary-empty]');
  emptySummary.hidden = Boolean(summary);
  if (!summary && !emptySummary.childElementCount)
    emptySummary.append(
      ninoNote('Ainda não há resumo desta aula. Use “Gerar resumo” para criar o primeiro.', 'rest'),
    );
  if (summarySpeech) summarySpeech.element.hidden = !summary;
  const name = $('[data-summary-name]');
  name.textContent = summary ? summaryName(summary) : '';
  name.hidden = !summary;
  $('[data-rename-summary]').hidden = !summary || !flags.study_authoring;
  $('[data-open-flashcards]').hidden = !(flags.flashcards && flags.flashcard_sets && ready());
  $('[data-summary-meta]').textContent = summary
    ? [
        ...summaryDetails(summary),
        summary.created_at ? formatDate(summary.created_at) : '',
        summary.is_current ? '' : 'versão anterior',
        summary.stale ? 'baseado em uma revisão anterior da transcrição' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Ainda não há resumo desta aula.';
  for (const button of document.querySelectorAll('[data-summary-version-list] button'))
    button.setAttribute(
      'aria-current',
      String(Boolean(summary) && button.dataset.summaryKey === summaryKey(summary)),
    );
}
function render(material) {
  currentMaterial = material;
  if (initialRender) {
    visitMaterial(materialId);
    initialRender = false;
    const lastTab = studyFor(materialId).lastTab;
    if (!hashTab && ready() && TAB_HASH[lastTab] && lastTab !== 'notes') activeTab = lastTab;
    if (params.has('from') && !ready()) activeTab = 'transcription';
    // Library "Editar transcrição": Transcrição tab in edit mode (pending revisions already edit).
    if (params.get('edit') === 'transcricao' && material.transcription) {
      activeTab = 'transcription';
      if (ready()) editing = true;
      else reviewOpened = true;
      queueMicrotask(() => $('.transcription-segment textarea')?.focus({ preventScroll: true }));
    }
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
    })
      .then((tools) => {
        notesEnabled = tools.notesEnabled;
        // #anotacoes (or the last tab) opens the notes once the tools say they exist.
        if (notesEnabled && ready() && (hashTab === 'notes' || (!hashTab && studyFor(materialId).lastTab === 'notes'))) activeTab = 'notes';
        layout();
      })
      .catch((error) => {
        const panel = $('[data-material-tools]');
        panel.hidden = false;
        panel.textContent = error.message || 'Ferramentas indisponíveis.';
      });
  }
  const summaries = material.summaries || [];
  const summary =
    (displayedSummary && summaries.find((s) => summaryKey(s) === summaryKey(displayedSummary))) ||
    summaries.find((s) => s.is_current) ||
    summaries[0];
  $('[data-regenerate-summary]').textContent = summaries.length
    ? 'Gerar novo resumo'
    : 'Gerar resumo';
  // The menu also holds "Renomear esta versão", so with names enabled it shows for one version too.
  $('[data-summary-history]').hidden = summaries.length < (flags.study_authoring ? 1 : 2);
  $('[data-summary-version-list]').replaceChildren();
  summaries.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'text-action version-choice';
    b.type = 'button';
    b.dataset.summaryKey = summaryKey(s);
    const title = document.createElement('span');
    title.textContent = summaryName(s);
    const meta = document.createElement('small');
    meta.textContent = [
      s.label ? `Versão ${s.version}` : '',
      s.created_at ? formatDate(s.created_at) : '',
      s.is_current ? 'mais recente' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    b.append(title, meta);
    b.addEventListener('click', () => {
      renderSummary(s);
      $('[data-summary-history]').open = false;
    });
    $('[data-summary-version-list]').append(b);
  });
  renderSummary(summary);
  renderQuestionBatches(material.questionBatches || []);
  $('[data-complete-review]').setAttribute('aria-pressed', String(studyFor(materialId).completed));
  $('[data-complete-review]').textContent = studyFor(materialId).completed
    ? 'Aula estudada · desfazer'
    : 'Marcar aula como estudada';
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
 * Each list shows its real questions and the locally recorded result of each one, so an
 * "answered" count is always backed by something the student can review.
 */
function renderQuestionBatches(batches) {
  renderQuestionLists({
    container: $('[data-question-batches]'),
    meta: $('[data-questions-meta]'),
    batches,
    answers: studyFor(materialId).answers,
    materialId,
    flags,
    actions: {
      export: (batch, name) => exportPanel.open({ listId: batch.id, listLabel: name }),
      ...(flags.study_authoring && flags.sharing
        ? { share: (batch, name) => listShare.open(batch, name) }
        : {}),
      rename: (batch, name) =>
        openRename({
          title: 'Renomear lista',
          label: 'Nome da lista',
          value: batch.title || name,
          save: (title) => {
            if (!title) throw new Error('Informe um nome para a lista.');
            return renameQuestionList(materialId, batch.id, title);
          },
        }),
      listen: (card) =>
        speakControls({
          blocks: () =>
            [...card.querySelectorAll('.question-list li')].map((li, n) => ({
              element: li,
              text: `Questão ${n + 1}. ${li.querySelector('span').textContent}`,
            })),
          lang: lessonLang,
          label: 'Ouvir questões',
          icon: true,
        }),
    },
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
async function generate(kind, options) {
  if (busy) return false;
  if (kind === 'summary') options = normalizeSummaryOptions(options);
  let completed = false;
  const source = scientificReview.sourceRevisionId(),
    operation = JSON.stringify([kind, source, options]);
  if (!pending.has(operation)) pending.set(operation, crypto.randomUUID());
  busy = true;
  scientificReview.setBusy(true);
  const generationFields = [
    ...document.querySelectorAll(
      '[data-summary-form] :is(select, input, button), [data-more-questions-form] :is(select, input, button)',
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
        ? await regenerateSummary(materialId, source, pending.get(operation), options)
        : await generateQuestions(
            materialId,
            options.count,
            source,
            pending.get(operation),
            options.config,
          );
    const result = await pollJob(job.jobId, {
      onUpdate: (state) => setStatus(message, jobLabel(state)),
    });
    if (result.status !== 'CONCLUIDA') {
      pending.delete(operation);
      throw Error(result.error_message || 'Não foi possível concluir. Tente novamente.');
    }
    pending.delete(operation);
    if (kind === 'summary') displayedSummary = null;
    await reload();
    setStatus(message, '');
    completed = true;
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
  return completed;
}
$('[data-summary-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = new FormData(form);
  $('[data-summary-dialog]').close();
  void generate('summary', {
    format: data.get('format'),
    length: data.get('length'),
    readingLevel: data.get('readingLevel'),
    focus: data.getAll('focus'),
    label: flags.study_authoring ? data.get('label') : '',
  }).then((ok) => {
    // A finished generation shows the new version; the next one starts with an empty name.
    if (ok) form.elements.label.value = '';
  });
});
/** One small dialog renames a summary version or a question list. */
function openRename({ title, label, value, save }) {
  const dialog = $('[data-rename-dialog]'),
    form = $('[data-rename-form]'),
    field = form.elements.name;
  $('#rename-dialog-title').textContent = title;
  $('[data-rename-label]').firstChild.textContent = label;
  field.value = value || '';
  $('[data-rename-message]').textContent = '';
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await save(field.value.trim());
      dialog.close();
      await reload();
    } catch (error) {
      setStatus($('[data-rename-message]'), error.message, 'error');
    } finally {
      button.disabled = false;
    }
  };
  dialog.showModal();
  field.focus();
  field.select();
}
$('[data-rename-summary]').addEventListener('click', () => {
  if (!displayedSummary) return;
  $('[data-summary-history]').open = false;
  // The menu item is hidden now; return focus to the "Versões" button when the dialog closes.
  $('[data-rename-dialog]')?.addEventListener(
    'close',
    () => $('[data-summary-history] > summary')?.focus(),
    { once: true },
  );
  const summary = displayedSummary;
  openRename({
    title: 'Renomear versão do resumo',
    label: 'Nome da versão',
    value: summary.label,
    save: (name) => renameSummary(materialId, summary.id, name || null),
  });
});
const questionDialog = initQuestionDialog({
  flags,
  maxCount: maxQuestionCount,
  material: () => currentMaterial,
});
$('[data-more-questions-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const request = questionDialog.read();
  if (!request) return;
  $('[data-questions-dialog]').close();
  void generate('questions', request).then((ok) => {
    if (ok) questionDialog.reset();
  });
});
// Flashcards 2.0 needs the flashcards feature and the sets migration.
const flashcardSets = flags.flashcards && flags.flashcard_sets;
const flashcardAuthoring = flashcardSets
  ? initFlashcardAuthoring({ material: () => currentMaterial })
  : null;
$('[data-open-flashcards]').addEventListener('click', () => void flashcardAuthoring?.open());
// New sets appear in the Flashcards tab as soon as the creation dialog closes.
document.querySelector('[data-flashcard-dialog]')?.addEventListener('close', () => {
  if (activeTab === 'flashcards') void renderLessonSets();
});
const exportPanel = initExportPanel({
  material: () => currentMaterial,
  flags,
  notesEnabled: () => notesEnabled,
  flashcards: flashcardAuthoring?.exporter || null,
});
$('[data-open-export]').addEventListener('click', () => exportPanel.open());
const listShare = initListShare({ materialId });
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
const searchParam = params.get('busca');
await reload().catch((e) => {
  $('[data-material-title]').textContent = 'Não foi possível abrir a aula';
  $('[data-material-meta]').textContent = e.message;
  // Dead end: explain and offer the way back instead of an empty page.
  $('.material-header').after(
    emptyState(
      'Esta aula não está disponível.',
      'Ela pode ter sido excluída ou pertencer a outra conta.',
      {
        href: './historico.html',
        action: 'Voltar à Biblioteca',
        mascot: 'curious',
      },
    ),
  );
});
// Arriving from the dashboard search: the term is searched, bolded and its passage scrolled to.
if (searchParam && currentMaterial?.transcription) {
  if (ready()) selectTab('transcription');
  transcriptPlayer.search(searchParam, params.get('trecho'));
}
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
