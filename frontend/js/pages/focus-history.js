// "Blocos recentes": the focus blocks the account finished (newest first), from the shared focus
// session. Part of the history and analysis in Planejar › Tempo de estudo (3.6; it used to sit
// under the timer on Focar).
import { getFocusSession } from '../utils/focus-host.js';

const LABEL = {
  pomodoro: 'Foco',
  short: 'Pausa curta',
  long: 'Pausa longa',
  reading: 'Estudo livre',
};
const locale = () => globalThis.VOZ_LOCALE || 'pt-BR';

export async function initFocusHistory({ section, list }) {
  if (!section || !list) return;
  const session = await getFocusSession();
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
        detail.textContent = `${item.materialTitle ? `${item.materialTitle} · ` : ''}${Math.round(item.seconds / 60)} min · ${new Date(item.endedAt).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
        row.append(name, detail);
        return row;
      }),
    );
  });
}
