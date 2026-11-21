// Focar: the account's focus session in full (ring, modes, durations, week) and recent blocks.
// The same session runs in the side panel and the capsule on the other pages.
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
  const session = await getFocusSession();
  const section = document.querySelector('[data-focus-history]');
  const list = document.querySelector('[data-focus-history-list]');
  const LABEL = {
    pomodoro: 'Foco',
    short: 'Pausa curta',
    long: 'Pausa longa',
    reading: 'Estudo livre',
  };
  const locale = () => globalThis.VOZ_LOCALE || 'pt-BR';
  let shown = '';
  session.subscribe((state) => {
    const key = state.history.map((item) => item.endedAt).join();
    if (key === shown) return;
    shown = key;
    section.hidden = !state.history.length;
    list.replaceChildren(
      ...state.history.slice(0, 12).map((item) => {
        const row = document.createElement('li');
        row.dataset.mode = item.mode;
        const name = document.createElement('strong');
        name.textContent = LABEL[item.mode] || item.mode;
        const detail = document.createElement('span');
        detail.textContent = `${Math.round(item.seconds / 60)} min · ${new Date(item.endedAt).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
        row.append(name, detail);
        return row;
      }),
    );
  });
}
