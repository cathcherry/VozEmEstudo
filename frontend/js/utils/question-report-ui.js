// "Sinalizar para revisar": a PERSONAL mark on a generated question, used on the answering page
// (small button in the question header) and in the lesson's question lists. Nobody else receives
// it: it is saved in the student's account (question-reports.js) and listed back to them as
// "Questões marcadas". The wording never suggests that a team will look at the problem.
import { icon as uiIcon } from './icons.js';
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

/** Modal with the reasons and an optional note. Resolves true when saved, 'removed' when the mark was removed. */
export function openReportDialog({ questionId, materialId, batchId, statement = '', opener }) {
  const id = `report-dialog-${++counter}`;
  const current = reportFor(questionId);
  const dialog = make('dialog', null, 'settings-dialog app-dialog report-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const form = make('form');
  form.method = 'dialog';
  const title = make('h2', 'Sinalizar questão para revisar');
  title.id = `${id}-title`;
  const close = make('button', '×', 'dialog-close');
  close.type = 'button';
  close.dataset.dialogClose = '';
  close.setAttribute('aria-label', 'Fechar');
  const hint = make(
    'p',
    'É uma marca pessoal: ninguém mais recebe este aviso. A questão continua na lista e aparece entre as suas questões marcadas, para você conferir com a aula.',
    'app-dialog-hint',
  );
  const reasons = make('fieldset', null, 'report-reasons');
  reasons.append(make('legend', 'O que parece errado?'));
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
  const save = make('button', current ? 'Salvar alteração' : 'Sinalizar', 'primary-action');
  save.type = 'submit';
  const remove = current ? make('button', 'Remover sinalização', 'text-action report-remove') : null;
  if (remove) remove.type = 'button';
  actions.append(...(remove ? [remove] : []), cancel, save);
  form.append(close, title, hint, reasons, noteLabel, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    let saved = false;
    cancel.addEventListener('click', () => dialog.close());
    close.addEventListener('click', () => dialog.close());
    remove?.addEventListener('click', async () => {
      await clearReport(questionId).catch(() => {});
      saved = 'removed';
      dialog.close();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const reason = form.querySelector('input[type=radio]:checked')?.value;
      save.disabled = true;
      try {
        await saveReport(questionId, { reason, note: note.value, materialId, batchId, statement });
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
 * The personal mark of one question. Two forms:
 * - in a list (default/compact): "Sinalizar para revisar" or, when marked,
 *   "Sinalizada: …" with Editar/Desfazer;
 * - `placement: 'header'`: one small flag button for the question header of the answering page
 *   ("Sinalizar" / "Sinalizada"), whose dialog also offers "Remover sinalização".
 * It updates itself when the mark changes (on this page or after the account copy loads).
 */
export function reportControl({
  questionId,
  materialId = null,
  batchId = null,
  statement = '',
  compact = false,
  placement = 'list',
}) {
  const header = placement === 'header';
  const box = make(
    'div',
    null,
    `question-report${compact ? ' is-compact' : ''}${header ? ' is-header' : ''}`,
  );
  box.dataset.questionId = questionId;
  const live = make('span', '', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const ask = async (opener) => {
    const result = await openReportDialog({ questionId, materialId, batchId, statement, opener });
    if (result === 'removed') live.textContent = 'Sinalização removida.';
    else if (result) live.textContent = 'Questão sinalizada para revisar.';
    return result;
  };
  const flagIcon = () => {
    const flag = make('span', '', 'question-report-icon');
    flag.setAttribute('aria-hidden', 'true');
    flag.append(uiIcon('flag', { size: 16 }));
    return flag;
  };
  const render = (focusTarget) => {
    const report = reportFor(questionId);
    const parts = [];
    if (header) {
      const button = make('button', null, `question-flag-button${report ? ' is-flagged' : ''}`);
      button.type = 'button';
      button.append(flagIcon(), make('span', report ? 'Sinalizada' : 'Sinalizar'));
      button.setAttribute(
        'aria-label',
        report
          ? `Sinalizada para revisar: ${reasonLabel(report.reason)}. Editar ou remover`
          : 'Sinalizar esta questão para revisar (marca pessoal)',
      );
      button.title = report
        ? `Você sinalizou: ${reasonLabel(report.reason)}`
        : 'Marca pessoal para conferir depois';
      button.addEventListener('click', async () => {
        if (await ask(button)) render('first');
      });
      parts.push(button);
    } else if (report) {
      const text = make('span', null, 'question-report-flag');
      text.append(flagIcon(), ` Sinalizada: ${reasonLabel(report.reason)}`);
      if (report.note) text.title = report.note;
      const edit = make('button', 'Editar', 'text-action');
      edit.type = 'button';
      edit.addEventListener('click', async () => {
        const result = await ask(edit);
        if (result) render(result === 'removed' ? 'open' : 'first');
      });
      const undo = make('button', 'Desfazer', 'text-action');
      undo.type = 'button';
      undo.setAttribute('aria-label', 'Remover a sinalização desta questão');
      undo.addEventListener('click', async () => {
        await clearReport(questionId).catch(() => {});
        live.textContent = 'Sinalização removida.';
        render('open');
      });
      parts.push(text, edit, undo);
    } else {
      const open = make('button', 'Sinalizar para revisar', 'text-action question-report-open');
      open.type = 'button';
      open.addEventListener('click', async () => {
        if (await ask(open)) render('first');
      });
      parts.push(open);
    }
    box.replaceChildren(...parts, live);
    if (focusTarget === 'first') box.querySelector('button')?.focus();
    if (focusTarget === 'open')
      (box.querySelector('.question-report-open') || box.querySelector('button'))?.focus();
  };
  render();
  const stop = onReportsChange(() => {
    if (!box.isConnected) return stop();
    if (!box.contains(document.activeElement)) render();
  });
  return box;
}
