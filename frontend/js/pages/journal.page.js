// Diário de estudo (3.6, Milestone D): personal study journals made of scrapbook pages. A shelf of
// journals (books with a chosen cover) → an open journal: one page at a time, with a spine, a
// stacked-paper page, a ribbon and page turns. Each page has a template (a small set of layouts),
// a paper, plain text and decorations placed by direct manipulation (drag with mouse or touch,
// snapping) or by keyboard (arrows, R, + / −, Delete). Pages link to the student's own lessons and
// discoveries; a quote always keeps its source. Text is rendered with textContent / form values
// only. Quiet mode (html[data-experience="quiet"]) shows clean pages without decoration.
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { applyExperienceMode } from '../utils/collectibles.js';
import { icon } from '../utils/icons.js';
import * as api from '../api/journal.api.js';
import { getCollection } from '../api/discovery.api.js';
import {
  COVER_CHOICES,
  DECORATION_KINDS,
  DECORATION_LIMIT,
  DEFAULT_COVER,
  FRAME_CHOICES,
  KIND_WIDTH,
  PAPERS,
  TEMPLATES,
  artSrc,
  artTitle,
  clamp,
  decorationChoices,
  decorationName,
  emptyContent,
  keyAction,
  kindOfArt,
  motionReduced,
  newDecoration,
  sanitizeDecorations,
  snap,
  spineColor,
  templateOf,
} from '../utils/scrapbook.js';

const $ = (selector, root = document) => root.querySelector(selector);
const uuid = () => crypto.randomUUID();
const PLAIN_KEY = 'voz-scrapbook-plain';
const DECOR_HINT = 'Setas movem, R gira, + e − mudam o tamanho, Delete remove.';

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
const button = (text, attributes = {}) => el('button', { type: 'button', className: 'secondary-action', ...attributes }, text);
const withIcon = (name, text, attributes = {}, textClass) => {
  const node = button('', attributes);
  node.append(icon(name, { size: 18 }), el('span', { text, className: textClass }));
  return node;
};
/** A text field that writes into the page model; `label` is its accessible name. */
function field(tag, { label, value = '', max, className, placeholder, rows, onInput }) {
  const node = el(tag, { className, 'aria-label': label, placeholder: placeholder ?? label, maxlength: max, rows, spellcheck: 'true' });
  if (tag === 'input') node.type = 'text';
  node.value = value;
  node.addEventListener('input', () => onInput(node.value));
  return node;
}

const state = {
  journals: [],
  journal: null,
  pages: [],
  index: 0,
  targets: new Map(),
  options: null,
  stamps: [],
  mode: 'write',
  selected: null,
  kind: 'sticker',
  saves: new Map(),
};
const page = () => state.pages[state.index] || null;

function announce(text) {
  const box = $('[data-journal-announce]');
  box.textContent = '';
  setTimeout(() => (box.textContent = text), 30);
}
function setStatus(text, kind = 'info') {
  const box = $('[data-journal-status]');
  box.textContent = text;
  box.dataset.state = kind;
}

// ---- Covers ------------------------------------------------------------------------------------
/** A book front: the cover art with the title written on its label plate. */
function coverFace(cover, title, className = '') {
  return el(
    'span',
    { className: `cover-face ${className}`.trim(), dataset: { cover } },
    el('img', { src: artSrc(cover) || artSrc(DEFAULT_COVER), alt: '', width: 240, height: 320, draggable: 'false' }),
    el('span', { className: 'cover-face-label', translate: 'no', text: title }),
  );
}

// ---- Shelf -------------------------------------------------------------------------------------
async function showShelf({ focus } = {}) {
  history.replaceState(null, '', location.pathname);
  $('[data-journal-view]').hidden = true;
  $('[data-shelf-view]').hidden = false;
  document.querySelector('.journal-heading').hidden = false;
  state.journal = null;
  try {
    state.journals = (await api.listJournals()).journals || [];
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível abrir a estante.', 'error');
    return;
  }
  setStatus('');
  renderShelf();
  if (focus) $(`[data-shelf] [data-journal-id="${CSS.escape(focus)}"]`)?.focus();
}

function renderShelf() {
  const shelf = $('[data-shelf]');
  const books = state.journals.map((journal) =>
    el(
      'li',
      { className: 'shelf-slot' },
      el(
        'button',
        {
          type: 'button',
          className: 'shelf-book',
          dataset: { journalId: journal.id },
          'aria-label': `Abrir o diário ${journal.title}, ${journal.pageCount === 1 ? '1 página' : `${journal.pageCount} páginas`}`,
          onclick: (event) => void openJournal(journal.id, event.currentTarget),
        },
        coverFace(journal.cover, journal.title),
      ),
      el('span', { className: 'shelf-caption', 'aria-hidden': 'true', text: journal.pageCount === 1 ? '1 página' : `${journal.pageCount} páginas` }),
    ),
  );
  const create = el(
    'li',
    { className: 'shelf-slot' },
    el(
      'button',
      { type: 'button', className: 'shelf-book shelf-new', 'data-new-journal': '', onclick: () => void createJournal() },
      icon('add', { size: 28 }),
      el('span', { text: 'Novo diário' }),
    ),
  );
  shelf.replaceChildren(...books, create);
  if (!state.journals.length)
    setStatus('Sua estante está vazia. Comece um diário: você escolhe a capa e o papel depois.');
}

async function createJournal() {
  const id = uuid();
  const cover = COVER_CHOICES[state.journals.length % COVER_CHOICES.length];
  const title = state.journals.length ? `Diário de estudo ${state.journals.length + 1}` : 'Diário de estudo';
  setStatus('Criando o diário…');
  try {
    const result = await api.saveJournal(id, { version: 0, requestId: uuid(), body: { title, cover, paper: 'ruled' } });
    state.journals.push(result.journal);
    setStatus('Diário criado. Dê um nome a ele e escolha a capa quando quiser.', 'success');
    await openJournal(id, null, { created: true });
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível criar o diário.', 'error');
  }
}

// ---- Open journal ------------------------------------------------------------------------------
async function openJournal(id, from, { created = false, pageId } = {}) {
  let data;
  try {
    data = await api.getJournal(id);
  } catch (failure) {
    setStatus(failure.status === 404 ? 'Este diário não existe mais.' : failure.message || 'Não foi possível abrir o diário.', 'error');
    if (!state.journals.length) await showShelf();
    return;
  }
  state.journal = data.journal;
  state.pages = (data.pages || []).map((p) => ({ ...p, decorations: sanitizeDecorations(p.decorations) }));
  state.targets = new Map((data.linkTargets || []).map((t) => [`${t.kind}:${t.id}`, t]));
  state.index = Math.max(0, pageId ? state.pages.findIndex((p) => p.id === pageId) : 0);
  state.selected = null;
  history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(id)}`);
  $('[data-shelf-view]').hidden = true;
  document.querySelector('.journal-heading').hidden = true;
  if (!created) setStatus('');
  const view = $('[data-journal-view]');
  view.hidden = false;
  renderJournal();
  openCoverAnimation(from);
  if (created) $('[data-rename]')?.click();
  else $('#journal-name')?.focus();
  void loadOptions();
}

async function loadOptions() {
  if (!state.options)
    try {
      state.options = await api.getLinkOptions();
    } catch {
      state.options = { lessons: [], discoveries: [] };
    }
  renderTray();
}

/** Opening the cover: the front swings open from the spine (instant with reduced motion). */
function openCoverAnimation() {
  if (motionReduced()) return;
  const stage = $('[data-book-stage]');
  if (!stage) return;
  const flap = coverFace(state.journal.cover, state.journal.title, 'cover-flap');
  flap.setAttribute('aria-hidden', 'true');
  stage.append(flap);
  flap.addEventListener('animationend', () => flap.remove(), { once: true });
  setTimeout(() => flap.remove(), 1200);
}

function renderJournal() {
  const view = $('[data-journal-view]');
  const journal = state.journal;
  const name = el('h2', { id: 'journal-name', className: 'journal-name', tabindex: '-1', translate: 'no', text: journal.title });
  const rename = withIcon('edit', 'Renomear', { 'data-rename': '', className: 'text-action' });
  rename.addEventListener('click', () => startRename(name, rename));
  const back = withIcon('library', 'Estante', { className: 'text-action journal-back', onclick: () => void showShelf({ focus: journal.id }) });
  const coverButton = button('', { className: 'journal-cover-button', 'data-open-covers': '', 'aria-label': 'Escolher a capa', onclick: openCoverDialog });
  coverButton.append(coverFace(journal.cover, '', 'cover-mini'), el('span', { text: 'Capa' }));
  const addPage = withIcon('add', 'Nova página', { className: 'primary-action', 'data-new-page': '', onclick: openTemplateDialog });
  const saveLine = el('p', { className: 'journal-save', 'data-save-state': '', role: 'status', 'aria-live': 'polite' });
  const retry = button('Tentar de novo', { className: 'text-action', 'data-save-retry': '', hidden: true, onclick: () => page() && void flush(page()) });
  const toolbar = el(
    'div',
    { className: 'journal-toolbar' },
    back,
    el('div', { className: 'journal-title-row' }, name, rename),
    el('div', { className: 'journal-actions' }, coverButton, addPage),
    el('div', { className: 'journal-save-row' }, saveLine, retry),
  );
  const modes = el(
    'div',
    { className: 'segmented-control journal-modes', role: 'radiogroup', 'aria-label': 'O que fazer na página', 'data-decor-tools': '' },
    ...[
      ['write', 'Escrever'],
      ['decorate', 'Decorar'],
    ].map(([value, text]) => {
      const input = el('input', { type: 'radio', className: 'segment-input', name: 'journal-mode', value });
      input.checked = state.mode === value;
      input.addEventListener('change', () => input.checked && setMode(value));
      return el('label', {}, input, el('span', { text }));
    }),
  );
  const plainToggle = el('label', { className: 'journal-plain-toggle' });
  const plainInput = el('input', { type: 'checkbox', 'data-plain-toggle': '' });
  plainInput.checked = document.documentElement.dataset.scrapbookPlain === 'true';
  plainInput.addEventListener('change', () => setPlain(plainInput.checked));
  plainToggle.append(plainInput, el('span', { text: 'Página limpa (sem decorações)' }));
  const stage = el('div', { className: 'book-stage', 'data-book-stage': '' });
  const book = el(
    'div',
    { className: 'journal-book', 'data-book': '', dataset: { mode: state.mode } },
    el('div', { className: 'journal-spine', 'aria-hidden': 'true', style: `--spine:${spineColor(journal.cover)}` }),
    stage,
  );
  const pager = el('nav', { className: 'journal-pager', 'aria-label': 'Páginas do diário', 'data-pager': '' });
  const tray = el('aside', { className: 'journal-tray', 'aria-label': 'Página e decorações', 'data-tray': '' });
  const quiet = el('p', { className: 'journal-quiet-note', text: 'Modo silencioso: as decorações ficam guardadas, mas não aparecem. Mude em Aparência.' });
  view.replaceChildren(
    toolbar,
    el(
      'div',
      { className: 'journal-desk' },
      el('div', { className: 'journal-main' }, el('div', { className: 'journal-page-tools' }, modes, plainToggle), quiet, book, pager),
      tray,
    ),
  );
  renderPage();
  renderTray();
}

function startRename(name, trigger) {
  const input = el('input', { type: 'text', className: 'journal-name-input', maxlength: '80', 'aria-label': 'Nome do diário' });
  input.value = state.journal.title;
  let finished = false;
  const done = async (save) => {
    if (finished || !input.isConnected) return;
    finished = true;
    const title = input.value.trim();
    input.replaceWith(name);
    trigger.hidden = false;
    if (save && title && title !== state.journal.title) {
      name.textContent = title;
      await saveJournalMeta({ title }, 'Nome salvo.');
    }
    name.focus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void done(true);
    if (event.key === 'Escape') void done(false);
  });
  input.addEventListener('blur', () => void done(true));
  name.replaceWith(input);
  trigger.hidden = true;
  input.focus();
  input.select();
}

async function saveJournalMeta(body, message) {
  try {
    const result = await api.saveJournal(state.journal.id, { version: state.journal.version, requestId: uuid(), body });
    state.journal = { ...state.journal, ...result.journal };
    const index = state.journals.findIndex((j) => j.id === state.journal.id);
    if (index >= 0) state.journals[index] = state.journal;
    else state.journals.push(state.journal);
    setStatus('');
    announce(message);
    return true;
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível salvar o diário.', 'error');
    if (failure.status === 409) await openJournal(state.journal.id, null, { pageId: page()?.id });
    return false;
  }
}

// ---- Cover picker (live preview) ---------------------------------------------------------------
function paintCover(cover) {
  $('.journal-spine')?.style.setProperty('--spine', spineColor(cover));
  document.querySelectorAll('[data-open-covers] .cover-face img, [data-cover-preview] img').forEach((img) => (img.src = artSrc(cover)));
}
function openCoverDialog(event) {
  const opener = event.currentTarget;
  const original = state.journal.cover;
  let chosen = original;
  const preview = el('div', { className: 'cover-preview', 'data-cover-preview': '' }, coverFace(chosen, state.journal.title));
  const grid = el('fieldset', { className: 'cover-grid' }, el('legend', { text: 'Capas' }));
  for (const id of COVER_CHOICES) {
    const input = el('input', { type: 'radio', name: 'journal-cover', value: id, className: 'cover-radio' });
    input.checked = id === chosen;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      chosen = id;
      preview.replaceChildren(coverFace(id, state.journal.title));
      paintCover(id);
    });
    grid.append(el('label', { className: 'cover-choice' }, input, el('img', { src: artSrc(id), alt: '', width: 60, height: 80 }), el('span', { text: artTitle(id) })));
  }
  const save = button('Usar esta capa', { className: 'primary-action', type: 'submit' });
  const cancel = button('Cancelar');
  const dialog = el(
    'dialog',
    { className: 'workflow-dialog journal-dialog cover-dialog', 'aria-labelledby': 'cover-dialog-title' },
    el('h2', { id: 'cover-dialog-title', text: 'Capa do diário' }),
    el('p', { className: 'dialog-lead', text: 'Escolha uma capa: o diário muda na hora.' }),
    el('div', { className: 'cover-dialog-body' }, preview, grid),
    el('div', { className: 'form-actions' }, cancel, save),
  );
  const close = async (keep) => {
    dialog.close();
    dialog.remove();
    if (keep && chosen !== original) {
      if (await saveJournalMeta({ cover: chosen }, `Capa ${artTitle(chosen)} salva.`)) renderJournal();
    } else paintCover(original);
    (document.querySelector('[data-open-covers]') || opener).focus();
  };
  save.addEventListener('click', () => void close(true));
  cancel.addEventListener('click', () => void close(false));
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    void close(false);
  });
  document.body.append(dialog);
  dialog.showModal();
  grid.querySelector('input:checked')?.focus();
}

// ---- New page (template picker) ----------------------------------------------------------------
function templateSketch(id) {
  const sketch = el('span', { className: `template-sketch sketch-${id}`, 'aria-hidden': 'true' });
  const lines = { ruled: 6, collage: 3, concept: 3, timeline: 4, free: 0 }[id];
  for (let i = 0; i < lines; i += 1) sketch.append(el('i'));
  return sketch;
}
function openTemplateDialog(event) {
  const opener = event.currentTarget;
  const list = el('div', { className: 'template-grid' });
  const dialog = el(
    'dialog',
    { className: 'workflow-dialog journal-dialog', 'aria-labelledby': 'template-dialog-title' },
    el('h2', { id: 'template-dialog-title', text: 'Nova página' }),
    el('p', { className: 'dialog-lead', text: 'Escolha um modelo. Você muda o papel e decora depois.' }),
    list,
  );
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  for (const template of TEMPLATES)
    list.append(
      button('', {
        className: 'template-card',
        dataset: { template: template.id },
        onclick: async () => {
          close();
          await createPage(template.id);
        },
      }),
    );
  list.querySelectorAll('.template-card').forEach((card) => {
    const template = templateOf(card.dataset.template);
    card.append(templateSketch(template.id), el('strong', { text: template.name }), el('span', { text: template.hint }));
  });
  const cancel = button('Cancelar', { onclick: () => {
    close();
    opener.focus();
  } });
  dialog.append(el('div', { className: 'form-actions' }, cancel));
  dialog.addEventListener('cancel', () => {
    dialog.remove();
    opener.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  list.querySelector('button')?.focus();
}

async function createPage(template) {
  const id = uuid();
  const body = { template, title: '', paper: templateOf(template).paper, content: emptyContent(template) };
  try {
    const result = await api.savePage(state.journal.id, id, { version: 0, requestId: uuid(), body });
    state.pages.push({ ...result.page, decorations: [] });
    state.journal = { ...state.journal, ...result.journal };
    turnTo(state.pages.length - 1);
    announce(`${templateOf(template).name} adicionada: página ${state.pages.length}.`);
    $('.sheet-title')?.focus();
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível criar a página.', 'error');
  }
}

// ---- Page turning ------------------------------------------------------------------------------
function turnTo(index) {
  if (index < 0 || index >= state.pages.length) return;
  const direction = index > state.index ? 'next' : 'previous';
  const stage = $('[data-book-stage]');
  const old = stage?.querySelector('.journal-sheet');
  if (page()) void flush(page());
  state.index = index;
  state.selected = null;
  if (old && !motionReduced() && direction === 'next') {
    const ghost = old.cloneNode(true);
    ghost.classList.add('page-turn-out');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    renderPage();
    stage.append(ghost);
    ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
    setTimeout(() => ghost.remove(), 900);
  } else {
    renderPage();
    if (old && !motionReduced()) $('.journal-sheet')?.classList.add('page-turn-in');
  }
  renderTray();
}

function renderPager() {
  const pager = $('[data-pager]');
  if (!pager) return;
  const total = state.pages.length;
  const previous = withIcon('previous', 'Página anterior', { className: 'text-action', 'data-page-prev': '', disabled: state.index <= 0 || !total, onclick: () => turnTo(state.index - 1) }, 'pager-text');
  const next = withIcon('next', 'Próxima página', { className: 'text-action', 'data-page-next': '', disabled: state.index >= total - 1 || !total, onclick: () => turnTo(state.index + 1) }, 'pager-text');
  const where = el('span', { className: 'pager-where', text: total ? `Página ${state.index + 1} de ${total}` : 'Nenhuma página ainda' });
  pager.replaceChildren(previous, where, next);
}

// ---- The page ----------------------------------------------------------------------------------
function renderPage() {
  const stage = $('[data-book-stage]');
  if (!stage) return;
  const current = page();
  stage.querySelectorAll('.journal-sheet, .journal-blank').forEach((node) => node.remove());
  renderPager();
  if (!current) {
    const blank = el(
      'div',
      { className: 'journal-blank paper page-stack', dataset: { paper: state.journal.paper } },
      el('p', { className: 'blank-hand', text: 'Uma página em branco espera por você.' }),
      withIcon('add', 'Criar a primeira página', { className: 'primary-action', onclick: openTemplateDialog }),
    );
    stage.prepend(blank);
    return;
  }
  const template = templateOf(current.template);
  const sheet = el('article', {
    className: `journal-sheet paper page-stack template-${current.template}`,
    dataset: { paper: current.paper, pageId: current.id },
    'aria-label': `Página ${state.index + 1} de ${state.pages.length}: ${template.name}`,
  });
  sheet.append(
    el('span', { className: 'bookmark-ribbon', dataset: { tint: 'lavender' }, 'aria-hidden': 'true' }),
    el('div', { className: 'sheet-art', 'aria-hidden': 'true' }),
    el('div', { className: 'journal-decor', 'data-decor-layer': '' }),
    el('div', { className: 'sheet-text' }),
  );
  stage.prepend(sheet);
  renderTemplate(sheet, current);
  renderDecor();
}

function edited(current, { structural = false } = {}) {
  schedule(current);
  if (structural) renderTray();
}

/** A quote card: the quoted text and its source, which must be one of the page's links. */
function quoteCard(current) {
  const quote = current.content.quote || { text: '', source: null };
  const sources = current.links.map((link) => [link, state.targets.get(`${link.kind}:${link.id}`)]);
  const select = el('select', { className: 'quote-source', 'aria-label': 'Fonte da citação', 'data-quote-source': '' }, el('option', { value: '', text: sources.length ? 'Escolha a fonte' : 'Ligue uma aula primeiro' }));
  for (const [link, target] of sources)
    select.append(el('option', { value: `${link.kind}:${link.id}`, text: `${link.kind === 'lesson' ? 'Aula' : 'Descoberta'}: ${target?.title || 'indisponível'}` }));
  select.value = quote.source ? `${quote.source.kind}:${quote.source.id}` : '';
  const write = () => {
    const [kind, id] = select.value ? select.value.split(':') : [];
    current.content.quote = { text: area.value, source: kind ? { kind, id } : null };
    edited(current);
  };
  const area = field('textarea', { label: 'Citação', value: quote.text, max: 600, rows: 2, className: 'quote-text', placeholder: 'Uma frase da aula, com a fonte ao lado', onInput: write });
  select.addEventListener('change', write);
  return el(
    'div',
    { className: 'sheet-quote index-card' },
    el('span', { className: 'washi', dataset: { tape: 'rose-floral' }, style: '--tilt:-3deg;--tape-length:5.5rem', 'aria-hidden': 'true' }),
    area,
    el('label', { className: 'quote-source-row' }, el('span', { text: 'Fonte' }), select),
  );
}

function linkChips(current) {
  if (!current.links.length) return null;
  return el(
    'ul',
    { className: 'sheet-links', 'aria-label': 'Ligada a' },
    ...current.links.map((link) => {
      const target = state.targets.get(`${link.kind}:${link.id}`);
      const href = link.kind === 'lesson' ? `./material.html?id=${encodeURIComponent(link.id)}` : `./descobertas.html?id=${encodeURIComponent(link.id)}`;
      return el('li', {}, target ? el('a', { href, translate: 'no', text: target.title }) : el('span', { text: link.kind === 'lesson' ? 'Aula indisponível' : 'Descoberta indisponível' }));
    }),
  );
}

function renderTemplate(sheet, current) {
  const art = $('.sheet-art', sheet);
  const text = $('.sheet-text', sheet);
  const c = current.content;
  const title = field('input', {
    label: 'Título da página',
    value: current.title,
    max: 120,
    className: 'sheet-title',
    placeholder: 'Título da página',
    onInput: (value) => {
      current.title = value;
      edited(current);
    },
  });
  text.append(title);
  if (current.template === 'ruled' || current.template === 'free') {
    text.append(
      field('textarea', {
        label: 'Texto da página',
        value: c.body || '',
        max: 6000,
        className: 'sheet-body',
        placeholder: current.template === 'ruled' ? 'O que você entendeu hoje?' : 'Escreva à vontade.',
        onInput: (value) => {
          c.body = value;
          edited(current);
        },
      }),
    );
    if (current.template === 'ruled') text.append(quoteCard(current));
  } else if (current.template === 'concept') {
    const card = el(
      'div',
      { className: 'concept-card index-card' },
      el('span', { className: 'washi', dataset: { tape: 'matcha-stripes' }, style: '--tilt:4deg', 'aria-hidden': 'true' }),
      field('input', { label: 'Termo', value: c.term, max: 120, className: 'concept-term', placeholder: 'Termo ou conceito', onInput: (v) => ((c.term = v), edited(current)) }),
      el('span', { className: 'concept-label', 'aria-hidden': 'true', text: 'Definição' }),
      field('textarea', { label: 'Definição', value: c.definition, max: 1500, rows: 3, placeholder: 'Com as suas palavras', onInput: (v) => ((c.definition = v), edited(current)) }),
      el('span', { className: 'concept-label', 'aria-hidden': 'true', text: 'Exemplo' }),
      field('textarea', { label: 'Exemplo', value: c.example, max: 1500, rows: 2, placeholder: 'Um exemplo que ajude a lembrar', onInput: (v) => ((c.example = v), edited(current)) }),
    );
    text.append(card, quoteCard(current));
  } else if (current.template === 'collage') {
    const photos = el('div', { className: 'collage-photos' });
    c.photos.forEach((photo, index) => {
      const frame = el('figure', { className: 'collage-photo', dataset: { slot: String(index) } });
      const picture = el('div', { className: 'collage-picture', 'aria-hidden': 'true' }, el('img', { className: 'collage-frame', src: artSrc(photo.frame), alt: '' }));
      if (photo.art) picture.append(el('img', { className: 'collage-motif', src: artSrc(photo.art), alt: '' }));
      frame.append(
        picture,
        field('input', { label: `Legenda da foto ${index + 1}`, value: photo.caption, max: 140, className: 'collage-caption', placeholder: 'Legenda', onInput: (v) => ((photo.caption = v), edited(current)) }),
      );
      photos.append(frame);
    });
    text.append(
      photos,
      field('textarea', { label: 'Nota da colagem', value: c.note, max: 1200, rows: 3, className: 'collage-note', placeholder: 'Por que estas lembranças importam?', onInput: (v) => ((c.note = v), edited(current)) }),
    );
  } else if (current.template === 'timeline') {
    art.append(el('span', { className: 'timeline-line' }));
    const list = el('ol', { className: 'timeline-items' });
    c.items.forEach((item, index) => {
      const remove = button('', { className: 'timeline-remove', 'aria-label': `Remover o momento ${index + 1}`, disabled: c.items.length <= 1 });
      remove.append(icon('close', { size: 16 }));
      remove.addEventListener('click', () => {
        c.items.splice(index, 1);
        edited(current);
        renderPage();
        $('.timeline-items input')?.focus();
      });
      list.append(
        el(
          'li',
          { className: 'timeline-item' },
          field('input', { label: `Quando (momento ${index + 1})`, value: item.when, max: 40, className: 'timeline-when', placeholder: 'Quando', onInput: (v) => ((item.when = v), edited(current)) }),
          field('input', { label: `O que aconteceu (momento ${index + 1})`, value: item.what, max: 300, className: 'timeline-what', placeholder: 'O que aconteceu', onInput: (v) => ((item.what = v), edited(current)) }),
          remove,
        ),
      );
    });
    const add = withIcon('add', 'Adicionar momento', { className: 'text-action timeline-add', disabled: c.items.length >= 8 });
    add.addEventListener('click', () => {
      c.items.push({ when: '', what: '' });
      edited(current);
      renderPage();
      const whens = document.querySelectorAll('.timeline-when');
      whens[whens.length - 1]?.focus();
    });
    text.append(list, add);
  }
  const chips = linkChips(current);
  if (chips) text.append(chips);
}

// ---- Decorations: direct manipulation and keyboard ---------------------------------------------
function setMode(mode) {
  state.mode = mode;
  const book = $('[data-book]');
  if (book) book.dataset.mode = mode;
  if (mode === 'write') state.selected = null;
  document.querySelectorAll('input[name="journal-mode"]').forEach((input) => (input.checked = input.value === mode));
  renderDecor();
  renderDecorControls();
}
function setPlain(plain) {
  document.documentElement.dataset.scrapbookPlain = String(plain);
  try {
    localStorage.setItem(PLAIN_KEY, plain ? '1' : '');
  } catch {
    /* per-viewer convenience only */
  }
}

function decorStyle(node, item) {
  node.style.left = `${item.x}%`;
  node.style.top = `${item.y}%`;
  node.style.setProperty('--w', `${KIND_WIDTH[kindOfArt(item.art)] || 14}%`);
  node.style.setProperty('--rot', `${item.rotation}deg`);
  node.style.setProperty('--scale', item.scale);
}

function renderDecor() {
  const layer = $('[data-decor-layer]');
  const current = page();
  if (!layer || !current) return;
  const decorating = state.mode === 'decorate';
  layer.replaceChildren(
    ...current.decorations.map((item) => {
      const node = el(
        'button',
        {
          type: 'button',
          className: `decor decor-${kindOfArt(item.art)}${state.selected === item.id ? ' is-selected' : ''}`,
          dataset: { decorId: item.id, art: item.art },
          'aria-label': decorationName(item.art),
          'aria-describedby': 'decor-hint',
          'aria-pressed': state.selected === item.id ? 'true' : 'false',
          tabindex: decorating ? '0' : '-1',
        },
        el('img', { src: artSrc(item.art), alt: '', draggable: 'false' }),
      );
      decorStyle(node, item);
      wireDecoration(node, item.id);
      return node;
    }),
  );
}

function updateDecoration(id, change, { announceText, save = true } = {}) {
  const current = page();
  const index = current.decorations.findIndex((d) => d.id === id);
  if (index < 0) return;
  if (change === null) {
    const [removed] = current.decorations.splice(index, 1);
    state.selected = null;
    renderDecor();
    renderDecorControls();
    announce(`${decorationName(removed.art)} removido da página.`);
    schedule(current);
    const next = current.decorations[Math.min(index, current.decorations.length - 1)];
    if (next) $(`[data-decor-id="${CSS.escape(next.id)}"]`)?.focus();
    else $('.decor-palette button')?.focus();
    return;
  }
  current.decorations[index] = change;
  const node = $(`[data-decor-id="${CSS.escape(id)}"]`);
  if (node) decorStyle(node, change);
  if (announceText) announce(announceText);
  if (save) schedule(current);
}

function selectDecoration(id) {
  state.selected = id;
  document.querySelectorAll('.decor').forEach((node) => {
    const on = node.dataset.decorId === id;
    node.classList.toggle('is-selected', on);
    node.setAttribute('aria-pressed', String(on));
  });
  renderDecorControls();
}

function wireDecoration(node, id) {
  node.addEventListener('focus', () => state.mode === 'decorate' && selectDecoration(id));
  node.addEventListener('keydown', (event) => {
    if (state.mode !== 'decorate') return;
    if (event.key === 'Escape') {
      selectDecoration(null);
      return;
    }
    const item = page().decorations.find((d) => d.id === id);
    const result = item && keyAction(item, event);
    if (!result) return;
    event.preventDefault();
    if (result.remove) return updateDecoration(id, null);
    const moved = result.item;
    const what = event.key.startsWith('Arrow')
      ? `${decorationName(item.art)}: ${Math.round(moved.x)}% da esquerda, ${Math.round(moved.y)}% do topo.`
      : /r/i.test(event.key)
        ? `${decorationName(item.art)} girado para ${Math.round(moved.rotation)} graus.`
        : `${decorationName(item.art)} em ${Math.round(moved.scale * 100)}% do tamanho.`;
    updateDecoration(id, moved, { announceText: what });
  });
  // Pointer: mouse, pen and touch. Drag moves with snapping to the centre and quarter lines.
  node.addEventListener('pointerdown', (event) => {
    if (state.mode !== 'decorate' || event.button > 0) return;
    event.preventDefault();
    selectDecoration(id);
    node.focus({ preventScroll: true });
    const layer = node.parentElement.getBoundingClientRect();
    const item = page().decorations.find((d) => d.id === id);
    const offsetX = event.clientX - (layer.left + (item.x / 100) * layer.width);
    const offsetY = event.clientY - (layer.top + (item.y / 100) * layer.height);
    let latest = item;
    node.setPointerCapture?.(event.pointerId);
    node.classList.add('is-dragging');
    const move = (e) => {
      const x = snap(((e.clientX - offsetX - layer.left) / layer.width) * 100);
      const y = snap(((e.clientY - offsetY - layer.top) / layer.height) * 100);
      latest = { ...latest, x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
      updateDecoration(id, latest, { save: false });
      const guides = node.parentElement;
      guides.dataset.guideX = [25, 50, 75].includes(latest.x) ? String(latest.x) : '';
      guides.dataset.guideY = [25, 50, 75].includes(latest.y) ? String(latest.y) : '';
    };
    const up = () => {
      node.classList.remove('is-dragging');
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.parentElement.dataset.guideX = node.parentElement.dataset.guideY = '';
      if (latest !== item) updateDecoration(id, latest, { announceText: `${decorationName(item.art)} colocado.` });
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  });
}

function addDecoration(art) {
  const current = page();
  if (!current) return;
  if (current.decorations.length >= DECORATION_LIMIT) {
    announce(`Esta página já tem ${DECORATION_LIMIT} decorações, o limite. Remova uma para colocar outra.`);
    return;
  }
  const item = newDecoration(art, current.decorations);
  current.decorations.push(item);
  if (state.mode !== 'decorate') setMode('decorate');
  else renderDecor();
  selectDecoration(item.id);
  schedule(current);
  $(`[data-decor-id="${CSS.escape(item.id)}"]`)?.focus();
  announce(`${decorationName(art)} colocado no meio da página. ${DECOR_HINT}`);
}

// ---- Tray: the page (paper, links, collage) and decorations ------------------------------------
function renderTray() {
  const tray = $('[data-tray]');
  const current = page();
  if (!tray) return;
  if (!current) {
    tray.replaceChildren(el('p', { className: 'tool-hint', text: 'Crie uma página para escolher o papel e decorar.' }));
    return;
  }
  const papers = el('fieldset', { className: 'paper-swatches' }, el('legend', { text: 'Papel' }));
  for (const [id, name] of PAPERS) {
    const input = el('input', { type: 'radio', name: 'page-paper', value: id, className: 'swatch-radio' });
    input.checked = current.paper === id;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      current.paper = id;
      $('.journal-sheet')?.setAttribute('data-paper', id);
      schedule(current);
      announce(`Papel ${name}.`);
    });
    papers.append(el('label', { className: 'swatch' }, input, el('span', { className: 'swatch-paper paper', dataset: { paper: id }, 'aria-hidden': 'true' }), el('span', { className: 'swatch-name', text: name })));
  }
  const pageSection = el('section', { className: 'tray-section', 'aria-labelledby': 'tray-page-title' }, el('h3', { id: 'tray-page-title', text: 'Esta página' }), papers, linksEditor(current));
  if (current.template === 'collage') pageSection.append(collageEditor(current));
  const remove = withIcon('remove', 'Excluir esta página', { className: 'text-action danger-action', 'data-delete-page': '' });
  remove.addEventListener('click', () => void deletePage(current));
  pageSection.append(remove);

  const decorSection = el('section', { className: 'tray-section decor-tools', 'aria-labelledby': 'tray-decor-title', 'data-decor-tools': '' });
  decorSection.append(el('h3', { id: 'tray-decor-title', text: 'Decorar' }));
  const kinds = DECORATION_KINDS.filter(([kind]) => kind !== 'stamp' || state.stamps.length);
  const tabs = el('div', { className: 'segmented-control segmented-wrap decor-kinds', role: 'radiogroup', 'aria-label': 'Tipo de decoração' });
  for (const [kind, name] of kinds) {
    const input = el('input', { type: 'radio', className: 'segment-input', name: 'decor-kind', value: kind });
    input.checked = state.kind === kind;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.kind = kind;
      renderPalette();
    });
    tabs.append(el('label', {}, input, el('span', { text: name })));
  }
  decorSection.append(
    tabs,
    el('div', { className: 'decor-palette', 'data-palette': '' }),
    el('p', { className: 'decor-count', 'data-decor-count': '' }),
    el('div', { className: 'decor-selected', 'data-decor-selected': '' }),
    el('p', { className: 'tool-hint', id: 'decor-hint', text: `Arraste com o mouse ou o dedo. Pelo teclado: escolha a decoração com Tab; ${DECOR_HINT}` }),
  );
  tray.replaceChildren(decorSection, pageSection);
  renderPalette();
  renderDecorControls();
}

function renderPalette() {
  const palette = $('[data-palette]');
  if (!palette) return;
  palette.replaceChildren(
    ...decorationChoices(state.kind, state.stamps).map((art) =>
      button('', {
        className: `palette-item palette-${kindOfArt(art)}`,
        'aria-label': `Colocar ${decorationName(art)}`,
        title: artTitle(art),
        dataset: { art },
        onclick: () => addDecoration(art),
      }),
    ),
  );
  palette.querySelectorAll('.palette-item').forEach((node) => node.append(el('img', { src: artSrc(node.dataset.art), alt: '', loading: 'lazy' })));
}

function renderDecorControls() {
  const box = $('[data-decor-selected]');
  const count = $('[data-decor-count]');
  const current = page();
  if (!box || !current) return;
  count.textContent = `${current.decorations.length} de ${DECORATION_LIMIT} decorações nesta página.`;
  const item = current.decorations.find((d) => d.id === state.selected);
  if (!item || state.mode !== 'decorate') {
    box.replaceChildren();
    return;
  }
  const act = (label, change, iconName) => {
    const node = withIcon(iconName, label, { className: 'text-action' });
    node.addEventListener('click', () => {
      const fresh = page().decorations.find((d) => d.id === item.id);
      if (!fresh) return;
      if (change === null) return updateDecoration(item.id, null);
      const result = keyAction(fresh, change);
      updateDecoration(item.id, result.item, { announceText: `${decorationName(fresh.art)} ajustado.` });
    });
    return node;
  };
  box.replaceChildren(
    el('strong', { text: decorationName(item.art) }),
    el(
      'div',
      { className: 'decor-actions' },
      act('Girar', { key: 'r' }, 'rotate'),
      act('Maior', { key: '+' }, 'expand'),
      act('Menor', { key: '-' }, 'minimize'),
      act('Remover', null, 'remove'),
    ),
  );
}

function linksEditor(current) {
  const wrap = el('div', { className: 'links-editor' }, el('h4', { text: 'Ligada a' }));
  const list = el('ul', { className: 'links-list' });
  for (const link of current.links) {
    const target = state.targets.get(`${link.kind}:${link.id}`);
    const label = target?.title || (link.kind === 'lesson' ? 'Aula indisponível' : 'Descoberta indisponível');
    const remove = button('Remover', { className: 'text-action', 'aria-label': `Remover a ligação com ${label}` });
    remove.addEventListener('click', () => {
      const quote = current.content.quote;
      if (quote?.text?.trim() && quote.source?.id === link.id) {
        announce('Esta ligação é a fonte da citação. Apague a citação ou escolha outra fonte antes.');
        return;
      }
      current.links = current.links.filter((l) => l !== link);
      if (quote && quote.source?.id === link.id) quote.source = null;
      schedule(current);
      renderPage();
      renderTray();
      $('[data-link-select]')?.focus();
    });
    list.append(el('li', {}, el('span', { translate: 'no', text: `${link.kind === 'lesson' ? 'Aula' : 'Descoberta'}: ${label}` }), remove));
  }
  const select = el('select', { 'aria-label': 'Aula ou descoberta para ligar', 'data-link-select': '' }, el('option', { value: '', text: 'Escolha uma aula ou descoberta' }));
  const taken = new Set(current.links.map((l) => `${l.kind}:${l.id}`));
  const groups = [
    ['Aulas', state.options?.lessons || []],
    ['Descobertas', state.options?.discoveries || []],
  ];
  for (const [label, items] of groups) {
    const available = items.filter((item) => !taken.has(`${item.kind}:${item.id}`));
    if (!available.length) continue;
    const group = el('optgroup', { label });
    for (const item of available) group.append(el('option', { value: `${item.kind}:${item.id}`, text: item.title }));
    select.append(group);
  }
  const add = button('Ligar', { disabled: current.links.length >= 6 });
  add.addEventListener('click', () => {
    if (!select.value) return select.focus();
    const [kind, id] = select.value.split(':');
    const option = [...(state.options?.lessons || []), ...(state.options?.discoveries || [])].find((o) => o.kind === kind && o.id === id);
    current.links.push({ kind, id });
    if (option) state.targets.set(`${kind}:${id}`, option);
    schedule(current);
    renderPage();
    renderTray();
    announce(`Página ligada a ${option?.title || 'um item seu'}.`);
    $('[data-link-select]')?.focus();
  });
  wrap.append(list, el('div', { className: 'links-add' }, select, add));
  if (!state.options) wrap.append(el('p', { className: 'tool-hint', text: 'Carregando as suas aulas…' }));
  return wrap;
}

function collageEditor(current) {
  const box = el('div', { className: 'collage-editor' }, el('h4', { text: 'Fotos da colagem' }));
  const stickers = decorationChoices('sticker');
  current.content.photos.forEach((photo, index) => {
    const frame = el('select', { 'aria-label': `Moldura da foto ${index + 1}` }, ...FRAME_CHOICES.map((id) => el('option', { value: id, text: artTitle(id) })));
    frame.value = photo.frame;
    const motif = el('select', { 'aria-label': `Desenho da foto ${index + 1}` }, el('option', { value: '', text: 'Sem desenho' }), ...stickers.map((id) => el('option', { value: id, text: artTitle(id) })));
    motif.value = photo.art || '';
    const apply = () => {
      photo.frame = frame.value;
      photo.art = motif.value || null;
      schedule(current);
      const figure = $(`.collage-photo[data-slot="${index}"] .collage-picture`);
      if (figure) {
        figure.replaceChildren(el('img', { className: 'collage-frame', src: artSrc(photo.frame), alt: '' }));
        if (photo.art) figure.append(el('img', { className: 'collage-motif', src: artSrc(photo.art), alt: '' }));
      }
    };
    frame.addEventListener('change', apply);
    motif.addEventListener('change', apply);
    box.append(el('div', { className: 'collage-row' }, el('span', { text: `Foto ${index + 1}` }), frame, motif));
  });
  return box;
}

async function deletePage(current) {
  if (!confirm('Excluir esta página do diário? O texto e as decorações dela somem.')) return;
  try {
    await api.savePage(state.journal.id, current.id, { version: current.version, requestId: uuid(), body: { deleted: true } });
    state.saves.delete(current.id);
    state.pages = state.pages.filter((p) => p !== current);
    state.index = Math.min(state.index, Math.max(0, state.pages.length - 1));
    renderPage();
    renderTray();
    announce('Página excluída.');
    $('[data-new-page]')?.focus();
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível excluir a página.', 'error');
  }
}

// ---- Saving (autosave per page: versions, one request id per attempt, retry) -------------------
const SAVE_TEXT = {
  saved: 'Salvo',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  error: 'Não salvo — tentar de novo',
  conflict: 'Esta página mudou em outro aparelho. Recarregue o diário.',
  quote: 'Não salvo: escolha a fonte da citação.',
};
function saveState(kind, text) {
  const box = $('[data-save-state]');
  if (!box) return;
  box.dataset.state = kind;
  box.textContent = text || SAVE_TEXT[kind];
  const retry = $('[data-save-retry]');
  if (retry) retry.hidden = kind !== 'error';
}
const pageBody = (p) => ({ template: p.template, title: p.title, paper: p.paper, content: p.content, decorations: p.decorations, links: p.links });

function schedule(p) {
  const entry = state.saves.get(p.id) || {};
  state.saves.set(p.id, entry);
  clearTimeout(entry.timer);
  entry.dirty = true;
  saveState('dirty');
  entry.timer = setTimeout(() => void flush(p), 650);
}

async function flush(p) {
  const entry = state.saves.get(p.id);
  if (!entry || !entry.dirty) return;
  clearTimeout(entry.timer);
  if (entry.inFlight) return;
  const quote = p.content.quote;
  if (quote?.text?.trim() && !quote.source) return saveState('quote');
  const body = pageBody(p);
  const text = JSON.stringify(body);
  // A retry of the same body keeps its request id, so the server can tell it is a repeat.
  if (entry.bodyText !== text) {
    entry.bodyText = text;
    entry.requestId = uuid();
  }
  entry.dirty = false;
  entry.inFlight = true;
  saveState('saving');
  try {
    const result = await api.savePage(state.journal.id, p.id, { version: p.version, requestId: entry.requestId, body });
    p.version = result.page.version;
    entry.bodyText = null;
    entry.inFlight = false;
    if (entry.dirty) return void flush(p);
    saveState('saved');
  } catch (failure) {
    entry.inFlight = false;
    entry.dirty = true;
    if (failure.code === 'JOURNAL_VERSION_CONFLICT') saveState('conflict');
    else saveState('error', failure.status && failure.status < 500 ? `Não salvo: ${failure.message}` : SAVE_TEXT.error);
  }
}
globalThis.addEventListener?.('beforeunload', (event) => {
  if ([...state.saves.values()].some((entry) => entry.dirty || entry.inFlight)) event.preventDefault();
});
globalThis.addEventListener?.('pagehide', () => {
  for (const p of state.pages) if (state.saves.get(p.id)?.dirty) void flush(p);
});

// ---- Start -------------------------------------------------------------------------------------
try {
  if (localStorage.getItem(PLAIN_KEY)) document.documentElement.dataset.scrapbookPlain = 'true';
} catch {
  /* per-viewer convenience only */
}
await initAuthenticatedShell();
applyExperienceMode();
const flags = await getFeatureFlags().catch(() => ({}));
if (!flags.journal) {
  const box = $('[data-tool-unavailable]');
  box.hidden = false;
  box.append(emptyState('O Diário de estudo ainda não está ativo', 'Ele aparece aqui quando for ativado neste servidor.', { href: './historico.html', action: 'Voltar à Biblioteca', mascot: 'rest' }));
} else {
  if (flags.discoveries)
    void getCollection()
      .then((collection) => {
        state.stamps = (collection.unlocks || []).filter((u) => String(u.id).startsWith('stamp.')).map((u) => u.id);
        if (state.journal) renderTray();
      })
      .catch(() => {});
  const id = new URLSearchParams(location.search).get('id');
  if (id) {
    try {
      state.journals = (await api.listJournals()).journals || [];
    } catch {
      /* the journal itself may still open */
    }
    await openJournal(id);
  } else await showShelf();
}
