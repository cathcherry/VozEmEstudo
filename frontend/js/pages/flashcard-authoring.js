import {
  previewFlashcards,
  listFlashcardSets,
  getFlashcardSet,
  createFlashcardSet,
  addFlashcardSetCards,
} from '../api/flashcard.api.js';
import { toFlashcardCsv } from '../utils/flashcard-csv.js';
import { toast } from '../utils/toast.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/**
 * Resumo tab → "Criar flashcards": configure, preview, edit/reject/regenerate single proposals,
 * then save to a new named set or add to an existing one. Review stays in the Painel.
 */
export function initFlashcardAuthoring({ material }) {
  const dialog = document.querySelector('[data-flashcard-dialog]');
  const form = dialog.querySelector('[data-flashcard-config]');
  const message = dialog.querySelector('[data-flashcard-message]');
  const preview = dialog.querySelector('[data-flashcard-preview]');
  const save = dialog.querySelector('[data-flashcard-save]');
  const generateButton = dialog.querySelector('[data-flashcard-generate]');
  const nameLabel = dialog.querySelector('[data-flashcard-name]');
  const customLabel = dialog.querySelector('[data-flashcard-custom]');
  let proposals = [],
    context = null,
    busy = false,
    pendingSetId = null;

  form.elements.count.addEventListener('change', () => {
    customLabel.hidden = form.elements.count.value !== 'custom';
    if (!customLabel.hidden && !form.elements.customCount.value)
      form.elements.customCount.value = '15';
  });
  form.elements.target.addEventListener('change', () => {
    nameLabel.hidden = form.elements.target.value !== 'new';
  });

  function readConfig() {
    const data = new FormData(form);
    const count = Number(
      data.get('count') === 'custom' ? data.get('customCount') : data.get('count'),
    );
    if (!Number.isInteger(count) || count < 1 || count > 50)
      throw new Error('Informe uma quantidade inteira de 1 a 50.');
    const difficulties = data.getAll('difficulty'),
      focus = data.getAll('focus');
    if (!difficulties.length || !focus.length)
      throw new Error('Escolha pelo menos uma dificuldade e um foco.');
    if (data.get('target') === 'new' && !String(data.get('name') || '').trim())
      throw new Error('Dê um nome ao novo conjunto.');
    return { count, config: { difficulties, focus, style: data.get('style') } };
  }

  const active = () => proposals.filter((p) => !p.rejected);
  function syncSave() {
    const count = active().length;
    save.hidden = !proposals.length;
    save.disabled = busy || !count;
    save.textContent = `Salvar ${count} ${count === 1 ? 'cartão' : 'cartões'}`;
  }

  async function request(count, avoid) {
    const current = material();
    if (current?.review?.state !== 'ready_to_generate')
      throw new Error('Confira e confirme a transcrição antes de gerar cartões.');
    const target = form.elements.target.value;
    return previewFlashcards({
      materialId: current.id,
      sourceRevisionId: current.review.sourceRevisionId,
      count,
      config: context.config,
      avoid,
      ...(target !== 'new' ? { setId: target } : {}),
    });
  }

  function renderProposals() {
    preview.replaceChildren();
    proposals.forEach((proposal, index) => {
      const card = el('article', null, 'flashcard-proposal');
      card.dataset.rejected = String(Boolean(proposal.rejected));
      const frontLabel = el('label', `Frente ${index + 1}`);
      const front = el('textarea');
      front.rows = 2;
      front.maxLength = 1000;
      front.value = proposal.front;
      front.addEventListener('input', () => (proposal.front = front.value));
      frontLabel.append(front);
      const backLabel = el('label', 'Verso');
      const back = el('textarea');
      back.rows = 3;
      back.maxLength = 2000;
      back.value = proposal.back;
      back.addEventListener('input', () => (proposal.back = back.value));
      backLabel.append(back);
      const evidence = el('p', `Trecho da transcrição: ${proposal.evidence}`, 'proposal-evidence');
      const actions = el('div', null, 'proposal-actions');
      const reject = el('button', proposal.rejected ? 'Restaurar' : 'Rejeitar', 'text-action');
      reject.type = 'button';
      reject.addEventListener('click', () => {
        proposal.rejected = !proposal.rejected;
        renderProposals();
        syncSave();
      });
      const again = el('button', 'Gerar outro', 'text-action');
      again.type = 'button';
      again.addEventListener('click', () => void regenerate(index, again));
      actions.append(reject, again);
      card.append(frontLabel, backLabel, evidence, actions);
      preview.append(card);
    });
    syncSave();
  }

  async function regenerate(index, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    message.textContent = 'Gerando outra sugestão…';
    try {
      // Every visible proposal (including rejected ones) is avoided, so the replacement is new.
      const result = await request(1, proposals.map((p) => p.front).filter(Boolean));
      if (!result.cards.length)
        message.textContent = 'A transcrição não sustenta outro cartão distinto.';
      else {
        proposals[index] = { ...result.cards[0], rejected: false };
        message.textContent = 'Sugestão substituída.';
      }
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      renderProposals();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    try {
      context = readConfig();
    } catch (error) {
      message.textContent = error.message;
      return;
    }
    busy = true;
    generateButton.disabled = true;
    message.textContent = 'Gerando prévia da revisão confirmada…';
    void request(context.count, [])
      .then((result) => {
        proposals = result.cards.map((card) => ({ ...card, rejected: false }));
        context.revision = result.revision;
        message.textContent = proposals.length
          ? `${proposals.length} de ${result.requested} sugestões. ${result.shortfall || ''} Confira cada uma; o trecho de apoio não garante que a resposta esteja correta.`
          : 'A transcrição não sustenta cartões distintos com essa configuração.';
        generateButton.textContent = 'Gerar nova prévia';
        generateButton.className = 'secondary-action';
      })
      .catch((error) => {
        message.textContent = error.message;
      })
      .finally(() => {
        busy = false;
        generateButton.disabled = false;
        renderProposals();
      });
  });

  save.addEventListener('click', () => {
    const cards = active()
      .map((p) => ({
        front: p.front.trim(),
        back: p.back.trim(),
        evidence: p.evidence,
        sourceSegments: p.sourceSegments || [],
        style: p.style,
        difficulty: p.difficulty,
        focus: p.focus,
      }))
      .filter((c) => c.front && c.back);
    if (!cards.length) return;
    busy = true;
    syncSave();
    const current = material();
    const target = form.elements.target.value;
    // A stable id makes a retried save return the same set instead of creating a second one.
    pendingSetId ||= crypto.randomUUID();
    const setId = target === 'new' ? pendingSetId : target;
    const setName =
      target === 'new' ? form.elements.name.value.trim() : form.elements.target.selectedOptions[0]?.textContent || '';
    const action =
      target === 'new'
        ? createFlashcardSet({
            id: pendingSetId,
            name: form.elements.name.value.trim(),
            materialId: current.id,
            sourceRevisionId: current.review.sourceRevisionId,
            config: { ...context.config, count: context.count },
            cards,
          }).then((set) => set.added)
        : addFlashcardSetCards(target, cards).then((result) => result.added);
    void action
      .then((added) => {
        pendingSetId = null;
        proposals = [];
        renderProposals();
        message.textContent = '';
        // A brief confirmation outside the dialog, with the way to review the set right away.
        dialog.close();
        toast(
          `${added} ${added === 1 ? 'cartão salvo' : 'cartões salvos'}${target === 'new' ? ` em “${setName}”` : ''}${added < cards.length ? ' (repetidos ficaram de fora)' : ''}.`,
          {
            type: 'success',
            action: {
              label: 'Revisar agora',
              onClick: () => {
                location.href = `./flashcards.html?conjunto=${encodeURIComponent(setId)}#revisar`;
              },
            },
          },
        );
        return loadTargets();
      })
      .catch((error) => {
        message.textContent = error.message;
      })
      .finally(() => {
        busy = false;
        syncSave();
      });
  });

  async function loadTargets() {
    const select = form.elements.target;
    const previous = select.value;
    const sets = await listFlashcardSets(material().id).catch(() => []);
    select.replaceChildren(
      new Option('Novo conjunto', 'new'),
      ...sets.map((set) => new Option(`Adicionar a: ${set.name} (${set.card_count})`, set.id)),
    );
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    nameLabel.hidden = select.value !== 'new';
    return sets;
  }

  return {
    async open() {
      message.textContent = '';
      proposals = [];
      renderProposals();
      generateButton.textContent = 'Gerar prévia';
      generateButton.className = 'primary-action';
      if (!form.elements.name.value)
        form.elements.name.value = `${material().title} · flashcards`.slice(0, 160);
      dialog.showModal();
      await loadTargets();
    },
    /** Adapter for the export dialog: list, load with cards, and CSV. */
    exporter: {
      list: () => listFlashcardSets(material().id),
      load: (ids) => Promise.all(ids.map((id) => getFlashcardSet(id))),
      csv: (sets) => toFlashcardCsv(sets, { lesson: material().title }),
    },
  };
}
