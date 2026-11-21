// Flashcards 3.0 — visual templates, kept apart from the card's educational content.
// A template is a declarative look (CSS in flashcards.css keyed by data-card-template): it never
// changes the question, answer, source, authorship or review history, and choosing one never
// calls the server or the AI. The choice lives in the account's appearance preferences:
// a favourite template for every card, optionally overridden per set.
export const CARD_TEMPLATES = [
  ['classic', 'Clássico', 'Cartão branco, direto ao ponto.'],
  ['notebook', 'Caderno', 'Folha pautada com margem.'],
  ['sticky', 'Post-it', 'Papel colorido e fita adesiva.'],
  ['window', 'Janela', 'Uma janelinha com barra de título.'],
  ['polaroid', 'Polaroid', 'Moldura de foto com legenda.'],
];
const KEYS = CARD_TEMPLATES.map(([key]) => key);

/** The template for a card: the set's own choice, else the favourite, else Clássico. */
export function templateFor({ setId = null, preferences = {} } = {}) {
  const own = setId ? preferences.setTemplates?.[setId] : null;
  if (KEYS.includes(own)) return own;
  return KEYS.includes(preferences.cardTemplate) ? preferences.cardTemplate : 'classic';
}
