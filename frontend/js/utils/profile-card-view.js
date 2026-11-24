// Renders the body of a profile card (and the live preview of the card editor). Every user string
// goes in through textContent or a validated attribute: no innerHTML of user content, and the
// only frames are the allow-listed YouTube (youtube-nocookie) and Spotify embeds, or the
// script-less sandbox of a legacy HTML card. See profile-cards.js for the data side.
import {
  EMBED_ATTRIBUTES,
  cardTemplateOf,
  checklistItems,
  embedFrame,
  parseRichText,
} from './profile-cards.js';
import { widgetDocument } from './profile-widgets.js';

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

function inline(nodes, parent) {
  for (const node of nodes) {
    if (node.t === 'text') parent.append(node.v);
    else if (node.t === 'a') {
      const link = make('a');
      link.href = node.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      inline(node.c, link);
      parent.append(link);
    } else {
      const element = make({ b: 'strong', i: 'em', mark: 'mark' }[node.t] || 'span');
      inline(node.c, element);
      parent.append(element);
    }
  }
  return parent;
}

const withBreaks = (lines, parent) => {
  lines.forEach((line, index) => {
    if (index) parent.append(make('br'));
    inline(line, parent);
  });
  return parent;
};

/** Formatted text → DOM (headings start at h4: the card title is an h3). */
export function renderRichText(source) {
  const box = make('div', 'card-rich');
  for (const block of parseRichText(source)) {
    if (block.t === 'h') box.append(inline(block.c, make(block.level === 1 ? 'h4' : 'h5')));
    else if (block.t === 'hr') box.append(make('hr'));
    else if (block.t === 'ul' || block.t === 'ol') {
      const list = make(block.t);
      for (const item of block.items) list.append(inline(item, make('li')));
      box.append(list);
    } else if (block.t === 'quote') box.append(withBreaks(block.lines, make('blockquote')));
    else box.append(withBreaks(block.lines, make('p')));
  }
  return box;
}

function renderChecklist(block, ctx) {
  const items = checklistItems(block);
  const box = make('div', 'profile-checklist');
  const count = make('p', 'profile-checklist-count');
  count.setAttribute('aria-live', 'polite');
  const sync = () => {
    const done = [...box.querySelectorAll('input')].filter((input) => input.checked).length;
    count.textContent = `${done} de ${items.length} ${items.length === 1 ? 'feito' : 'feitos'}`;
  };
  items.forEach((item, index) => {
    const label = make('label');
    const checkbox = make('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.addEventListener('change', () => {
      sync();
      ctx.onToggle?.(index, checkbox.checked);
    });
    label.append(checkbox, make('span', null, item.text));
    box.append(label);
  });
  box.prepend(count);
  sync();
  return box;
}

function calmMotion() {
  const root = document.documentElement.dataset;
  return (
    root.reducedMotion === 'true' ||
    root.lowStimulation === 'true' ||
    root.focusMode === 'true' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function renderImage(block, ctx) {
  const gif = block.card === 'gif';
  const figure = make(
    'figure',
    `card-figure card-fit-${block.fit === 'contain' ? 'contain' : 'cover'}`,
  );
  const frame = make('div', 'card-figure-frame');
  const image = make('img');
  image.alt = block.alt || '';
  image.decoding = 'async';
  frame.append(image);
  figure.append(frame);
  if (block.caption) figure.append(make('figcaption', null, block.caption));
  const missing = () =>
    frame.replaceChildren(
      make('p', 'card-note', 'A imagem não está disponível neste aparelho agora.'),
    );
  Promise.resolve(ctx.loadMedia?.(block.media))
    .then((source) => {
      if (!source) return missing();
      image.src = typeof source === 'string' ? source : URL.createObjectURL(source);
      if (gif) setUpGifControl(figure, frame, image, block);
    })
    .catch(missing);
  return figure;
}

/** A GIF can be paused (WCAG 2.2.2) and starts paused when less motion is requested. */
function setUpGifControl(figure, frame, image, block) {
  const still = make('canvas', 'card-gif-still');
  still.setAttribute('role', 'img');
  still.setAttribute('aria-label', block.alt ? `${block.alt} (pausado)` : 'GIF pausado');
  const button = make('button', 'text-action card-gif-toggle');
  button.type = 'button';
  let playing = !calmMotion();
  const apply = () => {
    image.hidden = !playing;
    still.hidden = playing;
    button.textContent = playing ? 'Pausar GIF' : 'Animar GIF';
    button.setAttribute('aria-pressed', String(!playing));
  };
  const draw = () => {
    still.width = image.naturalWidth || 1;
    still.height = image.naturalHeight || 1;
    still.getContext('2d')?.drawImage(image, 0, 0);
  };
  image.addEventListener(
    'load',
    () => {
      draw();
      apply();
    },
    { once: true },
  );
  button.addEventListener('click', () => {
    if (playing) draw();
    playing = !playing;
    apply();
  });
  frame.append(still);
  figure.append(button);
  apply();
}

/** Derived from the validated frame address, never from a stored link. */
function serviceLink(frame) {
  const parts = new URL(frame.src);
  if (frame.provider === 'youtube') {
    const id = parts.pathname.split('/').pop();
    return ['Abrir no YouTube', `https://www.youtube.com/watch?v=${id}`];
  }
  const [, , kind, id] = parts.pathname.split('/');
  return ['Abrir no Spotify', `https://open.spotify.com/${kind}/${id}`];
}

function renderEmbed(block) {
  const frame = embedFrame(block.url);
  if (!frame)
    return make(
      'p',
      'card-note',
      'Este link não pode ser exibido com segurança. Edite o card e cole o link do YouTube ou do Spotify de novo.',
    );
  const attributes = EMBED_ATTRIBUTES[frame.provider];
  const box = make('div', `card-embed card-embed-${frame.provider}`);
  const iframe = make('iframe');
  iframe.src = frame.src;
  iframe.title = `${frame.provider === 'youtube' ? 'Vídeo do YouTube' : 'Player do Spotify'}: ${block.title}`;
  iframe.loading = 'lazy';
  iframe.referrerPolicy = attributes.referrerPolicy;
  iframe.setAttribute('sandbox', attributes.sandbox);
  iframe.allow = attributes.allow;
  iframe.allowFullscreen = true;
  if (frame.height) box.style.setProperty('--embed-height', `${frame.height}px`);
  const [label, href] = serviceLink(frame);
  const link = make('a', 'card-embed-link', label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  box.append(iframe, link);
  return box;
}

/** Legacy HTML/CSS and 3D cards: shown as before in a sandbox without scripts, read-only. */
function renderLegacyWidget(block) {
  const frame = make('iframe', 'profile-widget-frame');
  frame.title = block.title;
  frame.setAttribute('sandbox', '');
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = widgetDocument(block.content, block.css);
  return frame;
}

/**
 * The body of a card. ctx: { loadMedia(slot) → Promise<Blob|string|null>, onToggle(index, done) }.
 * Data cards are rendered by the page (they load the person's study data).
 */
export function renderCardBody(block, ctx = {}) {
  const kind = cardTemplateOf(block);
  if (kind === 'text') {
    if (block.format === 'rich') return renderRichText(block.content);
    return make('p', 'card-plain', String(block.content ?? ''));
  }
  if (kind === 'checklist') return renderChecklist(block, ctx);
  if (kind === 'image' || kind === 'gif') return renderImage(block, ctx);
  if (kind === 'youtube' || kind === 'spotify') return renderEmbed(block);
  if (block.type === 'embed') return renderEmbed(block);
  if (block.type === 'widget') return renderLegacyWidget(block);
  if (block.type === 'code') {
    const pre = make('pre', 'card-legacy-code');
    pre.append(make('code', null, String(block.content ?? '')));
    return pre;
  }
  return make('p', 'card-plain', String(block.content ?? ''));
}

/** Text of a legacy HTML card, via an inert parser (nothing loads or runs). */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html).slice(0, 30000), 'text/html');
  for (const node of doc.querySelectorAll('style,script,template')) node.remove();
  for (const node of doc.querySelectorAll('br,p,div,li,h1,h2,h3,h4,label,blockquote,summary'))
    node.after('\n');
  return doc.body.textContent || '';
}
