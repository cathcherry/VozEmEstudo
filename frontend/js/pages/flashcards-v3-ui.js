// Revisar › Flashcards with Flashcards 3.0 on: typed cards in the "Criar cartão" dialog, one look
// per set (built-in or the student's own template), a template editor, and the review card
// decorated with its look, type, origin and imported images. Content is never changed by a look.
import {
  listCardTemplates,
  saveCardTemplate,
  setFlashcardSetTemplate,
  addFlashcardNote,
  listFlashcardSets,
} from '../api/flashcard.api.js';
import { CARD_TEMPLATES } from '../utils/card-templates.js';
import {
  NOTE_TYPES,
  noteTypeLabel,
  lookFor,
  applyLook,
  contrastRatio,
  TOKEN_FONTS,
  TOKEN_PATTERNS,
  TOKEN_SHADOWS,
} from '../utils/card-looks.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
let counter = 0;

const state = { templates: [], sets: new Map() };
export const lookState = state;

async function reload() {
  const [templates, sets] = await Promise.all([listCardTemplates().catch(() => []), listFlashcardSets().catch(() => [])]);
  state.templates = templates || [];
  state.sets = new Map((sets || []).map((set) => [set.id, set]));
}
const refreshPanel = () =>
  document.dispatchEvent(new CustomEvent('voz:flashcards-command', { detail: { action: 'refresh' } }));

// ---- review card decoration ---------------------------------------------------------------------
function decorate({ card, article }) {
  const set = state.sets.get(card.set_id);
  applyLook(article, lookFor(set, state.templates), card.note_type || 'basic');
  const meta = make('p', null, 'flashcard-note-meta');
  if (card.note_type && card.note_type !== 'basic') meta.append(make('span', noteTypeLabel(card.note_type), 'flashcard-type-badge'));
  if (card.origin_label) meta.append(make('span', `De: ${card.origin_label}`, 'flashcard-origin'));
  if (meta.childElementCount) article.querySelector('h3')?.after(meta);
  const images = (card.media || []).filter((m) => m.url);
  if (images.length) {
    const figure = make('div', null, 'flashcard-media');
    for (const image of images.slice(0, 4)) {
      const img = make('img');
      img.src = image.url;
      img.alt = image.name ? `Imagem do cartão: ${image.name}` : 'Imagem do cartão';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      figure.append(img);
    }
    // Images belong to the answer side when present there in Anki; shown after the front text.
    article.querySelector('.flashcard-content')?.after(figure);
  }
}

// ---- typed card creation ------------------------------------------------------------------------
function enhanceCreateForm(form, status) {
  const front = form.querySelector('[name="front"]');
  const back = form.querySelector('[name="back"]');
  const setSelect = form.querySelector('select[name="setId"], [data-flashcard-create-set] select') || null;
  const typeLabel = make('label', 'Tipo de cartão');
  const type = make('select');
  type.name = 'noteType';
  for (const [value, label] of NOTE_TYPES) type.append(new Option(label, value));
  typeLabel.append(type);
  const typed = make('div', null, 'flashcard-typed-fields');
  typed.hidden = true;
  form.prepend(typeLabel);
  front.closest('label').before(typed);
  const fields = new Map();
  const render = () => {
    const spec = NOTE_TYPES.find(([key]) => key === type.value);
    const basic = type.value === 'basic';
    front.closest('label').hidden = back.closest('label').hidden = !basic;
    front.required = back.required = basic;
    typed.hidden = basic;
    typed.replaceChildren();
    fields.clear();
    if (basic) return;
    for (const [name, label, kind, optional] of spec[2]) {
      const id = `typed-${++counter}`;
      const wrap = make('label', label);
      wrap.htmlFor = id;
      const input = make(kind === 'area' || kind === 'list' ? 'textarea' : 'input');
      input.id = id;
      if (kind === 'area' || kind === 'list') input.rows = kind === 'list' ? 4 : 3;
      input.required = !optional;
      input.maxLength = kind === 'list' ? 3000 : 2000;
      wrap.append(input);
      typed.append(wrap);
      fields.set(name, { input, kind });
    }
  };
  type.addEventListener('change', render);
  render();
  // Typed cards go to a set through the 3.0 endpoint (rendered by the server).
  form.addEventListener(
    'submit',
    (event) => {
      if (type.value === 'basic') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!form.reportValidity()) return;
      const setId = setSelect?.value || form.querySelector('[data-flashcard-create-set-select]')?.value || '';
      if (!setId) {
        status.textContent = 'Escolha um conjunto para cartões com tipo.';
        status.dataset.state = 'error';
        return;
      }
      const values = {};
      for (const [name, { input, kind }] of fields) {
        if (kind === 'list') values[name] = input.value.split('\n').map((line) => line.trim()).filter(Boolean);
        else if (input.value.trim()) values[name] = input.value;
      }
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      void addFlashcardNote(setId, { noteType: type.value, fields: values })
        .then(() => {
          form.reset();
          render();
          status.textContent = 'Cartão criado e disponível para a primeira revisão.';
          status.dataset.state = 'success';
          form.closest('dialog')?.close();
          refreshPanel();
        })
        .catch((error) => {
          status.textContent = error.message || 'Não foi possível salvar o cartão.';
          status.dataset.state = 'error';
        })
        .finally(() => {
          submit.disabled = false;
        });
    },
    true,
  );
}

// ---- template editor ----------------------------------------------------------------------------
export function openTemplateEditor({ template = null, opener } = {}) {
  const id = `card-template-${++counter}`;
  const dialog = make('dialog', null, 'settings-dialog app-dialog card-template-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const form = make('form');
  form.method = 'dialog';
  const title = make('h2', template ? 'Editar modelo de cartão' : 'Novo modelo de cartão');
  title.id = `${id}-title`;
  const hint = make('p', 'Muda só a aparência: perguntas, respostas, autoria e histórico continuam iguais.', 'app-dialog-hint');
  const t = template?.tokens || {};
  const control = (label, element) => {
    const wrap = make('label', label);
    wrap.append(element);
    return wrap;
  };
  const name = make('input');
  name.required = true;
  name.maxLength = 80;
  name.value = template?.name || '';
  const base = make('select');
  for (const [value, label] of CARD_TEMPLATES) base.append(new Option(label, value));
  base.value = template?.base || 'classic';
  const color = (value) => {
    const input = make('input');
    input.type = 'color';
    input.value = value;
    return input;
  };
  const accent = color(t.accent || '#5b4bc4');
  const paper = color(t.paper || '#ffffff');
  const ink = color(t.ink || '#1f1d2b');
  const select = (options, value) => {
    const element = make('select');
    for (const [key, label] of options) element.append(new Option(label, key));
    element.value = value;
    return element;
  };
  const font = select(TOKEN_FONTS, t.font || 'theme');
  const pattern = select(TOKEN_PATTERNS, t.pattern || 'none');
  const shadow = select(TOKEN_SHADOWS, t.shadow || 'soft');
  const radius = make('input');
  radius.type = 'range';
  radius.min = '0';
  radius.max = '32';
  radius.value = String(t.radius ?? 16);
  const clozeLeft = make('input');
  clozeLeft.type = 'checkbox';
  clozeLeft.checked = template?.variants?.cloze?.layout === 'left';
  const clozeLabel = make('label', null, 'card-template-check');
  clozeLabel.append(clozeLeft, make('span', 'Lacunas alinhadas à esquerda'));
  const preview = make('article', null, 'flashcard-review-card card-template-preview');
  preview.setAttribute('aria-label', 'Prévia do modelo');
  preview.append(make('h3', 'Frente do cartão'), make('p', 'A clorofila absorve qual cor de luz?', 'flashcard-content'));
  const warning = make('p', '', 'card-template-warning');
  warning.setAttribute('role', 'status');
  const grid = make('div', null, 'card-template-grid');
  grid.append(
    control('Nome do modelo', name),
    control('Base', base),
    control('Cor de destaque', accent),
    control('Papel', paper),
    control('Texto', ink),
    control('Fonte', font),
    control('Fundo', pattern),
    control('Sombra', shadow),
    control('Cantos arredondados', radius),
    clozeLabel,
  );
  const error = make('p', '', 'report-error');
  error.setAttribute('role', 'alert');
  const actions = make('div', null, 'form-actions');
  const cancel = make('button', 'Cancelar', 'secondary-action');
  cancel.type = 'button';
  const save = make('button', 'Salvar modelo', 'primary-action');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(title, hint, grid, preview, warning, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  const body = () => ({
    name: name.value.trim(),
    base: base.value,
    tokens: {
      accent: accent.value,
      paper: paper.value,
      ink: ink.value,
      font: font.value,
      pattern: pattern.value,
      shadow: shadow.value,
      radius: Number(radius.value),
    },
    variants: clozeLeft.checked ? { cloze: { layout: 'left' } } : {},
  });
  const update = () => {
    const look = body();
    applyLook(preview, look, 'cloze');
    const ratio = contrastRatio(look.tokens.ink, look.tokens.paper);
    // A warning, never a block: personal aesthetics are allowed.
    warning.textContent = ratio < 4.5 ? `Contraste baixo entre texto e papel (${ratio.toFixed(1)}:1). Pode ficar difícil de ler.` : '';
  };
  for (const element of [base, accent, paper, ink, font, pattern, shadow, radius, clozeLeft]) element.addEventListener('input', update);
  update();
  return new Promise((resolve) => {
    let saved = null;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      try {
        saved = await saveCardTemplate(template?.id || crypto.randomUUID(), {
          version: template?.version || 0,
          requestId: crypto.randomUUID(),
          body: body(),
        });
        dialog.close();
      } catch (problem) {
        error.textContent = problem.message || 'Não foi possível salvar o modelo.';
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
    name.focus();
  });
}

// ---- one look per set ---------------------------------------------------------------------------
function setLookControl(panel, setFilter) {
  // The 2.0 per-browser choice is replaced by the server choice stored on the set.
  panel.querySelector('[data-set-template-picker]')?.closest('label')?.setAttribute('hidden', '');
  const wrap = make('div', null, 'flashcard-set-look');
  const label = make('label', 'Aparência deste conjunto');
  const select = make('select');
  select.dataset.setLook = '';
  label.append(select);
  const create = make('button', 'Novo modelo', 'secondary-action');
  create.type = 'button';
  const status = make('p', '', 'flashcard-muted');
  status.setAttribute('role', 'status');
  wrap.append(label, create, status);
  const fill = () => {
    const set = state.sets.get(setFilter.value);
    wrap.hidden = !set;
    select.replaceChildren(new Option('Igual à favorita', ''));
    for (const [value, name] of CARD_TEMPLATES) select.append(new Option(name, `base:${value}`));
    if (state.templates.length) {
      const group = document.createElement('optgroup');
      group.label = 'Meus modelos';
      for (const template of state.templates) group.append(new Option(template.name, `template:${template.id}`));
      select.append(group);
    }
    if (set) select.value = set.template_id ? `template:${set.template_id}` : set.template_base ? `base:${set.template_base}` : '';
  };
  select.addEventListener('change', async () => {
    const [kind, value] = select.value.split(':');
    const setId = setFilter.value;
    try {
      const updated = await setFlashcardSetTemplate(setId, {
        templateId: kind === 'template' ? value : null,
        base: kind === 'base' ? value : null,
      });
      state.sets.set(setId, { ...state.sets.get(setId), ...updated });
      status.textContent = 'Aparência aplicada ao conjunto inteiro. Os cartões não mudaram.';
      const article = panel.querySelector('.flashcard-review-card');
      if (article) applyLook(article, lookFor(state.sets.get(setId), state.templates));
    } catch (error) {
      status.textContent = error.message || 'Não foi possível aplicar.';
    }
  });
  create.addEventListener('click', async () => {
    const saved = await openTemplateEditor({ opener: create });
    if (!saved) return;
    await reload();
    fill();
    select.value = `template:${saved.id}`;
    select.dispatchEvent(new Event('change'));
  });
  setFilter.addEventListener('change', fill);
  fill();
  return { wrap, fill };
}

export async function initFlashcardsV3({ panel }) {
  if (!panel) return;
  await reload();
  document.addEventListener('voz:flashcard-shown', (event) => decorate(event.detail));
  const already = panel.querySelector('.flashcard-review-card[data-card-id]');
  if (already) {
    /* the first card was drawn before 3.0 loaded: the next render decorates it */
    refreshPanel();
  }
  const form = panel.querySelector('[data-flashcard-create-form]');
  const status = panel.querySelector('[data-flashcard-create-status]');
  if (form && status) enhanceCreateForm(form, status);
  const setFilter = panel.querySelector('[data-flashcard-set-filter]');
  const looks = panel.querySelector('.flashcard-looks');
  if (setFilter && looks) {
    const control = setLookControl(panel, setFilter);
    looks.append(control.wrap);
    // Sets created, merged or imported later appear in the chooser.
    document.addEventListener('voz:flashcards-sets-changed', async () => {
      await reload();
      control.fill();
    });
  }
}
