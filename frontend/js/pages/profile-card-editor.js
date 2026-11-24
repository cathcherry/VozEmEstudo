// The "Novo card / Editar card" dialog of the profile (3.7): a gallery of useful templates (text,
// checklist, image, GIF, YouTube, Spotify and "Seus dados"), the fields of the chosen template and
// a live preview drawn by the same renderer as the profile. Decorative 3D cards and code/HTML are
// no longer offered; existing ones stay visible read-only (see profile-cards.js).
import {
  CARD_TEMPLATES,
  CARD_TONES,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_TEXT,
  buildCard,
  cardTemplateOf,
  cardValues,
  formatSelection,
  normalizeTone,
  parseSpotify,
  parseYouTube,
  templateDefaults,
} from '../utils/profile-cards.js';
import { renderCardBody } from '../utils/profile-card-view.js';

const $ = (selector, root = document) => root.querySelector(selector);
const make = (tag, attributes = {}, text) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Default size of a new card, by template (12-column grid, height in px). */
function defaultLayout(template, block) {
  if (template === 'spotify') {
    const tall = !/\/embed\/(track|episode)\//.test(block.url || '');
    return { columns: tall ? 6 : 4, height: tall ? 500 : 300 };
  }
  return (
    {
      text: { columns: 6, height: 380 },
      checklist: { columns: 4, height: 380 },
      image: { columns: 4, height: 400 },
      gif: { columns: 4, height: 400 },
      youtube: { columns: 6, height: 420 },
    }[template] || { columns: 4, height: 400 }
  );
}

const TILE_ICONS = {
  text: 'note',
  checklist: 'check',
  image: 'sticker',
  gif: 'sparkle',
  youtube: 'video',
  spotify: 'audio',
  data: 'grid',
};

const TOOLBAR = [
  ['heading', 'Título', 'Transformar a linha em título'],
  ['bold', 'B', 'Negrito (Ctrl+B)'],
  ['italic', 'I', 'Itálico (Ctrl+I)'],
  ['mark', 'Destaque', 'Destacar o trecho'],
  ['list', '• Lista', 'Lista com marcadores'],
  ['numbered', '1. Lista', 'Lista numerada'],
  ['quote', 'Citação', 'Citação'],
  ['link', 'Link', 'Inserir link (https://)'],
];

const SERVICE_HELP = {
  youtube:
    'Aceita links como youtube.com/watch?v=…, youtu.be/…, Shorts e transmissões.',
  spotify:
    'Aceita links de open.spotify.com para música, álbum, playlist, artista, episódio ou podcast (no Spotify: Compartilhar › Copiar link).',
};

/**
 * @param {{ loadBlocks: () => object[], saveBlocks: (blocks: object[]) => void,
 *   afterSave: (block: object, previous: object|null) => void, loadMedia: (slot: string) => Promise<any>,
 *   saveMedia: (slot: string, blob: Blob) => Promise<void> }} host
 */
export function createCardEditor(host) {
  const dialog = $('#block-dialog');
  const form = $('[data-block-form]', dialog);
  const titleInput = $('#block-title', dialog);
  const fields = $('[data-template-fields]', dialog);
  const status = $('[data-block-message]', dialog);
  const submit = $('[type="submit"]', dialog);
  const previewCard = $('[data-block-preview]', dialog);
  const previewHeading = $('[data-block-preview-heading]', dialog);
  const previewBody = $('[data-block-preview-body]', dialog);
  let template = null;
  let editing = null;
  let draft = null; // { file, url } of a newly chosen image
  let lastEmbed = null;
  let previewTimer = 0;

  const say = (text, type) => {
    status.textContent = text || '';
    status.dataset.type = type || '';
  };

  // ---- Step 1: choose -----------------------------------------------------------------------
  const grid = $('[data-block-templates]', dialog);
  for (const item of [
    ...CARD_TEMPLATES,
    {
      id: 'data',
      label: 'Seus dados',
      description: 'Aulas recentes, objetivos, minutos da semana e mais.',
    },
  ]) {
    const button = make('button', {
      type: 'button',
      className: `block-template-tile tile-${item.id}`,
    });
    if (item.id === 'data') button.dataset.blockMode = 'data';
    else button.dataset.template = item.id;
    const icon = make('span', { className: 'block-template-icon', 'aria-hidden': 'true' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ui-icon');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/assets/icons/sprite.svg#i-${TILE_ICONS[item.id]}`);
    svg.append(use);
    icon.append(svg);
    button.append(
      icon,
      make('strong', {}, item.label),
      make('span', { className: 'block-template-detail' }, item.description),
    );
    button.addEventListener('click', () => (item.id === 'data' ? showData() : choose(item.id)));
    grid.append(button);
  }
  for (const back of dialog.querySelectorAll('[data-block-back]'))
    back.addEventListener('click', () => showChoose(true));

  function step(name) {
    for (const section of dialog.querySelectorAll('[data-block-step]'))
      section.hidden = section.dataset.blockStep !== name;
  }

  function showChoose(focus) {
    template = null;
    clearDraft();
    step('choose');
    grid.hidden = false;
    $('[data-block-data-sources]', dialog).hidden = true;
    $('#block-dialog-title', dialog).textContent = 'Novo card';
    if (focus) grid.querySelector('button')?.focus();
  }

  function showData() {
    grid.hidden = true;
    $('[data-block-data-sources]', dialog).hidden = false;
    $('[data-block-data-sources] [data-data-source]:not(:disabled)', dialog)?.focus();
  }

  function choose(id, values = templateDefaults(id)) {
    template = id;
    say('');
    step('edit');
    const label = CARD_TEMPLATES.find((item) => item.id === id)?.label || 'Card';
    $('#block-dialog-title', dialog).textContent = editing
      ? `Editar card · ${label}`
      : `Novo card · ${label}`;
    $('[data-block-back-edit]', dialog).hidden = Boolean(editing);
    submit.textContent = editing ? 'Salvar card' : 'Adicionar card';
    titleInput.value = values.title || '';
    renderFields(values);
    preview(true);
    titleInput.focus();
  }

  // ---- Step 2: fields -----------------------------------------------------------------------
  function field(label, control, help) {
    const wrap = make('label', { className: 'block-field', for: control.id });
    wrap.append(label);
    if (help) {
      const hint = make('span', { className: 'block-field-help', id: `${control.id}-help` }, help);
      control.setAttribute('aria-describedby', hint.id);
      wrap.append(control, hint);
    } else wrap.append(control);
    return wrap;
  }

  function toneField(value) {
    const set = make('fieldset', { className: 'block-tones' });
    set.append(make('legend', {}, 'Cor de fundo'));
    for (const [id, name] of CARD_TONES) {
      const input = make('input', { type: 'radio', name: 'card-tone', value: id });
      input.checked = normalizeTone(value) === id;
      const option = make('label', { className: `block-tone card-tone-${id || 'none'}` });
      option.append(
        input,
        make('span', { className: 'block-tone-swatch', 'aria-hidden': 'true' }),
        make('span', {}, name),
      );
      set.append(option);
    }
    return set;
  }

  function textFields(values) {
    const area = make('textarea', {
      id: 'card-text',
      rows: '9',
      maxlength: String(MAX_TEXT),
      'data-card-field': 'text',
      spellcheck: 'true',
    });
    area.value = values.text || '';
    const bar = make('div', {
      className: 'block-toolbar',
      role: 'toolbar',
      'aria-label': 'Formatação do texto',
      'aria-controls': 'card-text',
    });
    for (const [kind, label, name] of TOOLBAR) {
      const button = make(
        'button',
        { type: 'button', className: `block-tool tool-${kind}`, 'aria-label': name, title: name },
        label,
      );
      button.addEventListener('click', () => applyFormat(area, kind));
      bar.append(button);
    }
    area.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const kind = { b: 'bold', i: 'italic' }[event.key.toLowerCase()];
      if (!kind) return;
      event.preventDefault();
      applyFormat(area, kind);
    });
    const label = make('label', { className: 'block-field', for: 'card-text' }, 'Texto');
    const help = make(
      'p',
      { className: 'block-field-help', id: 'card-text-help' },
      'Também dá para digitar: **negrito**, *itálico*, ==destaque==, ## título, - lista, > citação e [texto](https://link).',
    );
    area.setAttribute('aria-describedby', help.id);
    const group = make('div', { className: 'block-text-editor' });
    group.append(label, bar, area, help);
    return [group, toneField(values.tone)];
  }

  function applyFormat(area, kind) {
    const next = formatSelection(area.value, area.selectionStart, area.selectionEnd, kind);
    area.value = next.value.slice(0, MAX_TEXT);
    area.focus();
    area.setSelectionRange(next.start, next.end);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function checklistFields(values) {
    const area = make('textarea', {
      id: 'card-items',
      rows: '7',
      maxlength: '4000',
      'data-card-field': 'items',
    });
    area.value = values.items || '';
    return [
      field(
        'Passos',
        area,
        'Um passo por linha (até 30).',
      ),
      toneField(values.tone),
    ];
  }

  function imageFields(values) {
    const gif = template === 'gif';
    const file = make('input', {
      id: 'card-file',
      type: 'file',
      accept: gif ? 'image/gif,image/webp' : IMAGE_TYPES.join(','),
    });
    const current = values.media ? 'A imagem atual é mantida; escolha outra para trocar.' : '';
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      try {
        if (
          !IMAGE_TYPES.includes(chosen.type) ||
          (gif && !['image/gif', 'image/webp'].includes(chosen.type))
        )
          throw new Error(
            gif
              ? 'Escolha um arquivo GIF (ou WebP animado).'
              : 'Escolha uma imagem PNG, JPG, WebP ou GIF.',
          );
        if (chosen.size > MAX_IMAGE_BYTES) throw new Error('A imagem deve ter no máximo 8 MB.');
        clearDraft();
        draft = { file: chosen, url: URL.createObjectURL(chosen) };
        say('');
        preview(true);
      } catch (error) {
        file.value = '';
        say(error.message, 'error');
      }
    });
    const alt = make('input', { id: 'card-alt', maxlength: '200', 'data-card-field': 'alt' });
    alt.value = values.alt || '';
    const caption = make('input', {
      id: 'card-caption',
      maxlength: '200',
      'data-card-field': 'caption',
    });
    caption.value = values.caption || '';
    const fit = make('fieldset', { className: 'block-choice' });
    fit.append(make('legend', {}, 'Enquadramento'));
    for (const [id, name] of [
      ['cover', 'Preencher o card'],
      ['contain', 'Mostrar inteira'],
    ]) {
      const input = make('input', { type: 'radio', name: 'card-fit', value: id });
      input.checked = (values.fit || 'cover') === id;
      const option = make('label');
      option.append(input, ` ${name}`);
      fit.append(option);
    }
    const media = make('input', { type: 'hidden', 'data-card-field': 'media' });
    media.value = values.media || '';
    return [
      field(
        gif ? 'Arquivo GIF' : 'Imagem',
        file,
        `${gif ? 'GIF ou WebP animado' : 'PNG, JPG, WebP ou GIF'} · até 8 MB. ${current}`.trim(),
      ),
      field(
        'Descrição para leitores de tela (recomendado)',
        alt,
        'O que a imagem mostra, em poucas palavras.',
      ),
      field('Legenda (opcional)', caption),
      fit,
      media,
    ];
  }

  function serviceFields(values) {
    const input = make('input', {
      id: 'card-url',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      'data-card-field': 'url',
      placeholder:
        template === 'youtube'
          ? 'https://www.youtube.com/watch?v=…'
          : 'https://open.spotify.com/track/…',
    });
    input.value = values.url || '';
    const check = make('p', {
      className: 'block-url-check',
      id: 'card-url-check',
      'aria-live': 'polite',
    });
    const wrap = field(
      template === 'youtube' ? 'Link do vídeo no YouTube' : 'Link do Spotify',
      input,
      SERVICE_HELP[template],
    );
    input.setAttribute('aria-describedby', `card-url-help card-url-check`);
    wrap.append(check);
    return [wrap];
  }

  function renderFields(values) {
    clearDraft();
    const build = {
      text: textFields,
      checklist: checklistFields,
      image: imageFields,
      gif: imageFields,
      youtube: serviceFields,
      spotify: serviceFields,
    }[template];
    fields.replaceChildren(...build(values));
  }

  function readValues() {
    const values = { title: titleInput.value };
    for (const input of fields.querySelectorAll('[data-card-field]'))
      values[input.dataset.cardField] = input.value;
    values.tone = fields.querySelector('input[name="card-tone"]:checked')?.value || '';
    values.fit = fields.querySelector('input[name="card-fit"]:checked')?.value || 'cover';
    if (draft) values.media = 'draft';
    return values;
  }

  // ---- Preview ------------------------------------------------------------------------------
  function urlCheck(values) {
    const check = $('#card-url-check', dialog);
    if (!check) return;
    if (!String(values.url || '').trim()) {
      check.textContent = '';
      check.dataset.state = '';
      return;
    }
    try {
      const parsed = template === 'youtube' ? parseYouTube(values.url) : parseSpotify(values.url);
      check.textContent =
        template === 'youtube'
          ? 'Vídeo reconhecido.'
          : `Link do Spotify reconhecido (${{ track: 'música', album: 'álbum', playlist: 'playlist', episode: 'episódio', show: 'podcast', artist: 'artista' }[parsed.kind]}).`;
      check.dataset.state = 'ok';
    } catch (error) {
      check.textContent = error.message;
      check.dataset.state = 'error';
    }
  }

  function preview(force = false) {
    if (!template) return;
    const values = readValues();
    previewHeading.textContent = values.title.trim() || 'Sem título';
    previewCard.className = `profile-block block-preview-card card-kind-${template}`;
    const tone = normalizeTone(values.tone);
    if (tone) previewCard.classList.add(`card-tone-${tone}`);
    urlCheck(values);
    let block;
    try {
      block = {
        id: 'preview',
        ...buildCard(template, { ...values, title: values.title.trim() || 'Sem título' }, editing),
      };
    } catch (error) {
      lastEmbed = null;
      previewBody.replaceChildren(make('p', { className: 'card-note' }, error.message));
      return;
    }
    if (block.type === 'embed') {
      if (!force && lastEmbed === block.url) return;
      lastEmbed = block.url;
    } else lastEmbed = null;
    previewBody.replaceChildren(
      renderCardBody(block, {
        loadMedia: (slot) => (slot === 'draft' ? draft?.url : host.loadMedia(slot)),
      }),
    );
  }

  form.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(
      () => preview(),
      template === 'youtube' || template === 'spotify' ? 350 : 60,
    );
  });
  form.addEventListener('change', () => preview());

  function clearDraft() {
    if (draft?.url) URL.revokeObjectURL(draft.url);
    draft = null;
  }

  // ---- Save ---------------------------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!template) return;
    const values = readValues();
    const blocks = host.loadBlocks();
    const current = editing ? blocks.find((block) => block.id === editing.id) : null;
    let fieldsToSave;
    try {
      // Validate everything first, so a bad link never leaves a stray upload behind.
      fieldsToSave = buildCard(template, values, current);
    } catch (error) {
      say(error.message, 'error');
      fields.querySelector('[aria-describedby], input, textarea')?.focus();
      return;
    }
    dialog.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    try {
      if (draft) {
        const slot = `card-${crypto.randomUUID()}`;
        say('Salvando a imagem…');
        await host.saveMedia(slot, draft.file);
        fieldsToSave.media = slot;
      }
      const previous = current ? structuredClone(current) : null;
      let saved;
      if (current) {
        Object.assign(current, fieldsToSave);
        if (current.type !== 'widget') delete current.css;
        saved = current;
      } else {
        saved = {
          id: crypto.randomUUID(),
          ...fieldsToSave,
          layout: defaultLayout(template, fieldsToSave),
        };
        blocks.push(saved);
      }
      host.saveBlocks(blocks);
      clearDraft();
      dialog.removeAttribute('aria-busy');
      dialog.close();
      host.afterSave(saved, previous);
    } catch (error) {
      say(error?.message || 'Não foi possível salvar o card.', 'error');
    } finally {
      dialog.removeAttribute('aria-busy');
      submit.disabled = false;
    }
  });

  dialog.addEventListener('close', () => {
    clearDraft();
    clearTimeout(previewTimer);
    // Stop a playing video or song when the dialog closes.
    previewBody.replaceChildren();
    lastEmbed = null;
  });

  return {
    /** A new card (gallery first), or an existing card in its own template. */
    open(block = null) {
      editing = block && cardTemplateOf(block) && cardTemplateOf(block) !== 'data' ? block : null;
      say('');
      form.reset();
      if (editing) choose(cardTemplateOf(editing), cardValues(editing));
      else showChoose(false);
      dialog.showModal();
      if (!editing) grid.querySelector('button')?.focus();
    },
    /** Opens the text template prefilled (used by "Copiar como texto" of a legacy card). */
    openText(title, text) {
      editing = null;
      say('');
      form.reset();
      choose('text', { title, text, tone: '' });
      dialog.showModal();
      titleInput.focus();
    },
  };
}
