// Applies the interface language to the current page: keyed messages (data-i18n) and the phrase
// catalog for everything else. Imported by preferences.js; pages without it load this directly.
import { currentLocale, translateDocument } from './i18n.js';
import { startPhraseTranslation } from './phrases.js';

let started = null;
export function bootTranslations() {
  if (started) return started;
  translateDocument(document);
  started = startPhraseTranslation(currentLocale()).catch(() => {
    // A missing catalog leaves the page in Portuguese, never hidden.
    document.documentElement.removeAttribute('data-i18n-pending');
    return null;
  });
  return started;
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', () => void bootTranslations(), { once: true });
else void bootTranslations();
