import { getQuizDiagnostic, createQuizReviewSession } from '../api/quiz-session.api.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { answerLine } from '../utils/quiz-v2-view.js';
import { icon } from '../utils/icons.js';

/** Icon + word: correctness never depends on colour alone. */
function mark(name, text, className) {
  const node = document.createElement('span');
  if (className) node.className = className;
  const glyph = document.createElement('span');
  glyph.className = 'quiz-icon';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.append(icon(name, { size: 18 }));
  const label = document.createElement('span');
  label.textContent = text;
  node.append(glyph, label);
  return node;
}

/**
 * E11/E12: display a descriptive score and optionally start a new session
 * referencing only the mistakes in a completed attempt. Never infer results.
 */
// A completed attempt never changes: one request per attempt while the page is open, instead of
// one on every Anterior/Próxima. Failures are not kept, so a later render tries again.
const diagnostics = new Map();
export function loadDiagnostic(sessionId, fetcher = getQuizDiagnostic) {
  if (!diagnostics.has(sessionId))
    diagnostics.set(
      sessionId,
      fetcher(sessionId).catch((error) => {
        diagnostics.delete(sessionId);
        throw error;
      }),
    );
  return diagnostics.get(sessionId);
}

export async function renderQuizDiagnosticPanel({ parent, session, materialId, batchId }) {
  if (session.status !== 'completed') return;
  const section = document.createElement('section');
  section.className = 'quiz-v2-diagnostic';
  section.setAttribute('aria-label', 'Resultado');
  const status = document.createElement('p');
  status.className = 'quiz-score';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Carregando o resultado…';
  section.append(status);
  parent.append(section);

  try {
    const diagnostic = await loadDiagnostic(session.id);
    if (!section.isConnected) return;
    if (diagnostic.sessionId !== session.id)
      throw new Error('O diagnóstico não corresponde à tentativa.');
    const score = document.createElement('strong');
    score.className = 'quiz-score-value';
    score.textContent = `${diagnostic.correct} de ${diagnostic.total}`;
    const words = document.createElement('span');
    words.textContent = ` ${diagnostic.correct === 1 ? 'acerto' : 'acertos'} (${diagnostic.percent}%) · ${diagnostic.incorrect} ${diagnostic.incorrect === 1 ? 'erro' : 'erros'}`;
    status.replaceChildren(score, words);

    // One short line of context (from the server), not a disclaimer block.
    const interpretation = document.createElement('p');
    interpretation.className = 'quiz-v2-note';
    interpretation.textContent = diagnostic.interpretation;
    section.append(interpretation);

    if (!diagnostic.incorrect) {
      const success = document.createElement('p');
      success.className = 'quiz-all-right';
      success.append(mark('check', 'Você acertou todas as questões desta tentativa.'));
      section.append(success);
      return;
    }

    const subtitle = document.createElement('h2');
    subtitle.textContent = 'Questões para retomar';
    const list = document.createElement('ol');
    list.className = 'quiz-v2-errors';
    for (const item of diagnostic.toReview) {
      const entry = document.createElement('li');
      const statement = document.createElement('strong');
      statement.textContent = item.statement;
      entry.append(statement, mark('close', 'Errou', 'quiz-review-mark'));
      for (const line of [
        answerLine('Sua resposta', item.selectedIndex, item.selectedText),
        answerLine('Resposta correta', item.correctIndex, item.correctText),
      ]) {
        const p = document.createElement('p');
        p.textContent = line;
        entry.append(p);
      }
      if (item.explanation) {
        const explanation = document.createElement('p');
        explanation.className = 'quiz-v2-explanation';
        explanation.textContent = item.explanation;
        entry.append(explanation);
      }
      if (item.evidence) {
        const source = document.createElement('figure');
        source.className = 'quiz-evidence';
        const caption = document.createElement('figcaption');
        caption.append(mark('quote', 'Trecho da aula'));
        const quote = document.createElement('blockquote');
        quote.textContent = item.evidence;
        source.append(caption, quote);
        entry.append(source);
      }
      list.append(entry);
    }
    section.append(subtitle, list);
    if (!(await isFeatureEnabled('quiz_review'))) return;
    if (!section.isConnected) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-action';
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
    if (section.isConnected)
      status.textContent = error.message || 'Não foi possível carregar o resultado.';
  }
}
