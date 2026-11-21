// Biblioteca entry points of the integrated material (Milestone C): "Material integrado" in the
// multiple-selection bar, "Estudar a unidade inteira" / "Estudar a disciplina" in a folder and
// (3.4) "Estudar várias unidades", where the student ticks several units in the dialog itself.
// The dialog shows which lessons go in (confirmed current revision) and which stay out and why,
// before anything is generated. Lesson titles are user content and are never translated.
import { createMultiLesson, previewMultiLesson } from '../api/multi-lesson.api.js';

export const MULTI_LESSON_PAGE = './integrado.html';
const REASON = {
  unconfirmed: 'transcrição ainda não confirmada',
  not_transcribed: 'ainda sem transcrição',
};
let counter = 0;

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter(Boolean));
  return node;
}
const own = (tag, text) => el(tag, { translate: 'no', text });

export const MAX_UNITS = 20;

/**
 * Opens the dialog for a selection. `title` is the suggested name (a unit or subject name, or a
 * neutral one); `opener` gets the focus back when the dialog closes. With `unitChoices`
 * ([{subjectId, subjectName, units:[{id, title}]}]) the student picks the units in the dialog
 * (selection kind `units`) and the preview follows each change.
 * @param {{kind:string, ids:string[]}} selection
 */
export function openMultiLessonDialog(
  selection,
  { title = 'Material integrado', opener = document.activeElement, unitChoices = null } = {},
) {
  const id = `multi-lesson-dialog-${++counter}`;
  const picking = Array.isArray(unitChoices);
  const dialog = el('dialog', { className: 'app-dialog multi-lesson-dialog', 'aria-labelledby': `${id}-title` });
  const form = el('form', { method: 'dialog', novalidate: true });
  const heading = el('h2', { id: `${id}-title`, text: 'Material integrado' });
  const intro = el('p', {
    className: 'app-dialog-hint',
    text: 'Um resumo e questões que relacionam as aulas escolhidas. Só entram aulas com a transcrição atual conferida e confirmada; cada item cita o trecho da aula que o sustenta.',
  });
  const status = el('p', { className: 'multi-lesson-status', role: 'status', 'aria-live': 'polite', text: picking ? 'Escolha as unidades que vão entrar no material.' : 'Conferindo as aulas…' });
  // Unit picker (3.4): one group per subject; subject and unit names are user content.
  let unitPicker = null;
  if (picking) {
    unitPicker = el('fieldset', { className: 'multi-lesson-units' }, el('legend', { text: 'Unidades' }));
    for (const group of unitChoices) {
      const subject = el('fieldset', { className: 'multi-lesson-unit-group' }, el('legend', { translate: 'no', text: group.subjectName }));
      for (const unit of group.units) {
        const inputId = `${id}-unit-${unit.id}`;
        const input = el('input', { type: 'checkbox', name: 'units', value: unit.id, id: inputId });
        input.checked = selection.ids.includes(unit.id);
        subject.append(el('label', { for: inputId }, input, own('span', unit.title)));
      }
      unitPicker.append(subject);
    }
  }
  const preview = el('div', { className: 'multi-lesson-preview' });
  const nameLabel = el('label', { for: `${id}-name`, text: 'Nome do material' });
  const name = el('input', { id: `${id}-name`, name: 'title', required: true, maxlength: '160', autocomplete: 'off' });
  name.value = title;
  const outputs = el('fieldset', { className: 'multi-lesson-outputs' }, el('legend', { text: 'O que gerar' }));
  const choice = (value, label, checked) => {
    const input = el('input', { type: 'checkbox', name: 'outputs', value, id: `${id}-${value}` });
    input.checked = checked;
    outputs.append(el('label', { for: `${id}-${value}` }, input, document.createTextNode(` ${label}`)));
    return input;
  };
  choice('summary', 'Resumo integrado', true);
  const questions = choice('questions', 'Questões integradas', true);
  choice('flashcards', 'Flashcards', false);
  const countLabel = el('label', { for: `${id}-count`, text: 'Quantidade de questões' });
  const count = el('input', { id: `${id}-count`, name: 'questionCount', type: 'number', min: '1', max: '20', value: '8', inputmode: 'numeric' });
  questions.addEventListener('change', () => {
    count.disabled = !questions.checked;
  });
  const reuseInput = el('input', { type: 'checkbox', name: 'reuse', id: `${id}-reuse` });
  reuseInput.checked = true;
  const reuse = el('label', { for: `${id}-reuse`, className: 'multi-lesson-reuse' }, reuseInput, document.createTextNode(' Reaproveitar um material igual que já exista (não gasta uma nova geração)'));
  const error = el('p', { className: 'multi-lesson-error', role: 'alert' });
  const cancel = el('button', { type: 'button', className: 'secondary-action', text: 'Cancelar' });
  const submit = el('button', { type: 'submit', className: 'primary-action', text: 'Gerar material integrado' });
  submit.disabled = true;
  form.append(heading, intro, ...(unitPicker ? [unitPicker] : []), status, preview, nameLabel, outputs, countLabel, reuse, error, el('div', { className: 'form-actions' }, cancel, submit));
  nameLabel.append(name);
  countLabel.append(count);
  dialog.append(form);
  document.body.append(dialog);
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener?.isConnected) opener.focus();
  });

  let resolved = null;
  let sequence = 0;
  const currentSelection = () =>
    picking ? { kind: 'units', ids: [...unitPicker.querySelectorAll('input:checked')].map((input) => input.value) } : selection;
  const fail = (text) => {
    status.textContent = text;
    status.dataset.state = 'error';
  };
  /** Shows which lessons go in and which stay out. Only the latest answer counts. */
  function refreshPreview() {
    const wanted = currentSelection();
    const mine = ++sequence;
    resolved = null;
    submit.disabled = true;
    if (!wanted.ids.length) {
      preview.replaceChildren();
      status.textContent = 'Escolha pelo menos uma unidade.';
      status.dataset.state = 'info';
      return Promise.resolve();
    }
    if (wanted.ids.length > MAX_UNITS) {
      preview.replaceChildren();
      fail(`Escolha no máximo ${MAX_UNITS} unidades.`);
      return Promise.resolve();
    }
    status.textContent = 'Conferindo as aulas…';
    status.dataset.state = 'info';
    preview.setAttribute('aria-busy', 'true');
    return previewMultiLesson(wanted)
      .then((result) => {
        if (mine !== sequence) return;
        preview.replaceChildren();
        const included = result.included || [];
        const excluded = result.excluded || [];
        if (included.length) {
          preview.append(el('h3', { text: `Aulas incluídas (${included.length})` }));
          const list = el('ul', { className: 'multi-lesson-sources' });
          for (const item of included) list.append(el('li', {}, own('span', item.title)));
          preview.append(list);
        }
        if (excluded.length) {
          preview.append(el('h3', { text: `Fora deste material (${excluded.length})` }));
          const list = el('ul', { className: 'multi-lesson-excluded' });
          for (const item of excluded)
            list.append(el('li', {}, own('span', item.title), document.createTextNode(' — '), el('span', { className: 'multi-lesson-reason', text: REASON[item.reason] || 'indisponível' })));
          preview.append(list);
        }
        if (result.missing)
          preview.append(el('p', { className: 'app-dialog-hint', text: result.missing === 1 ? '1 aula não está mais disponível e foi ignorada.' : `${result.missing} aulas não estão mais disponíveis e foram ignoradas.` }));
        if (!included.length) {
          fail(
            picking && !excluded.length
              ? 'As unidades escolhidas ainda não têm aulas.'
              : 'Nenhuma aula desta seleção tem a transcrição confirmada. Confira e confirme as transcrições para estudá-las juntas.',
          );
        } else if (included.length > (result.limit || 12)) {
          fail(`São ${included.length} aulas confirmadas; escolha no máximo ${result.limit || 12} por material integrado.`);
        } else {
          resolved = { ...result, selection: wanted };
          status.textContent = included.length === 1 ? '1 aula pronta para estudar.' : `${included.length} aulas prontas para estudar juntas.`;
          status.dataset.state = 'success';
          submit.disabled = false;
        }
      })
      .catch((failure) => {
        if (mine !== sequence) return;
        preview.replaceChildren();
        fail(failure.message || 'Não foi possível conferir as aulas agora.');
      })
      .finally(() => {
        if (mine === sequence) preview.removeAttribute('aria-busy');
      });
  }
  let pending = null;
  unitPicker?.addEventListener('change', () => {
    clearTimeout(pending);
    error.textContent = '';
    resolved = null;
    submit.disabled = true;
    pending = setTimeout(refreshPreview, 200);
  });
  refreshPreview();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const chosen = [...outputs.querySelectorAll('input:checked')].map((input) => input.value);
    if (!name.value.trim()) {
      error.textContent = 'Dê um nome ao material.';
      name.focus();
      return;
    }
    if (!chosen.length) {
      error.textContent = 'Escolha pelo menos um item para gerar.';
      outputs.querySelector('input').focus();
      return;
    }
    if (!resolved) return;
    submit.disabled = true;
    try {
      const settings = {};
      if (chosen.includes('questions')) settings.questionCount = Math.min(20, Math.max(1, Number(count.value) || 8));
      const created = await createMultiLesson({
        id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        title: name.value.trim(),
        selection: resolved.selection,
        outputs: chosen,
        settings,
        expectedRevisionIds: resolved.included.map((item) => item.revisionId),
        reuse: reuseInput.checked,
      });
      location.href = `${MULTI_LESSON_PAGE}?id=${encodeURIComponent(created.multiLesson.id)}`;
    } catch (failure) {
      if (failure.code === 'MULTI_LESSON_SOURCES_CHANGED') {
        // A lesson was confirmed, edited or moved after the preview: show the new list and let
        // the student confirm again, instead of generating something they did not see.
        await refreshPreview();
        error.textContent = 'As aulas da seleção mudaram desde a prévia. Confira a lista atualizada e confirme de novo.';
        return;
      }
      error.textContent = failure.message || 'Não foi possível pedir o material integrado.';
      submit.disabled = false;
    }
  });
  dialog.showModal();
  (unitPicker?.querySelector('input') || name).focus();
  return dialog;
}

/** "Material integrado" button for the library's selection bar (several selected lessons). */
export function selectionButton(getSelectedIds) {
  const button = el('button', { type: 'button', className: 'secondary-action', 'data-multi-lesson-selection': true, 'aria-haspopup': 'dialog', text: 'Material integrado' });
  button.addEventListener('click', () => {
    const ids = getSelectedIds();
    if (ids.length) openMultiLessonDialog({ kind: 'lessons', ids }, { title: 'Material integrado', opener: button });
  });
  return button;
}

/** "Estudar a unidade inteira" / "Estudar a disciplina" for a folder page. */
export function folderButton({ subjectId, unitId, name }) {
  const unit = Boolean(unitId);
  const button = el('button', {
    type: 'button',
    className: 'secondary-action multi-lesson-folder-action',
    'data-multi-lesson-folder': unit ? 'unit' : 'subject',
    'aria-haspopup': 'dialog',
    text: unit ? 'Estudar a unidade inteira' : 'Estudar a disciplina',
  });
  button.addEventListener('click', () =>
    openMultiLessonDialog(unit ? { kind: 'unit', ids: [unitId] } : { kind: 'subject', ids: [subjectId] }, { title: name, opener: button }),
  );
  return button;
}

/**
 * "Estudar várias unidades": the dialog lists every unit, grouped by subject (the current subject
 * first), and the student ticks the ones to study together.
 * @param {() => {subjects:{id:string,name:string}[], units:{id:string,title:string,subject_id:string}[], currentSubjectId?:string|null}} getCatalog
 */
export function unitsButton(getCatalog) {
  const button = el('button', {
    type: 'button',
    className: 'secondary-action multi-lesson-folder-action',
    'data-multi-lesson-units': true,
    'aria-haspopup': 'dialog',
    text: 'Estudar várias unidades',
  });
  button.addEventListener('click', () => {
    const { subjects, units, currentSubjectId = null } = getCatalog();
    const groups = subjects
      .map((subject) => ({
        subjectId: subject.id,
        subjectName: subject.name,
        units: units.filter((unit) => unit.subject_id === subject.id).map((unit) => ({ id: unit.id, title: unit.title })),
      }))
      .filter((group) => group.units.length)
      .sort((a, b) => (b.subjectId === currentSubjectId) - (a.subjectId === currentSubjectId));
    openMultiLessonDialog({ kind: 'units', ids: [] }, { title: 'Material integrado', opener: button, unitChoices: groups });
  });
  return button;
}
