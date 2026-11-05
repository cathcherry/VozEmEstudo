import { isFeatureEnabled } from '../utils/feature-flags.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initCalendarPanel } from './calendar-panel.js';
export async function initDashboardTools({materials}){
  await Promise.allSettled([
    (async()=>{if(await isFeatureEnabled('annotations'))await initAnnotationsPanel({panel:document.querySelector('[data-note-search-panel]'),materials});})(),
    (async()=>{if(await isFeatureEnabled('calendar'))await initCalendarPanel({panel:document.querySelector('[data-calendar-panel]'),materials});})(),
  ]);
}
