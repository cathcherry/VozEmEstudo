export const FLASHCARD_RATINGS = Object.freeze([
  { value: 0, label: 'De novo', detail: 'Rever em 10 minutos' },
  { value: 1, label: 'Difícil', detail: 'Rever em breve' },
  { value: 2, label: 'Bom', detail: 'Espaçar a revisão' },
  { value: 3, label: 'Fácil', detail: 'Intervalo maior' },
]);

export function formatFlashcardDue(isoDate) {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.valueOf())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function flashcardSummary(count) {
  return count === 1 ? '1 cartão para revisar' : `${count} cartões para revisar`;
}
