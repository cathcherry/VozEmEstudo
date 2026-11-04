import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import {
  listFlashcards, createFlashcard, updateFlashcard, reviewFlashcard,
} from '../api/flashcard.api.js';
import {
  FLASHCARD_RATINGS, formatFlashcardDue, flashcardSummary,
} from '../utils/flashcard-view.js';

function make(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined && value !== null) element.textContent = value;
  if (className) element.className = className;
  return element;
}

export async function initFlashcardsPanel({ materials }) {
  const panel = document.querySelector('[data-flashcards-panel]');
  if (!panel || !(await isFeatureEnabled('flashcards'))) return;

  const createForm = panel.querySelector('[data-flashcard-create-form]');
  const frontInput = createForm.querySelector('[name="front"]');
  const backInput = createForm.querySelector('[name="back"]');
  const materialInput = createForm.querySelector('[name="materialId"]');
  const createMessage = panel.querySelector('[data-flashcard-create-status]');
  const reviewMessage = panel.querySelector('[data-flashcard-review-status]');
  const count = panel.querySelector('[data-flashcard-count]');
  const dueArea = panel.querySelector('[data-flashcard-due-area]');
  const manager = panel.querySelector('[data-flashcard-manage-form]');
  const managerSelect = manager.querySelector('[name="cardId"]');
  const managerFront = manager.querySelector('[name="front"]');
  const managerBack = manager.querySelector('[name="back"]');
  const managerArchived = manager.querySelector('[name="archived"]');
  const managerMessage = panel.querySelector('[data-flashcard-manage-status]');
  const materialMap = new Map(materials.map((item) => [item.id, item]));
  let dueCards = [];
  let allCards = [];
  let dueTotal = 0;
  let revealed = false;
  let pendingReview = null;
  let reviewing = false;

  panel.hidden = false;
  materialInput.append(new Option('Sem aula vinculada', ''));
  for (const material of materials) materialInput.append(new Option(material.title, material.id));

  function renderDue() {
    dueArea.replaceChildren();
    count.textContent = flashcardSummary(dueTotal);
    if (dueTotal > dueCards.length) {
      const note = make('p', 'Exibindo os primeiros 100 cartões vencidos.', 'flashcard-muted');
      dueArea.append(note);
    }
    const card = dueCards[0];
    if (!card) {
      dueArea.append(make('p', 'Nenhum cartão pendente. Suas próximas revisões aparecerão aqui.', 'flashcard-muted'));
      return;
    }
    const article = make('article', null, 'flashcard-review-card');
    const frontTitle = make('h3', 'Frente do cartão');
    const front = make('p', card.front_text, 'flashcard-content');
    article.append(frontTitle, front);
    const material = materialMap.get(card.material_id);
    if (material) {
      const link = make('a', `Aula: ${material.title}`);
      link.href = `./material.html?id=${encodeURIComponent(material.id)}`;
      link.className = 'flashcard-material-link';
      article.append(link);
    }

    if (!revealed) {
      const reveal = make('button', 'Revelar resposta', 'secondary-action');
      reveal.type = 'button';
      reveal.addEventListener('click', () => {
        revealed = true;
        renderDue();
      });
      article.append(reveal);
    } else {
      article.append(make('h4', 'Verso do cartão'));
      article.append(make('p', card.back_text, 'flashcard-content flashcard-answer'));
      const legend = make('p', 'Como você se lembrou?', 'flashcard-muted');
      const ratingRow = make('div', null, 'flashcard-rating-buttons');
      for (const rating of FLASHCARD_RATINGS) {
        const button = make('button', rating.label, 'secondary-action');
        button.type = 'button';
        button.title = rating.detail;
        button.disabled = reviewing || (pendingReview !== null && pendingReview.rating !== rating.value);
        button.addEventListener('click', () => { void submitRating(card, rating.value); });
        ratingRow.append(button);
      }
      article.append(legend, ratingRow);
    }
    dueArea.append(article);
  }

  function renderManagement() {
    const selectedId = managerSelect.value;
    managerSelect.replaceChildren(new Option('Selecione um cartão', ''));
    for (const card of allCards) {
      const label = card.front_text.length > 70
        ? card.front_text.slice(0, 67) + '…' : card.front_text;
      managerSelect.append(new Option(
        `${card.status === 'archived' ? '[Arquivado] ' : ''}${label}`,
        card.id,
      ));
    }
    if (allCards.some((card) => card.id === selectedId)) managerSelect.value = selectedId;
    fillManagerFields();
    const notice = panel.querySelector('[data-flashcard-manage-limit]');
    notice.textContent = allCards.length >= 100
      ? 'Mostrando até 100 cartões por vez. A paginação ficará para a próxima versão.'
      : '';
  }

  function fillManagerFields() {
    const selected = allCards.find((card) => card.id === managerSelect.value);
    managerFront.value = selected?.front_text || '';
    managerBack.value = selected?.back_text || '';
    managerArchived.checked = selected?.status === 'archived';
    for (const field of [managerFront, managerBack, managerArchived])
      field.disabled = !selected;
    manager.querySelector('[type="submit"]').disabled = !selected;
  }

  async function refresh() {
    const [due, all] = await Promise.all([
      listFlashcards('due'), listFlashcards('all'),
    ]);
    dueCards = due.cards;
    dueTotal = due.total;
    allCards = all.cards;
    revealed = false;
    renderDue();
    renderManagement();
  }

  async function submitRating(card, rating) {
    if (reviewing) return;
    if (pendingReview && (pendingReview.cardId !== card.id || pendingReview.rating !== rating)) {
      setStatus(reviewMessage, 'Repita a mesma avaliação para confirmar o envio anterior.', 'error');
      return;
    }
    if (!pendingReview) {
      pendingReview = { cardId: card.id, rating, requestId: crypto.randomUUID() };
    }
    reviewing = true;
    renderDue();
    setStatus(reviewMessage, 'Registrando revisão…');
    try {
      const response = await reviewFlashcard(card.id, rating, pendingReview.requestId);
      pendingReview = null;
      setStatus(reviewMessage, `Revisão registrada. Próxima: ${formatFlashcardDue(response.dueAt)}.`, 'success');
      await refresh();
    } catch (error) {
      setStatus(reviewMessage,
        `${error.message || 'Não foi possível confirmar.'} Repita a mesma avaliação para tentar novamente.`,
        'error');
    } finally {
      reviewing = false;
      renderDue();
    }
  }

  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!createForm.reportValidity()) return;
    const button = createForm.querySelector('[type="submit"]');
    button.disabled = true;
    setStatus(createMessage, '');
    void (async () => {
      try {
        await createFlashcard({
          front: frontInput.value, back: backInput.value,
          materialId: materialInput.value || null,
        });
        createForm.reset();
        setStatus(createMessage, 'Cartão criado e disponível para a primeira revisão.', 'success');
        await refresh();
      } catch (error) {
        setStatus(createMessage, error.message || 'Não foi possível salvar o cartão.', 'error');
      } finally { button.disabled = false; }
    })();
  });

  managerSelect.addEventListener('change', fillManagerFields);
  manager.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!manager.reportValidity() || !managerSelect.value) return;
    const button = manager.querySelector('[type="submit"]');
    button.disabled = true;
    setStatus(managerMessage, '');
    void (async () => {
      try {
        await updateFlashcard(managerSelect.value, {
          front: managerFront.value, back: managerBack.value,
          archived: managerArchived.checked,
        });
        setStatus(managerMessage, 'Alterações salvas.', 'success');
        await refresh();
      } catch (error) {
        setStatus(managerMessage, error.message || 'Não foi possível salvar.', 'error');
      } finally { button.disabled = false; }
    })();
  });

  try { await refresh(); }
  catch (error) {
    setStatus(reviewMessage,
      error.message || 'Os flashcards estão indisponíveis. Nenhuma alteração foi feita.',
      'error');
    createForm.querySelector('[type="submit"]').disabled = true;
    manager.querySelector('[type="submit"]').disabled = true;
    dueArea.append(make('p', 'Não foi possível carregar as revisões.', 'flashcard-muted'));
  }
}
