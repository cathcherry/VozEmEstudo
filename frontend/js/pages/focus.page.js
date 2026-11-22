// Focar: the active study session, in full (ring, modes, durations) with this week beside it. The
// account has one focus session; Focar is the only page that runs it (3.6). Other pages show a
// small indicator in the top bar while a block runs; history and analysis live in Planejar.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { initStudyTrackingPanel } from './study-tracking-panel.js';
import { getFocusSession } from '../utils/focus-host.js';

await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
if (!flags.study_tracking) {
  const unavailable = document.querySelector('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(
    emptyState(
      'O cronômetro ainda não está ativo',
      'O registro de tempo de estudo aparece aqui quando for ativado neste servidor.',
      { href: './painel.html', action: 'Voltar ao início', mascot: 'rest' },
    ),
  );
} else {
  await initStudyTrackingPanel({});
  // "Iniciar foco" elsewhere (Início, Planejar) opens Focar and starts a focus block here.
  const params = new URLSearchParams(location.search);
  if (params.get('iniciar') === 'foco') {
    history.replaceState(null, '', location.pathname + location.hash);
    const session = await getFocusSession();
    if (session.state().status === 'idle') void session.start({ mode: 'pomodoro' }).catch(() => {});
    document.querySelector('.focus-primary')?.focus();
  }
}
