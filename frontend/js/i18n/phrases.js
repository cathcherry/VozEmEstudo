// Phrase catalog: translates interface text on the page by its Portuguese source (gettext-style,
// the Portuguese text is the key). It complements the keyed t() messages: pages and scripts keep
// writing Portuguese, and in another interface language this module replaces every *exact*
// known interface phrase — in static HTML, in elements added later by scripts (observed), in
// labels/placeholders/titles and in native confirm/alert texts.
//
// User content is never translated: only whole, known interface phrases change, and the
// containers below (lesson titles, transcripts, summaries, questions, cards, notes, profile text,
// shared copies) are skipped entirely.
//
// Catalogs live in ./phrases/<locale>.js: { phrases: { pt: translation }, patterns: [[pt, tr]] }.
// Patterns carry {0}, {1}… for numbers or names inside a message ("Revisar {0} cartões").

export const USER_CONTENT = [
  '[translate="no"]',
  '[contenteditable="true"]',
  'textarea',
  '[data-material-title]',
  '[data-summary-text]',
  '[data-transcription-segments]',
  '.transcription-segment',
  '[data-quiz-statement]',
  '[data-quiz-alternatives] .quiz-option-text',
  '.flashcard-content',
  '.dash-next-card span',
  '.annotation-card blockquote',
  '.dashboard-lesson-title',
  '.dashboard-lesson-topics',
  '.dash-task-title',
  '.dash-agenda-title',
  '[data-shared-title]',
  '[data-shared-content]',
  '[data-profile-name]',
  '.profile-card-body',
  '.profile-about-block dd',
  '.search-snippet',
].join(',');

const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'data-tooltip'];
const MAX_LENGTH = 600;
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const NUMBER = /^[\d][\d.,:/%–\s-]*$/u;
const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();

/** Builds a translator from a catalog (exported for tests). */
export function createPhraseTranslator(catalog = { phrases: {}, patterns: [] }) {
  const phrases = new Map(Object.entries(catalog.phrases || {}));
  const patterns = (catalog.patterns || []).map(([source, target]) => {
    const fixed = source.replace(/\{\d+\}/g, '').replace(/[^\p{L}]/gu, '');
    const strict = fixed.length < 12;
    const escaped = source
      .split(/(\{\d+\})/)
      .map((part) =>
        /^\{\d+\}$/.test(part)
          ? `(?<p${part.slice(1, -1)}>.+?)`
          : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('');
    return { regex: new RegExp(`^${escaped}$`, 'u'), target, strict };
  });
  function phrase(source) {
    // Interface phrases are short; long text (a transcript, an injected script) is never one,
    // and matching patterns against it would only cost time.
    if (!source || source.length > MAX_LENGTH) return null;
    const key = normalize(source);
    if (!key) return null;
    if (phrases.has(key)) return phrases.get(key);
    for (const { regex, target, strict } of patterns) {
      const match = regex.exec(key);
      if (!match) continue;
      // With little fixed text ("{0} aula"), a value must be a number or a known interface
      // phrase — never arbitrary text such as a lesson title.
      if (
        strict &&
        !Object.values(match.groups || {}).every((v) => NUMBER.test(v) || phrases.has(v))
      )
        continue;
      // A value inside a pattern may itself be a known phrase ("Status: Concluída").
      return target.replace(/\{(\d+)\}/g, (_, n) => {
        const value = match.groups?.[`p${n}`] ?? '';
        return phrases.get(value) ?? value;
      });
    }
    return null;
  }
  /** Translated text keeping the original leading and trailing whitespace, or null. */
  function text(value) {
    const translated = phrase(value);
    if (translated === null) return null;
    const lead = /^\s*/.exec(value)[0];
    const trail = /\s*$/.exec(value)[0];
    return lead + translated + trail;
  }
  return { phrase, text, size: phrases.size + patterns.length };
}

function inUserContent(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return Boolean(element?.closest(USER_CONTENT));
}

/** Translates a subtree (text nodes, labelling attributes, button values) in place. */
export function translateTree(root, translator) {
  if (!root) return;
  if (root.nodeType === 3) {
    if (SKIPPED_TAGS.has(root.parentElement?.tagName) || inUserContent(root)) return;
    const next = translator.text(root.data);
    if (next !== null && next !== root.data) root.data = next;
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  const element = root.nodeType === 9 ? root.documentElement : root;
  if (SKIPPED_TAGS.has(element.tagName) || element.closest?.(USER_CONTENT)) return;
  const walker = (root.ownerDocument || root).createTreeWalker(element, 5 /* element + text */, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        if (node.matches(USER_CONTENT) || SKIPPED_TAGS.has(node.tagName)) return 2; // reject subtree
        return 1;
      }
      return 1;
    },
  });
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const next = translator.text(node.data);
      if (next !== null && next !== node.data) node.data = next;
      continue;
    }
    for (const name of ATTRIBUTES) {
      const value = node.getAttribute(name);
      if (!value) continue;
      const next = translator.phrase(value);
      if (next !== null && next !== value) node.setAttribute(name, next);
    }
    if (
      node.tagName === 'INPUT' &&
      ['button', 'submit', 'reset'].includes(node.type) &&
      node.value
    ) {
      const next = translator.phrase(node.value);
      if (next !== null) node.value = next;
    }
  }
}

/** Keeps translating what scripts add or change later. Returns the observer. */
export function observeTranslations(root, translator) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList')
        for (const node of record.addedNodes) translateTree(node, translator);
      else if (record.type === 'characterData') translateTree(record.target, translator);
      else if (record.type === 'attributes' && !inUserContent(record.target)) {
        const value = record.target.getAttribute(record.attributeName);
        const next = value && translator.phrase(value);
        if (next && next !== value) record.target.setAttribute(record.attributeName, next);
      }
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
  return observer;
}

/** Native dialogs carry interface text too. */
function wrapDialogs(translator) {
  for (const name of ['confirm', 'alert', 'prompt']) {
    const native = window[name];
    if (typeof native !== 'function' || native.vozTranslated) continue;
    const wrapped = (message, ...rest) =>
      native.call(window, translator.phrase(message) ?? message, ...rest);
    wrapped.vozTranslated = true;
    window[name] = wrapped;
  }
}

/** Loads the catalog for `locale`, translates the page and keeps it translated. */
export async function startPhraseTranslation(locale, doc = document) {
  try {
    if (locale === 'pt-BR') return null;
    const module = await import(`./phrases/${locale}.js`);
    const translator = createPhraseTranslator(module.default);
    translateTree(doc, translator);
    const title = doc.title.split(' | ').map((part) => translator.phrase(part) ?? part);
    doc.title = title.join(' | ');
    observeTranslations(doc.documentElement, translator);
    wrapDialogs(translator);
    return translator;
  } finally {
    doc.documentElement.removeAttribute('data-i18n-pending');
  }
}
