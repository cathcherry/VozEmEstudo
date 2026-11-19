import {
  listFlashcardSets,
  getFlashcardSet,
  updateFlashcardSet,
  deleteFlashcardSet,
} from '../api/flashcard.api.js';
import { toFlashcardCsv } from '../utils/flashcard-csv.js';
import { downloadText } from '../utils/study-export.js';
import { buildStudyDocument, toMarkdown, safeFilename } from '../utils/study-document.js';
import { ninoNote } from '../utils/material-ui.js';

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/**
 * Painel → Flashcards → "Conjuntos": named sets organized by lesson, with review counts, rename,
 * archive/restore, delete (confirmed) and export. Reviewing stays in the existing queue.
 */
export function initFlashcardSetsPanel({ container, materials, onChange, onSelect }) {
  const lessons = new Map(materials.map((m) => [m.id, m.title]));
  const section = make('details', null, 'flashcard-management flashcard-sets');
  const summary = make('summary', 'Conjuntos de flashcards');
  const status = make('p', null, 'flashcard-muted');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = make('div', null, 'flashcard-set-list');
  section.append(
    summary,
    make(
      'p',
      'Crie conjuntos na aba Resumo de cada aula. Aqui você organiza, revisa por conjunto e exporta.',
      'flashcard-muted',
    ),
    list,
    status,
  );
  container.after(section);
  let sets = [];

  async function exportSet(set, format) {
    const full = await getFlashcardSet(set.id);
    const lesson = lessons.get(set.material_id) || '';
    if (format === 'csv')
      downloadText(
        toFlashcardCsv([full], { lesson }),
        safeFilename(full.name, 'csv'),
        'text/csv;charset=utf-8',
      );
    else
      downloadText(
        toMarkdown(
          buildStudyDocument(
            { title: full.name, subject: lesson || 'Sem aula' },
            { flashcardSets: [full] },
          ),
        ),
        safeFilename(full.name, 'md'),
        'text/markdown;charset=utf-8',
      );
  }

  function render() {
    list.replaceChildren();
    if (!sets.length) list.append(ninoNote('Ainda não há conjuntos. Crie um na aba Resumo de uma aula.', 'rest'));
    for (const set of sets) {
      const row = make('article', null, 'flashcard-set-row');
      row.dataset.setId = set.id;
      const title = make('h4', set.name);
      const meta = make(
        'p',
        [
          lessons.get(set.material_id) || 'Sem aula',
          `${set.card_count} ${set.card_count === 1 ? 'cartão' : 'cartões'}`,
          set.status === 'archived' ? 'arquivado' : `${set.due_count} para revisar`,
        ].join(' · '),
        'flashcard-muted',
      );
      const actions = make('div', null, 'proposal-actions');
      const button = (label, handler) => {
        const b = make('button', label, 'text-action');
        b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await handler();
          } catch (error) {
            status.textContent = error.message || 'Não foi possível concluir.';
          } finally {
            b.disabled = false;
          }
        });
        actions.append(b);
      };
      button('Ver cartões', async () => onSelect(set.id));
      button('Renomear', async () => {
        const name = prompt('Novo nome do conjunto', set.name);
        if (!name?.trim()) return;
        await updateFlashcardSet(set.id, { name: name.trim() });
        status.textContent = 'Conjunto renomeado.';
        await load();
      });
      button(set.status === 'archived' ? 'Reativar' : 'Arquivar', async () => {
        await updateFlashcardSet(set.id, { archived: set.status !== 'archived' });
        status.textContent =
          set.status === 'archived'
            ? 'Conjunto reativado; os cartões voltam à revisão.'
            : 'Conjunto arquivado; os cartões saem da revisão e o histórico é mantido.';
        await load();
        await onChange();
      });
      button('Exportar CSV', () => exportSet(set, 'csv'));
      button('Exportar Markdown', () => exportSet(set, 'md'));
      button('Excluir', async () => {
        if (
          !confirm(
            `Excluir o conjunto “${set.name}”, seus ${set.card_count} cartões e o histórico de revisões deles? Esta ação não pode ser desfeita.`,
          )
        )
          return;
        await deleteFlashcardSet(set.id);
        status.textContent = 'Conjunto excluído.';
        await load();
        await onChange();
      });
      row.append(title, meta, actions);
      list.append(row);
    }
  }

  async function load() {
    sets = await listFlashcardSets();
    render();
    return sets;
  }
  return { load, sets: () => sets };
}
