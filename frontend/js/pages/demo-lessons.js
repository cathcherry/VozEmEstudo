// Demonstration lessons of the public testing program: the shelf in the Biblioteca, the compact
// entry on Início and the discreet note on a demo copy. Opening a demo creates the participant's
// own copy on first use (POST /api/demo-lessons/:id/open, no AI) and goes to that lesson; the
// copy then lives in the library like any other lesson, so the shelf says "Abrir" instead of
// "Começar" once it exists. Loaded only when FEATURE_PUBLIC_TESTING is on.
import { openDemoLesson } from '../api/testing.api.js';
import { ensureTestingStyles, getDemoLessons } from '../utils/public-testing.js';
import { renderArt } from '../art/art.js';
import { icon } from '../utils/icons.js';
import { toast } from '../utils/toast.js';

const TONES = ['lavender', 'matcha', 'honey', 'mist', 'rose'];
export const SHELF_ID = 'aulas-de-demonstracao';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const own = (tag, className, text) => {
  const node = el(tag, className, text);
  node.setAttribute('translate', 'no');
  return node;
};

export const toneOf = (demo, index = 0) =>
  TONES.includes(demo?.cover?.tone) ? demo.cover.tone : TONES[index % TONES.length];

/** "5 min de aula" (at least 1 min). */
export function durationText(ms) {
  const minutes = Math.max(1, Math.round((Number(ms) || 0) / 60000));
  return `${minutes} min de aula`;
}

/** "Resumo · 12 questões · 20 cartões". */
export function contentsText(demo) {
  const parts = ['Resumo'];
  const questions = Number(demo.questionCount) || 0;
  const cards = Number(demo.flashcardCount) || 0;
  if (questions) parts.push(`${questions} ${questions === 1 ? 'questão' : 'questões'}`);
  if (cards) parts.push(`${cards} ${cards === 1 ? 'cartão' : 'cartões'}`);
  return parts.join(' · ');
}

function emblem(demo, size) {
  const id = String(demo?.cover?.emblem || 'emblem.geral');
  return renderArt(id.startsWith('emblem.') ? id : 'emblem.geral', { size, decorative: true }) ||
    renderArt('emblem.geral', { size, decorative: true });
}

/** Opens (or creates) the copy and goes to it; the button shows the pending state meanwhile. */
async function openDemo(demo, button, card, status) {
  if (card.dataset.state === 'pending') return;
  const label = button.querySelector('[data-demo-action-label]');
  const previous = label.textContent;
  card.dataset.state = 'pending';
  card.setAttribute('aria-busy', 'true');
  button.disabled = true;
  label.textContent = demo.materialId ? 'Abrindo…' : 'Preparando…';
  if (status) status.textContent = demo.materialId ? 'Abrindo a aula de demonstração…' : 'Preparando sua cópia da aula de demonstração…';
  try {
    const result = await openDemoLesson(demo.id);
    const materialId = result?.materialId || demo.materialId;
    if (!materialId) throw new Error('Não foi possível abrir a aula de demonstração. Tente novamente.');
    location.href = `./material.html?id=${encodeURIComponent(materialId)}`;
  } catch (error) {
    delete card.dataset.state;
    card.removeAttribute('aria-busy');
    button.disabled = false;
    label.textContent = previous;
    const message = error?.message || 'Não foi possível abrir a aula de demonstração. Tente novamente.';
    if (status) status.textContent = message;
    toast(message, { type: 'error' });
    button.focus();
  }
}

function actionButton(demo, className) {
  const button = el('button', className);
  button.type = 'button';
  button.dataset.demoOpen = demo.id;
  const label = el('span', '', demo.materialId ? 'Abrir' : 'Começar');
  label.dataset.demoActionLabel = '';
  const hidden = own('span', 'sr-only', `: ${demo.title}`);
  button.append(label, hidden, icon(demo.materialId ? 'open' : 'play', { size: 18 }));
  return button;
}

/** One cover card of the shelf. */
export function demoCard(demo, index, status) {
  const card = el('article', 'demo-card');
  card.dataset.tone = toneOf(demo, index);
  card.dataset.demoId = demo.id;
  const titleId = `demo-card-title-${index}`;
  card.setAttribute('aria-labelledby', titleId);
  const cover = el('div', 'demo-card__cover');
  const art = emblem(demo, 64);
  if (art) cover.append(art);
  if (demo.hasVideo) {
    const video = el('span', 'demo-card__media');
    video.append(icon('video', { size: 16 }), el('span', 'demo-card__media-text', 'Com vídeo'));
    cover.append(video);
  }
  const body = el('div', 'demo-card__body');
  const subject = own('p', 'demo-card__subject', demo.subject || '');
  const title = own('h3', 'demo-card__title', demo.title);
  title.id = titleId;
  body.append(subject, title);
  if (demo.description) body.append(own('p', 'demo-card__description', demo.description));
  const facts = el('ul', 'demo-card__facts');
  const fact = (iconName, text) => {
    const item = el('li');
    item.append(icon(iconName, { size: 16 }), el('span', '', text));
    facts.append(item);
  };
  fact('clock', durationText(demo.durationMs));
  fact('questions', contentsText(demo));
  body.append(facts);
  const foot = el('div', 'demo-card__foot');
  const badge = el('span', 'demo-card__badge');
  badge.append(icon('check', { size: 16 }), el('span', '', 'Já processada — não usa seu limite'));
  const button = actionButton(demo, 'demo-card__action');
  button.addEventListener('click', () => openDemo(demo, button, card, status));
  foot.append(badge, button);
  body.append(foot);
  card.append(cover, body);
  return card;
}

/**
 * The shelf above the library's folders. Returns { setVisible } (the library hides it inside a
 * folder, in the resources view and while searching), or null when there are no demos.
 */
export async function mountLibraryShelf(anchor) {
  if (!anchor) return null;
  const demos = await getDemoLessons();
  if (!demos.length) return null;
  await ensureTestingStyles();
  const section = el('section', 'demo-shelf');
  section.id = SHELF_ID;
  section.dataset.demoShelf = '';
  section.setAttribute('aria-labelledby', 'demo-shelf-title');
  const head = el('header', 'demo-shelf__head');
  const copy = el('div', 'demo-shelf__copy');
  const eyebrow = el('p', 'demo-shelf__eyebrow', 'Período de testes');
  const heading = el('h2', 'demo-shelf__title', 'Aulas de demonstração');
  heading.id = 'demo-shelf-title';
  const intro = el(
    'p',
    'demo-shelf__intro',
    'Aulas completas, já transcritas, com resumo, questões e cartões prontos. Explore à vontade: elas não usam seu limite.',
  );
  copy.append(eyebrow, heading, intro);
  head.append(copy);
  const status = el('p', 'sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.dataset.demoStatus = '';
  const list = el('div', 'demo-shelf__row');
  list.setAttribute('role', 'list');
  demos.forEach((demo, index) => {
    const item = el('div', 'demo-shelf__item');
    item.setAttribute('role', 'listitem');
    item.append(demoCard(demo, index, status));
    list.append(item);
  });
  section.append(head, list, el('div', 'demo-shelf__ledge'), status);
  section.querySelector('.demo-shelf__ledge').setAttribute('aria-hidden', 'true');
  anchor.before(section);
  if (location.hash === `#${SHELF_ID}`) section.scrollIntoView({ block: 'start' });
  return {
    element: section,
    setVisible(visible) {
      section.hidden = !visible;
    },
  };
}

/**
 * Início: a compact card under "Continuar estudando" while some demo has not been opened yet
 * (nothing once every demo has its copy: they are in the library like any lesson).
 */
export async function mountHomeEntry(after) {
  if (!after) return null;
  const demos = await getDemoLessons();
  const pending = demos.filter((demo) => !demo.materialId);
  if (!pending.length) return null;
  await ensureTestingStyles();
  const section = el('section', 'dash-card demo-home');
  section.dataset.demoHome = '';
  section.setAttribute('aria-labelledby', 'demo-home-title');
  const head = el('div', 'dash-card-head');
  const heading = el('h2', '', 'Aulas de demonstração');
  heading.id = 'demo-home-title';
  const all = el('a', 'text-action', 'Ver todas');
  all.href = `./historico.html#${SHELF_ID}`;
  all.setAttribute('aria-label', 'Ver todas as aulas de demonstração');
  head.append(heading, all);
  const intro = el(
    'p',
    'demo-home__intro',
    pending.length === 1
      ? '1 aula completa para explorar, já processada: não usa seu limite.'
      : `${pending.length} aulas completas para explorar, já processadas: não usam seu limite.`,
  );
  const status = el('p', 'sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = el('ul', 'demo-home__list');
  pending.forEach((demo) => {
    const item = el('li', 'demo-home__item');
    item.dataset.tone = toneOf(demo, demos.indexOf(demo));
    // The whole tile is the button: emblem, title, subject and length, then "Começar".
    const button = el('button', 'demo-home__tile');
    button.type = 'button';
    button.dataset.demoOpen = demo.id;
    const mark = el('span', 'demo-home__emblem');
    const art = emblem(demo, 32);
    if (art) mark.append(art);
    const copy = el('span', 'demo-home__copy');
    const meta = el('small', 'demo-home__meta');
    if (demo.subject) meta.append(own('span', '', demo.subject), ' · ');
    meta.append(el('span', '', durationText(demo.durationMs)));
    copy.append(own('strong', 'demo-home__title', demo.title), meta);
    const go = el('span', 'demo-home__go');
    const label = el('span', '', 'Começar');
    label.dataset.demoActionLabel = '';
    go.append(label, icon('next', { size: 16 }));
    button.append(mark, copy, go);
    button.addEventListener('click', () => openDemo(demo, button, item, status));
    item.append(button);
    list.append(item);
  });
  section.append(head, intro, list, status);
  after.after(section);
  return section;
}

/** The discreet note next to a demo copy's title (credits in a disclosure). */
export async function renderDemoNote(container, demo) {
  if (!container || !demo || container.querySelector('[data-demo-note]')) return;
  await ensureTestingStyles();
  if (container.querySelector('[data-demo-note]')) return;
  const note = el('details', 'demo-note');
  note.dataset.demoNote = '';
  const summary = el('summary', 'demo-note__summary');
  summary.append(
    icon('info', { size: 16 }),
    el('span', 'demo-note__label', 'Aula de demonstração'),
    el('span', 'demo-note__detail', 'já processada; não usa seu limite'),
  );
  note.append(summary);
  const body = el('div', 'demo-note__body');
  body.append(
    el('p', '', 'Esta é a sua cópia de uma aula preparada para o período de testes. Suas anotações, respostas e cartões ficam só com você.'),
  );
  if (demo.credits) {
    const credits = el('p', 'demo-note__credits');
    credits.append(el('strong', '', 'Créditos: '), own('span', '', String(demo.credits)));
    body.append(credits);
  }
  note.append(body);
  container.append(note);
}
