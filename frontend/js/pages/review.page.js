// Revisar: flashcards (review, create, organise, sets), question attempts and annotations. Since
// 3.6 today's work comes first (review-layout.js): counts on the tabs, a "para hoje" line, and the
// flashcard tools in a compact toolbar and a "Gerenciar" view.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listMaterials } from '../api/material.api.js';
import { initToolTabs, showToolFailure } from '../utils/tool-tabs.js';
import { emptyState } from '../utils/material-ui.js';
import { initFlashcardsPanel } from './flashcards-panel.js';
import { initFlashcardsV3 } from './flashcards-v3-ui.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initQuizHistoryPanel } from './quiz-history-panel.js';
import { initQuestionReportsPanel } from './question-reports-panel.js';
import { initReviewToday, composeFlashcards } from './review-layout.js';

await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
const sections = [
  ['flashcards', flags.flashcards],
  ['questoes', flags.quiz_v2],
  ['anotacoes', flags.annotations],
]
  .filter(([, enabled]) => enabled)
  .map(([id]) => id);
const askedFor = location.hash.slice(1);
const tabs = initToolTabs(document.querySelector('[data-tool-tabs]'), sections);
const today = sections.length ? initReviewToday({ tabs, chooseTab: !askedFor }) : null;

if (!sections.length) {
  const unavailable = document.querySelector('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(
    emptyState(
      'A revisão ainda não está ativa',
      'Flashcards, questões e anotações aparecem aqui.',
      { href: './historico.html', action: 'Abrir a Biblioteca', mascot: 'rest' },
    ),
  );
} else {
  const materials = await listMaterials().catch(() => []);
  const params = new URLSearchParams(location.search);
  const loads = [];
  if (flags.flashcards)
    loads.push(
      initFlashcardsPanel({ materials }).then(async () => {
        if (flags.flashcards_v3 && flags.flashcard_sets)
          await initFlashcardsV3({ panel: document.querySelector('[data-flashcards-panel]') }).catch(() => {});
        composeFlashcards(document.querySelector('[data-flashcards-panel]'));
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
  if (flags.quiz_v2) {
    loads.push(initQuizHistoryPanel({ materials }));
    void initQuestionReportsPanel({ section: document.querySelector('[data-question-reports]'), materials });
  }
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
  // Tools load in the same order as their tabs (`sections`).
  results.forEach((result, index) => {
    if (result.status === 'rejected')
      showToolFailure(sections[index], 'Esta seção não pôde ser carregada agora.', result.reason);
  });
  // Tools that are off or failed have nothing waiting today.
  for (const id of ['flashcards', 'questoes', 'anotacoes']) today?.settle(id);
  if (params.has('acao') || params.has('busca'))
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
}
