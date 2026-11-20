// Revisar: flashcards (review, create, organise, sets), question attempts and annotations.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listMaterials } from '../api/material.api.js';
import { initToolTabs } from '../utils/tool-tabs.js';
import { emptyState } from '../utils/material-ui.js';
import { initFlashcardsPanel } from './flashcards-panel.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initQuizHistoryPanel } from './quiz-history-panel.js';

await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
const sections = [
  ['flashcards', flags.flashcards],
  ['questoes', flags.quiz_v2],
  ['anotacoes', flags.annotations],
]
  .filter(([, enabled]) => enabled)
  .map(([id]) => id);
const tabs = initToolTabs(document.querySelector('[data-tool-tabs]'), sections);

if (!sections.length) {
  const unavailable = document.querySelector('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(
    emptyState(
      'A revisão ainda não está ativa',
      'Flashcards, tentativas de questões e anotações aparecem aqui quando forem ativados neste servidor.',
      { href: './historico.html', action: 'Abrir a Biblioteca', mascot: 'rest' },
    ),
  );
} else {
  const materials = await listMaterials().catch(() => []);
  const params = new URLSearchParams(location.search);
  const loads = [];
  if (flags.flashcards)
    loads.push(
      initFlashcardsPanel({ materials }).then(() => {
        const action = params.get('acao');
        if (action === 'revisar' || action === 'criar') {
          tabs.select('flashcards');
          document.dispatchEvent(
            new CustomEvent('voz:flashcards-command', {
              detail: { action: action === 'revisar' ? 'review' : 'create' },
            }),
          );
        }
      }),
    );
  if (flags.quiz_v2) loads.push(initQuizHistoryPanel({ materials }));
  if (flags.annotations)
    loads.push(
      initAnnotationsPanel({
        panel: document.querySelector('[data-note-search-panel]'),
        materials,
      }).then(() => {
        const query = params.get('busca');
        if (query) {
          tabs.select('anotacoes');
          document.dispatchEvent(
            new CustomEvent('voz:notes-command', { detail: { action: 'search', q: query } }),
          );
        }
      }),
    );
  const results = await Promise.allSettled(loads);
  for (const result of results)
    if (result.status === 'rejected')
      console.warn('Ferramenta de revisão indisponível:', result.reason);
  if (params.has('acao') || params.has('busca'))
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
}
