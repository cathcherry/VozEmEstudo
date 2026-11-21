// Small accessible dialogs in the app's own style, in place of the browser's prompt():
// a modal <dialog> with a heading, a labelled field, Cancel and a main action. Focus goes to the
// field, Escape cancels, and focus returns to the control that opened it.
let counter = 0;

/**
 * Asks for one line of text. Resolves with the trimmed value, or null when cancelled.
 * @param {{title: string, label: string, value?: string, confirmLabel?: string, maxLength?: number, hint?: string}} options
 */
export function askText({
  title,
  label,
  value = '',
  confirmLabel = 'Salvar',
  maxLength = 120,
  hint = '',
}) {
  const opener = document.activeElement;
  const id = `app-dialog-${++counter}`;
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog app-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('h2');
  heading.id = `${id}-title`;
  heading.textContent = title;
  const field = document.createElement('label');
  field.htmlFor = `${id}-input`;
  field.textContent = label;
  const input = document.createElement('input');
  input.id = `${id}-input`;
  input.required = true;
  input.maxLength = maxLength;
  input.value = value;
  input.autocomplete = 'off';
  field.append(input);
  const help = document.createElement('p');
  help.className = 'app-dialog-hint';
  help.textContent = hint;
  help.hidden = !hint;
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary-action';
  cancel.textContent = 'Cancelar';
  const confirmButton = document.createElement('button');
  confirmButton.type = 'submit';
  confirmButton.className = 'primary-action';
  confirmButton.textContent = confirmLabel;
  actions.append(cancel, confirmButton);
  form.append(heading, field, help, actions);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    let result = null;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input.value.trim()) {
        input.setCustomValidity('Preencha este campo.');
        input.reportValidity();
        return;
      }
      result = input.value.trim();
      dialog.close();
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
      // After the caller re-enables its button (it may disable it while waiting).
      setTimeout(() => {
        if (opener?.isConnected) opener.focus();
      }, 0);
    });
    dialog.showModal();
    input.focus();
    input.select();
  });
}
