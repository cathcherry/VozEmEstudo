// Interface language (pt-BR, en, es, zh-CN). Only the interface is translated: transcripts,
// summaries, questions, lesson titles, notes and anything a person typed are never touched.
// The interface language is independent of the recording/AI language chosen for a lesson.
//
// Portuguese is the source and the fallback: in pt-BR nothing on the page is rewritten, and a
// message missing in another language falls back to Portuguese (then to the key itself).
// Pages mark text with data-i18n="key" (text) and data-i18n-attr="aria-label:key;title:key";
// elements repeated in every page (navigation, footer) are matched centrally by SHARED below.
import ptBR from './locales/pt-BR.js';
import en from './locales/en.js';
import es from './locales/es.js';
import zhCN from './locales/zh-CN.js';

export const LOCALES = Object.freeze({
  'pt-BR': { label: 'Português (Brasil)', messages: ptBR },
  en: { label: 'English', messages: en },
  es: { label: 'Español', messages: es },
  'zh-CN': { label: '简体中文', messages: zhCN },
});
export const DEFAULT_LOCALE = 'pt-BR';

export function currentLocale() {
  const value = typeof document === 'undefined' ? '' : document.documentElement.dataset.language;
  return Object.hasOwn(LOCALES, value) ? value : DEFAULT_LOCALE;
}

const pluralRules = new Map();
function pluralForm(locale, count) {
  // CLDR treats 0 as singular in pt-BR; the app has always written "0 aulas".
  if (locale === 'pt-BR') return count === 1 ? 'one' : 'other';
  if (!pluralRules.has(locale)) pluralRules.set(locale, new Intl.PluralRules(locale));
  return pluralRules.get(locale).select(count);
}

function lookup(locale, key, count) {
  const entry = LOCALES[locale]?.messages[key];
  if (entry === undefined) return undefined;
  if (typeof entry === 'string') return entry;
  // Plural messages: { one, other } (and any other CLDR category a language needs).
  return entry[pluralForm(locale, Number(count) || 0)] ?? entry.other;
}

/**
 * Translates `key` for the current interface language. `params` fill {name} placeholders; a
 * numeric `count` also chooses the plural form.
 */
export function t(key, params = {}, locale = currentLocale()) {
  const message =
    lookup(locale, key, params.count) ?? lookup(DEFAULT_LOCALE, key, params.count) ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined || params[name] === null ? match : String(params[name]),
  );
}

/** BCP 47 tag for dates, numbers and sorting in the interface language. */
export const intlLocale = () => currentLocale();

/** Every key of the Portuguese source that `locale` lacks (used by tests and reviews). */
export function missingKeys(locale) {
  const messages = LOCALES[locale]?.messages || {};
  return Object.keys(ptBR).filter((key) => {
    const source = ptBR[key];
    const target = messages[key];
    if (target === undefined) return true;
    return typeof source === 'object' && (typeof target !== 'object' || target.other === undefined);
  });
}

// Elements present in every page, translated by their Portuguese text (their markup is repeated
// across the HTML files, so they carry no attributes). [selector, attribute or null].
const SHARED = [
  ['.primary-navigation a > span', null],
  ['.sidebar-settings a > span', null],
  ['.topbar-title > span', null],
  ['.skip-link', null],
  ['.site-footer a', null],
  ['.account-link > span:last-child:not(.user-initials)', null],
  ['[data-menu-toggle]', 'aria-label'],
  ['[data-sidebar-close]', 'aria-label'],
  ['[data-menu-backdrop]', 'aria-label'],
  ['.appearance-shortcut', 'aria-label'],
  ['.appearance-shortcut', 'title'],
  ['.primary-navigation', 'aria-label'],
  ['.side-navigation', 'aria-label'],
  ['.account-link', 'aria-label'],
];
let reverse = null;
function keyForText(text) {
  if (!reverse) {
    reverse = new Map();
    for (const [key, value] of Object.entries(ptBR))
      if (typeof value === 'string' && !reverse.has(value)) reverse.set(value, key);
  }
  return reverse.get(String(text).trim());
}

/** Applies the interface language to `root`. Does nothing in Portuguese (the source text). */
export function translateDocument(root = document) {
  const locale = currentLocale();
  if (locale === DEFAULT_LOCALE) return;
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-attr]'))
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (attribute && key) node.setAttribute(attribute, t(key));
    }
  for (const [selector, attribute] of SHARED)
    for (const node of root.querySelectorAll(selector)) {
      const source = attribute ? node.getAttribute(attribute) : node.textContent;
      const key = source && keyForText(source);
      if (!key) continue;
      if (attribute) node.setAttribute(attribute, t(key));
      else node.textContent = t(key);
    }
  root.documentElement?.setAttribute('lang', locale);
}
