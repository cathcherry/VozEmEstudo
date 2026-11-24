// "Leitura em voz alta: em todo o site": one discreet speaker in the header of every page that
// reads the selected text or, without a selection, the main content block by block (Alt+L).
// Uses the browser's own voices (speech.js); nothing is sent to a server or an AI provider.
import { speakControls, speechSupported } from './speech.js';

// Elements that are always a block of their own when read.
const READABLE =
  'h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, figcaption, caption, td, th, pre, label, .segment-text';
// Containers that also start a new block when the text sits directly inside them.
const BLOCK_TAGS = new Set(
  'address article aside div dl fieldset figure footer form header legend main ol section table tr ul'.split(
    ' ',
  ),
);
const BLOCK_DISPLAY =
  /^(block|flex|grid|list-item|table|table-row|table-cell|table-caption|flow-root)$/;
// Text inside these is never read: hidden or decorative parts, controls (their names are
// for the buttons, not the content), the screen-reader-only extras and the reader itself.
const SKIP = [
  '[hidden]',
  '[aria-hidden="true"]',
  '[inert]',
  'dialog:not([open])',
  'nav',
  'button',
  'select',
  'textarea',
  'input',
  'summary',
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  '[role="button"]',
  '[role="menu"]',
  '[role="tablist"]',
  '[role="toolbar"]',
  // Links styled as buttons ("Editar informações", "Responder") are controls too; links inside
  // a paragraph or list item are still read with it.
  ':is(a, label)[class*="-action"]',
  // The player's time and captions repeat the transcript.
  '.media-player',
  'audio',
  'video',
  '.sr-only',
  '.speak-controls',
].join(', ');
// Words inside these stay glued to their neighbours ("a <strong>fotossíntese</strong> ocorre").
const INLINE = new Set(
  'a abbr b bdi bdo cite code data dfn del em i ins kbd mark q s small strong sub sup time u var'.split(
    ' ',
  ),
);

function hiddenByStyle(element, view) {
  if (element.checkVisibility)
    return !element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const style = view?.getComputedStyle?.(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return false;
}
// Collapsed <details>: only their summary shows (and summaries are controls).
const inClosedDetails = (element) => Boolean(element.closest('details:not([open])'));

function blockOf(element, root, view) {
  const readable = element.closest(READABLE);
  if (readable && root.contains(readable)) return readable;
  for (let node = element; node && node !== root; node = node.parentElement) {
    if (BLOCK_TAGS.has(node.localName)) return node;
    const display = view?.getComputedStyle?.(node)?.display;
    if (display && BLOCK_DISPLAY.test(display)) return node;
  }
  return root;
}
// Two text nodes of the same block are separated by a space unless only inline formatting
// stands between them ("Questão?" + "Não respondida" in separate spans stay two words).
function glued(previous, next) {
  if (previous.parentNode === next.parentNode) return true;
  const ancestors = (node) => {
    const list = [];
    for (let el = node.parentElement; el; el = el.parentElement) list.push(el);
    return list;
  };
  const a = ancestors(previous);
  const b = ancestors(next);
  const common = a.find((el) => b.includes(el));
  const between = [...a.slice(0, a.indexOf(common)), ...b.slice(0, b.indexOf(common))];
  return between.every((el) => INLINE.has(el.localName));
}

/**
 * Visible, non-decorative text of the main content in reading (document) order, one entry per
 * block: headings, paragraphs, list items, cells, transcript segments, alternatives, and any
 * other visible text, so nothing is skipped because of the markup used. Each text appears once.
 */
export function readableBlocks(root = document.querySelector('main')) {
  if (!root) return [];
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const verdicts = new Map();
  const readableParent = (element) => {
    if (!verdicts.has(element))
      verdicts.set(
        element,
        !element.closest(SKIP) && !inClosedDetails(element) && !hiddenByStyle(element, view),
      );
    return verdicts.get(element);
  };
  const blocks = [];
  let last = null,
    lastNode = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim() || !node.parentElement || !readableParent(node.parentElement))
      continue;
    const element = blockOf(node.parentElement, root, view);
    if (last && last.element === element) {
      last.text += (glued(lastNode, node) ? '' : ' ') + node.nodeValue;
    } else {
      last = { element, text: node.nodeValue };
      blocks.push(last);
    }
    lastNode = node;
  }
  return blocks
    .map((block) => ({ element: block.element, text: block.text.replace(/\s+/g, ' ').trim() }))
    .filter((block) => block.text);
}

export function selectedBlocks(win = window) {
  const text = String(win.getSelection?.() || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? [{ text }] : null;
}

export function initPageReader(win = window) {
  const doc = win.document;
  const header = doc.querySelector('.header-navigation');
  if (!header || !speechSupported(win) || header.querySelector('.page-reader')) return null;
  const controls = speakControls({
    win,
    icon: true,
    label: 'Ouvir esta página',
    lang: () => doc.documentElement.lang || 'pt-BR',
    blocks: () => selectedBlocks(win) || readableBlocks(doc.querySelector('main')),
  });
  controls.element.classList.add('page-reader');
  controls.element.querySelector('.speak-button').setAttribute('aria-keyshortcuts', 'Alt+L');
  header.prepend(controls.element);
  doc.addEventListener('keydown', (event) => {
    if (doc.documentElement.dataset.readAloud !== 'everywhere') return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'l') return;
    event.preventDefault();
    controls.speaker.toggle();
  });
  return controls;
}
