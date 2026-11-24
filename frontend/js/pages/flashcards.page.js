// Flashcards (3.6): an area of its own, replacing the flashcard part of the old Revisar page.
// Six sections in one tab row: Revisar cartões (today's queue, the default), Conjuntos, Criar
// cartão, Gerar com IA, Importar e mesclar and Aparência. flashcards-panel.js builds the tools
// and puts each in its section; this module owns the sections, the address and the counts.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { listMaterials } from '../api/material.api.js';
import { listQuizSessions } from '../api/quiz-session.api.js';
import { initToolTabs, showToolFailure } from '../utils/tool-tabs.js';
import { emptyState } from '../utils/material-ui.js';
import { initFlashcardsPanel } from './flashcards-panel.js';
import { initFlashcardsV3 } from './flashcards-v3-ui.js';

export const FLASHCARD_SECTIONS = ['revisar', 'conjuntos', 'criar', 'gerar', 'importar', 'aparencia'];

await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
const panel = document.querySelector('[data-flashcards-panel]');
const params = new URLSearchParams(location.search);

if (!flags.flashcards) {
  const unavailable = document.querySelector('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(
    emptyState(
      'Os flashcards ainda não estão ativos',
      'A revisão de cartões aparece aqui quando o recurso for ativado neste servidor.',
      { href: './historico.html', action: 'Abrir a Biblioteca', mascot: 'rest' },
    ),
  );
} else {
  // Old addresses (#flashcards from Revisar) open the review.
  if (location.hash === '#flashcards') history.replaceState(null, '', `${location.search}#revisar`);
  // Merging and importing come with sets (FEATURE_FLASHCARD_SETS); everything else is always here.
  const sections = FLASHCARD_SECTIONS.filter((id) => id !== 'importar' || flags.flashcard_sets);
  const tabs = initToolTabs(document.querySelector('[data-tool-tabs]'), sections);
  // The tools ask for a section (a suggestion to edit, a set to review, "Revisar agora").
  document.addEventListener('voz:flashcards-section', (event) => {
    const section = event.detail?.section;
    if (sections.includes(section)) tabs.select(section);
  });
  // Cards waiting today, on the "Revisar cartões" tab (a filtered queue does not change it).
  const reviewTab = document.querySelector('#tab-revisar');
  const badge = document.createElement('span');
  badge.className = 'tool-tab-count';
  badge.hidden = true;
  badge.setAttribute('aria-hidden', 'true');
  reviewTab?.append(badge);
  document.addEventListener('voz:flashcards', (event) => {
    if (event.detail?.filtered || event.detail?.error) return;
    const due = Number(event.detail?.dueTotal) || 0;
    badge.hidden = !due;
    badge.textContent = due ? String(due) : '';
    reviewTab?.setAttribute('aria-label', due ? `Revisar cartões, ${due} para hoje` : 'Revisar cartões');
  });

  const materials = await listMaterials().catch(() => []);
  try {
    await initFlashcardsPanel({ materials });
    if (flags.flashcards_v3 && flags.flashcard_sets) await initFlashcardsV3({ panel }).catch(() => {});
  } catch (error) {
    showToolFailure('revisar', 'Os flashcards não puderam ser carregados agora.', error);
  }
  // "?acao=revisar" / "?acao=criar" (Início's shortcuts, old Revisar links): the section, with focus.
  const action = params.get('acao');
  if (action === 'revisar' || action === 'criar') {
    tabs.select(action);
    document.dispatchEvent(
      new CustomEvent('voz:flashcards-command', { detail: { action: action === 'revisar' ? 'review' : 'create' } }),
    );
    params.delete('acao');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }

  // Question attempts left open live with the questions; a quiet way there from here.
  if (flags.quiz_v2)
    void listQuizSessions()
      .then((sessions) => {
        const open = (sessions || []).filter((session) => session.status !== 'completed').length;
        const link = document.querySelector('[data-flashcards-quiz-link]');
        if (!link || !open) return;
        link.textContent = open === 1 ? '1 lista de questões em andamento' : `${open} listas de questões em andamento`;
        link.hidden = false;
      })
      .catch(() => { /* optional */ });
}
