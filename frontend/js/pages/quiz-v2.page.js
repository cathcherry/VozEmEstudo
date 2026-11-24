import { speakControls, speechLang } from '../utils/speech.js';
import {
  createQuizSession, getQuizSession, submitQuizAnswer, finishQuizSession,
  listQuizSessions,
} from '../api/quiz-session.api.js';
import {
  feedbackForQuestion, firstUnanswered, nextUnanswered, primaryAction, shouldAutoAdvance, letter,
} from '../utils/quiz-v2-view.js';
import { emptyState, ninoImage } from '../utils/material-ui.js';
import { icon } from '../utils/icons.js';
import { renderQuizDiagnosticPanel } from './quiz-diagnostic-panel.js';
import { reportControl } from '../utils/question-report-ui.js';

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function withIcon(name, text, className) {
  const node = el('span', null, className);
  const mark = el('span', null, 'quiz-icon');
  mark.setAttribute('aria-hidden', 'true');
  mark.append(icon(name, { size: 18 }));
  node.append(mark, el('span', text));
  return node;
}

const MODES = {
  immediate: {
    title: 'Correção a cada questão',
    hint: 'Veja se acertou e a explicação logo depois de responder.',
    icon: 'idea',
  },
  deferred: {
    title: 'Correção no final',
    hint: 'Responda tudo como numa prova e veja a correção no fim.',
    icon: 'document',
  },
};

const attemptUrl = (materialId, item) =>
  `./responder.html?material=${encodeURIComponent(materialId)}&batch=${encodeURIComponent(item.batch_id)}&session=${encodeURIComponent(item.id)}`;

export async function runQuizV2({ main, material, materialId, batch, sessionId: resumedSessionId }) {
  let currentListen = null;
  main.dataset.quizV2 = 'true';
  const returnLink = `./material.html?id=${encodeURIComponent(materialId)}#questoes`;
  if (!batch?.questions?.length && !resumedSessionId) {
    main.replaceChildren(emptyState(
      'Nenhuma questão disponível.', 'Gere um lote para começar uma tentativa.',
      { href: returnLink, action: 'Voltar ao material', mascot: 'rest' },
    ));
    return;
  }

  let sessionData = null;
  let current = 0;
  let busy = false;
  // 'question' steps through the questions; a concluded attempt opens on 'results'.
  let view = 'question';
  // One-shot notes for the next render: what was just saved, or why the button changed.
  let savedNote = '';
  let doneNote = false;

  // One polite live region outside the re-rendered card, so announcements survive a render.
  const live = el('p', '', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.dataset.quizLive = '';
  document.body.append(live);
  const announce = (text) => {
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60);
  };

  function showFailure(error) {
    main.replaceChildren();
    const box = el('section', null, 'quiz-question-card');
    box.append(ninoImage('curious', 96), el('h1', 'Não foi possível abrir a tentativa.'));
    box.append(el('p', error.message || 'Ocorreu um erro ao carregar as questões.'));
    const link = el('a', 'Voltar ao material', 'secondary-action button-link');
    link.href = returnLink;
    box.append(link);
    main.append(box);
  }

  function renderStart() {
    const card = el('section', null, 'quiz-question-card quiz-start');
    const count = batch?.questions?.length || 0;
    const eyebrow = el('span', batch?.title || 'Lista de questões', 'eyebrow');
    const heading = el('h1', 'Como você quer responder?');
    heading.tabIndex = -1;
    const meta = el('p', `${count} ${count === 1 ? 'questão' : 'questões'} · ${material.title}`, 'quiz-start-meta');
    const form = el('form', null, 'quiz-start-form');
    const fieldset = el('fieldset', null, 'quiz-mode-options');
    fieldset.append(el('legend', 'Quando ver a correção', 'sr-only'));
    // A list may suggest a feedback mode (saved with its settings); the student still chooses.
    const suggested = new URLSearchParams(location.search).get('feedback');
    const preset = ['immediate', 'deferred'].includes(suggested) ? suggested : 'deferred';
    for (const [mode, copy] of Object.entries(MODES)) {
      const option = el('label', null, 'quiz-mode-card');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'feedbackMode';
      radio.value = mode;
      radio.required = true;
      radio.checked = mode === preset;
      const id = `quiz-mode-${mode}`;
      const hint = el('span', copy.hint, 'quiz-mode-hint');
      hint.id = `${id}-hint`;
      radio.setAttribute('aria-describedby', hint.id);
      const mark = el('span', null, 'quiz-mode-icon');
      mark.setAttribute('aria-hidden', 'true');
      mark.append(icon(copy.icon, { size: 24 }));
      const text = el('span', null, 'quiz-mode-copy');
      text.append(el('strong', copy.title, 'quiz-mode-title'), hint);
      option.append(radio, mark, text);
      fieldset.append(option);
    }
    const message = el('p', '', 'quiz-selection-message');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    const actions = el('div', null, 'quiz-start-actions');
    const button = el('button', 'Começar', 'primary-action quiz-start-button');
    button.type = 'submit';
    const back = el('a', 'Voltar à aula', 'text-action quiz-start-back');
    back.href = returnLink;
    actions.append(button, back);
    form.append(fieldset, message, actions);
    card.append(eyebrow, heading, meta, form);
    main.replaceChildren(card);
    // A compact entry to resume recent attempts of this list, not a duplicated question bank.
    void listQuizSessions().then((sessions) => {
      if (sessionData) return;
      const previous = sessions
        .filter((item) => item.material_id === materialId && (!batch || item.batch_id === batch.id))
        .slice(0, 6);
      if (!previous.length) return;
      const history = el('section', null, 'quiz-v2-history');
      history.setAttribute('aria-labelledby', 'quiz-history-title');
      const title = el('h2', 'Tentativas desta lista');
      title.id = 'quiz-history-title';
      history.append(title);
      const list = el('ul');
      for (const item of previous) {
        const row = el('li');
        const open = item.status !== 'completed';
        const info = el('span', null, 'quiz-history-info');
        info.append(
          el('span', open ? 'Em andamento' : 'Concluída', `quiz-history-status${open ? ' is-open' : ''}`),
          el('span', `${item.kind === 'review' ? 'Revisão dos erros' : 'Lista completa'} · ${new Date(item.created_at).toLocaleDateString((globalThis.VOZ_LOCALE || 'pt-BR'))}`),
        );
        const link = el('a', open ? 'Continuar' : 'Ver resultado', 'text-action');
        link.href = attemptUrl(materialId, item);
        link.setAttribute('aria-label', `${open ? 'Continuar tentativa' : 'Ver resultado'} de ${new Date(item.created_at).toLocaleDateString((globalThis.VOZ_LOCALE || 'pt-BR'))}`);
        row.append(info, link);
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
      message.dataset.state = '';
      message.textContent = 'Preparando a lista…';
      try {
        const selected = form.querySelector('input[name="feedbackMode"]:checked');
        const created = await createQuizSession(materialId, batch.id, selected.value);
        const url = new URL(window.location.href);
        url.searchParams.set('session', created.id);
        window.history.replaceState(null, '', url.toString());
        sessionData = await getQuizSession(created.id);
        current = 0;
        render();
        main.querySelector('h1')?.focus();
      } catch (error) {
        message.dataset.state = 'error';
        message.textContent = error.message || 'Não foi possível iniciar.';
        button.disabled = false;
      } finally { busy = false; }
    });
  }

  async function reload() {
    sessionData = await getQuizSession(sessionData.session.id);
  }

  function progressArea({ questions, progress, session }) {
    const section = el('section', null, 'quiz-progress-area');
    section.setAttribute('aria-label', 'Progresso da lista');
    const top = el('div');
    const counts = el('span', `Questão ${current + 1} de ${questions.length} · ${progress.answered} ${progress.answered === 1 ? 'respondida' : 'respondidas'}`);
    const mode = el('span', MODES[session.feedback_mode]?.title || '', 'quiz-mode-tag');
    top.append(counts, mode);
    section.append(top);
    const track = el('div', null, 'quiz-progress-track');
    const bar = el('span');
    bar.style.width = `${Math.round((progress.answered / questions.length) * 100)}%`;
    track.append(bar);
    section.append(track);
    if (savedNote) section.append(withIcon('check', savedNote, 'quiz-saved-chip'));
    return section;
  }

  function feedbackBlock(result, options) {
    const info = feedbackForQuestion(result, options);
    if (!info) return null;
    const box = el('section', null, 'quiz-feedback');
    box.dataset.state = info.state;
    box.tabIndex = -1;
    box.setAttribute('aria-label', 'Correção');
    box.append(withIcon(info.icon, info.title, 'quiz-feedback-title'));
    for (const line of info.lines) box.append(el('p', line, 'quiz-feedback-line'));
    if (info.explanation) {
      const why = el('div', null, 'quiz-explanation');
      why.append(el('h2', 'Explicação'), el('p', info.explanation));
      box.append(why);
    }
    if (info.evidence) {
      const source = el('figure', null, 'quiz-evidence');
      const caption = el('figcaption');
      caption.append(withIcon('quote', 'Trecho da aula'));
      const quote = el('blockquote');
      quote.append(el('p', info.evidence));
      source.append(caption, quote);
      box.append(source);
    }
    box.append(el('p', 'Correção gerada a partir da aula. Na dúvida, confira o trecho.', 'quiz-v2-note'));
    return box;
  }

  function render() {
    if (!sessionData) return renderStart();
    const { session, questions } = sessionData;
    if (!questions.length) return showFailure(new Error('Nenhuma questão encontrada nesta tentativa.'));
    if (session.status === 'completed' && view === 'results') return renderResults();
    return renderQuestion();
  }

  function renderQuestion() {
    const { session, questions, answers, progress } = sessionData;
    current = Math.min(Math.max(0, current), questions.length - 1);
    const question = questions[current];
    const prior = answers.find((answer) => answer.questionId === question.id);
    const finished = session.status === 'completed';
    const mode = session.feedback_mode;
    const remaining = questions.length - progress.answered;
    const keyed = Boolean(prior && Object.hasOwn(prior, 'correctIndex'));

    const card = el('article', null, 'quiz-question-card');
    const head = el('div', null, 'quiz-card-head');
    head.append(
      el('span', `Questão ${current + 1}`, 'eyebrow'),
      reportControl({
        questionId: question.id, materialId, batchId: session.batch_id,
        statement: question.statement, placement: 'header',
      }),
    );
    const heading = el('h1', question.statement);
    heading.id = 'quiz-statement';
    heading.tabIndex = -1;
    currentListen?.speaker.stop();
    currentListen = speakControls({
      blocks: () => [
        { element: heading, text: question.statement },
        ...[...card.querySelectorAll('.quiz-answer-card')].map((option, n) => ({
          element: option,
          text: `Alternativa ${letter(n)}. ${question.options[n]}`,
        })),
      ],
      lang: () => speechLang(material.transcription?.language),
      label: 'Ouvir questão',
    });
    const form = el('form', null, 'quiz-answer-form');
    const fieldset = el('fieldset', null, 'quiz-alternatives');
    fieldset.setAttribute('aria-labelledby', 'quiz-statement');
    fieldset.dataset.quizAlternatives = '';

    question.options.forEach((optionText, index) => {
      const option = el('label', null, 'quiz-answer-card');
      const input = el('input');
      input.type = 'radio';
      input.name = 'quiz-answer';
      input.value = String(index);
      input.disabled = Boolean(prior) || finished;
      if (prior?.selectedIndex === index) input.checked = true;
      option.append(input, el('span', letter(index), 'quiz-answer-letter'), el('span', optionText, 'quiz-answer-text'));
      // Correctness is marked with an icon AND a word, only when the server released the key.
      if (keyed && index === prior.correctIndex) {
        option.classList.add('is-correct');
        option.append(withIcon('check', prior.selectedIndex === index ? 'Sua resposta · correta' : 'Correta', 'quiz-answer-badge'));
      } else if (keyed && index === prior.selectedIndex) {
        option.classList.add('is-wrong');
        option.append(withIcon('close', 'Sua resposta · incorreta', 'quiz-answer-badge'));
      } else if (prior && index === prior.selectedIndex) {
        option.classList.add('is-saved');
        option.append(el('span', 'Sua resposta', 'quiz-answer-badge'));
      }
      fieldset.append(option);
    });

    // Save and finish problems stay on screen (role=alert) until the next try succeeds.
    const error = el('p', '', 'quiz-save-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    // Each sentence in its own node, so every part is a translatable phrase.
    const showError = (...parts) => {
      const mark = el('span', null, 'quiz-icon');
      mark.setAttribute('aria-hidden', 'true');
      mark.append(icon('close', { size: 18 }));
      const text = el('span', null, 'quiz-save-error-text');
      parts.filter(Boolean).forEach((part, index) => {
        if (index) text.append(' ');
        text.append(el(index ? 'span' : 'strong', part));
      });
      error.replaceChildren(mark, text);
      error.hidden = false;
    };
    const status = el('p', '', 'quiz-selection-message');
    if (doneNote && !finished && remaining === 0) {
      status.textContent = 'Todas as questões têm resposta. Revise se quiser e conclua a tentativa.';
      status.dataset.state = 'info';
    }

    const nav = el('div', null, 'quiz-navigation');
    const previous = el('button', 'Anterior', 'secondary-action');
    previous.type = 'button';
    previous.disabled = current === 0;
    previous.addEventListener('click', () => {
      current--;
      savedNote = '';
      doneNote = false;
      render();
      main.querySelector('h1')?.focus();
    });
    const step = finished
      ? (current < questions.length - 1
        ? { action: 'next', label: 'Próxima questão' }
        : { action: 'results', label: 'Ver resultado' })
      : primaryAction({ mode, answered: Boolean(prior), isLast: current === questions.length - 1, remaining });
    const action = el('button', step.label, 'primary-action');
    action.type = 'submit';
    action.dataset.quizPrimary = step.action;
    nav.append(previous, action);
    if (finished) {
      const back = el('button', 'Ver resultado', 'secondary-action');
      back.type = 'button';
      back.addEventListener('click', () => { view = 'results'; render(); main.querySelector('h1')?.focus(); });
      if (step.action !== 'results') nav.append(back);
    }
    form.append(fieldset, error, status, nav);
    const feedback = keyed ? feedbackBlock(prior, question.options) : null;
    card.append(head, heading, ...(currentListen ? [currentListen.element] : []), form);
    if (feedback) form.insertBefore(feedback, error);
    main.replaceChildren(progressArea(sessionData));
    main.append(card);
    savedNote = '';
    doneNote = false;

    const go = (index, message) => {
      current = index;
      render();
      main.querySelector('h1')?.focus();
      if (message) announce(message);
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      if (step.action === 'results') {
        view = 'results';
        render();
        main.querySelector('h1')?.focus();
        return;
      }
      if (step.action === 'next') return go(current + 1);
      if (step.action === 'pending') return go(firstUnanswered(questions, answers));
      if (step.action === 'finish') {
        busy = true;
        action.disabled = true;
        try {
          await finishQuizSession(session.id);
          await reload();
          view = 'results';
          render();
          main.querySelector('h1')?.focus();
        } catch (problem) {
          // Stay on this question so the message is seen; the button can be used again.
          showError('Não foi possível concluir a tentativa.', problem.message || 'Tente novamente.');
          action.disabled = false;
        } finally { busy = false; }
        return;
      }
      const chosen = fieldset.querySelector('input:checked');
      if (!chosen) {
        showError('Selecione uma alternativa.');
        fieldset.querySelector('input')?.focus();
        return;
      }
      const selectedIndex = Number(chosen.value);
      busy = true;
      action.disabled = true;
      action.setAttribute('aria-busy', 'true');
      const label = action.textContent;
      action.textContent = 'Salvando…';
      let saved;
      try {
        await submitQuizAnswer(session.id, question.id, selectedIndex);
        saved = true;
      } catch (problem) {
        // Nothing moves: the choice stays selected and the message stays until a retry works.
        showError(
          'A resposta não foi salva.',
          problem.message || 'Verifique a conexão.',
          'Sua escolha continua marcada; tente de novo.',
        );
        action.textContent = label;
        action.disabled = false;
        action.removeAttribute('aria-busy');
        busy = false;
        return;
      }
      try {
        await reload();
      } catch {
        // Saved on the server; keep going with what is known locally (never a guessed key).
        sessionData.answers = [...answers, { questionId: question.id, selectedIndex }];
        sessionData.progress = { ...progress, answered: progress.answered + 1 };
      }
      busy = false;
      const number = current + 1;
      if (mode === 'immediate') {
        render();
        const box = main.querySelector('.quiz-feedback');
        const result = sessionData.answers.find((answer) => answer.questionId === question.id);
        const info = feedbackForQuestion(result, question.options);
        if (box) box.focus();
        else main.querySelector('[data-quiz-primary]')?.focus();
        announce(info ? `${info.title}. ${info.lines.join('. ')}.` : 'Resposta salva.');
        return;
      }
      const target = nextUnanswered(sessionData.questions, sessionData.answers, current);
      savedNote = `Resposta da questão ${number} salva`;
      if (shouldAutoAdvance({ mode, saved, target })) {
        go(target, `Resposta da questão ${number} salva. Questão ${target + 1} de ${questions.length}.`);
        return;
      }
      // Last answer: stay here and offer "Concluir tentativa".
      doneNote = true;
      render();
      main.querySelector('[data-quiz-primary]')?.focus();
      announce(`Resposta da questão ${number} salva. Todas as questões têm resposta; você pode concluir a tentativa.`);
    });
  }

  function renderResults() {
    const { session, questions, answers } = sessionData;
    currentListen?.speaker.stop();
    const card = el('section', null, 'quiz-question-card quiz-results');
    const heading = el('h1', 'Resultado da tentativa');
    heading.tabIndex = -1;
    card.append(el('span', batch?.title || material.title, 'eyebrow'), heading);
    main.replaceChildren(card);
    // Score, short note and "Refazer apenas as erradas" come from the server diagnostic.
    void renderQuizDiagnosticPanel({ parent: card, session, materialId, batchId: session.batch_id });

    const all = el('details', null, 'quiz-review-all');
    all.append(el('summary', `Rever todas as questões (${questions.length})`));
    const list = el('ol', null, 'quiz-review-list');
    questions.forEach((question, index) => {
      const answer = answers.find((item) => item.questionId === question.id);
      const item = el('li');
      const info = feedbackForQuestion(answer, question.options || []);
      item.dataset.result = info ? info.state : 'pending';
      item.append(el('strong', question.statement, 'quiz-review-statement'));
      if (info) {
        item.append(withIcon(info.icon, info.state === 'success' ? 'Acertou' : 'Errou', 'quiz-review-mark'));
        for (const line of info.lines) item.append(el('p', line));
      } else item.append(el('p', 'Sem correção disponível para esta questão.'));
      const open = el('button', 'Ver questão', 'text-action');
      open.type = 'button';
      open.setAttribute('aria-label', `Ver questão ${index + 1}`);
      open.addEventListener('click', () => {
        view = 'question';
        current = index;
        render();
        main.querySelector('h1')?.focus();
      });
      item.append(open);
      list.append(item);
    });
    all.append(list);
    const actions = el('div', null, 'quiz-results-actions');
    const back = el('a', 'Voltar à aula', 'secondary-action button-link');
    back.href = returnLink;
    actions.append(back);
    card.append(all, actions);
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
      view = sessionData.session.status === 'completed' ? 'results' : 'question';
      render();
    } catch (error) { showFailure(error); }
  } else renderStart();
}
