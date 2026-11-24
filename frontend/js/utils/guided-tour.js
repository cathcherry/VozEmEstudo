// Guided tour (3.7): a short walk through the main parts of the app, in context.
//
// - Starts by itself once, on Início, for accounts created recently (first visit after sign-up);
//   "Pular" or Esc ends it for good. Older accounts are never interrupted; anyone can see it again
//   from Ajuda or Configurações (they open Início with ?tour=1).
// - Explanations that would otherwise sit on the screens (e.g. demonstration lessons do not use
//   the testing allowance) live in the steps instead.
// - While it runs, <html data-tour> is set and 'voz:tour-done' fires at the end, so other first-visit
//   notes (the testing welcome) wait instead of covering it.
// - A popover beside each target plus a ring around it; nothing covers or blocks the page.
//   A step whose target is missing or hidden (feature off, phone layout) is skipped.
// - Keyboard: Esc closes, → / Enter next, ← previous; focus moves to the step title and returns
//   where it was. "Passo 2 de 6" is announced through a live region.
// - No animation with prefers-reduced-motion, the app's "Movimento reduzido" or screen-reader mode.
// - Completion or dismissal is kept per account in profile_state ('guided-tour', synchronized
//   like the other account preferences, with this browser's copy read first).
import { cachedCloudState, loadCloudState, saveCloudState } from './profile-cloud.js';

export const TOUR_KEY = 'guided-tour';
export const TOUR_VERSION = 1;
/** Accounts older than this are not invited (they already know the app). */
export const OFFER_WINDOW_DAYS = 30;
export const TOUR_START_URL = './painel.html?tour=1';

const nav = (href) => [`.side-navigation a[href="${href}"]`, `.focus-dock a[href="${href}"]`];

/**
 * Steps in order. `targets`: selectors tried in order (first visible wins). `when`: optional
 * condition on the page. `title` may be a function of the target (the menu may rename a page).
 */
export const TOUR_STEPS = Object.freeze([
  {
    id: 'create',
    targets: nav('./nova-transcricao.html'),
    title: 'Nova transcrição',
    text: 'Comece por aqui: envie o áudio ou vídeo de uma aula. Você confere a transcrição antes de gerar resumo e questões.',
  },
  {
    // Public testing only: the Início card exists when the program is on and demos are open.
    id: 'demos',
    targets: ['.demo-home', '.demo-shelf'],
    title: 'Aulas de demonstração',
    text: 'Três aulas completas para explorar transcrição, resumo, questões e flashcards. Abrir uma delas não gasta o seu limite de transcrição.',
  },
  {
    id: 'home',
    targets: nav('./painel.html'),
    title: 'Início',
    text: 'A aula para continuar, as tarefas e os cartões de hoje e o seu tempo de estudo na semana.',
  },
  {
    id: 'library',
    targets: nav('./historico.html'),
    title: 'Biblioteca',
    text: 'Todas as suas aulas, com pastas, disciplinas e busca. Cada aula mostra o próximo passo de estudo.',
  },
  {
    id: 'review',
    targets: [...nav('./flashcards.html'), ...nav('./revisar.html')],
    title: (target) => target?.textContent.trim() || 'Revisar',
    text: 'Revise com flashcards e retome suas questões e anotações.',
  },
  {
    id: 'plan',
    targets: nav('./planejar.html'),
    title: 'Planejar',
    text: 'Objetivos, tarefas e calendário de estudos, com uma meta de tempo por semana.',
  },
  {
    id: 'focus',
    targets: nav('./focar.html'),
    title: 'Focar',
    text: 'Um cronômetro de foco com pausas. O tempo estudado aparece no Início e no Planejar.',
  },
  {
    // Phone layout: the navigation is behind the menu button.
    id: 'menu',
    targets: ['.menu-toggle'],
    when: ({ visible }) => !visible('.side-navigation a[href="./historico.html"]'),
    title: 'Menu',
    text: 'Abra o menu para ir à Biblioteca, ao Planejar, ao Focar e às Configurações.',
  },
  {
    id: 'search',
    targets: ['.topbar-search'],
    title: 'Busca',
    text: 'Procure em aulas, questões e transcrições. Os resultados aparecem aqui mesmo, no Início.',
  },
  {
    id: 'customize',
    targets: ['[data-dashboard-customize]'],
    title: 'Personalizar',
    text: 'Escolha quais blocos aparecem no Início e em que ordem.',
  },
  {
    id: 'settings',
    targets: ['.sidebar-settings a[href="./configuracoes.html"]', '.account-menu-trigger'],
    title: 'Configurações e ajuda',
    text: 'Aparência, idioma, senha e a Ajuda ficam aqui. O tutorial pode ser visto de novo por lá.',
  },
]);

/** Whether an element is on screen for the person (not hidden, not zero-sized). */
export function isElementVisible(element) {
  if (!element?.isConnected) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  const box = element.getBoundingClientRect();
  // Off-canvas (a closed drawer) counts as hidden.
  const width = globalThis.innerWidth || element.ownerDocument.documentElement.clientWidth;
  return box.width > 0 && box.height > 0 && box.right > 0 && box.left < width;
}

/**
 * The steps that can be shown now, each with its target element. Steps without a visible target
 * or whose condition fails are left out. `find(selector)` returns the visible element or null.
 */
export function availableSteps(steps, find) {
  const visible = (selector) => Boolean(find(selector));
  const result = [];
  for (const step of steps) {
    if (step.when && !step.when({ visible })) continue;
    const target = step.targets.map((selector) => find(selector)).find(Boolean);
    if (!target) continue;
    result.push({
      ...step,
      target,
      title: typeof step.title === 'function' ? step.title(target) : step.title,
    });
  }
  return result;
}

/** First visible element for a selector in the document. */
export function findVisible(selector, doc = document) {
  return [...doc.querySelectorAll(selector)].find(isElementVisible) || null;
}

/** A record for profile_state: what happened and when. */
export function tourRecord(status, now = new Date()) {
  return { status, version: TOUR_VERSION, at: now.toISOString() };
}

/**
 * Whether to invite this account now: never after it finished or declined the tour, and only for
 * accounts created in the last OFFER_WINDOW_DAYS (an account without a creation date is not new).
 */
export function shouldOfferTour({ record, user, now = Date.now() }) {
  if (record && ['done', 'dismissed'].includes(record.status)) return false;
  const created = Date.parse(user?.created_at || '');
  if (!Number.isFinite(created)) return false;
  return now - created <= OFFER_WINDOW_DAYS * 86_400_000;
}

/** Account storage for the tour state; the cloud functions can be replaced in tests. */
export function createTourStore(
  owner,
  cloud = { cachedCloudState, loadCloudState, saveCloudState },
) {
  return {
    cached: () => (owner ? cloud.cachedCloudState(owner, TOUR_KEY) : null),
    load: async () => {
      if (!owner) return null;
      try {
        return await cloud.loadCloudState(owner, TOUR_KEY, null);
      } catch {
        return cloud.cachedCloudState(owner, TOUR_KEY);
      }
    },
    save: (status) =>
      owner ? cloud.saveCloudState(owner, TOUR_KEY, tourRecord(status)).catch(() => false) : false,
  };
}

/** The app's and the system's reduced-motion choices (and screen-reader mode). */
export function prefersReducedMotion(doc = document) {
  const root = doc.documentElement;
  return (
    root.dataset.reducedMotion === 'true' ||
    root.dataset.screenReaderMode === 'true' ||
    Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
}

/** From any page: open Início and start there (most steps point at Início). */
export function startTourFromAnywhere() {
  location.href = TOUR_START_URL;
}

/** Loads the tour stylesheet once; resolves when it applies (or after 3 s, so nothing hangs). */
function ensureStyles(doc = document) {
  let link = doc.querySelector('link[href$="/css/guided-tour.css"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/guided-tour.css';
    doc.head.append(link);
  }
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 3000);
  });
}

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let active = null;

/**
 * Places the popover beside the target: right of it when there is room (sidebar items), else
 * below, else above; always inside the viewport with a 12px margin.
 */
export function placePopover(targetBox, popoverSize, viewport, gap = 14, margin = 12) {
  const { width: w, height: h } = popoverSize;
  const clampX = (x) => Math.max(margin, Math.min(x, viewport.width - w - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, viewport.height - h - margin));
  if (targetBox.right + gap + w + margin <= viewport.width && viewport.width >= 700)
    return {
      side: 'right',
      left: targetBox.right + gap,
      top: clampY(targetBox.top + targetBox.height / 2 - h / 2),
    };
  if (targetBox.bottom + gap + h + margin <= viewport.height)
    return {
      side: 'below',
      left: clampX(targetBox.left + targetBox.width / 2 - w / 2),
      top: targetBox.bottom + gap,
    };
  if (targetBox.top - gap - h >= margin)
    return {
      side: 'above',
      left: clampX(targetBox.left + targetBox.width / 2 - w / 2),
      top: targetBox.top - gap - h,
    };
  return { side: 'below', left: clampX(targetBox.left), top: clampY(targetBox.bottom + gap) };
}

/**
 * Runs the tour. Returns a controller ({ close, next, previous, index }) or null when no step can
 * be shown. `onEnd(status)` gets 'done' (finished) or 'dismissed' (closed before the end).
 */
export function startTour({ steps = TOUR_STEPS, onEnd = () => {}, doc = document } = {}) {
  active?.close('replaced');
  const list = availableSteps(steps, (selector) => findVisible(selector, doc));
  if (!list.length) return null;
  const stylesReady = ensureStyles(doc);
  const reduced = prefersReducedMotion(doc);
  const returnFocus = doc.activeElement;

  const ring = make('div', 'tour-ring');
  ring.setAttribute('aria-hidden', 'true');
  const popover = make('section', 'tour-popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-labelledby', 'tour-title');
  popover.setAttribute('aria-describedby', 'tour-text');
  popover.dataset.guidedTour = '';
  const counter = make('p', 'tour-counter');
  counter.setAttribute('aria-live', 'polite');
  counter.dataset.tourCounter = '';
  const close = make('button', 'tour-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar tutorial');
  close.dataset.tourClose = '';
  const title = make('h2', 'tour-title');
  title.id = 'tour-title';
  title.tabIndex = -1;
  const text = make('p', 'tour-text');
  text.id = 'tour-text';
  const actions = make('div', 'tour-actions');
  const back = make('button', 'secondary-action tour-back', 'Voltar');
  back.type = 'button';
  back.dataset.tourBack = '';
  const forward = make('button', 'primary-action tour-next', 'Próximo');
  forward.type = 'button';
  forward.dataset.tourNext = '';
  // First step: "Pular" ends the tutorial; later steps go back.
  actions.append(back, forward);
  const head = make('div', 'tour-head');
  head.append(counter, close);
  popover.append(head, title, text, actions);
  if (reduced) popover.dataset.reducedMotion = 'true';
  // Invisible until the stylesheet applies: an unstyled popover would be measured and placed in
  // the wrong spot (below or above the target instead of beside it) on a first visit.
  popover.style.visibility = 'hidden';
  ring.style.visibility = 'hidden';
  doc.body.append(ring, popover);
  doc.documentElement.dataset.tour = 'active';

  let index = 0;
  let ended = false;
  let current = null;

  function position() {
    if (!current) return;
    const box = current.target.getBoundingClientRect();
    const pad = 6;
    Object.assign(ring.style, {
      left: `${box.left - pad}px`,
      top: `${box.top - pad}px`,
      width: `${box.width + pad * 2}px`,
      height: `${box.height + pad * 2}px`,
    });
    const size = popover.getBoundingClientRect();
    const place = placePopover(box, size, {
      width: doc.documentElement.clientWidth,
      height: window.innerHeight,
    });
    popover.dataset.side = place.side;
    popover.style.left = `${place.left}px`;
    popover.style.top = `${place.top}px`;
  }
  function show(next) {
    // A target may have gone meanwhile (layout change): skip it in the direction of travel.
    const direction = next >= index ? 1 : -1;
    let candidate = next;
    while (list[candidate] && !isElementVisible(list[candidate].target)) candidate += direction;
    if (!list[candidate]) return candidate >= list.length ? end('done') : undefined;
    index = candidate;
    current = list[index];
    popover.dataset.step = current.id;
    counter.textContent = `Passo ${index + 1} de ${list.length}`;
    title.textContent = current.title;
    text.textContent = current.text;
    back.textContent = index === 0 ? 'Pular' : 'Voltar';
    back.dataset.tourSkip = index === 0 ? 'true' : 'false';
    forward.textContent = index === list.length - 1 ? 'Concluir' : 'Próximo';
    current.target.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    });
    position();
    // Smooth scrolling moves the target after this frame; place again once it settles.
    if (!reduced) setTimeout(position, 350);
    title.focus({ preventScroll: true });
  }
  function end(status) {
    if (ended) return;
    ended = true;
    active = null;
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    resized?.disconnect();
    doc.removeEventListener('keydown', onKey, true);
    ring.remove();
    popover.remove();
    if (status !== 'replaced') releaseTourGate(doc);
    const target =
      returnFocus?.isConnected && returnFocus !== doc.body
        ? returnFocus
        : doc.querySelector('main');
    target?.focus?.({ preventScroll: true });
    if (status !== 'replaced') onEnd(status);
  }
  function onKey(event) {
    if (event.key === 'Escape') {
      // A dialog opened meanwhile closes first.
      if (doc.querySelector('dialog[open]')) return;
      event.preventDefault();
      end('dismissed');
      return;
    }
    if (!popover.contains(event.target)) return;
    if (event.key === 'ArrowRight' || (event.key === 'Enter' && !event.target.closest('button'))) {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (index > 0) show(index - 1);
    }
  }
  forward.addEventListener('click', () => show(index + 1));
  back.addEventListener('click', () => (index === 0 ? end('dismissed') : show(index - 1)));
  close.addEventListener('click', () => end('dismissed'));
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  doc.addEventListener('keydown', onKey, true);
  // The stylesheet may still be loading on a first visit (the tutorial starts by itself): place the
  // popover again whenever its own size changes, so it ends up beside the target, not below it.
  const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => position()) : null;
  resized?.observe(popover);
  show(0);
  void stylesReady.then(() => {
    if (ended) return;
    position();
    popover.style.visibility = '';
    ring.style.visibility = '';
    title.focus({ preventScroll: true });
  });
  active = {
    close: (status = 'dismissed') => end(status),
    next: () => show(index + 1),
    previous: () => show(index - 1),
    get index() {
      return index;
    },
    get steps() {
      return list.map((step) => step.id);
    },
  };
  return active;
}

/** First-visit notes wait while the tutorial may start or is running (see <html data-tour>). */
function releaseTourGate(doc = document) {
  if (!doc.documentElement.dataset.tour) return;
  delete doc.documentElement.dataset.tour;
  doc.dispatchEvent(new CustomEvent('voz:tour-done'));
}

/** Resolves once no tutorial is pending or running (immediately when there is none). */
export function afterTour(doc = document) {
  if (!doc.documentElement.dataset.tour) return Promise.resolve();
  return new Promise((resolve) => doc.addEventListener('voz:tour-done', () => resolve(), { once: true }));
}

/**
 * Início: starts the tutorial when asked (?tour=1, from Ajuda or Configurações) or, once, by
 * itself for a new account. Never throws: the tutorial is optional.
 */
export async function maybeOfferTour({ user, doc = document, delay = 1200 } = {}) {
  // Hold first-visit notes until we know whether the tutorial starts.
  doc.documentElement.dataset.tour = 'pending';
  try {
    const store = createTourStore(user?.id);
    const params = new URLSearchParams(location.search);
    const asked = params.get('tour') === '1';
    if (asked) {
      params.delete('tour');
      const query = params.toString();
      history.replaceState(
        history.state,
        '',
        `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
      );
    }
    // Let the navigation reveal feature pages and the dashboard settle first.
    await new Promise((resolve) => setTimeout(resolve, asked ? Math.min(delay, 600) : delay));
    const run = () => {
      const started = startTour({ doc, onEnd: (status) => void store.save(status) });
      if (!started) releaseTourGate(doc);
      return started ? 'started' : 'unavailable';
    };
    if (asked) return run();
    const record = store.cached() ?? (await store.load());
    if (!shouldOfferTour({ record, user }) || doc.querySelector('dialog[open]')) {
      releaseTourGate(doc);
      return 'skipped';
    }
    // A new account: the tutorial starts by itself ("Pular" on the first step ends it).
    return run();
  } catch {
    releaseTourGate(doc);
    return 'error';
  }
}
