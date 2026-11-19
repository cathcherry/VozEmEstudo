// CSV for importing into other flashcard applications (e.g. Anki "Importar arquivo", Quizlet).
// Schema (UTF-8, comma-separated, CRLF, RFC 4180 quoting, header row):
//   front, back, set, lesson, difficulty, focus, style, source_revision_id, evidence
// Map "front"/"back" to the two card fields; the other columns are optional metadata.
export const FLASHCARD_CSV_COLUMNS = Object.freeze([
  'front',
  'back',
  'set',
  'lesson',
  'difficulty',
  'focus',
  'style',
  'source_revision_id',
  'evidence',
]);

/** Quotes every cell and neutralises spreadsheet formulas (=, +, -, @, tab, CR) with a leading apostrophe. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toFlashcardCsv(sets, { lesson = '' } = {}) {
  const rows = [FLASHCARD_CSV_COLUMNS.join(',')];
  for (const set of sets)
    for (const card of set.cards || [])
      rows.push(
        [
          card.front_text,
          card.back_text,
          set.name,
          lesson,
          card.difficulty,
          card.focus,
          card.card_style,
          card.source_revision_id ?? set.source_revision_id ?? '',
          card.evidence,
        ]
          .map(csvCell)
          .join(','),
      );
  // A BOM lets spreadsheet programs detect UTF-8 accents correctly.
  return '﻿' + rows.join('\r\n') + '\r\n';
}
