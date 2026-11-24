// "Caderno da aula" (Notes 3.0): one private notebook per lesson, in the Anotações tab above the
// lesson's highlights. First of all a place to WRITE: one writing area (notebook-editor.js) where
// you click and type, Enter starts a new paragraph, and a small toolbar or a markdown-like start
// ("# ", "- ", "1. ", "[ ] ", "> ") makes a line a title, a list, a checklist or a quote. The
// stored format is unchanged (the block document of notebook-doc.js), so old notebooks open as
// they were. Plain text only, never innerHTML. Saves automatically with versions, retries and a
// copy kept in this browser until the account has it.
import { getNotebook, saveNotebook } from '../api/notebook.api.js';
import { getSession } from '../api/auth.api.js';
import { focusReadingAnnotation, isMultiSegment } from '../utils/annotation-anchor.js';
import {
  NOTEBOOK_MAX_BLOCKS,
  createAutosave,
  emptyContent,
  hasMarkup,
  keepBoth,
  limitProblem,
  referenceBlock,
  sameContent,
} from '../utils/notebook-doc.js';
import { KIND_LABELS, createNotebookEditor } from '../utils/notebook-editor.js';
import { cachedLook, loadLook, saveLook } from '../utils/notebook-look.js';
import { COVER_CHOICES, PAPERS, artSrc, artTitle, motionReduced, spineColor } from '../utils/scrapbook.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { toast } from '../utils/toast.js';

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
const STATUS = {
  saved: 'Salvo',
  dirty: 'Salvando…',
  saving: 'Salvando…',
  retrying: 'Não foi possível salvar.',
  invalid: 'Não salvo',
  conflict: 'Não salvo — outro aparelho alterou este caderno',
};
/** Toolbar: the line types, with a short visible name and a glyph (aria-hidden). */
const TOOLS = [
  ['p', '¶'],
  ['h2', 'T'],
  ['h3', 't'],
  ['bullet', '•'],
  ['ordered', '1.'],
  ['check', '☐'],
  ['quote', '❝'],
];
const SHORT = { p: 'Texto', h2: 'Título', h3: 'Subtítulo', bullet: 'Lista', ordered: 'Numerada', check: 'Checklist', quote: 'Citação' };
/** This tab remembers an opened notebook, so a reload does not close it again. */
const openKey = (materialId) => `voz-notebook-open:${materialId}`;
/** Browser key of the copy not yet saved (namespaced by account; see local-account-data.js). */
export const notebookPendingKey = (owner, materialId) => `voz-notebook-pending-v1:${owner}:${materialId}`;
const clock = (ms) => {
  const at = Math.floor(Number(ms) / 1000);
  return `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
};

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
  const retry = button('Tentar de novo', 'text-action notebook-retry');
  retry.hidden = true;
  statusRow.append(status, retry);
  header.append(title, privacy);
  const conflict = make('div', undefined, 'notebook-conflict');
  conflict.setAttribute('role', 'alert');
  conflict.hidden = true;

  // ---- The writing page: title, compact toolbar, the writing area -----------------------------
  const titleInput = make('input');
  titleInput.type = 'text';
  titleInput.maxLength = 160;
  titleInput.id = 'lesson-notebook-name';
  titleInput.autocomplete = 'off';
  titleInput.placeholder = 'Sem título';
  titleInput.className = 'notebook-name';
  titleInput.setAttribute('aria-label', 'Título do caderno (opcional)');
  const editorId = `lesson-notebook-text-${materialId}`.replace(/[^A-Za-z0-9_-]/g, '');
  const toolbar = make('div', undefined, 'notebook-toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Formatar o texto do caderno');
  toolbar.setAttribute('aria-controls', editorId);
  const kindButtons = new Map();
  for (const [kind, glyph] of TOOLS) {
    const tool = button('', 'notebook-tool-button');
    tool.dataset.kind = kind;
    tool.setAttribute('aria-pressed', 'false');
    tool.setAttribute('aria-label', KIND_LABELS[kind]);
    tool.title = KIND_LABELS[kind];
    const mark = make('span', glyph, 'notebook-tool-glyph');
    mark.setAttribute('aria-hidden', 'true');
    const label = make('span', SHORT[kind], 'notebook-tool-label');
    label.setAttribute('aria-hidden', 'true');
    tool.append(mark, label);
    tool.tabIndex = kindButtons.size ? -1 : 0;
    // Keep the caret in the text when the toolbar is clicked.
    tool.addEventListener('mousedown', (event) => event.preventDefault());
    tool.addEventListener('click', () => editor.setLineKind(kind));
    kindButtons.set(kind, tool);
    toolbar.append(tool);
  }
  const citeTool = button('', 'notebook-tool-button notebook-cite-tool');
  citeTool.dataset.citeLesson = '';
  citeTool.tabIndex = -1;
  const citeGlyph = make('span', '❞', 'notebook-tool-glyph');
  citeGlyph.setAttribute('aria-hidden', 'true');
  citeTool.append(citeGlyph, make('span', 'Citar trecho da aula', 'notebook-tool-label'));
  citeTool.addEventListener('mousedown', (event) => event.preventDefault());
  citeTool.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('voz:open-transcript', { detail: {} }));
    toast('Selecione um trecho na transcrição e escolha “Citar no caderno”. Ele entra aqui com o tempo e a revisão.', { duration: 8000 });
  });
  toolbar.append(make('span', undefined, 'notebook-toolbar-gap'), citeTool);
  // One tab stop for the whole toolbar; arrows move between its buttons.
  toolbar.addEventListener('keydown', (event) => {
    const tools = [...toolbar.querySelectorAll('button')];
    const at = tools.indexOf(document.activeElement);
    if (at < 0) return;
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tools.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tools[(next + tools.length) % tools.length];
    for (const tool of tools) tool.tabIndex = tool === target ? 0 : -1;
    target.focus();
  });

  const writing = make('div', undefined, 'notebook-writing');
  const area = make('div', undefined, 'nb-editor');
  area.id = editorId;
  area.setAttribute('aria-label', 'Texto do caderno');
  const hint = make(
    'p',
    'Escreva à vontade: Enter começa um novo parágrafo. Comece a linha com # para título, - para lista, 1. para lista numerada, [ ] para checklist ou > para citação.',
    'notebook-hint',
  );
  hint.id = `${editorId}-hint`;
  area.setAttribute('aria-describedby', hint.id);
  const placeholder = make('p', 'Comece a escrever aqui…', 'nb-editor-placeholder');
  placeholder.setAttribute('aria-hidden', 'true');
  writing.append(placeholder, area);
  const announce = make('p', '', 'sr-only');
  announce.setAttribute('aria-live', 'polite');
  const say = (text) => {
    announce.textContent = '';
    announce.textContent = text;
  };

  // ---- The notebook as an object (3.6): a cover that opens, a spine, a page with a ribbon and
  // paper tabs for its sections. Cover and paper per lesson live in the account's synced
  // preferences (notebook-look.js), never in the notebook body.
  let look = cachedLook(owner, materialId);
  const bookId = `lesson-notebook-book-${materialId}`.replace(/[^A-Za-z0-9_-]/g, '');
  const coverButton = make('button', undefined, 'nb-cover');
  coverButton.type = 'button';
  coverButton.setAttribute('aria-expanded', 'false');
  coverButton.setAttribute('aria-controls', bookId);
  const coverArt = make('span', undefined, 'cover-face');
  const coverImg = make('img');
  coverImg.alt = '';
  coverImg.width = 240;
  coverImg.height = 320;
  const coverLabel = make('span', 'Caderno da aula', 'cover-face-label');
  coverLabel.setAttribute('translate', 'no');
  coverArt.append(coverImg, coverLabel);
  coverButton.append(coverArt, make('span', 'Abrir o caderno', 'nb-cover-hint'));
  const closed = make('div', undefined, 'nb-closed');
  closed.append(coverButton);

  const book = make('div', undefined, 'nb-book');
  book.id = bookId;
  book.hidden = true;
  const spine = make('div', undefined, 'nb-spine');
  spine.setAttribute('aria-hidden', 'true');
  const sheet = make('div', undefined, 'nb-page paper page-stack');
  const ribbon = make('span', undefined, 'bookmark-ribbon');
  ribbon.setAttribute('aria-hidden', 'true');
  ribbon.dataset.tint = 'lavender';
  const sections = make('nav', undefined, 'nb-tabs tab-strip');
  sections.setAttribute('aria-label', 'Seções do caderno');
  sections.hidden = true;
  const pageTop = make('div', undefined, 'notebook-page-top');
  pageTop.append(titleInput, statusRow);
  sheet.append(ribbon, pageTop, toolbar, writing, hint);
  const binding = make('div', undefined, 'nb-binding');
  binding.append(spine, sheet);

  // Appearance: cover and paper, with a live preview (the book changes as you choose).
  const looks = make('details', undefined, 'nb-look');
  const coverSet = make('fieldset', undefined, 'nb-look-covers');
  coverSet.append(make('legend', 'Capa'));
  for (const id of COVER_CHOICES) {
    const option = make('label', undefined, 'nb-look-cover');
    const input = make('input');
    input.type = 'radio';
    input.name = `${bookId}-cover`;
    input.value = id;
    input.className = 'cover-radio';
    const img = make('img');
    img.src = artSrc(id);
    img.alt = '';
    img.width = 36;
    img.height = 48;
    img.loading = 'lazy';
    input.addEventListener('change', () => input.checked && changeLook({ cover: id }, `Capa ${artTitle(id)}.`));
    option.append(input, img, make('span', artTitle(id), 'sr-only'));
    coverSet.append(option);
  }
  const paperSet = make('fieldset', undefined, 'nb-look-papers');
  paperSet.append(make('legend', 'Papel'));
  for (const [id, name] of PAPERS) {
    const option = make('label', undefined, 'swatch');
    const input = make('input');
    input.type = 'radio';
    input.name = `${bookId}-paper`;
    input.value = id;
    input.className = 'swatch-radio';
    const sample = make('span', undefined, 'swatch-paper paper');
    sample.dataset.paper = id;
    sample.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => input.checked && changeLook({ paper: id }, `Papel ${name}.`));
    option.append(input, sample, make('span', name, 'swatch-name'));
    paperSet.append(option);
  }
  const preview = make('span', undefined, 'nb-look-preview');
  preview.setAttribute('aria-hidden', 'true');
  const previewCover = make('img');
  previewCover.alt = '';
  const previewPaper = make('span', undefined, 'paper');
  preview.append(previewCover, previewPaper);
  const looksBody = make('div', undefined, 'nb-look-body');
  looksBody.append(preview, coverSet, paperSet);
  looks.append(make('summary', 'Capa e papel'), looksBody);

  const bookBar = make('div', undefined, 'nb-bar');
  const closeBook = button('Fechar o caderno', 'text-action nb-close');
  bookBar.append(looks, closeBook);
  book.append(bookBar, sections, binding);

  function paintLook() {
    coverImg.src = previewCover.src = artSrc(look.cover);
    spine.style.setProperty('--spine', spineColor(look.cover));
    sheet.dataset.paper = previewPaper.dataset.paper = look.paper;
    for (const input of coverSet.querySelectorAll('input')) input.checked = input.value === look.cover;
    for (const input of paperSet.querySelectorAll('input')) input.checked = input.value === look.paper;
  }
  function changeLook(change, message) {
    look = { ...look, ...change };
    paintLook();
    say(`${message} Salvo na sua conta.`);
    void saveLook(owner, materialId, look);
  }
  function paintCoverTitle() {
    coverLabel.textContent = (content?.title || '').trim() || 'Caderno da aula';
  }
  function setOpen(open, { focus = true } = {}) {
    const wasOpen = !book.hidden;
    book.hidden = !open;
    closed.hidden = open;
    coverButton.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
    try {
      if (open) sessionStorage.setItem(openKey(materialId), '1');
      else sessionStorage.removeItem(openKey(materialId));
    } catch {
      /* this tab only */
    }
    if (open && !wasOpen && !motionReduced()) {
      // The front cover swings open from the spine (skipped with reduced motion).
      const flap = coverArt.cloneNode(true);
      flap.classList.add('nb-cover-flap');
      flap.setAttribute('aria-hidden', 'true');
      binding.append(flap);
      flap.addEventListener('animationend', () => flap.remove(), { once: true });
      setTimeout(() => flap.remove(), 1000);
    }
    // Opening puts the caret in the text: you can type at once.
    if (focus) {
      if (open) editor.focus();
      else coverButton.focus();
    }
  }
  coverButton.addEventListener('click', () => setOpen(true));
  closeBook.addEventListener('click', () => setOpen(false));
  document.addEventListener('voz:open-notebook', () => setOpen(true));
  paintLook();
  void loadLook(owner, materialId).then((saved) => {
    look = saved;
    paintLook();
  });

  // From the notebook only: the personal study journal (FEATURE_JOURNAL).
  const diary = make('a', 'Abrir meu Diário de estudo', 'nb-diary-link');
  diary.href = './diario.html';
  diary.hidden = true;
  header.append(diary);
  void isFeatureEnabled('journal')
    .then((on) => (diary.hidden = !on))
    .catch(() => {});

  panel.append(header, conflict, closed, book, announce);

  const references = new Map();
  let content = emptyContent(),
    currentRevision = null;
  // The server's answer is authoritative; the page's copy of the lesson may be a cached one.
  const revisionNow = () => currentRevision ?? context?.()?.transcription?.current_revision;
  const absorb = (payload) => {
    if (Number.isInteger(payload?.currentRevision)) currentRevision = payload.currentRevision;
    for (const item of payload?.references || []) references.set(item.id, item);
  };

  // ---- Read-only blocks inside the text: a cited highlight, or a block kept as it was ---------
  function referenceView(block, figure) {
    figure.classList.add('notebook-reference');
    figure.setAttribute('role', 'group');
    figure.setAttribute('aria-label', 'Trecho citado da aula');
    const ref = references.get(block.annotationId);
    const remove = button('Remover citação', 'notebook-tool');
    remove.addEventListener('click', () => {
      if (editor.removeAtom(block.id)) say('Citação removida do caderno. Ctrl+Z desfaz.');
    });
    if (!ref) {
      figure.append(make('p', 'Destaque indisponível nesta aula.', 'notebook-ref-notice'));
      const tools = make('div', undefined, 'notebook-ref-tools');
      tools.append(remove);
      figure.append(tools);
      return;
    }
    const quote = make('blockquote', undefined, `notebook-ref-quote annotation-${ref.color || 'yellow'}`);
    quote.setAttribute('translate', 'no');
    quote.append(make('span', ref.quote || ref.note_text || '', 'notebook-ref-mark'));
    const revision = ref.source_revision ?? block.sourceRevision;
    const now = revisionNow();
    const older = Number.isInteger(now) && Number.isInteger(revision) && revision !== now;
    // Where the passage is in the lesson: its time (current revision only) and revision.
    const segment = context?.()?.transcription?.transcription_segments?.find((item) => item.position === ref.segment_position);
    const when = segment && !older && Number.isFinite(Number(segment.start_ms)) ? ` · ${clock(segment.start_ms)}` : '';
    figure.append(quote, make('p', `Destaque da revisão ${revision}${when}`, 'notebook-ref-meta'));
    if (ref.note_text && ref.quote) {
      const note = make('p', undefined, 'notebook-ref-comment');
      const label = make('span', 'Comentário:');
      const value = make('span', ` ${ref.note_text}`);
      value.setAttribute('translate', 'no');
      note.append(label, value);
      figure.append(note);
    }
    if (ref.deleted)
      figure.append(make('p', 'O destaque original foi excluído; o trecho citado continua guardado aqui.', 'notebook-ref-notice'));
    if (older)
      figure.append(
        make(
          'p',
          `Revisão anterior: esta referência aponta para a revisão ${revision}; a aula está na revisão ${now}. O trecho citado continua legível aqui.`,
          'notebook-ref-notice notebook-ref-older',
        ),
      );
    if (isMultiSegment(ref))
      figure.append(make('p', `Abrange ${ref.end_segment_position - ref.segment_position + 1} trechos da transcrição`, 'notebook-ref-meta'));
    const tools = make('div', undefined, 'notebook-ref-tools');
    if (!older && !ref.deleted && ref.quote && segments) {
      const go = button('Ir ao destaque', 'notebook-tool');
      go.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('voz:open-transcript', { detail: {} }));
        const found = focusReadingAnnotation(ref, segments, revisionNow());
        if (!found) say('O trecho não foi encontrado no texto atual. A citação continua guardada aqui.');
      });
      tools.append(go);
      const stamp = [...segments.querySelectorAll('.transcription-segment')]
        .find((item) => Number(item.dataset.segmentPosition) === ref.segment_position)
        ?.querySelector('.segment-timestamp');
      if (segment && stamp) {
        const listen = button(`Ouvir ${clock(segment.start_ms)}`, 'notebook-tool');
        listen.disabled = stamp.disabled;
        listen.addEventListener('click', () => stamp.click());
        tools.append(listen);
      }
    }
    tools.append(remove);
    figure.append(tools);
  }
  function renderAtom(block, figure) {
    if (block?.type === 'annotation_ref') return referenceView(block, figure);
    // A block this editor does not edit (another version of the app): kept and saved as it is.
    figure.classList.add('notebook-preserved');
    figure.setAttribute('role', 'group');
    figure.setAttribute('aria-label', 'Bloco preservado');
    figure.append(make('p', 'Bloco preservado: este conteúdo não pode ser editado aqui, mas continua salvo no caderno.', 'notebook-ref-notice'));
    const texts = [];
    const walk = (value) => {
      if (typeof value === 'string') texts.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) if (!['id', 'type'].includes(key)) walk(inner);
    };
    walk(block);
    if (texts.length) {
      const text = make('p', texts.join(' · '), 'notebook-preserved-text');
      text.setAttribute('translate', 'no');
      figure.append(text);
    }
  }

  const editor = createNotebookEditor({
    root: area,
    renderAtom,
    announce: say,
    onCaret: (kind) => {
      for (const [name, tool] of kindButtons) tool.setAttribute('aria-pressed', String(name === kind));
    },
    onChange: (blocks) => {
      content.doc = { ...content.doc, blocks };
      changed();
      renderSections();
    },
  });

  const autosave = createAutosave({
    send: (body) => saveNotebook(materialId, body),
    storage,
    key: notebookPendingKey(owner, materialId),
    onSaved: (result) => {
      absorb(result);
      editor.refreshAtoms();
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
    const problem = hasMarkup(content)
      ? 'use apenas texto, sem marcações HTML (como <b>).'
      : limitProblem(content);
    blocked = Boolean(problem);
    if (blocked) {
      // Kept in this browser until it can be saved (nothing is cut or lost).
      try {
        storage?.setItem(
          notebookPendingKey(owner, materialId),
          JSON.stringify({ baseVersion: autosave.version, content, at: Date.now() }),
        );
      } catch {
        /* optional */
      }
      status.dataset.state = 'invalid';
      status.textContent = `Não salvo: ${problem}`;
      retry.hidden = true;
      return;
    }
    autosave.edit(content);
  }
  titleInput.addEventListener('input', () => {
    content.title = titleInput.value;
    paintCoverTitle();
    changed();
  });
  // Enter or ↓ in the title goes on to the text.
  titleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      editor.focus({ line: 0, offset: 0 });
    }
  });
  // Clicking the empty paper below the text puts the caret at the end.
  writing.addEventListener('mousedown', (event) => {
    if (event.target === writing) {
      event.preventDefault();
      editor.focus();
    }
  });

  // Paper tabs for the notebook's sections (its main headings): a quick way to jump to one.
  const TINTS = ['lavender', 'matcha', 'honey', 'rose', 'mist'];
  let sectionKey = '';
  function renderSections() {
    const headings = content.doc.blocks.filter((block) => block.type === 'heading' && block.level === 2);
    const key = JSON.stringify(headings.map((block) => [block.id, block.text]));
    if (key === sectionKey) return;
    sectionKey = key;
    sections.hidden = headings.length === 0;
    sections.replaceChildren(
      ...headings.slice(0, 8).map((block, index) => {
        const tab = button(block.text.trim() || `Seção ${index + 1}`, 'paper-tab');
        tab.dataset.tint = TINTS[index % TINTS.length];
        tab.setAttribute('translate', 'no');
        tab.addEventListener('click', () => {
          const line = editor.lineOfBlock(block.id);
          const target = area.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
          target?.scrollIntoView?.({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
          if (line >= 0) editor.focus({ line, offset: 0 });
        });
        return tab;
      }),
    );
  }
  function renderAll() {
    titleInput.value = content.title;
    paintCoverTitle();
    editor.setBlocks(content.doc.blocks);
    sectionKey = '';
    renderSections();
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
      say(message);
      editor.focus();
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

  // Cite a highlight (Destaques da aula, or "Citar no caderno" over a selection in the
  // transcription; annotations-panel.js → voz:notebook-cite): goes in at the caret.
  document.addEventListener('voz:notebook-cite', (event) => {
    const note = event.detail?.note;
    if (!note || note.material_id !== materialId || !note.source_revision_id) return;
    if (content.doc.blocks.length >= NOTEBOOK_MAX_BLOCKS) {
      say('O caderno chegou ao limite de 300 blocos.');
      return;
    }
    if (book.hidden) setOpen(true, { focus: false });
    references.set(note.id, { ...note, deleted: false });
    const block = referenceBlock(note);
    editor.insertAtom(block);
    const figure = area.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
    figure?.scrollIntoView?.({ block: 'center' });
    say('Destaque citado no caderno.');
  });

  let loaded;
  try {
    loaded = await getNotebook(materialId);
  } catch (error) {
    status.textContent = `Caderno indisponível: ${error.message || 'tente novamente mais tarde.'}`;
    status.dataset.state = 'invalid';
    titleInput.hidden = toolbar.hidden = writing.hidden = hint.hidden = true;
    return { autosave: null };
  }
  absorb(loaded);
  const server = loaded.notebook
    ? { title: loaded.notebook.title || '', doc: loaded.notebook.doc }
    : emptyContent();
  const serverVersion = loaded.notebook?.version ?? 0;
  autosave.start({ version: serverVersion, content: server });
  content = JSON.parse(JSON.stringify(server));
  let reopen = false;
  try {
    reopen = sessionStorage.getItem(openKey(materialId)) === '1';
  } catch {
    /* this tab only */
  }
  if (reopen) setOpen(true, { focus: false });
  const local = autosave.localCopy();
  if (local && !sameContent(local.content, server)) {
    if (local.baseVersion === serverVersion) {
      // Edits that never reached the account (closed tab, offline): restore and save them now.
      content = local.content;
      renderAll();
      changed();
      if (!blocked) void autosave.flush();
      say('Recuperamos alterações deste aparelho que ainda não estavam salvas.');
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
