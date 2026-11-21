import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import {
  listFlashcards, createFlashcard, updateFlashcard, reviewFlashcard,
  listFlashcardReviews,
  getFlashcardSource, previewFlashcards, addFlashcardSetCards, deleteFlashcard,
} from '../api/flashcard.api.js';
import {
  FLASHCARD_RATINGS, formatFlashcardDue, flashcardSummary,
} from '../utils/flashcard-view.js';

import { initFlashcardSetsPanel } from './flashcard-sets-panel.js';
import { ninoNote } from '../utils/material-ui.js';

// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal = (name, detail) => {
  try {
    const view = document.defaultView;
    if (view?.CustomEvent) document.dispatchEvent(new view.CustomEvent(`voz:${name}`, { detail }));
  } catch { /* the dashboard summary is optional */ }
};

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
  let loading = false;
  let creating = false;
  let saving = false;
  let offset = 0;
  let allTotal = 0;
  let pageLimit = 100;
  let refreshVersion = 0;
  let historyVersion = 0;
  let generating = false;

  const generator = make('section', null, 'flashcard-generator');
  generator.setAttribute('aria-label', 'Gerar cartões com IA');
  const generateForm = make('form');
  const generateLessonLabel = make('label', 'Aula para gerar cartões');
  const generateLesson = make('select');
  generateLesson.required = true;
  generateLesson.append(new Option('Selecione uma aula', ''));
  for (const material of materials) generateLesson.append(new Option(material.title, material.id));
  generateLessonLabel.append(generateLesson);
  const amountLabel = make('label', 'Quantidade máxima');
  const amount = make('select');
  for (const value of [5, 10, 20]) amount.append(new Option(String(value), String(value)));
  amountLabel.append(amount);
  const generateButton = make('button', 'Gerar prévia', 'secondary-action');
  generateButton.type = 'submit';
  const generateMessage = make('p');
  generateMessage.setAttribute('role', 'status');
  generateMessage.setAttribute('aria-live', 'polite');
  const drafts = make('div');
  generateForm.append(generateLessonLabel, amountLabel, generateButton);
  generator.append(make('h3', 'Criar cartões com IA'),
    make('p', 'Usa a revisão confirmada da transcrição. Confira a resposta e o trecho de apoio antes de copiar o cartão para o formulário e salvá-lo. A prévia não é salva automaticamente.'),
    generateForm, generateMessage, drafts);
  const generatorSlot = panel.querySelector('[data-flashcard-generator-slot]');
  if (generatorSlot) generatorSlot.append(generator);
  else createForm.before(generator);
  // Re-rendering the review card replaces the focused button; keep keyboard users in place.
  const keepFocus = (selector) => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && panel.contains(active)) return;
    dueArea.querySelector(selector)?.focus();
  };
  document.addEventListener('voz:flashcards-command', (event) => {
    const action = event.detail?.action;
    if (action === 'review') {
      (dueArea.querySelector('button') || count)?.focus?.();
      dueArea.scrollIntoView?.({ block: 'nearest' });
    } else if (action === 'create') {
      const summary = panel.querySelector('[data-flashcard-generate-disclosure] > summary')
        || panel.querySelector('[data-flashcard-create-disclosure] > summary');
      summary?.focus();
      summary?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  generateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (generating || !generateForm.reportValidity()) return;
    generating = true;
    const selectedMaterial = generateLesson.value;
    generateButton.disabled = generateLesson.disabled = amount.disabled = true;
    drafts.replaceChildren();
    setStatus(generateMessage, 'Gerando prévia da revisão confirmada…');
    void (async () => {
      try {
        const material = await getFlashcardSource(selectedMaterial);
        if (material.review?.state !== 'ready_to_generate')
          throw new Error('Abra a aula, confira e confirme a transcrição antes de gerar cartões.');
        const result = await previewFlashcards({ materialId: selectedMaterial,
          sourceRevisionId: material.review.sourceRevisionId, count: Number(amount.value) });
        setStatus(generateMessage, `${result.cards.length} sugestões da revisão ${result.revision}. Confira cada uma; o trecho de apoio não garante que a resposta esteja correta.`, 'success');
        for (const card of result.cards) {
          const article = make('article', null, 'flashcard-draft');
          article.append(make('h4', card.front), make('p', card.back, 'flashcard-content'),
            make('p', `Trecho da transcrição: ${card.evidence}`, 'flashcard-muted'));
          const use = make('button', 'Editar este cartão no formulário', 'secondary-action');
          use.type = 'button';
          use.addEventListener('click', () => {
            const disclosure = createForm.closest('details');
            if (disclosure) disclosure.open = true;
            frontInput.value = card.front;
            backInput.value = card.back;
            materialInput.value = selectedMaterial;
            setStatus(createMessage, 'Sugestão copiada. Confira, edite e salve o cartão.');
            frontInput.focus();
          });
          article.append(use);
          drafts.append(article);
        }
      } catch (error) {
        setStatus(generateMessage, error.message || 'Não foi possível gerar os cartões. Tente novamente.', 'error');
      } finally {
        generating = false;
        generateButton.disabled = generateLesson.disabled = amount.disabled = false;
      }
    })();
  });

  const filters = make('div', null, 'flashcard-filters');
  const lessonLabel = make('label', 'Filtrar por aula');
  const lessonFilter = make('select');
  lessonFilter.append(new Option('Todas as aulas', ''));
  for (const material of materials) lessonFilter.append(new Option(material.title, material.id));
  lessonLabel.append(lessonFilter);
  const statusLabel = make('label', 'Cartões no gerenciador');
  const statusFilter = make('select');
  for (const [value, label] of [['all', 'Todos'], ['active', 'Ativos'], ['archived', 'Arquivados']])
    statusFilter.append(new Option(label, value));
  statusLabel.append(statusFilter);
  filters.append(lessonLabel, statusLabel);
  panel.insertBefore(filters, panel.querySelector('.flashcard-columns'));
  // Flashcards 2.0 (sets migration): filter by set, add manual cards to a set, delete cards.
  const setsEnabled = await isFeatureEnabled('flashcard_sets').catch(() => false);
  const setLabel = make('label', 'Conjunto');
  const setFilter = make('select');
  setFilter.append(new Option('Todos os conjuntos', ''));
  setLabel.append(setFilter);
  const createSetLabel = make('label', 'Conjunto (opcional)');
  const createSet = make('select');
  createSet.name = 'setId';
  createSet.append(new Option('Sem conjunto', ''));
  createSetLabel.append(createSet);
  const deleteCardButton = make('button', 'Excluir cartão', 'text-action');
  deleteCardButton.type = 'button';
  if (setsEnabled) {
    filters.append(setLabel);
    materialInput.closest('label').after(createSetLabel);
    manager.querySelector('[type="submit"]').after(deleteCardButton);
  }
  function fillSetOptions(sets) {
    for (const select of [setFilter, createSet]) {
      const previous = select.value;
      select.replaceChildren(select.options[0]);
      for (const set of sets) select.append(new Option(set.name, set.id));
      if ([...select.options].some((o) => o.value === previous)) select.value = previous;
    }
  }

  const pagination = make('nav', null, 'flashcard-pagination');
  pagination.setAttribute('aria-label', 'Páginas dos flashcards');
  const previousPage = make('button', 'Página anterior', 'secondary-action');
  const nextPage = make('button', 'Próxima página', 'secondary-action');
  previousPage.type = nextPage.type = 'button';
  const pageMessage = make('span', null, 'flashcard-muted');
  pageMessage.setAttribute('role', 'status');
  pagination.append(previousPage, pageMessage, nextPage);
  manager.after(pagination);
  const historyArea = make('section', null, 'flashcard-history');
  historyArea.setAttribute('aria-label', 'Histórico do cartão selecionado');
  historyArea.setAttribute('aria-live', 'polite');
  pagination.after(historyArea);

  function updateControls() {
    const locked = reviewing || loading || pendingReview !== null;
    lessonFilter.disabled = statusFilter.disabled = locked;
    previousPage.disabled = locked || offset === 0;
    nextPage.disabled = locked || offset + pageLimit >= allTotal || offset + pageLimit > 1000000;
    managerSelect.disabled = locked || saving;
    createForm.querySelector('[type="submit"]').disabled = locked || creating;
    for (const field of [managerFront, managerBack, managerArchived])
      field.disabled = locked || saving || !managerSelect.value;
    manager.querySelector('[type="submit"]').disabled = locked || saving || !managerSelect.value;
    deleteCardButton.disabled = locked || saving || !managerSelect.value;
  }

  panel.hidden = false;
  materialInput.append(new Option('Sem aula vinculada', ''));
  for (const material of materials) materialInput.append(new Option(material.title, material.id));

  function renderDue() {
    dueArea.replaceChildren();
    count.textContent = flashcardSummary(dueTotal);
    signal('flashcards', {
      dueTotal,
      next: dueCards[0]?.front_text || '',
      filtered: Boolean(lessonFilter.value || (setsEnabled && setFilter.value)),
    });
    if (dueTotal > dueCards.length) {
      const note = make('p', `Mais cartões serão carregados à medida que você revisar. ${dueTotal} pendentes no filtro atual.`, 'flashcard-muted');
      dueArea.append(note);
    }
    const card = dueCards[0];
    if (!card) {
      dueArea.append(ninoNote('Nenhum cartão pendente. Suas próximas revisões aparecerão aqui.', 'celebrate', { className: 'flashcard-muted' }));
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
      reveal.disabled = loading;
      reveal.addEventListener('click', () => {
        revealed = true;
        renderDue();
        keepFocus('.flashcard-rating-buttons button:not([disabled])');
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
        button.disabled = reviewing || loading || (pendingReview !== null && pendingReview.rating !== rating.value);
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
    notice.textContent = '';
    pageMessage.textContent = allTotal
      ? `${offset + 1}–${offset + allCards.length} de ${allTotal} cartões`
      : 'Nenhum cartão neste filtro';
    updateControls();
  }

  function fillManagerFields() {
    const selected = allCards.find((card) => card.id === managerSelect.value);
    managerFront.value = selected?.front_text || '';
    managerBack.value = selected?.back_text || '';
    managerArchived.checked = selected?.status === 'archived';
    for (const field of [managerFront, managerBack, managerArchived])
      field.disabled = !selected;
    manager.querySelector('[type="submit"]').disabled = !selected;
    deleteCardButton.disabled = !selected || saving;
    void renderHistory(selected);
  }

  async function renderHistory(card) {
    const version = ++historyVersion;
    historyArea.replaceChildren();
    if (!card) return;
    historyArea.append(make('h3', 'Histórico de revisões'));
    historyArea.append(make('p', `Próxima revisão: ${formatFlashcardDue(card.due_at)}${card.status === 'archived' ? ' (cartão arquivado, fora da fila)' : ''}.`, 'flashcard-muted'));
    const content = make('div', 'Carregando histórico…');
    historyArea.append(content);
    try {
      const reviews = await listFlashcardReviews(card.id);
      if (version !== historyVersion) return;
      content.replaceChildren();
      if (!reviews.length) {
        content.append(make('p', 'Este cartão ainda não foi revisado.', 'flashcard-muted'));
        return;
      }
      content.append(make('p', 'Até 50 revisões mais recentes.', 'flashcard-muted'));
      const list = make('ol');
      for (const review of reviews) {
        const rating = FLASHCARD_RATINGS.find((item) => item.value === review.rating);
        list.append(make('li', `${formatFlashcardDue(review.reviewed_at)} — ${rating?.label || 'Avaliação indisponível'}. Próxima revisão agendada: ${formatFlashcardDue(review.due_at)}.`));
      }
      content.append(list);
    } catch (error) {
      if (version === historyVersion)
        content.textContent = error.message || 'Não foi possível carregar o histórico. Selecione o cartão novamente para tentar.';
    }
  }

  async function refresh() {
    const version = ++refreshVersion;
    loading = true;
    updateControls();
    dueArea.setAttribute('aria-busy', 'true');
    try {
      const options = {
        materialId: lessonFilter.value || undefined,
        ...(setsEnabled && setFilter.value ? { setId: setFilter.value } : {}),
      };
      const [due, initialAll] = await Promise.all([
        listFlashcards('due', options),
        listFlashcards('all', { ...options, status: statusFilter.value, offset }),
      ]);
      if (version !== refreshVersion) return;
      let all = initialAll;
      // Archiving or filtering can empty the last page. Move back to the last valid one.
      if (offset > 0 && offset >= all.total) {
        offset = Math.max(0, Math.floor((all.total - 1) / all.limit) * all.limit);
        all = await listFlashcards('all', { ...options, status: statusFilter.value, offset });
        if (version !== refreshVersion) return;
      }
      dueCards = due.cards;
      dueTotal = due.total;
      allCards = all.cards;
      allTotal = all.total;
      pageLimit = all.limit;
      revealed = false;
      renderDue();
      renderManagement();
    } finally {
      if (version === refreshVersion) {
        loading = false;
        dueArea.setAttribute('aria-busy', 'false');
        updateControls();
        renderDue();
      }
    }
  }

  function changeView(nextOffset) {
    if (loading || reviewing || pendingReview) return;
    const previousOffset = offset;
    offset = nextOffset;
    void refresh().catch((error) => {
      offset = previousOffset;
      // A failed filter request must not leave cards from another filter actionable.
      dueCards = [];
      dueTotal = 0;
      allCards = [];
      allTotal = 0;
      renderDue();
      renderManagement();
      setStatus(reviewMessage, error.message || 'Não foi possível atualizar os cartões.', 'error');
    });
  }
  lessonFilter.addEventListener('change', () => changeView(0));
  setFilter.addEventListener('change', () => changeView(0));
  statusFilter.addEventListener('change', () => changeView(0));
  previousPage.addEventListener('click', () => changeView(Math.max(0, offset - pageLimit)));
  nextPage.addEventListener('click', () => changeView(offset + pageLimit));

  async function submitRating(card, rating) {
    if (reviewing || loading) return;
    if (pendingReview && (pendingReview.cardId !== card.id || pendingReview.rating !== rating)) {
      setStatus(reviewMessage, 'Repita a mesma avaliação para confirmar o envio anterior.', 'error');
      return;
    }
    if (!pendingReview) {
      pendingReview = { cardId: card.id, rating, requestId: crypto.randomUUID() };
    }
    reviewing = true;
    updateControls();
    renderDue();
    setStatus(reviewMessage, 'Registrando revisão…');
    try {
      const response = await reviewFlashcard(card.id, rating, pendingReview.requestId);
      pendingReview = null;
      setStatus(reviewMessage, `Revisão registrada. Próxima: ${formatFlashcardDue(response.dueAt)}.`, 'success');
      dueCards = dueCards.filter((item) => item.id !== card.id);
      dueTotal = Math.max(0, dueTotal - 1);
      await refresh();
    } catch (error) {
      setStatus(reviewMessage,
        pendingReview
          ? `${error.message || 'Não foi possível confirmar.'} Repita a mesma avaliação para tentar novamente.`
          : `Revisão registrada, mas a lista não pôde ser atualizada. ${error.message || 'Atualize a página para continuar.'}`,
        'error');
    } finally {
      reviewing = false;
      updateControls();
      renderDue();
      keepFocus('button:not([disabled])');
    }
  }

  // Set counts are refreshed right after a card is created (see the sets panel below).
  let afterCreate = async () => {};
  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (creating || loading || reviewing || pendingReview || !createForm.reportValidity()) return;
    creating = true;
    updateControls();
    setStatus(createMessage, '');
    void (async () => {
      try {
        if (setsEnabled && createSet.value)
          await addFlashcardSetCards(createSet.value, [{ front: frontInput.value, back: backInput.value }]);
        else
          await createFlashcard({
            front: frontInput.value, back: backInput.value,
            materialId: materialInput.value || null,
          });
        createForm.reset();
        setStatus(createMessage, 'Cartão criado e disponível para a primeira revisão.', 'success');
        await refresh();
        await afterCreate();
      } catch (error) {
        setStatus(createMessage, error.message || 'Não foi possível salvar o cartão.', 'error');
      } finally { creating = false; updateControls(); }
    })();
  });

  managerSelect.addEventListener('change', fillManagerFields);
  manager.addEventListener('submit', (event) => {
    event.preventDefault();
    if (saving || loading || reviewing || pendingReview || !manager.reportValidity() || !managerSelect.value) return;
    saving = true;
    updateControls();
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
      } finally { saving = false; updateControls(); }
    })();
  });

  if (setsEnabled) {
    const setsPanel = initFlashcardSetsPanel({
      container: manager.closest('details'),
      materials,
      onChange: refresh,
      onSelect: (setId) => {
        setFilter.value = setId;
        changeView(0);
        manager.closest('details').open = true;
        setFilter.focus();
      },
    });
    const reloadSets = () =>
      setsPanel
        .load()
        .then(fillSetOptions)
        .catch((error) =>
          setStatus(managerMessage, error?.message || 'Não foi possível carregar os conjuntos agora.', 'error'),
        );
    await reloadSets();
    afterCreate = reloadSets;
    deleteCardButton.addEventListener('click', () => {
      const id = managerSelect.value;
      if (!id || saving || !confirm('Excluir este cartão e o histórico de revisões dele? Esta ação não pode ser desfeita.')) return;
      saving = true;
      updateControls();
      void deleteFlashcard(id)
        .then(async () => {
          setStatus(managerMessage, 'Cartão excluído.', 'success');
          await refresh();
          await reloadSets();
        })
        .catch((error) => setStatus(managerMessage, error.message || 'Não foi possível excluir.', 'error'))
        .finally(() => { saving = false; updateControls(); });
    });
  }

  try { await refresh(); }
  catch (error) {
    setStatus(reviewMessage,
      error.message || 'Os flashcards estão indisponíveis. Nenhuma alteração foi feita.',
      'error');
    createForm.querySelector('[type="submit"]').disabled = true;
    manager.querySelector('[type="submit"]').disabled = true;
    dueArea.append(make('p', 'Não foi possível carregar as revisões.', 'flashcard-muted'));
    signal('flashcards', { error: error.message || 'Os flashcards estão indisponíveis.' });
  }
}

