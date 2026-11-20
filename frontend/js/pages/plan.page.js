// Planejar: goals and tasks, the study calendar and study time, each in its own tab.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listMaterials } from '../api/material.api.js';
import { initToolTabs } from '../utils/tool-tabs.js';
import { emptyState } from '../utils/material-ui.js';
import { initPlanningPanel } from './planning-panel.js';
import { initCalendarPanel } from './calendar-panel.js';
import { initStudyTrackingPanel } from './study-tracking-panel.js';

await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
const sections = [
  ['tarefas', flags.planning],
  ['calendario', flags.calendar],
  ['tempo', flags.study_tracking],
]
  .filter(([, enabled]) => enabled)
  .map(([id]) => id);
const tabs = initToolTabs(document.querySelector('[data-tool-tabs]'), sections);

if (!sections.length) {
  const unavailable = document.querySelector('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(
    emptyState(
      'O planejamento ainda não está ativo',
      'Objetivos, calendário e tempo de estudo aparecem aqui quando forem ativados neste servidor.',
      { href: './painel.html', action: 'Voltar ao início', mascot: 'rest' },
    ),
  );
} else {
  const materials = await listMaterials().catch(() => []);
  const params = new URLSearchParams(location.search);
  const create = params.get('criar');
  // A failure in one tool never blocks the others.
  const loads = [];
  if (flags.planning)
    loads.push(
      initPlanningPanel({ materials }).then(() => {
        if (create === 'objetivo' || create === 'tarefa') {
          tabs.select('tarefas');
          document.dispatchEvent(
            new CustomEvent('voz:planning-command', {
              detail: { action: create === 'objetivo' ? 'goal' : 'task' },
            }),
          );
        }
      }),
    );
  if (flags.calendar)
    loads.push(
      initCalendarPanel({ panel: document.querySelector('[data-calendar-panel]'), materials }).then(
        () => {
          if (create === 'horario') {
            tabs.select('calendario');
            document.dispatchEvent(
              new CustomEvent('voz:calendar-command', { detail: { action: 'compose' } }),
            );
          }
        },
      ),
    );
  if (flags.study_tracking) loads.push(initStudyTrackingPanel({ materials }));
  const results = await Promise.allSettled(loads);
  for (const result of results)
    if (result.status === 'rejected')
      console.warn('Ferramenta de planejamento indisponível:', result.reason);
  // Remove the one-off creation request so a reload does not open the form again.
  if (create) history.replaceState(null, '', `${location.pathname}${location.hash}`);
}
