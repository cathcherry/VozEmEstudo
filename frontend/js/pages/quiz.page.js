import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getMaterial, answerQuestion } from '../api/material.api.js';
import { recordAnswer, visitMaterial } from '../utils/study-store.js';
import { emptyState } from '../utils/material-ui.js';

await initAuthenticatedShell();
const params = new URLSearchParams(location.search);
const materialId = params.get('material');
const batchId = params.get('batch');
const material = await getMaterial(materialId);
visitMaterial(materialId);
const batch = material.questionBatches?.find((b) => b.id === batchId) || material.questionBatches?.[0];

const main = document.querySelector('.quiz-session-main');
if (!batch?.questions?.length) {
  main.replaceChildren(emptyState('Nenhuma questão disponível.', 'Gere um lote na página da aula para iniciar a revisão.', { href: `./material.html?id=${encodeURIComponent(materialId)}#questoes`, action: 'Voltar ao material' }));
} else {
  const questions = batch.questions;
  const answered = new Map();
  let current = 0;
  const statement = document.querySelector('[data-quiz-statement]');
  const alternatives = document.querySelector('[data-quiz-alternatives]');
  const progressText = document.querySelector('[data-quiz-progress-text]');
  const progressBar = document.querySelector('[data-quiz-progress-bar]');
  const title = document.querySelector('[data-quiz-title]');
  const form = document.querySelector('[data-single-question-form]');
  const nextButton = document.querySelector('[data-next-question]');
  const previousButton = document.querySelector('[data-previous-question]');
  const message = document.querySelector('[data-quiz-message]');
  title.textContent = material.title;

  function render() {
    const question = questions[current];
    progressText.textContent = `Questão ${current + 1} de ${questions.length}`;
    progressBar.style.width = `${((current + 1) / questions.length) * 100}%`;
    statement.textContent = question.statement;
    alternatives.innerHTML = '';
    question.options.forEach((text, index) => {
      const label = document.createElement('label');
      label.className = 'quiz-answer-card';
      label.innerHTML = `<input type="radio" name="quiz-answer" value="${index}" required><span class="quiz-answer-letter">${String.fromCharCode(65 + index)}</span><span class="quiz-answer-text"></span>`;
      label.querySelector('.quiz-answer-text').textContent = text;
      alternatives.appendChild(label);
    });
    const prior = answered.get(question.id);
    message.textContent = '';
    if (prior) showFeedback(prior, false);
    nextButton.textContent = prior ? (current === questions.length - 1 ? 'Concluir' : 'Próxima questão') : 'Responder';
    previousButton.disabled = current === 0;
  }

  function showFeedback(result, selectCorrect = true) {
    const inputs = [...alternatives.querySelectorAll('input')];
    inputs.forEach((input) => { input.disabled = true; });
    if (selectCorrect) inputs[result.selectedIndex]?.closest('label')?.classList.add(result.correct ? 'answer-correct' : 'answer-incorrect');
    inputs[result.correctIndex]?.closest('label')?.classList.add('answer-correct');
    message.textContent = result.correct ? `Resposta correta.${result.explanation ? ` ${result.explanation}` : ''}` : `Resposta incorreta. A resposta prevista é ${String.fromCharCode(65 + result.correctIndex)}.${result.explanation ? ` ${result.explanation}` : ''}`;
    message.dataset.state = result.correct ? 'success' : 'error';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = questions[current];
    const prior = answered.get(question.id);
    if (prior) {
      if (current === questions.length - 1) location.href = `./material.html?id=${encodeURIComponent(materialId)}`;
      else { current += 1; render(); statement.focus(); }
      return;
    }
    const selected = alternatives.querySelector('input:checked');
    if (!selected) { message.textContent = 'Selecione uma alternativa.'; return; }
    try {
      nextButton.disabled = true;
      const result = await answerQuestion(question.id, Number(selected.value));
      const stored = { ...result, selectedIndex: Number(selected.value) };
      answered.set(question.id, stored);
      recordAnswer(materialId, question.id, result.correct);
      showFeedback(stored);
      nextButton.textContent = current === questions.length - 1 ? 'Concluir' : 'Próxima questão';
    } catch (error) { message.textContent = error.message; }
    finally { nextButton.disabled = false; }
  });

  previousButton.addEventListener('click', () => { if (current > 0) { current -= 1; render(); statement.focus(); } });
  document.querySelector('[data-leave-quiz]')?.addEventListener('click', () => { location.href = `./material.html?id=${encodeURIComponent(materialId)}`; });
  render();
}
