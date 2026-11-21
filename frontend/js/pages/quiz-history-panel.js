// Revisar › Questões: every question attempt across lessons, newest first, with the one action
// that makes sense for each (continue an open attempt, or see the result and redo the mistakes).
import { listQuizSessions } from '../api/quiz-session.api.js';
import { ninoNote } from '../utils/material-ui.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export async function initQuizHistoryPanel({ materials = [] }) {
  const panel = document.querySelector('[data-quiz-history-panel]');
  const list = panel.querySelector('[data-quiz-history-list]');
  const status = panel.querySelector('[data-quiz-history-status]');
  const titles = new Map(materials.map((m) => [m.id, m.title]));
  list.replaceChildren();
  let sessions;
  try {
    sessions = await listQuizSessions();
  } catch (error) {
    status.textContent = error.message || 'Não foi possível carregar suas tentativas.';
    return;
  }
  if (!sessions.length) {
    list.append(
      ninoNote(
        'Você ainda não respondeu nenhuma lista. Crie questões a partir de uma aula para praticar e revisar os erros aqui.',
        'reading',
      ),
    );
    const start = make('a', 'Escolher uma aula na Biblioteca', 'secondary-action button-link');
    start.href = './historico.html';
    list.append(start);
    return;
  }
  const open = sessions.filter((s) => s.status !== 'completed');
  const done = sessions.filter((s) => s.status === 'completed');
  const group = (title, items, action) => {
    if (!items.length) return;
    const section = make('section', null, 'quiz-history-group');
    section.append(make('h3', title));
    const ul = make('ul', null, 'quiz-history-list');
    for (const session of items.slice(0, 20)) {
      const li = make('li');
      const copy = make('div', null, 'quiz-history-copy');
      copy.append(
        make('strong', titles.get(session.material_id) || 'Aula'),
        make(
          'small',
          `${session.kind === 'review' ? 'Revisão dos erros' : 'Lista completa'} · ${new Date(session.created_at).toLocaleDateString((globalThis.VOZ_LOCALE || 'pt-BR'))}`,
        ),
      );
      const link = make('a', action, 'secondary-action button-link');
      link.href = `./responder.html?material=${encodeURIComponent(session.material_id)}&batch=${encodeURIComponent(session.batch_id)}&session=${encodeURIComponent(session.id)}`;
      link.setAttribute('aria-label', `${action}: ${titles.get(session.material_id) || 'aula'}`);
      li.append(copy, link);
      ul.append(li);
    }
    section.append(ul);
    list.append(section);
  };
  group('Em andamento', open, 'Continuar tentativa');
  group('Concluídas', done, 'Ver resultado e erros');
  const footer = make(
    'p',
    'Para criar uma lista nova, abra uma aula na Biblioteca e use a aba Questões. ',
    'tool-hint',
  );
  const library = make('a', 'Escolher uma aula');
  library.href = './historico.html';
  footer.append(library);
  list.append(footer);
}
