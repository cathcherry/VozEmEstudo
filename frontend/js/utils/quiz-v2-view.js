// E10: browser view intentionally renders only server-provided feedback.
export function feedbackForQuestion(result) {
  if (!result) return '';
  if (!Object.hasOwn(result, 'correctIndex'))
    return 'Resposta registrada. O gabarito será apresentado ao concluir.';
  const explanation = result.explanation ? ` ${result.explanation}` : '';
  if (result.correct) return `Resposta correta.${explanation}`;
  return `Resposta incorreta. A resposta prevista é ${String.fromCharCode(65 + result.correctIndex)}.${explanation}`;
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
