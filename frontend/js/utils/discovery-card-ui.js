// The evolving discovery card as DOM (3.6, Milestone E): one renderer for the Arquivo, the
// discovery page, the Gabinete's specimen drawer and the investigation's sketch. The look comes
// from cardState() (utils/discovery-card.js), which only reads stored learning data; every mark
// on the card has a sentence that says why it is there.
import { cardState, describeState, TRAIT_NAMES } from './discovery-card.js';
import { formatDay } from './collectibles.js';
import { icon } from './icons.js';

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
export const own = (tag, text, className) => el(tag, { translate: 'no', className, text });

/** The marks drawn on the paper (decorative; the state is also said in words). */
function marks(state) {
  const list = [];
  if (state.traits.includes('bound')) list.push(el('span', { className: 'specimen-thread', 'aria-hidden': 'true' }));
  if (state.traits.includes('stamped'))
    list.push(el('span', { className: 'specimen-postmark', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
  if (state.traits.includes('pressed'))
    list.push(
      el(
        'span',
        { className: 'specimen-flower', 'aria-hidden': 'true' },
        el('span', { className: 'washi', 'data-tape': 'rose-floral', style: '--tilt:-8deg;--tape-length:3.2rem' }),
        el('span', { 'data-art-slot': 'sticker', 'data-art-id': 'sticker.pressed-flower', 'data-art-size': '52' }),
      ),
    );
  return list;
}

/** "Por que este cartão está assim": one line per mark, reached or not (with the next step). */
export function stateLines(state, { dates = false } = {}) {
  return el(
    'ul',
    { className: 'specimen-why-list' },
    ...state.lines.map((line) =>
      el(
        'li',
        { 'data-trait': line.trait, 'data-reached': String(line.reached) },
        el('span', { className: 'specimen-why-mark', 'aria-hidden': 'true' }, line.reached ? icon('check', { size: 16 }) : null),
        el(
          'span',
          { className: 'specimen-why-text' },
          el('strong', { text: TRAIT_NAMES[line.trait] }),
          line.reached && line.text ? el('span', { text: line.text }) : null,
          line.reached && line.note ? el('span', { text: line.note }) : null,
          !line.reached || line.hint ? el('span', { className: 'specimen-why-hint', text: line.hint }) : null,
          dates && line.reached && line.at ? el('time', { datetime: line.at, text: formatDay(line.at) }) : null,
        ),
      ),
    ),
  );
}

/**
 * A discovery card. `input` is a list row, a discovery view or an investigation view (see
 * cardFacts). Options: href (title link), headingLevel, title/subject/lesson overrides, compact
 * (no explanation block), open (explanation expanded), extra (nodes appended at the end).
 */
export function discoveryCard(input, options = {}) {
  const state = cardState(input);
  const row = input.discovery || input.investigation || input;
  const title = options.title ?? row.title ?? row.question ?? '';
  const subject = options.subject ?? row.subject ?? input.lesson?.subject ?? '';
  const lesson = options.lesson ?? row.lessonTitle ?? input.lesson?.title ?? '';
  const question = state.facts.question && state.facts.question !== title ? state.facts.question : '';
  const heading = el(`h${options.headingLevel || 3}`, { className: 'specimen-title' },
    options.href ? el('a', { href: options.href, translate: 'no', text: title }) : own('span', title));
  const whyId = options.idPrefix ? `${options.idPrefix}-why` : null;
  const card = el(
    'article',
    {
      className: `specimen-card${options.compact ? ' is-compact' : ''}`,
      'data-stage': state.stage,
      'data-traits': state.traits.join(' ') || 'sketch',
      'data-discovery': row.id || null,
    },
    ...marks(state),
    subject ? own('p', subject, 'specimen-subject') : null,
    heading,
    question ? el('p', { className: 'specimen-question' }, el('span', { text: 'Pergunta: ' }), own('span', question)) : null,
    lesson || state.facts.createdAt
      ? el(
          'p',
          { className: 'specimen-meta' },
          lesson ? own('span', lesson, 'specimen-lesson') : null,
          state.facts.createdAt ? el('time', { datetime: state.facts.createdAt, text: formatDay(state.facts.createdAt) }) : null,
        )
      : null,
    el('p', { className: 'specimen-state' }, el('span', { className: 'sr-only', text: 'Estado do cartão: ' }), el('span', { text: describeState(state) })),
    options.compact
      ? null
      : el(
          'details',
          { className: 'specimen-why', id: whyId, open: options.open || null },
          el('summary', { text: state.stage === 'sketch' ? 'Como este cartão vai mudar' : 'Por que este cartão está assim' }),
          stateLines(state, { dates: Boolean(options.dates) }),
        ),
    ...(options.extra || []),
  );
  card.cardState = state;
  return card;
}
