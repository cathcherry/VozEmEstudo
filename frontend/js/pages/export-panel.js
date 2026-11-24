import { listAnnotations } from '../api/learning-tools.api.js';
import { getAnswerKey } from '../api/material.api.js';
import { listQuizSessions, getQuizSession } from '../api/quiz-session.api.js';
import { downloadText } from '../utils/study-export.js';
import {
  buildStudyDocument,
  toMarkdown,
  toPlainText,
  printDocument,
  safeFilename,
} from '../utils/study-document.js';
import { listName, summaryName } from '../utils/authoring.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/**
 * One export dialog for the whole material (header "Exportar") and for a single list (the list
 * menu opens it with only that list selected). Content, format, one primary action.
 */
export function initExportPanel({ material, flags, notesEnabled: notesAvailable, flashcards }) {
  const dialog = document.querySelector('[data-export-dialog]');
  const form = dialog.querySelector('[data-export-form]');
  const message = dialog.querySelector('[data-export-message]');
  const listsBox = dialog.querySelector('[data-export-lists]');
  const cardsBox = dialog.querySelector('[data-export-flashcards]');
  const title = dialog.querySelector('#export-dialog-title');
  dialog.querySelector('[data-export-attempt]').hidden = !flags.quiz_v2;

  function fillSummaries(current) {
    const select = form.elements.summaryVersion;
    const summaries = current.summaries || [];
    select.replaceChildren(
      ...summaries.map(
        (s) =>
          new Option(
            `${summaryName(s)}${s.is_current ? ' (mais recente)' : ''}`,
            String(s.version),
          ),
      ),
    );
    const latest = summaries.find((s) => s.is_current) || summaries[0];
    if (latest) select.value = String(latest.version);
    form.elements.summary.disabled = !summaries.length;
    dialog.querySelector('[data-export-summary-choice]').hidden = summaries.length < 2;
  }

  function fillLists(current, only) {
    const batches = current.questionBatches || [];
    listsBox.replaceChildren();
    if (!batches.length) return;
    const heading = el('p', 'Listas de questões', 'export-group-title');
    listsBox.append(heading);
    batches.forEach((batch, index) => {
      const label = el('label');
      const input = el('input');
      input.type = 'checkbox';
      input.name = 'list';
      input.value = batch.id;
      input.checked = only ? batch.id === only : false;
      label.append(input, ` ${listName(batch, index, batches.length)}`);
      listsBox.append(label);
    });
  }

  async function fillFlashcards() {
    cardsBox.replaceChildren();
    const sets = flashcards ? await flashcards.list().catch(() => []) : [];
    if (sets.length) cardsBox.append(el('p', 'Conjuntos de flashcards', 'export-group-title'));
    for (const set of sets) {
      const label = el('label');
      const input = el('input');
      input.type = 'checkbox';
      input.name = 'flashcardSet';
      input.value = set.id;
      label.append(input, ` ${set.name} (${set.card_count ?? set.cards?.length ?? 0})`);
      cardsBox.append(label);
    }
    syncFormats();
  }

  /** CSV only for flashcards alone; answer-key variants only matter when a list is chosen. */
  function syncFormats() {
    const data = new FormData(form);
    const lists = data.getAll('list').length,
      sets = data.getAll('flashcardSet').length;
    const onlyCards =
      sets > 0 && !lists && !data.get('transcript') && !data.get('summary') && !data.get('notes');
    const csv = dialog.querySelector('[data-export-csv]');
    csv.hidden = !onlyCards;
    if (!onlyCards && form.elements.format.value === 'csv') form.elements.format.value = 'pdf';
    dialog.querySelector('[data-export-variant]').disabled = !lists;
    form.elements.timestamps.disabled = !form.elements.transcript.checked;
  }
  form.addEventListener('change', syncFormats);

  function open({ listId = null, listLabel = '' } = {}) {
    const current = material();
    message.textContent = '';
    title.textContent = listId ? `Exportar lista: ${listLabel}` : 'Exportar';
    // Only a confirmed revision is exported; a revision awaiting review is never in the file.
    const confirmed = Boolean(current.transcription) && current.review?.state === 'ready_to_generate';
    form.elements.transcript.checked = !listId && confirmed;
    form.elements.transcript.disabled = !confirmed;
    dialog.querySelector('[data-export-unconfirmed]').hidden = confirmed || !current.transcription;
    form.elements.summary.checked = !listId && Boolean(current.summaries?.length);
    form.elements.notes.checked = false;
    form.elements.notes.disabled = !notesAvailable();
    form.elements.variant.value = 'student';
    fillSummaries(current);
    fillLists(current, listId);
    syncFormats();
    dialog.showModal();
    void fillFlashcards();
    (listId ? form.querySelector('[name=variant]') : form.elements.transcript).focus();
  }

  async function collectNotes(materialId) {
    const notes = [];
    let offset = 0,
      total;
    do {
      const page = await listAnnotations({ materialId, offset });
      notes.push(...page.notes);
      total = page.total;
      if (!page.notes.length && offset < total)
        throw new Error('Não foi possível completar a exportação das anotações.');
      offset += page.limit;
    } while (offset < total);
    return notes;
  }

  async function latestCompletedAttempt(batchId) {
    const sessions = await listQuizSessions();
    const list = Array.isArray(sessions) ? sessions : sessions.sessions || [];
    const done = list
      .filter(
        (s) => s.batch_id === batchId && s.status === 'completed' && (s.kind || 'full') === 'full',
      )
      .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0];
    return done ? getQuizSession(done.id) : null;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const current = material();
    const data = new FormData(form);
    const format = data.get('format');
    const variant = data.get('variant') || 'student';
    // The print window must open in the click handler or browsers block it.
    const popup = format === 'pdf' ? window.open('', '_blank') : null;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    message.textContent = 'Preparando…';
    void (async () => {
      const batches = current.questionBatches || [];
      const lists = [];
      for (const id of data.getAll('list')) {
        const index = batches.findIndex((b) => b.id === id);
        const batch = batches[index];
        const entry = { batch, name: listName(batch, index, batches.length) };
        if (variant === 'teacher') entry.key = await getAnswerKey(current.id, batch.id);
        if (variant === 'attempt') {
          entry.attempt = await latestCompletedAttempt(batch.id);
          if (!entry.attempt) throw new Error(`“${entry.name}” ainda não tem tentativa concluída.`);
        }
        lists.push(entry);
      }
      const sets = flashcards ? await flashcards.load(data.getAll('flashcardSet')) : [];
      const notes = data.get('notes') && notesAvailable() ? await collectNotes(current.id) : [];
      if (format === 'csv') {
        downloadText(
          flashcards.csv(sets),
          safeFilename(current.title + '-flashcards', 'csv'),
          'text/csv;charset=utf-8',
        );
        return 'CSV pronto.';
      }
      const summary = data.get('summary')
        ? (current.summaries || []).find((s) => String(s.version) === data.get('summaryVersion'))
        : null;
      const doc = buildStudyDocument(current, {
        transcript: Boolean(data.get('transcript')),
        timestamps: Boolean(data.get('timestamps')),
        summary,
        notes,
        lists,
        variant,
        flashcardSets: sets,
      });
      if (!doc.sections.length) throw new Error('Selecione pelo menos um conteúdo disponível.');
      const suffix = lists.length && variant === 'teacher' ? '-gabarito' : '';
      if (format === 'pdf') {
        printDocument(doc, popup);
        return 'Na janela de impressão, escolha “Salvar como PDF”.';
      }
      if (format === 'md')
        downloadText(
          toMarkdown(doc),
          safeFilename(current.title + suffix, 'md'),
          'text/markdown;charset=utf-8',
        );
      else downloadText(toPlainText(doc), safeFilename(current.title + suffix, 'txt'));
      return 'Arquivo preparado com as versões salvas.';
    })()
      .then((text) => {
        message.textContent = text;
      })
      .catch((error) => {
        popup?.close();
        message.textContent = error.message || 'Não foi possível exportar.';
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return { open };
}
