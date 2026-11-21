// "Caderno da aula" (Notes 3.0): one private, structured notebook per lesson, in the Anotações tab
// above the list of highlights. Blocks are edited in plain form fields (no contenteditable, no
// HTML); text is rendered with textContent only. Saves automatically with versions, retries and a
// copy kept in this browser until the account has it.
import { getNotebook, saveNotebook } from '../api/notebook.api.js';
import { getSession } from '../api/auth.api.js';
import { focusReadingAnnotation, isMultiSegment } from '../utils/annotation-anchor.js';
import {
  ADDABLE_BLOCKS,
  BLOCK_LABELS,
  NOTEBOOK_MAX_BLOCKS,
  createAutosave,
  emptyContent,
  hasMarkup,
  keepBoth,
  newBlock,
  referenceBlock,
  sameContent,
} from '../utils/notebook-doc.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, className = 'secondary-action') => {
  const node = make('button', text, className);
  node.type = 'button';
  return node;
};
const field = (labelText, control) => {
  const label = make('label', labelText, 'notebook-field');
  label.append(control);
  return label;
};
const STATUS = {
  saved: 'Salvo',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  retrying: 'Não salvo — tentar de novo',
  invalid: 'Não salvo',
  conflict: 'Não salvo — outro aparelho alterou este caderno',
};
/** Browser key of the copy not yet saved (namespaced by account; see local-account-data.js). */
export const notebookPendingKey = (owner, materialId) => `voz-notebook-pending-v1:${owner}:${materialId}`;

export async function initLessonNotebook({ panel, materialId, context, segments }) {
  const owner = (await getSession().catch(() => null))?.user?.id || 'anon';
  let storage = null;
  try {
    storage = globalThis.localStorage;
  } catch {
    /* storage blocked: autosave still works in memory */
  }
  panel.hidden = false;
  panel.replaceChildren();
  const header = make('div', undefined, 'notebook-header');
  const title = make('h2', 'Caderno da aula');
  title.id = 'lesson-notebook-title';
  panel.setAttribute('aria-labelledby', title.id);
  const privacy = make('p', 'Privado: só você vê este caderno.', 'notebook-privacy');
  const statusRow = make('div', undefined, 'notebook-status-row');
  const status = make('p', 'Carregando o caderno…', 'notebook-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const retry = button('Tentar de novo');
  retry.hidden = true;
  statusRow.append(status, retry);
  header.append(title, privacy, statusRow);
  const conflict = make('div', undefined, 'notebook-conflict');
  conflict.setAttribute('role', 'alert');
  conflict.hidden = true;
  const titleInput = make('input');
  titleInput.type = 'text';
  titleInput.maxLength = 160;
  titleInput.id = 'lesson-notebook-name';
  titleInput.autocomplete = 'off';
  const titleField = field('Título do caderno (opcional)', titleInput);
  const list = make('ol', undefined, 'notebook-blocks');
  list.setAttribute('aria-label', 'Blocos do caderno');
  const empty = make(
    'p',
    'Comece seu caderno: adicione um título, um parágrafo ou uma lista, ou cite um destaque da lista abaixo.',
    'notebook-empty',
  );
  const tools = make('div', undefined, 'notebook-add');
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-labelledby', 'lesson-notebook-add-label');
  const toolsLabel = make('span', 'Adicionar ao caderno:', 'notebook-add-label');
  toolsLabel.id = 'lesson-notebook-add-label';
  tools.append(toolsLabel);
  const announce = make('p', '', 'sr-only');
  announce.setAttribute('aria-live', 'polite');
  panel.append(header, conflict, titleField, empty, list, tools, announce);

  const references = new Map();
  let content = emptyContent(),
    currentRevision = null;
  // The server's answer is authoritative; the page's copy of the lesson may be a cached one.
  const revisionNow = () => currentRevision ?? context?.()?.transcription?.current_revision;
  const absorb = (payload) => {
    if (Number.isInteger(payload?.currentRevision)) currentRevision = payload.currentRevision;
    for (const item of payload?.references || []) references.set(item.id, item);
  };

  const autosave = createAutosave({
    send: (body) => saveNotebook(materialId, body),
    storage,
    key: notebookPendingKey(owner, materialId),
    onSaved: (result) => {
      absorb(result);
      renderReferences();
    },
    onState: (state, info = {}) => {
      panel.dataset.saveState = state;
      status.dataset.state = state;
      status.textContent =
        state === 'retrying' && info.offline
          ? 'Sem conexão — guardado neste aparelho. Tentaremos de novo.'
          : state === 'invalid' && info.message
            ? `Não salvo: ${info.message}`
            : STATUS[state];
      retry.hidden = !['retrying', 'invalid'].includes(state);
      if (state === 'conflict') void showConflict();
    },
  });
  retry.addEventListener('click', () => void autosave.retry());
  globalThis.addEventListener?.('online', () => {
    if (autosave.state === 'retrying') void autosave.retry();
  });
  globalThis.addEventListener?.('beforeunload', (event) => {
    if (blocked || ['dirty', 'saving', 'retrying', 'invalid', 'conflict'].includes(autosave.state))
      event.preventDefault();
  });

  let blocked = false;
  function changed() {
    blocked = hasMarkup(content);
    if (blocked) {
      status.dataset.state = 'invalid';
      status.textContent = 'Não salvo: use apenas texto, sem marcações HTML (como <b>).';
      retry.hidden = true;
      return;
    }
    autosave.edit(content);
  }
  titleInput.addEventListener('input', () => {
    content.title = titleInput.value;
    changed();
  });

  for (const type of ADDABLE_BLOCKS) {
    const add = button(BLOCK_LABELS[type], 'secondary-action notebook-add-button');
    add.dataset.blockType = type;
    add.addEventListener('click', () => {
      if (content.doc.blocks.length >= NOTEBOOK_MAX_BLOCKS) {
        announce.textContent = 'O caderno chegou ao limite de 300 blocos.';
        return;
      }
      const block = newBlock(type);
      content.doc.blocks.push(block);
      changed();
      renderBlocks();
      focusBlock(block.id);
      announce.textContent = `${BLOCK_LABELS[type]} adicionado ao caderno.`;
    });
    tools.append(add);
  }

  // Focuses the first enabled match of the first selector that has one.
  function focusBlock(id, ...selectors) {
    const target = list.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
    for (const selector of selectors.length ? selectors : ['input, textarea, select, button']) {
      const found = [...(target?.querySelectorAll(selector) || [])].find((node) => !node.disabled);
      if (found) return found.focus();
    }
  }

  function move(index, delta) {
    const blocks = content.doc.blocks;
    const to = index + delta;
    if (to < 0 || to >= blocks.length) return;
    [blocks[index], blocks[to]] = [blocks[to], blocks[index]];
    changed();
    renderBlocks();
    const keep = delta < 0 ? '[data-move="up"]' : '[data-move="down"]';
    focusBlock(blocks[to].id, keep, '[data-move]');
    announce.textContent = `Bloco movido para a posição ${to + 1}.`;
  }

  function remove(index) {
    const [removed] = content.doc.blocks.splice(index, 1);
    changed();
    renderBlocks();
    const next = content.doc.blocks[Math.min(index, content.doc.blocks.length - 1)];
    if (next) focusBlock(next.id);
    else tools.querySelector('button')?.focus();
    announce.textContent = `${BLOCK_LABELS[removed.type]} removido do caderno.`;
  }

  function textArea(labelText, value, onInput, rows = 3) {
    const area = make('textarea');
    area.rows = rows;
    area.value = value;
    area.addEventListener('input', () => {
      onInput(area.value);
      changed();
    });
    return field(labelText, area);
  }

  function checklistEditor(block, number) {
    const wrap = make('div', undefined, 'notebook-checklist');
    const items = make('ul');
    block.items.forEach((item, index) => {
      const row = make('li');
      const check = make('input');
      check.type = 'checkbox';
      check.checked = item.checked;
      check.setAttribute('aria-label', `Concluído: item ${index + 1}`);
      check.addEventListener('change', () => {
        item.checked = check.checked;
        changed();
      });
      const text = make('input');
      text.type = 'text';
      text.maxLength = 1000;
      text.value = item.text;
      text.setAttribute('aria-label', `Item ${index + 1} da checklist`);
      text.addEventListener('input', () => {
        item.text = text.value;
        changed();
      });
      const drop = button('Remover item', 'notebook-tool');
      drop.setAttribute('aria-label', `Remover item ${index + 1}`);
      drop.addEventListener('click', () => {
        block.items.splice(index, 1);
        changed();
        renderBlocks();
        focusBlock(block.id, '.notebook-checklist input[type=text], [data-add-item]');
      });
      row.append(check, text, drop);
      items.append(row);
    });
    const add = button('Adicionar item');
    add.dataset.addItem = '';
    add.disabled = block.items.length >= 100;
    add.addEventListener('click', () => {
      block.items.push({ text: '', checked: false });
      changed();
      renderBlocks();
      const rows = list.querySelectorAll(`[data-block-id="${CSS.escape(block.id)}"] .notebook-checklist input[type=text]`);
      rows[rows.length - 1]?.focus();
    });
    wrap.append(items, add);
    wrap.setAttribute('aria-label', `Checklist do bloco ${number}`);
    wrap.setAttribute('role', 'group');
    return wrap;
  }

  function referenceView(block) {
    const wrap = make('div', undefined, 'notebook-reference');
    const ref = references.get(block.annotationId);
    if (!ref) {
      wrap.append(make('p', 'Destaque indisponível nesta aula.', 'notebook-ref-notice'));
      return wrap;
    }
    const quote = make('blockquote', ref.quote || ref.note_text || '', `notebook-ref-quote annotation-${ref.color || 'yellow'}`);
    quote.setAttribute('translate', 'no');
    const revision = ref.source_revision ?? block.sourceRevision;
    wrap.append(quote, make('p', `Destaque da revisão ${revision}`, 'notebook-ref-meta'));
    if (ref.note_text && ref.quote) {
      const note = make('p', undefined, 'notebook-ref-comment');
      const label = make('span', 'Comentário:');
      const value = make('span', ` ${ref.note_text}`);
      value.setAttribute('translate', 'no');
      note.append(label, value);
      wrap.append(note);
    }
    const now = revisionNow();
    const older = Number.isInteger(now) && Number.isInteger(revision) && revision !== now;
    if (ref.deleted)
      wrap.append(make('p', 'O destaque original foi excluído; o trecho citado continua guardado aqui.', 'notebook-ref-notice'));
    if (older)
      wrap.append(
        make(
          'p',
          `Revisão anterior: esta referência aponta para a revisão ${revision}; a aula está na revisão ${now}. O trecho citado continua legível aqui.`,
          'notebook-ref-notice notebook-ref-older',
        ),
      );
    if (!older && !ref.deleted && ref.quote && segments) {
      const go = button('Ir ao destaque', 'notebook-tool');
      go.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('voz:open-transcript', { detail: {} }));
        const found = focusReadingAnnotation(ref, segments, revisionNow());
        if (!found) announce.textContent = 'O trecho não foi encontrado no texto atual. A citação continua guardada aqui.';
      });
      wrap.append(go);
    }
    if (isMultiSegment(ref))
      wrap.append(make('p', `Abrange ${ref.end_segment_position - ref.segment_position + 1} trechos da transcrição`, 'notebook-ref-meta'));
    return wrap;
  }

  function blockEditor(block, index) {
    const number = index + 1;
    const item = make('li', undefined, `notebook-block notebook-block-${block.type}`);
    item.dataset.blockId = block.id;
    const set = make('fieldset');
    const legend = make('legend', `Bloco ${number} · ${BLOCK_LABELS[block.type]}`);
    const bar = make('div', undefined, 'notebook-block-tools');
    const up = button('Subir', 'notebook-tool');
    up.dataset.move = 'up';
    up.setAttribute('aria-label', `Mover bloco ${number} para cima`);
    up.disabled = index === 0;
    up.addEventListener('click', () => move(index, -1));
    const down = button('Descer', 'notebook-tool');
    down.dataset.move = 'down';
    down.setAttribute('aria-label', `Mover bloco ${number} para baixo`);
    down.disabled = index === content.doc.blocks.length - 1;
    down.addEventListener('click', () => move(index, 1));
    const drop = button('Remover', 'notebook-tool');
    drop.setAttribute('aria-label', `Remover bloco ${number}`);
    drop.addEventListener('click', () => remove(index));
    bar.append(up, down, drop);
    set.append(legend);
    if (block.type === 'heading') {
      const input = make('input');
      input.type = 'text';
      input.maxLength = 300;
      input.value = block.text;
      input.addEventListener('input', () => {
        block.text = input.value;
        changed();
      });
      const level = make('select');
      level.append(new Option('Título', '2'), new Option('Subtítulo', '3'));
      level.value = String(block.level);
      level.addEventListener('change', () => {
        block.level = Number(level.value);
        changed();
      });
      set.append(field('Texto do título', input), field('Nível', level));
    } else if (block.type === 'paragraph')
      set.append(textArea('Texto do parágrafo', block.text, (value) => (block.text = value), 4));
    else if (block.type === 'quote')
      set.append(textArea('Texto da citação', block.text, (value) => (block.text = value)));
    else if (block.type === 'bullet_list' || block.type === 'ordered_list')
      set.append(
        textArea('Itens, um por linha', block.items.join('\n'), (value) => {
          block.items = value.split('\n').slice(0, 100);
        }),
      );
    else if (block.type === 'checklist') set.append(checklistEditor(block, number));
    else if (block.type === 'annotation_ref') set.append(referenceView(block));
    set.append(bar);
    item.append(set);
    return item;
  }

  function renderBlocks() {
    list.replaceChildren(...content.doc.blocks.map(blockEditor));
    empty.hidden = content.doc.blocks.length > 0;
  }
  function renderReferences() {
    for (const [index, block] of content.doc.blocks.entries()) {
      if (block.type !== 'annotation_ref') continue;
      const item = list.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
      item?.replaceWith(blockEditor(block, index));
    }
  }
  function renderAll() {
    titleInput.value = content.title;
    renderBlocks();
  }

  // Another device saved first: the person chooses; nothing is discarded without confirmation.
  // `content` keeps this device's version (and edits made while the choice is open).
  async function showConflict() {
    conflict.hidden = false;
    conflict.replaceChildren(make('p', 'Carregando a versão salva pelo outro aparelho…'));
    let latest;
    try {
      latest = await getNotebook(materialId);
    } catch (error) {
      conflict.replaceChildren(make('p', `Não foi possível carregar a outra versão: ${error.message}`));
      const again = button('Tentar de novo');
      again.addEventListener('click', () => void showConflict());
      conflict.append(again);
      return;
    }
    absorb(latest);
    const theirs = latest.notebook ? { title: latest.notebook.title, doc: latest.notebook.doc } : emptyContent();
    const theirVersion = latest.notebook?.version ?? 0;
    const mineNow = () => JSON.parse(JSON.stringify(content));
    conflict.replaceChildren(
      make('h3', 'Este caderno mudou em outro aparelho'),
      make(
        'p',
        'Suas alterações deste aparelho estão guardadas. Escolha como continuar; nada é apagado sem confirmação.',
      ),
    );
    const actions = make('div', undefined, 'notebook-conflict-actions');
    const both = button('Manter as duas versões', 'primary-action');
    const theirsOnly = button('Usar a versão do outro aparelho');
    const mineOnly = button('Manter só a deste aparelho');
    const finish = (next, save, message) => {
      content = next;
      conflict.hidden = true;
      conflict.replaceChildren();
      renderAll();
      void autosave.adopt({ version: theirVersion, content }, { save });
      announce.textContent = message;
      titleInput.focus();
    };
    both.addEventListener('click', () =>
      finish(
        keepBoth(theirs, mineNow(), `Cópia deste aparelho (${new Date().toLocaleString('pt-BR')})`),
        true,
        'As duas versões foram mantidas no caderno.',
      ),
    );
    theirsOnly.addEventListener('click', () => {
      if (confirm('Descartar as alterações deste aparelho e usar a versão salva pelo outro aparelho?'))
        finish(theirs, false, 'Caderno atualizado com a versão do outro aparelho.');
    });
    mineOnly.addEventListener('click', () => {
      if (confirm('Substituir a versão do outro aparelho pela deste aparelho?'))
        finish(mineNow(), true, 'A versão deste aparelho foi mantida.');
    });
    actions.append(both, theirsOnly, mineOnly);
    conflict.append(actions);
    both.focus();
  }

  // Cite a highlight from the list below (annotations-panel.js → voz:notebook-cite).
  document.addEventListener('voz:notebook-cite', (event) => {
    const note = event.detail?.note;
    if (!note || note.material_id !== materialId || !note.source_revision_id) return;
    if (content.doc.blocks.length >= NOTEBOOK_MAX_BLOCKS) {
      announce.textContent = 'O caderno chegou ao limite de 300 blocos.';
      return;
    }
    references.set(note.id, { ...note, deleted: false });
    const block = referenceBlock(note);
    content.doc.blocks.push(block);
    changed();
    renderBlocks();
    const item = list.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
    item?.scrollIntoView?.({ block: 'center' });
    focusBlock(block.id, 'button');
    announce.textContent = 'Destaque citado no caderno.';
  });

  let loaded;
  try {
    loaded = await getNotebook(materialId);
  } catch (error) {
    status.textContent = `Caderno indisponível: ${error.message || 'tente novamente mais tarde.'}`;
    status.dataset.state = 'invalid';
    titleField.hidden = list.hidden = tools.hidden = empty.hidden = true;
    return { autosave: null };
  }
  absorb(loaded);
  const server = loaded.notebook
    ? { title: loaded.notebook.title || '', doc: loaded.notebook.doc }
    : emptyContent();
  const serverVersion = loaded.notebook?.version ?? 0;
  autosave.start({ version: serverVersion, content: server });
  content = JSON.parse(JSON.stringify(server));
  const local = autosave.localCopy();
  if (local && !sameContent(local.content, server)) {
    if (local.baseVersion === serverVersion) {
      // Edits that never reached the account (closed tab, offline): restore and save them now.
      content = local.content;
      renderAll();
      autosave.edit(content);
      void autosave.flush();
      announce.textContent = 'Recuperamos alterações deste aparelho que ainda não estavam salvas.';
      return { autosave };
    }
    // The account moved on since this copy was made: show this device's copy and ask.
    content = local.content;
    renderAll();
    autosave.hold(content);
    status.textContent = STATUS.conflict;
    status.dataset.state = 'conflict';
    panel.dataset.saveState = 'conflict';
    void showConflict();
    return { autosave };
  }
  renderAll();
  return { autosave };
}
