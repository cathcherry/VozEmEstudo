// Planejar: goals and tasks, the study calendar, and study time (history and analysis; the timer
// itself runs on Focar), each in its own tab.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listMaterials } from '../api/material.api.js';
import { initToolTabs, showToolFailure } from '../utils/tool-tabs.js';
import { emptyState } from '../utils/material-ui.js';
import { initPlanningPanel } from './planning-panel.js';
import { initCalendarPanel } from './calendar-panel.js';
import { initStudyTrackingPanel } from './study-tracking-panel.js';
import { initStudyStats } from './study-stats.js';
import { initFocusHistory } from './focus-history.js';
import { openUnitPlanDialog } from './unit-plan.js';
import { toast } from '../utils/toast.js';

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
        // "Planejar uma unidade" needs the catalog (subjects and units).
        const unitButton = document.querySelector('[data-unit-plan-open]');
        if (unitButton && flags.catalog_units && materials.some((m) => m.unit_id)) {
          unitButton.hidden = false;
          unitButton.addEventListener('click', async () => {
            unitButton.disabled = true;
            try {
              const created = await openUnitPlanDialog({ materials, opener: unitButton });
              if (created) {
                document.dispatchEvent(new CustomEvent('voz:planning-command', { detail: { action: 'reload' } }));
                toast(`${created} ${created === 1 ? 'tarefa criada' : 'tarefas criadas'} para a unidade.`);
              }
            } catch (error) {
              toast(error.message || 'Não foi possível abrir o planejamento da unidade.', { type: 'error' });
            } finally {
              unitButton.disabled = false;
              unitButton.focus();
            }
          });
        }
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
  if (flags.study_tracking)
    loads.push(
      // History and analysis only: the timer runs on Focar ("Iniciar foco" opens it).
      initStudyTrackingPanel({ materials, timer: false }).then(() => {
        void initFocusHistory({
          section: document.querySelector('[data-focus-history]'),
          list: document.querySelector('[data-focus-history-list]'),
        });
        return initStudyStats({ container: document.querySelector('[data-study-stats]'), materials });
      }),
    );
  const results = await Promise.allSettled(loads);
  // Tools load in the same order as their tabs (`sections`).
  results.forEach((result, index) => {
    if (result.status === 'rejected')
      showToolFailure(sections[index], 'Esta seção não pôde ser carregada agora.', result.reason);
  });
  // Remove the one-off creation request so a reload does not open the form again.
  if (create) history.replaceState(null, '', `${location.pathname}${location.hash}`);
}
