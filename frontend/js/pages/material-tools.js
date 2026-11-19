import { isFeatureEnabled } from '../utils/feature-flags.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initSharingPanel } from './sharing-panel.js';

/** Starts annotations and material sharing. Export lives in export-panel.js. */
export async function initMaterialTools({ materialId, context, segments }) {
  const notesEnabled = await isFeatureEnabled('annotations').catch(() => false);
  const results = await Promise.allSettled([
    notesEnabled
      ? initAnnotationsPanel({ panel: document.querySelector('[data-annotations-panel]'), materialId, context, segments })
      : Promise.resolve(),
    (async () => {
      if (await isFeatureEnabled('sharing'))
        await initSharingPanel({ panel: document.querySelector('[data-sharing-panel]'), materialId, context });
    })(),
  ]);
  if (results.some((r) => r.status === 'rejected')) {
    const panel = document.querySelector('[data-material-tools]');
    panel.hidden = false;
    panel.textContent = 'Algumas ferramentas estão indisponíveis. A exportação dos textos continua disponível.';
  }
  return { notesEnabled };
}
