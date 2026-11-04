import {
  createQuizSession, getQuizSession, submitQuizAnswer, finishQuizSession,
  listQuizSessions, createReviewQuizSession,
} from '../api/quiz-session.api.js';
import { feedbackForQuestion, quizScore, firstUnanswered } from '../utils/quiz-v2-view.js';
import { emptyState } from '../utils/material-ui.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export async function runQuizV2({ main, material, materialId, batch, sessionId: resumedSessionId }) {
  main.dataset.quizV2 = 'true';
  const returnLink = `./material.html?id=${encodeURIComponent(materialId)}#questoes`;
  if (!batch?.questions?.length && !resumedSessionId) {
    main.replaceChildren(emptyState(
      'Nenhuma questão disponível.', 'Gere um lote para começar uma tentativa.',
      { href: returnLink, action: 'Voltar ao material' },
    ));
    return;
  }

  let sessionData = null;
  let current = 0;
  let busy = false;
  const reviewEnabled = await isFeatureEnabled('quiz_review');

  function showFailure(error) {
    main.replaceChildren();
    const box = el('section', null, 'quiz-question-card');
    box.append(el('h1', 'Não foi possível abrir a tentativa.'));
    box.append(el('p', error.message || 'Ocorreu um erro ao carregar as questões.'));
    const link = el('a', 'Voltar ao material', 'secondary-action button-link');
    link.href = returnLink;
    box.append(link);
    main.append(box);
  }

  function renderStart() {
    const card = el('section', null, 'quiz-question-card');
    const heading = el('h1', 'Escolha como deseja responder');
    const description = el('p', 'As respostas serão salvas na sua conta. Depois de concluir, você poderá revisar seus erros.');
    const form = el('form');
    const fieldset = el('fieldset', null, 'quiz-v2-choice');
    const legend = el('legend', 'Quando deseja receber o feedback?');
    fieldset.append(legend);
    for (const [mode, labelText] of [
      ['immediate', 'Após cada questão'],
      ['deferred', 'Somente ao finalizar a lista'],
    ]) {
      const label = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'feedbackMode';
      radio.value = mode;
      radio.required = true;
      if (mode === 'deferred') radio.checked = true;
      label.append(radio, el('span', labelText));
      fieldset.append(label);
    }
    const message = el('p', '', 'quiz-selection-message');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const button = el('button', 'Começar tentativa', 'primary-action');
    button.type = 'submit';
    form.append(fieldset, message, button);
    card.append(heading, description, form);
    main.replaceChildren(card);
    // A compact entry to resume recent attempts, not a duplicated question bank.
    void listQuizSessions().then((sessions) => {
      if (sessionData) return;
      const previous = sessions.filter((item) => item.material_id === materialId).slice(0, 8);
      if (!previous.length) return;
      const history = el('section', null, 'quiz-v2-history');
      history.append(el('h2', 'Tentativas anteriores'));
      const list = el('ul');
      for (const item of previous) {
        const row = el('li');
        const link = el('a',
          `${item.status === 'completed' ? 'Concluída' : 'Em andamento'} · ${item.kind === 'review' ? 'Revisão de erros' : 'Lista completa'} · ${new Date(item.created_at).toLocaleDateString('pt-BR')}`,
        );
        link.href = `./responder.html?material=${encodeURIComponent(materialId)}&batch=${encodeURIComponent(item.batch_id)}&session=${encodeURIComponent(item.id)}`;
        row.append(link);
        list.append(row);
      }
      history.append(list);
      card.append(history);
    }).catch(() => {});

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      busy = true;
      button.disabled = true;
      message.textContent = 'Criando tentativa…';
      try {
        const selected = form.querySelector('input[name="feedbackMode"]:checked');
        const created = await createQuizSession(materialId, batch.id, selected.value);
        const url = new URL(window.location.href);
        url.searchParams.set('session', created.id);
        window.history.replaceState(null, '', url.toString());
        sessionData = await getQuizSession(created.id);
        render();
      } catch (error) {
        message.textContent = error.message || 'Não foi possível iniciar.';
        button.disabled = false;
      } finally { busy = false; }
    });
  }

  async function reload() {
    sessionData = await getQuizSession(sessionData.session.id);
  }

  function render() {
    if (!sessionData) return renderStart();
    const { session, questions, answers, progress } = sessionData;
    if (!questions.length) return showFailure(new Error('Nenhuma questão encontrada nesta tentativa.'));
    current = Math.min(Math.max(0, current), questions.length - 1);
    const question = questions[current];
    const prior = answers.find((answer) => answer.questionId === question.id);
    const finished = session.status === 'completed';

    const progressSection = el('section', null, 'quiz-progress-area');
    progressSection.setAttribute('aria-label', 'Progresso da lista');
    const top = el('div');
    top.append(
      el('span', `Questão ${current + 1} de ${questions.length} · ${progress.answered} respondidas`),
      el('strong', material.title),
    );
    progressSection.append(top);
    const track = el('div', null, 'quiz-progress-track');
    const bar = el('span');
    bar.style.width = `${Math.round((progress.answered / questions.length) * 100)}%`;
    track.append(bar);
    progressSection.append(track);

    const card = el('article', null, 'quiz-question-card');
    const label = el('span', 'Questão de múltipla escolha', 'eyebrow');
    const heading = el('h1', question.statement);
    heading.tabIndex = -1;
    const form = el('form');
    const fieldset = el('fieldset', null, 'quiz-alternatives');
    fieldset.setAttribute('aria-label', 'Alternativas da questão');
    const feedback = el('p', '', 'quiz-selection-message');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');

    question.options.forEach((optionText, index) => {
      const option = el('label', null, 'quiz-answer-card');
      const input = el('input');
      input.type = 'radio';
      input.name = 'quiz-answer';
      input.value = String(index);
      input.disabled = Boolean(prior);
      if (prior?.selectedIndex === index) input.checked = true;
      option.append(input, el('span', String.fromCharCode(65 + index), 'quiz-answer-letter'), el('span', optionText, 'quiz-answer-text'));
      if (prior && Object.hasOwn(prior, 'correctIndex')) {
        if (index === prior.correctIndex) option.classList.add('answer-correct');
        else if (index === prior.selectedIndex) option.classList.add('answer-incorrect');
      }
      fieldset.append(option);
    });

    if (prior) {
      feedback.textContent = feedbackForQuestion(prior, session.feedback_mode);
      if (Object.hasOwn(prior, 'correct'))
        feedback.dataset.state = prior.correct ? 'success' : 'error';
    }
    const nav = el('div', null, 'quiz-navigation');
    const previous = el('button', 'Anterior', 'secondary-action');
    previous.type = 'button';
    previous.disabled = current === 0;
    previous.addEventListener('click', () => {
      current--;
      render();
      main.querySelector('h1')?.focus();
    });
    let primaryLabel = prior ? 'Próxima questão' : 'Registrar resposta';
    if (finished && current === questions.length - 1) primaryLabel = 'Voltar ao material';
    else if (prior && current === questions.length - 1)
      primaryLabel = progress.answered === questions.length ? 'Concluir tentativa' : 'Ver pendentes';
    const action = el('button', primaryLabel, 'primary-action');
    action.type = 'submit';
    nav.append(previous, action);
    form.append(fieldset, feedback, nav);
    card.append(label, heading, form);
    main.replaceChildren(progressSection);
    if (finished) {
      const score = quizScore(answers);
      const incorrect = questions.map((q) => ({
        question: q,
        answer: answers.find((item) => item.questionId === q.id),
      })).filter(({ answer }) => answer?.correct === false);
      const result = el('section', null, 'quiz-v2-result');
      result.setAttribute('aria-label', 'Diagnóstico da tentativa');
      result.append(el('h2', 'Resultado da tentativa'));
      result.append(el('p', `${score.correct} de ${questions.length} acertos · ${Math.round((score.correct / questions.length) * 100)}% pelo gabarito gerado.`));
      if (incorrect.length) {
        result.append(el('h3', `${incorrect.length} ${incorrect.length === 1 ? 'questão para revisar' : 'questões para revisar'}`));
        const list = el('ol', null, 'quiz-v2-errors');
        for (const { question: missed, answer } of incorrect) {
          const row = el('li');
          row.append(el('strong', missed.statement));
          row.append(el('p', `Você marcou ${String.fromCharCode(65 + answer.selectedIndex)}. O gabarito indica ${String.fromCharCode(65 + answer.correctIndex)}.`));
          if (answer.explanation) row.append(el('p', answer.explanation));
          list.append(row);
        }
        result.append(list);
        if (reviewEnabled) {
          const review = el('button', 'Refazer apenas as questões erradas', 'secondary-action');
          review.type = 'button';
          review.addEventListener('click', async () => {
            if (busy) return;
            busy = true;
            review.disabled = true;
            try {
              const created = await createReviewQuizSession(session.id, 'immediate');
              const url = new URL(window.location.href);
              url.searchParams.set('session', created.id);
              url.searchParams.set('batch', session.batch_id);
              window.location.href = url.toString();
            } catch (error) {
              review.disabled = false;
              busy = false;
              const warning = el('p', error.message || 'Não foi possível criar a revisão.');
              warning.setAttribute('role', 'alert');
              result.append(warning);
            }
          });
          result.append(review);
        }
      } else {
        result.append(el('p', 'Todas as respostas coincidiram com o gabarito gerado.'));
      }
      result.append(el('p', 'Este resultado compara alternativas com respostas geradas automaticamente; confira o conteúdo original se encontrar alguma divergência.', 'quiz-v2-disclaimer'));
      main.append(result);
    }
    main.append(card);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      if (finished && current === questions.length - 1) {
        window.location.href = returnLink;
        return;
      }
      if (prior) {
        if (current < questions.length - 1) current++;
        else if (progress.answered < questions.length) {
          const first = firstUnanswered(questions, answers);
          if (first >= 0) current = first;
        } else {
          busy = true;
          action.disabled = true;
          try {
            await finishQuizSession(session.id);
            await reload();
          } catch (error) {
            feedback.textContent = error.message || 'Não foi possível concluir.';
          } finally { busy = false; }
        }
        render();
        main.querySelector('h1')?.focus();
        return;
      }
      const chosen = fieldset.querySelector('input:checked');
      if (!chosen) {
        feedback.textContent = 'Selecione uma alternativa.';
        return;
      }
      busy = true;
      action.disabled = true;
      try {
        await submitQuizAnswer(session.id, question.id, Number(chosen.value));
        await reload();
        render();
      } catch (error) {
        feedback.textContent = error.message || 'Não foi possível registrar a resposta.';
        action.disabled = false;
      } finally { busy = false; }
    });
  }

  document.querySelector('[data-leave-quiz]')?.addEventListener('click', () => {
    window.location.href = returnLink;
  });
  if (resumedSessionId) {
    try {
      sessionData = await getQuizSession(resumedSessionId);
      if (sessionData.session.material_id !== materialId ||
        (batch && sessionData.session.batch_id !== batch.id))
        throw new Error('Esta tentativa não pertence ao material selecionado.');
      const pending = firstUnanswered(sessionData.questions, sessionData.answers);
      current = pending >= 0 ? pending : 0;
      render();
    } catch (error) { showFailure(error); }
  } else renderStart();
}
