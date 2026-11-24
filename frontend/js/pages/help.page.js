// Ajuda and Privacidade (both pages load this module).
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getPublicConfig } from '../api/config.js';
import { describeProcessing, providerPolicies } from '../utils/processing-disclosure.js';
import { filterTopics } from '../utils/help-filter.js';
import { startTourFromAnywhere } from '../utils/guided-tour.js';
await initAuthenticatedShell();

// The privacy page names the providers of the active AI configuration, not a fixed list.
const disclosureNode = document.querySelector('[data-provider-disclosure]');
if (disclosureNode) {
  try {
    const disclosure = (await getPublicConfig()).processingDisclosure;
    if (disclosure) {
      disclosureNode.textContent = describeProcessing(disclosure);
      const policies = document.querySelector('[data-provider-policies]');
      if (policies) {
        const links = [
          ...providerPolicies(disclosure),
          { name: 'Supabase', href: 'https://supabase.com/privacy' },
        ].map(({ name, href }) =>
          Object.assign(document.createElement('a'), { href, textContent: name }),
        );
        policies.replaceChildren(...links.flatMap((link, i) => (i ? [' · ', link] : [link])));
      }
    }
  } catch {
    /* Keep the generic, provider-neutral text when configuration is unavailable. */
  }
}

document
  .querySelectorAll('[data-start-tour]')
  .forEach((button) => button.addEventListener('click', () => startTourFromAnywhere()));

// ---- Ajuda: the topics filter as you type; the index and the sections follow ---------------
const filter = document.querySelector('#help-filter');
if (filter) {
  const topics = [...document.querySelectorAll('.help-topic')];
  const links = [...document.querySelectorAll('[data-help-index] a')];
  const status = document.querySelector('[data-help-status]');
  const empty = document.querySelector('[data-help-empty]');
  let timer;
  const apply = () => {
    const query = filter.value;
    // The text as shown (already translated in other languages), so the search follows it.
    const shown = new Set(
      filterTopics(
        topics.map((node) => ({ id: node.id, text: node.textContent })),
        query,
      ),
    );
    for (const node of topics) node.hidden = !shown.has(node.id);
    for (const link of links) link.closest('li').hidden = !shown.has(link.hash.slice(1));
    empty.hidden = shown.size > 0;
    status.textContent = !query.trim()
      ? ''
      : shown.size === 1
        ? '1 tópico encontrado'
        : `${shown.size} tópicos encontrados`;
  };
  filter.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  });
  document.querySelector('[data-help-search]').addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
    // Enter goes to the first topic found.
    const first = topics.find((node) => !node.hidden);
    if (first && filter.value.trim()) {
      first.setAttribute('tabindex', '-1');
      first.focus();
    }
  });
  filter.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filter.value) {
      event.preventDefault();
      filter.value = '';
      apply();
    }
  });
  // ?q=… prefills the search (e.g. a link from another page).
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    filter.value = initial;
    apply();
  }
}
