import { askText } from '../utils/app-dialog.js';
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
import { openMergeDialog, openImportDialog } from './deck-tools-panel.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { listClassrooms, listSharedSets } from '../api/classroom.api.js';

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
export function initFlashcardSetsPanel({ container, materials, onChange, onSelect, toolsSlot = null, listSlot = null }) {
  const lessons = new Map(materials.map((m) => [m.id, m.title]));
  // On the Flashcards page the list is the "Conjuntos" section itself (listSlot), not a fold.
  const section = listSlot ? make('div', null, 'flashcard-sets') : make('details', null, 'flashcard-management flashcard-sets');
  const summary = listSlot ? null : make('summary', 'Conjuntos de flashcards');
  const status = make('p', null, 'flashcard-muted');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = make('div', null, 'flashcard-set-list');
  // Merge sets / import a file: both create a new personal set. They live in plain sight next to
  // "Novos cartões" (toolsSlot), with their own confirmation, instead of inside this disclosure.
  const tools = make('div', null, 'deck-tools');
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-labelledby', 'deck-tools-title');
  const toolsTitle = make('p', 'Juntar ou trazer conjuntos', 'deck-tools-title');
  toolsTitle.id = 'deck-tools-title';
  const toolsHint = make('p', 'Criam um conjunto novo; os originais não mudam.', 'flashcard-muted deck-tools-hint');
  const buttons = make('div', null, 'deck-tools-buttons');
  const mergeButton = make('button', 'Mesclar conjuntos', 'secondary-action');
  mergeButton.type = 'button';
  mergeButton.setAttribute('aria-haspopup', 'dialog');
  const importButton = make('button', 'Importar cartões', 'secondary-action');
  importButton.type = 'button';
  importButton.setAttribute('aria-haspopup', 'dialog');
  const result = make('div', null, 'deck-tools-result');
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  if (listSlot) {
    // Flashcards page, "Importar e mesclar": each tool says what it takes and what it makes.
    const tool = (title, text, button, id) => {
      const box = make('div', null, 'deck-tool');
      const heading = make('h3', title, 'deck-tool-title');
      const hint = make('p', text, 'flashcard-muted');
      hint.id = id;
      button.setAttribute('aria-describedby', id);
      box.append(heading, hint, button);
      return box;
    };
    importButton.className = mergeButton.className = 'primary-action';
    buttons.className = 'deck-tools-grid';
    buttons.append(
      tool('Importar cartões', 'Do Anki (pacote .apkg ou notas em texto), de uma planilha CSV ou de uma lista com pergunta e resposta.', importButton, 'deck-tool-import-hint'),
      tool('Mesclar conjuntos', 'Junta dois ou mais conjuntos num novo, sem cartões repetidos. Também vale para baralhos compartilhados nas turmas.', mergeButton, 'deck-tool-merge-hint'),
    );
    toolsTitle.className = 'sr-only';
    tools.append(toolsTitle, buttons, result);
  } else {
    buttons.append(mergeButton, importButton);
    tools.append(toolsTitle, toolsHint, buttons, result);
  }
  async function afterTool(done) {
    if (!done) return;
    const open = make('button', 'Abrir o conjunto novo', 'text-action');
    open.type = 'button';
    open.addEventListener('click', () => onSelect(done.id));
    const text = make('p', null, 'deck-tools-result-text');
    text.append(make('strong', done.message));
    for (const sentence of done.details || []) text.append(' ', make('span', sentence));
    result.replaceChildren(text, open);
    status.textContent = done.message;
    open.focus();
    await load();
    await onChange();
    document.dispatchEvent(new CustomEvent('voz:flashcards-sets-changed'));
  }
  const v3 = () => isFeatureEnabled('flashcards_v3').catch(() => false);
  /**
   * Keeps the button busy while the sets (and the classes' shared decks) are being read. It is
   * released before the dialog opens, so focus can come back to it when the dialog closes.
   */
  const whileBusy = async (button, work) => {
    if (button.getAttribute('aria-busy') === 'true') return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const release = () => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    };
    try {
      await work(release);
    } catch (error) {
      result.replaceChildren(make('p', error.message || 'Não foi possível abrir agora. Tente de novo.', 'deck-error'));
    } finally {
      release();
    }
  };
  mergeButton.addEventListener('click', () =>
    whileBusy(mergeButton, async (release) => {
      result.replaceChildren();
      const usable = sets.filter((set) => (set.card_count ?? 0) > 0);
      const typed = await v3();
      // Flashcards 3.0 + Turmas: decks classmates shared in my classes can be merged too (read only).
      if (typed && (await isFeatureEnabled('classrooms').catch(() => false))) {
        const classes = await listClassrooms().catch(() => []);
        for (const room of Array.isArray(classes) ? classes : classes?.classrooms || []) {
          const shared = await listSharedSets(room.id).catch(() => []);
          for (const item of shared)
            if (!item.isMine && item.cardCount > 0)
              usable.push({
                id: `${room.id}:${item.sharedId}`,
                classroomId: room.id,
                sharedId: item.sharedId,
                name: item.name,
                authorName: item.author?.displayName || 'colega',
                classroomName: room.name,
                card_count: item.cardCount,
              });
        }
      }
      if (usable.length < 2) {
        result.replaceChildren(
          make(
            'p',
            'Para mesclar, é preciso ter pelo menos dois conjuntos com cartões. Crie um conjunto na aba Flashcards de uma aula ou importe cartões de um arquivo.',
            'flashcard-muted',
          ),
        );
        return;
      }
      release();
      await afterTool(await openMergeDialog({ sets: usable, opener: mergeButton, v3: typed }));
    }),
  );
  importButton.addEventListener('click', () =>
    whileBusy(importButton, async (release) => {
      result.replaceChildren();
      const typed = await v3();
      release();
      await afterTool(await openImportDialog({ opener: importButton, v3: typed }));
    }),
  );
  if (summary)
    section.append(
      summary,
      make(
        'p',
        'Crie conjuntos na aba Flashcards de cada aula. Para mesclar conjuntos ou importar cartões, use “Juntar ou trazer conjuntos”, em Novos cartões. Aqui você organiza, revisa por conjunto e exporta.',
        'flashcard-muted',
      ),
    );
  section.append(list, status);
  if (toolsSlot) toolsSlot.append(tools);
  else section.insertBefore(tools, list);
  if (listSlot) listSlot.replaceWith(section);
  else container.after(section);
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
    if (!sets.length)
      list.append(
        ninoNote(
          listSlot
            ? 'Ainda não há conjuntos. Gere um na aba Flashcards de uma aula ou traga um em “Importar e mesclar”.'
            : 'Ainda não há conjuntos. Crie um na aba Resumo de uma aula.',
          'rest',
        ),
      );
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
            await handler(b);
          } catch (error) {
            status.textContent = error.message || 'Não foi possível concluir.';
          } finally {
            b.disabled = false;
          }
        });
        actions.append(b);
      };
      button(listSlot ? 'Revisar este conjunto' : 'Ver cartões', async () => onSelect(set.id));
      button('Renomear', async (opener) => {
        const name = await askText({
          title: 'Renomear conjunto',
          label: 'Nome do conjunto',
          value: set.name,
          confirmLabel: 'Salvar nome',
          opener,
          maxLength: 120,
        });
        if (!name || name === set.name) return;
        await updateFlashcardSet(set.id, { name });
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
