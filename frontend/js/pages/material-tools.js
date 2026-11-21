import { isFeatureEnabled } from '../utils/feature-flags.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initSharingPanel } from './sharing-panel.js';
import { initLessonNotebook } from './lesson-notebook.js';

/** Starts annotations and material sharing. Export lives in export-panel.js. */
export async function initMaterialTools({ materialId, context, segments }) {
  const notesEnabled = await isFeatureEnabled('annotations').catch(() => false);
  // Notes 3.0: the lesson notebook and highlights across segments (needs annotations too).
  const notebooks = notesEnabled && (await isFeatureEnabled('notebooks').catch(() => false));
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
