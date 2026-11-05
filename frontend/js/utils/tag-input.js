import { normalizeTags } from './study-store.js';
export function tagInput(input) {
  const wrapper = document.createElement('div'),
    chips = document.createElement('div');
  wrapper.className = 'tag-editor';
  chips.className = 'tag-chips';
  input.before(wrapper);
  wrapper.append(chips, input);
  let tags = [];
  const render = () => {
    chips.replaceChildren();
    for (const tag of tags) {
      const chip = document.createElement('span'),
        remove = document.createElement('button');
      chip.className = 'tag-chip';
      chip.append(document.createTextNode(tag));
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remover tag ' + tag);
      remove.addEventListener('click', () => {
        tags = tags.filter((t) => t !== tag);
        render();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
      chip.append(remove);
      chips.append(chip);
    }
    input.placeholder = tags.length ? 'Adicionar tag' : 'Ex.: revisão, energia, vestibular';
  };
  function commit() {
    tags = normalizeTags([...tags, ...input.value.split(',')]);
    input.value = '';
    render();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ',') && !event.isComposing) {
      event.preventDefault();
      commit();
    }
  });
  input.addEventListener('input', () => {
    if (input.value.includes(',')) commit();
  });
  return {
    value: () => normalizeTags([...tags, ...input.value.split(',')]).join(', '),
    reset: () => {
      tags = [];
      input.value = '';
      render();
    },
  };
}
