// The "Reportar problema" control used on the answering page and in the lesson's question lists.
import {
  REPORT_REASONS,
  reasonLabel,
  reportFor,
  saveReport,
  clearReport,
  onReportsChange,
} from './question-reports.js';

let counter = 0;
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** Modal with the reasons and an optional note. Resolves true when saved. */
export function openReportDialog({ questionId, materialId, batchId, opener }) {
  const id = `report-dialog-${++counter}`;
  const current = reportFor(questionId);
  const dialog = make('dialog', null, 'settings-dialog app-dialog report-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const form = make('form');
  form.method = 'dialog';
  const title = make('h2', 'Reportar problema na questão');
  title.id = `${id}-title`;
  const hint = make(
    'p',
    'Fica marcado só para você, nesta conta. Ajuda a lembrar de conferir a questão com a aula.',
    'app-dialog-hint',
  );
  const reasons = make('fieldset', null, 'report-reasons');
  reasons.append(make('legend', 'O que há de errado?'));
  REPORT_REASONS.forEach(([value, label], index) => {
    const row = make('label', null, 'report-reason');
    const input = make('input');
    input.type = 'radio';
    input.name = `${id}-reason`;
    input.value = value;
    input.required = true;
    input.checked = current ? current.reason === value : index === 0;
    row.append(input, make('span', label));
    reasons.append(row);
  });
  const noteLabel = make('label', 'Detalhe (opcional)');
  noteLabel.htmlFor = `${id}-note`;
  const note = make('textarea');
  note.id = `${id}-note`;
  note.rows = 3;
  note.maxLength = 500;
  note.value = current?.note || '';
  noteLabel.append(note);
  const error = make('p', '', 'report-error');
  error.setAttribute('role', 'alert');
  const actions = make('div', null, 'form-actions');
  const cancel = make('button', 'Cancelar', 'secondary-action');
  cancel.type = 'button';
  const save = make('button', current ? 'Salvar alteração' : 'Marcar problema', 'primary-action');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(title, hint, reasons, noteLabel, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    let saved = false;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const reason = form.querySelector('input[type=radio]:checked')?.value;
      save.disabled = true;
      try {
        await saveReport(questionId, { reason, note: note.value, materialId, batchId });
        saved = true;
        dialog.close();
      } catch (problem) {
        // Saved here even when the account copy could not be reached; only invalid input stops.
        if (reportFor(questionId)) {
          saved = true;
          dialog.close();
        } else error.textContent = problem.message || 'Não foi possível salvar agora.';
      } finally {
        save.disabled = false;
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(saved);
    });
    dialog.showModal();
    form.querySelector('input[type=radio]:checked')?.focus();
  });
}

/**
 * A small block: "Reportar problema" or, when flagged, "Você marcou: …" with Editar/Desfazer.
 * It updates itself when the report changes (on this page or after the account copy loads).
 */
export function reportControl({ questionId, materialId = null, batchId = null, compact = false }) {
  const box = make('div', null, `question-report${compact ? ' is-compact' : ''}`);
  box.dataset.questionId = questionId;
  const live = make('span', '', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const render = (focusTarget) => {
    const report = reportFor(questionId);
    const parts = [];
    if (report) {
      const text = make('span', null, 'question-report-flag');
      text.append(make('span', '⚑', 'question-report-icon'), ` Você marcou: ${reasonLabel(report.reason)}`);
      text.firstChild.setAttribute('aria-hidden', 'true');
      if (report.note) text.title = report.note;
      const edit = make('button', 'Editar', 'text-action');
      edit.type = 'button';
      edit.addEventListener('click', async () => {
        if (await openReportDialog({ questionId, materialId, batchId, opener: edit })) render('edit');
      });
      const undo = make('button', 'Desfazer', 'text-action');
      undo.type = 'button';
      undo.setAttribute('aria-label', 'Desfazer a marcação desta questão');
      undo.addEventListener('click', async () => {
        await clearReport(questionId).catch(() => {});
        live.textContent = 'Marcação removida.';
        render('open');
      });
      parts.push(text, edit, undo);
    } else {
      const open = make('button', 'Reportar problema', 'text-action question-report-open');
      open.type = 'button';
      open.addEventListener('click', async () => {
        if (await openReportDialog({ questionId, materialId, batchId, opener: open })) {
          live.textContent = 'Questão marcada.';
          render('edit');
        }
      });
      parts.push(open);
    }
    box.replaceChildren(...parts, live);
    if (focusTarget === 'edit') box.querySelector('button')?.focus();
    if (focusTarget === 'open') box.querySelector('.question-report-open')?.focus();
  };
  render();
  const stop = onReportsChange(() => {
    if (!box.isConnected) return stop();
    if (!box.contains(document.activeElement)) render();
  });
  return box;
}
