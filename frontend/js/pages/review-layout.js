// Revisar (3.6): what to review today comes first. Under the title, one line says what is waiting
// (cards due, lists to finish) and each tab shows its count; the page opens on the tab with work.
// Inside Flashcards the review card is the page: filters, the card's look and creating cards sit
// in a compact toolbar (two popovers), and managing cards and sets — organize, sets, merge and
// import — is a second view ("Gerenciar"), not a stack of boxes under the card. The panels are
// built by their own modules; this one only arranges what they made (ids and handlers stay).

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const counts = { flashcards: null, questoes: null, anotacoes: null };

/** The tab counts and the "para hoje" line. */
export function initReviewToday({ tabs, chooseTab }) {
  const intro = document.querySelector('.tool-intro');
  const today = make('div', null, 'review-today');
  today.dataset.reviewToday = '';
  today.setAttribute('aria-live', 'polite');
  intro?.after(today);
  const badges = {};
  for (const id of Object.keys(counts)) {
    const tab = document.querySelector(`[role="tab"][data-tab="${id}"]`);
    if (!tab) continue;
    const badge = make('span', null, 'tool-tab-count');
    badge.setAttribute('aria-hidden', 'true');
    badge.hidden = true;
    tab.append(badge);
    badges[id] = badge;
  }
  let chosen = false;
  const paint = () => {
    for (const [id, badge] of Object.entries(badges)) {
      const value = counts[id];
      badge.hidden = !value;
      badge.textContent = value ? String(value) : '';
    }
    const items = [];
    if (counts.flashcards)
      items.push(['flashcards', `${counts.flashcards} ${counts.flashcards === 1 ? 'cartão para revisar' : 'cartões para revisar'}`]);
    if (counts.questoes)
      items.push(['questoes', `${counts.questoes} ${counts.questoes === 1 ? 'lista de questões para terminar' : 'listas de questões para terminar'}`]);
    const known = counts.flashcards !== null && counts.questoes !== null;
    today.replaceChildren();
    if (items.length) {
      today.append(make('strong', 'Para hoje', 'review-today-label'));
      for (const [id, text] of items) {
        const go = make('button', text, 'review-today-item');
        go.type = 'button';
        go.addEventListener('click', () => tabs.select(id, true));
        today.append(go);
      }
    } else if (known) today.append(make('p', 'Nada pendente para hoje. Crie cartões ou pratique questões quando quiser.', 'review-today-done'));
    if (intro) intro.hidden = Boolean(items.length) || known;
    // Without a #section in the address, open on the first tab with something waiting.
    if (!chosen && chooseTab && known) {
      chosen = true;
      if (items.length) tabs.select(items[0][0]);
    }
  };
  document.addEventListener('voz:flashcards', (event) => {
    if (event.detail?.filtered) return; // a filter narrows the queue, not today's work
    counts.flashcards = Number(event.detail?.dueTotal) || 0;
    paint();
  });
  document.addEventListener('voz:quiz-history', (event) => {
    counts.questoes = Number(event.detail?.open) || 0;
    paint();
  });
  document.addEventListener('voz:notes', (event) => {
    counts.anotacoes = Number(event.detail?.total) || 0;
    paint();
  });
  return {
    /** A tool that is off (or failed) has nothing waiting. */
    settle(id) {
      if (counts[id] === null) counts[id] = 0;
      paint();
    },
  };
}

/** A small popover: a key that opens a surface below it; Esc or a click outside closes it. */
function popover(label, className) {
  const box = make('details', null, `review-popover ${className}`);
  const summary = make('summary', label, 'secondary-action');
  const surface = make('div', null, 'review-popover-surface popover-surface');
  box.append(summary, surface);
  document.addEventListener('click', (event) => {
    // Dialogs opened from the popover (creating a card) keep it open, so focus can come back.
    if (box.open && !box.contains(event.target) && !event.target.closest?.('dialog[open]')) box.open = false;
  });
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !box.open) return;
    event.stopPropagation();
    box.open = false;
    summary.focus();
  });
  return { box, summary, surface };
}

/** Flashcards: one review card, a compact toolbar, and a "Gerenciar" view for everything else. */
export function composeFlashcards(panel) {
  if (!panel || panel.dataset.composed) return;
  panel.dataset.composed = 'true';
  const $ = (selector) => panel.querySelector(selector);
  const columns = $('.flashcard-columns');
  const reviewColumn = $('.flashcard-review-column');
  const createColumn = $('.flashcard-create-column');
  const filters = $('.flashcard-filters');
  const looks = $('.flashcard-looks');
  const count = $('[data-flashcard-count]');
  const statusFilter = filters?.querySelectorAll('select')[1] || null;
  const setFilter = $('[data-flashcard-set-filter]');
  const lessonFilter = filters?.querySelector('select') || null;

  // ---- toolbar -------------------------------------------------------------------------------
  const toolbar = make('div', null, 'review-toolbar');
  const heading = make('div', null, 'review-toolbar-heading');
  const title = make('h3', 'Revisão de hoje');
  heading.append(title);
  if (count) heading.append(count);
  const actions = make('div', null, 'review-toolbar-actions');
  const filter = popover('Filtros', 'review-filter');
  if (lessonFilter) filter.surface.append(lessonFilter.closest('label'));
  if (setFilter) filter.surface.append(setFilter.closest('label'));
  if (looks) filter.surface.append(looks);
  const create = popover('Novo cartão', 'review-create');
  const createActions = $('.flashcard-create-actions');
  if (createActions) create.surface.append(createActions);
  const manage = make('button', 'Gerenciar', 'secondary-action review-manage-toggle');
  manage.type = 'button';
  manage.setAttribute('aria-expanded', 'false');
  manage.setAttribute('aria-controls', 'flashcard-manage-view');
  actions.append(filter.box, create.box, manage);
  toolbar.append(heading, actions);

  // ---- the two views -------------------------------------------------------------------------
  const stage = make('div', null, 'review-stage');
  stage.id = 'flashcard-review-view';
  // The review column keeps its children (the due area and its status) in reading order.
  stage.append(reviewColumn);
  reviewColumn.querySelector(':scope > h3')?.remove();
  const manageView = make('section', null, 'review-manage');
  manageView.id = 'flashcard-manage-view';
  manageView.hidden = true;
  manageView.setAttribute('aria-labelledby', 'flashcard-manage-title');
  const manageHead = make('div', null, 'review-manage-head');
  const manageTitle = make('h3', 'Gerenciar cartões e conjuntos');
  manageTitle.id = 'flashcard-manage-title';
  manageTitle.tabIndex = -1;
  manageHead.append(manageTitle);
  manageView.append(manageHead);
  const deckTools = $('.deck-tools');
  if (deckTools) manageView.append(deckTools);
  const organize = $('details.flashcard-management:not(.flashcard-sets)');
  if (organize && statusFilter) organize.querySelector(':scope > summary').after(statusFilter.closest('label'));
  for (const details of panel.querySelectorAll(':scope > details.flashcard-management')) manageView.append(details);
  // What is left of the old columns (dialogs, status lines) stays in the panel, out of the way.
  createColumn?.querySelector(':scope > h3')?.remove();
  createColumn?.classList.add('review-create-parts');
  columns?.classList.add('review-columns');
  columns?.before(toolbar);
  columns?.prepend(stage);
  columns?.after(manageView);
  filters?.remove();

  const showManage = (on, { focus = true } = {}) => {
    manageView.hidden = !on;
    stage.hidden = on;
    manage.setAttribute('aria-expanded', String(on));
    manage.textContent = on ? 'Voltar à revisão' : 'Gerenciar';
    panel.dataset.view = on ? 'manage' : 'review';
    if (focus) (on ? manageTitle : manage).focus();
  };
  manage.addEventListener('click', () => showManage(manageView.hidden));
  // How many filters narrow the queue, on the key itself.
  const markFilters = () => {
    const active = [lessonFilter, setFilter].filter((select) => select?.value).length;
    filter.summary.textContent = active ? `Filtros (${active})` : 'Filtros';
    filter.box.dataset.active = String(Boolean(active));
  };
  for (const select of [lessonFilter, setFilter]) select?.addEventListener('change', markFilters);
  markFilters();
  // A set opened from the tools (merged, imported, chosen in Conjuntos) is reviewed right away.
  setFilter?.addEventListener('change', () => {
    if (!manageView.hidden) showManage(false, { focus: false });
    markFilters();
  });
  // "?acao=criar" and Início's shortcuts ask for the creation keys: open the popover first.
  document.addEventListener('voz:flashcards-command', (event) => {
    if (event.detail?.action === 'create') {
      showManage(false, { focus: false });
      create.box.open = true;
      create.surface.querySelector('button')?.focus();
    }
    if (event.detail?.action === 'review') showManage(false, { focus: false });
  });
  return { showManage };
}
