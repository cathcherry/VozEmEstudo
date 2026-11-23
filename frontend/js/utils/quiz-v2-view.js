// E10: browser view intentionally renders only server-provided feedback. Nothing here knows the
// answer key: correctness, the correct letter and the explanation exist only when the server
// released them (immediate mode, or after the attempt was concluded).

export const letter = (index) => String.fromCharCode(65 + index);

/**
 * "Sua resposta: C — 15". When older data has no text for the option, only the letter is shown
 * and the line says so, instead of inventing a text.
 */
export function answerLine(prefix, index, text) {
  if (!Number.isInteger(index) || index < 0) return `${prefix}: não disponível`;
  const clean = typeof text === 'string' ? text.trim() : '';
  return clean
    ? `${prefix}: ${letter(index)} — ${clean}`
    : `${prefix}: ${letter(index)} (texto da alternativa não disponível)`;
}

/**
 * Correction of one answered question, or null while the key is not released (deferred mode
 * before concluding): then the page shows no message at all, never a guess.
 */
export function feedbackForQuestion(result, options = []) {
  if (!result || !Object.hasOwn(result, 'correctIndex')) return null;
  const correct = result.correct === true;
  const lines = [answerLine('Sua resposta', result.selectedIndex, options[result.selectedIndex])];
  if (!correct)
    lines.push(answerLine('Resposta correta', result.correctIndex, options[result.correctIndex]));
  return {
    state: correct ? 'success' : 'error',
    icon: correct ? 'check' : 'close',
    title: correct ? 'Você acertou' : 'Resposta incorreta',
    lines,
    explanation: result.explanation || null,
    evidence: result.evidence || null,
  };
}

export function quizScore(answers) {
  return {
    correct: answers.filter((answer) => answer.correct === true).length,
    total: answers.length,
  };
}

export function firstUnanswered(questions, answers) {
  const submitted = new Set(answers.map((answer) => answer.questionId));
  return questions.findIndex((q) => !submitted.has(q.id));
}

/** The next question still without an answer after `current` (wrapping), or -1. */
export function nextUnanswered(questions, answers, current) {
  const submitted = new Set(answers.map((answer) => answer.questionId));
  for (let step = 1; step <= questions.length; step++) {
    const index = (current + step) % questions.length;
    if (!submitted.has(questions[index].id)) return index;
  }
  return -1;
}

/**
 * What the main button does on a question: save (and, at the end, advance), go on, or conclude.
 * `answered` is whether THIS question already has a saved answer.
 */
export function primaryAction({ mode, answered, isLast, remaining }) {
  if (!answered) {
    if (mode === 'immediate') return { action: 'save', label: 'Confirmar resposta' };
    // `remaining` counts unanswered questions including this one.
    return remaining > 1
      ? { action: 'save', label: 'Salvar e avançar' }
      : { action: 'save', label: 'Salvar resposta' };
  }
  if (remaining === 0) return { action: 'finish', label: 'Concluir tentativa' };
  if (!isLast) return { action: 'next', label: 'Próxima questão' };
  return { action: 'pending', label: 'Ir para a próxima sem resposta' };
}

/**
 * Whether a successful save in end-feedback mode should move on by itself: only when the
 * answer that was just saved belongs to the question on screen and another one is waiting.
 */
export function shouldAutoAdvance({ mode, saved, target }) {
  return mode === 'deferred' && saved === true && Number.isInteger(target) && target >= 0;
}
