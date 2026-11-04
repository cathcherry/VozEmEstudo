import { getQuizDiagnostic, createQuizReviewSession } from '../api/quiz-session.api.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';

/**
 * E11/E12: display a descriptive score and optionally start a new session
 * referencing only the mistakes in a completed attempt. Never infer results.
 */
export async function renderQuizDiagnosticPanel({ parent, session, materialId, batchId }) {
  if (session.status !== 'completed') return;
  const section = document.createElement('section');
  section.className = 'quiz-v2-diagnostic';
  section.setAttribute('aria-label', 'Diagnóstico da tentativa');
  const heading = document.createElement('h2');
  heading.textContent = 'Resultado e revisão';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Carregando o diagnóstico…';
  section.append(heading, status);
  parent.append(section);

  try {
    const diagnostic = await getQuizDiagnostic(session.id);
    if (!section.isConnected) return;
    if (diagnostic.sessionId !== session.id) throw new Error('O diagnóstico não corresponde à tentativa.');
    status.textContent = `${diagnostic.correct} de ${diagnostic.total} acertos (${diagnostic.percent}%). ${diagnostic.incorrect} ${diagnostic.incorrect === 1 ? 'erro' : 'erros'}.`;

    const interpretation = document.createElement('p');
    interpretation.className = 'quiz-v2-note';
    interpretation.textContent = diagnostic.interpretation;
    section.append(interpretation);

    if (!diagnostic.incorrect) {
      const success = document.createElement('p');
      success.textContent = 'Nenhuma questão incorreta para revisar nesta tentativa.';
      section.append(success);
      return;
    }

    const subtitle = document.createElement('h3');
    subtitle.textContent = 'Questões para retomar';
    const list = document.createElement('ol');
    list.className = 'quiz-v2-errors';
    for (const item of diagnostic.toReview) {
      const entry = document.createElement('li');
      const statement = document.createElement('strong');
      statement.textContent = item.statement;
      const answer = document.createElement('p');
      answer.textContent = `Sua escolha: ${String.fromCharCode(65 + item.selectedIndex)}. Gabarito: ${String.fromCharCode(65 + item.correctIndex)}.`;
      entry.append(statement, answer);
      if (item.explanation) {
        const explanation = document.createElement('p');
        explanation.textContent = item.explanation;
        entry.append(explanation);
      }
      list.append(entry);
    }
    section.append(subtitle, list);
    if (!(await isFeatureEnabled('quiz_review'))) return;
    if (!section.isConnected) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-action';
    button.textContent = 'Refazer apenas as questões erradas';
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      button.disabled = true;
      notice.textContent = 'Preparando a revisão…';
      try {
        const review = await createQuizReviewSession(session.id, 'deferred');
        const target = new URL('./responder.html', window.location.href);
        target.searchParams.set('material', materialId);
        target.searchParams.set('batch', batchId);
        target.searchParams.set('session', review.id);
        window.location.assign(target.toString());
      } catch (error) {
        notice.textContent = error.message || 'Não foi possível começar a revisão.';
        button.disabled = false;
      }
    });
    section.append(button, notice);
  } catch (error) {
    if (section.isConnected) status.textContent = error.message || 'Não foi possível carregar o diagnóstico.';
  }
}
