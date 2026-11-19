import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getPublicConfig } from '../api/config.js';
import { describeProcessing, providerPolicies } from '../utils/processing-disclosure.js';
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
