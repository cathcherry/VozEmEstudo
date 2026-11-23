import { AppError } from '../domain/errors.js';

function optionText(question, index) {
  const text = Array.isArray(question.options) ? question.options[index] : null;
  return typeof text === 'string' && text.trim() ? text : null;
}

/** E11: descriptive analysis of the generated answer key, never an LLM diagnosis. */
export function buildQuizDiagnostic(payload) {
  const { session, questions, answers } = payload;
  if (session?.status !== 'completed')
    throw new AppError('QUIZ_DIAGNOSTIC_LOCKED', 'Conclua a tentativa antes de ver o diagnóstico.', 409);

  if (!Array.isArray(questions) || !Array.isArray(answers) || questions.length === 0 ||
    answers.length !== questions.length)
    throw new AppError('QUIZ_DIAGNOSTIC_UNAVAILABLE', 'Os resultados da tentativa estão incompletos.', 409);

  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const review = [];
  let correct = 0;
  for (const question of questions) {
    const answer = byQuestion.get(question.id);
    if (!answer || !Number.isInteger(answer.correctIndex) ||
      !Number.isInteger(answer.selectedIndex))
      throw new AppError('QUIZ_DIAGNOSTIC_UNAVAILABLE', 'O gabarito desta tentativa ainda não está disponível.', 409);
    if (answer.selectedIndex === answer.correctIndex) {
      correct++;
    } else {
      review.push({
        questionId: question.id,
        position: question.position,
        statement: question.statement,
        selectedIndex: answer.selectedIndex,
        correctIndex: answer.correctIndex,
        // Option text as stored with the question; null (never a guess) when it is missing.
        selectedText: optionText(question, answer.selectedIndex),
        correctText: optionText(question, answer.correctIndex),
        explanation: answer.explanation || null,
        evidence: answer.evidence || null,
      });
    }
  }
  const total = questions.length;
  return {
    sessionId: session.id,
    materialId: session.material_id,
    total,
    correct,
    incorrect: total - correct,
    percent: Math.round(correct * 100 / total),
    toReview: review,
    interpretation: 'Resultado conferido com o gabarito gerado automaticamente.',
  };
}
