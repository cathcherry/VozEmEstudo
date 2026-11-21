// Profile personalization: a clean viewing mode and an explicit editing mode, sections that can
// be hidden, and blocks that show the person's own study data. Custom blocks keep living in
// `profile-blocks` (profile_state) with the same shape; this module only adds optional fields
// (`hidden`, `source`) that older versions ignore. Section visibility is a small separate key,
// `profile-layout`, synced through profile-cloud.js like the rest of the profile.
import { listMaterials } from '../api/material.api.js';
import { getPlanning } from '../api/planning.api.js';
import { getStudyOverview } from '../api/study.api.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { studyFor } from '../utils/study-store.js';

import { DATA_BLOCKS } from '../utils/profile-blocks.js';

export {
  PROFILE_LAYOUT_KEY,
  PROFILE_SECTIONS,
  BLOCK_SIZES,
  DATA_BLOCKS,
  normalizeProfileLayout,
  newDataBlock,
  duplicateBlock,
  moveBlock,
} from '../utils/profile-blocks.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

let materialsRequest = null;
const materials = () => (materialsRequest ||= listMaterials().catch(() => null));
// One request per page for each source: re-rendering after a move or resize reuses it.
let planningRequest = null;
let overviewRequest = null;
const planning = () =>
  (planningRequest ||= getPlanning().catch((error) => {
    planningRequest = null;
    throw error;
  }));
const overview = () =>
  (overviewRequest ||= getStudyOverview().catch((error) => {
    overviewRequest = null;
    throw error;
  }));
const quiet = (text) => make('p', text, 'profile-data-empty');

/** Renders the body of a data block. Always resolves to an element (an empty or error state). */
export async function renderDataBlock(source) {
  const flags = await getFeatureFlags().catch(() => ({}));
  const spec = DATA_BLOCKS[source];
  if (!spec) return quiet('Este bloco não está disponível nesta versão.');
  if (spec.flag && !flags[spec.flag]) return quiet('Este recurso está desligado neste servidor.');
  try {
    if (source === 'recent' || source === 'subjects') {
      const list = await materials();
      if (!list) return quiet('Suas aulas não puderam ser carregadas agora.');
      if (source === 'recent') {
        const opened = list
          .filter((m) => studyFor(m.id).openedAt)
          .sort((a, b) => studyFor(b.id).openedAt - studyFor(a.id).openedAt)
          .slice(0, 5);
        if (!opened.length) return quiet('Nenhuma aula aberta ainda.');
        const ul = make('ul', null, 'profile-data-list');
        for (const m of opened) {
          const li = make('li');
          const link = make('a', m.title);
          link.href = `./material.html?id=${encodeURIComponent(m.id)}`;
          li.append(link, make('small', m.subject || 'Sem disciplina'));
          ul.append(li);
        }
        return ul;
      }
      const visits = new Map();
      for (const m of list) {
        const count = studyFor(m.id).visits || 0;
        if (count)
          visits.set(
            m.subject || 'Sem disciplina',
            (visits.get(m.subject || 'Sem disciplina') || 0) + count,
          );
      }
      if (!visits.size) return quiet('Abra algumas aulas para ver suas disciplinas favoritas.');
      const ol = make('ol', null, 'profile-data-list');
      for (const [subject, count] of [...visits].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        const li = make('li');
        const link = make('a', subject);
        link.href = `./historico.html?subject=${encodeURIComponent(subject)}`;
        li.append(link, make('small', `${count} ${count === 1 ? 'acesso' : 'acessos'}`));
        ol.append(li);
      }
      return ol;
    }
    if (source === 'goals') {
      const { goals = [], tasks = [] } = await planning();
      const active = goals.filter((goal) => goal.status === 'active').slice(0, 5);
      if (!active.length) {
        const box = make('div');
        const link = make('a', 'Criar um objetivo');
        link.href = './planejar.html?criar=objetivo#tarefas';
        box.append(quiet('Nenhum objetivo ativo.'), link);
        return box;
      }
      const ul = make('ul', null, 'profile-data-list');
      for (const goal of active) {
        const own = tasks.filter((task) => task.goal_id === goal.id);
        const done = own.filter((task) => task.completed_at).length;
        const li = make('li');
        li.append(make('span', goal.title));
        const detail = own.length ? `${done} de ${own.length} tarefas` : 'Sem tarefas';
        const progress = make('progress');
        progress.max = Math.max(1, own.length);
        progress.value = done;
        progress.setAttribute('aria-label', `${goal.title}: ${detail}`);
        li.append(progress, make('small', detail));
        ul.append(li);
      }
      return ul;
    }
    if (source === 'week') {
      const data = await overview();
      const minutes = Math.floor(Number(data.weekSeconds) / 60);
      const box = make('div', null, 'profile-data-week');
      const value = make('strong', String(minutes));
      box.append(
        value,
        make(
          'span',
          data.goalMinutes ? ` de ${data.goalMinutes} min nesta semana` : ' min nesta semana',
        ),
      );
      if (data.goalMinutes) {
        const progress = make('progress');
        progress.max = data.goalMinutes;
        progress.value = Math.min(minutes, data.goalMinutes);
        progress.setAttribute(
          'aria-label',
          `Meta semanal: ${minutes} de ${data.goalMinutes} minutos`,
        );
        box.append(progress);
      }
      return box;
    }
  } catch (error) {
    return quiet(error?.message || 'Estes dados não puderam ser carregados agora.');
  }
  return quiet('Este bloco não está disponível nesta versão.');
}
