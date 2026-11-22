import { isFeatureEnabled } from '../utils/feature-flags.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initSharingPanel } from './sharing-panel.js';
import { initLessonNotebook } from './lesson-notebook.js';

/** Starts annotations and material sharing. Export lives in export-panel.js. */
export async function initMaterialTools({ materialId, context, segments }) {
  const notesEnabled = await isFeatureEnabled('annotations').catch(() => false);
  // Notes 3.0: the lesson notebook and highlights across segments (needs annotations too).
  const notebooks = notesEnabled && (await isFeatureEnabled('notebooks').catch(() => false));
  // 3.6: a visible way from the lesson to its notebook (opens Anotações and the notebook cover).
  const actions = document.querySelector('[data-material-actions]');
  if (notebooks && actions && !actions.querySelector('[data-open-notebook]')) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'secondary-action';
    open.dataset.openNotebook = '';
    open.textContent = 'Caderno da aula';
    open.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('voz:open-notes'));
      document.dispatchEvent(new CustomEvent('voz:open-notebook'));
      document.querySelector('[data-lesson-notebook]')?.scrollIntoView?.({ block: 'start' });
    });
    actions.prepend(open);
  }
  const results = await Promise.allSettled([
    notesEnabled
      ? initAnnotationsPanel({
          panel: document.querySelector('[data-annotations-panel]'),
          materialId,
          context,
          segments,
          multiSegment: notebooks,
          notebook: notebooks,
        })
      : Promise.resolve(),
    notebooks
      ? initLessonNotebook({ panel: document.querySelector('[data-lesson-notebook]'), materialId, context, segments })
      : Promise.resolve(),
    (async () => {
      if (await isFeatureEnabled('sharing')) {
        await initSharingPanel({ panel: document.querySelector('[data-sharing-panel]'), materialId, context });
        // The copy-for-reading form lives in a dialog opened from the header, not in the page body.
        const open = document.querySelector('[data-open-material-share]');
        open.hidden = false;
        open.addEventListener('click', () => document.querySelector('[data-material-share-dialog]').showModal());
      }
    })(),
  ]);
  if (results.some((r) => r.status === 'rejected')) {
    const panel = document.querySelector('[data-material-tools]');
    panel.hidden = false;
    panel.textContent = 'Algumas ferramentas estão indisponíveis. A exportação dos textos continua disponível.';
  }
  return { notesEnabled };
}
