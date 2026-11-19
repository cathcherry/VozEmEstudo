// "Leitura em voz alta: em todo o site": one discreet speaker in the header of every page that
// reads the selected text or, without a selection, the main content block by block (Alt+L).
// Uses the browser's own voices (speech.js); nothing is sent to a server or an AI provider.
import { speakControls, speechSupported } from './speech.js';

const READABLE = 'h1, h2, h3, h4, p, li, dt, dd, blockquote, figcaption, td, th, .segment-text';

/** Visible, non-decorative text blocks of the main content, without nested duplicates. */
export function readableBlocks(root = document.querySelector('main')) {
  if (!root) return [];
  const blocks = [];
  for (const element of root.querySelectorAll(READABLE)) {
    if (
      element.closest(
        '[hidden], [aria-hidden="true"], dialog:not([open]), nav, button, select, textarea, .sr-only, .speak-controls',
      )
    )
      continue;
    // A list item or cell that contains another readable block is read through that block.
    if (element.querySelector(READABLE)) continue;
    const view = element.ownerDocument.defaultView;
    const style = view?.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
    const text = element.textContent.replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ element, text });
  }
  return blocks;
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
    blocks: () => selectedBlocks(win) || readableBlocks(),
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
