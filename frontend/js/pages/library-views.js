import { getLibraryResources } from '../api/catalog.api.js';
import { groupLibraryResources } from '../utils/library-views.js';
import { setStatus } from '../utils/shell.js';

/** Visible only when the server's catalog feature flag was enabled. */
export function initLibraryViewSwitcher({ onChange }) {
  const switcher = document.querySelector('[data-library-view-switch]');
  const status = document.querySelector('[data-library-view-status]');
  if (!switcher || !status) return null;

  const lessons = switcher.querySelector('input[value="lessons"]');
  const resources = switcher.querySelector('input[value="resources"]');
  let availability = null;
  let busy = false;
  switcher.hidden = false;

  switcher.addEventListener('change', async (event) => {
    if (event.target !== lessons && event.target !== resources) return;
    if (busy) return;
    if (lessons.checked) {
      setStatus(status, '');
      onChange();
      return;
    }
    if (availability === null) {
      busy = true;
      lessons.disabled = true;
      resources.disabled = true;
      setStatus(status, 'Carregando os recursos disponíveis…');
      try {
        availability = await getLibraryResources();
      } catch (error) {
        resources.checked = false;
        lessons.checked = true;
        setStatus(
          status,
          error.message || 'Não foi possível carregar os recursos. A visualização por aula continua disponível.',
          'error',
        );
      } finally {
        busy = false;
        lessons.disabled = false;
        resources.disabled = false;
      }
    } else setStatus(status, '');
    onChange();
  });

  return {
    isResourceView: () => resources.checked && availability !== null,
    groupsFor: (materials) => groupLibraryResources(materials, availability || {}),
    invalidate: () => {
      availability = null;
      lessons.checked = true;
      resources.checked = false;
      setStatus(status, '');
      onChange();
    },
  };
}
