import { AppError } from '../domain/errors.js';

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
        explanation: answer.explanation || null,
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
    interpretation: 'Desempenho medido pelo gabarito gerado; não é avaliação clínica, diagnóstica ou de domínio do assunto.',
  };
}
