// Keeps the chosen stickers beside the page title: on load, after local or synced preference
// changes, and when a page rewrites its title (e.g. the lesson name arriving).
import { getUiPreferences } from './preferences.js';
import { renderPageStickers } from './stickers.js';

export function initPageStickers() {
  const main = document.querySelector('main');
  if (!main) return;
  const kinds = () => getUiPreferences().stickers || [];
  const render = () => renderPageStickers(kinds());
  render();
  for (const event of ['voz-stickers-change', 'voz-preferences-change', 'storage'])
    window.addEventListener(event, () => queueMicrotask(render));
  // A title replaced by page code loses its stickers: put them back once.
  new MutationObserver(() => {
    const title = main.querySelector('h1');
    if (title && kinds().length && !title.querySelector('.page-stickers')) render();
  }).observe(main, { childList: true, subtree: true, characterData: true });
}
