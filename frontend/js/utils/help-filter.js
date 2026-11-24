// Ajuda: which topics match a search. Accents and case are ignored ("sessao" finds "sessão"),
// every word must appear (in any order), and an empty search shows everything.

/** Lower case, without accents, single spaces. */
export function normalizeSearch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ids of the topics ({ id, text }) whose text contains every word of the query. */
export function filterTopics(topics, query) {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  return topics
    .filter(({ text }) => {
      const haystack = normalizeSearch(text);
      return words.every((word) => haystack.includes(word));
    })
    .map(({ id }) => id);
}
