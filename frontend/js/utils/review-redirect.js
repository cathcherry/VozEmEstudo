// Revisar (revisar.html) was retired in 3.6: Flashcards got their own page, question attempts live
// with the questions, and notes are found in the lesson and in the global search. Old links and
// bookmarks still work: each one lands where that part now lives, keeping what it asked for.

/**
 * Where an old Revisar address goes now.
 * @param {string} search  location.search of the old address ("?conjunto=…&acao=criar")
 * @param {string} hash    location.hash of the old address ("#flashcards", "#questoes", "#anotacoes")
 * @returns {string} relative address of the new page
 */
export function reviewRedirectTarget(search = '', hash = '') {
  const params = new URLSearchParams(search);
  const section = String(hash).replace(/^#/, '');
  if (section === 'questoes') return './questoes.html';
  if (section === 'anotacoes') {
    // A search for notes runs in the global search (on Início); without one, every note is listed there.
    const query = String(params.get('busca') || '').trim();
    const next = new URLSearchParams(query.length >= 2 ? { busca: query.slice(0, 100), em: 'notes' } : { em: 'notes' });
    return `./painel.html?${next}`;
  }
  // #flashcards, no section or an unknown one: the Flashcards page, on the same set and action.
  const next = new URLSearchParams();
  const set = params.get('conjunto');
  if (set) next.set('conjunto', set);
  const action = params.get('acao');
  const target = action === 'criar' ? 'criar' : 'revisar';
  const query = next.toString();
  return `./flashcards.html${query ? `?${query}` : ''}#${target}`;
}
