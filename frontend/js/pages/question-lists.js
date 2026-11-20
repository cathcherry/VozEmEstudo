import { formatDate } from '../utils/format.js';
import { listName, listDetails, recommendQuestionCount } from '../utils/authoring.js';
import { ninoNote } from '../utils/material-ui.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};

/**
 * "Gerar lista" dialog: presets plus a bounded custom count, an on-demand recommendation and,
 * with the authoring migration, list name, difficulty, skills and advanced settings.
 */
export function initQuestionDialog({ flags, maxCount, material }) {
  const form = document.querySelector('[data-more-questions-form]');
  const select = form.querySelector('#more-question-count');
  const custom = form.querySelector('#custom-question-count');
  const customLabel = form.querySelector('[data-custom-count]');
  const info = form.querySelector('[data-count-info]');
  const panel = form.querySelector('[data-count-recommendation]');
  const message = form.querySelector('[data-questions-form-message]');
  const authoring = Boolean(flags.study_authoring);
  for (const node of form.querySelectorAll('[data-authoring-only]')) {
    if (authoring) continue;
    // Controls that need the migration are removed, not shown as working.
    if (node.tagName === 'OPTION') node.remove();
    else node.hidden = true;
  }
  form.querySelector('[data-feedback-choice]').hidden = !(authoring && flags.quiz_v2);
  custom.max = String(maxCount);
  const syncCustom = () => {
    customLabel.hidden = select.value !== 'custom';
    custom.required = select.value === 'custom';
  };
  select.addEventListener('change', () => {
    syncCustom();
    if (select.value === 'custom') {
      if (!custom.value) custom.value = '12';
      custom.focus();
    }
  });
  syncCustom();

  function renderRecommendation() {
    const current = material();
    const text =
      current?.transcription?.current_text ||
      (current?.transcription?.transcription_segments || []).map((s) => s.current_text).join(' ');
    const skills = form.querySelectorAll('[name=skill]:checked').length || 1;
    const result = recommendQuestionCount({
      durationMs: current?.audio?.duration_ms || 0,
      text,
      skills,
      max: maxCount,
    });
    const list = el('ul');
    for (const line of [
      'Menos de 5 minutos: em geral 3 a 5 questões.',
      'De 5 a 15 minutos: cerca de 5 a 10.',
      'De 15 a 30 minutos: cerca de 10 a 20.',
      'Gravações mais longas: depende da densidade e da cobertura dos conceitos.',
    ])
      list.append(el('li', line));
    panel.replaceChildren(
      el(
        'strong',
        `Para esta aula: cerca de ${result.min === result.max ? result.max : `${result.min} a ${result.max}`} questões.`,
      ),
      list,
      ...result.notes.map((note) => el('p', note)),
      el(
        'p',
        `São referências, não limites${authoring ? ` (máximo ${maxCount})` : ''}. A estimativa considera a duração, os termos distintos da transcrição e as habilidades escolhidas. Se a aula não sustentar todas sem repetição, a lista terá menos questões.`,
      ),
    );
  }
  info.addEventListener('click', () => {
    const open = info.getAttribute('aria-expanded') !== 'true';
    info.setAttribute('aria-expanded', String(open));
    if (open) renderRecommendation();
    panel.hidden = !open;
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'skill' && !panel.hidden) renderRecommendation();
  });

  /** Reads and validates the form; returns null (with a message) when it cannot be sent. */
  function read() {
    message.textContent = '';
    const isCustom = select.value === 'custom';
    const count = Number(isCustom ? custom.value : select.value);
    if (!Number.isInteger(count) || count < 1 || count > maxCount) {
      message.textContent = `Informe uma quantidade inteira de 1 a ${maxCount}.`;
      (isCustom ? custom : select).focus();
      return null;
    }
    if (!authoring) return { count };
    const data = new FormData(form);
    const difficulties = data.getAll('difficulty'),
      skills = data.getAll('skill');
    if (!difficulties.length || !skills.length) {
      message.textContent = 'Escolha pelo menos uma dificuldade e uma habilidade.';
      form.querySelector(difficulties.length ? '[name=skill]' : '[name=difficulty]').focus();
      return null;
    }
    const title = String(data.get('title') || '').trim();
    const topicFocus = String(data.get('topicFocus') || '').trim();
    return {
      count,
      config: {
        ...(title ? { title } : {}),
        difficulties,
        skills,
        ...(topicFocus ? { topicFocus } : {}),
        format: 'single_choice',
        distribution: data.get('distribution') || 'balanced',
        previousQuestions: data.get('previousQuestions') || 'avoid',
        ...(flags.quiz_v2 ? { feedbackMode: data.get('feedbackMode') || 'deferred' } : {}),
      },
    };
  }
  return {
    read,
    reset() {
      form.elements.title.value = '';
      message.textContent = '';
    },
  };
}

const COVERAGE_NOTES = {
  insufficient_content: 'a aula não sustenta mais questões distintas',
  redundancy: 'questões repetidas ou sem fonte foram descartadas',
};

/** Compact list rows; questions and results stay one click away. */
export function renderQuestionLists({
  container,
  meta,
  batches,
  answers,
  materialId,
  flags,
  actions,
}) {
  container.replaceChildren();
  const total = batches.reduce(
    (sum, b) => sum + (b.questions?.length || b.generated_count || 0),
    0,
  );
  meta.textContent = batches.length
    ? `${batches.length} ${batches.length === 1 ? 'lista' : 'listas'} · ${total} questões`
    : 'Ainda não há questões desta aula.';
  if (!batches.length)
    container.append(ninoNote('Ainda não há listas de questões. Use “Gerar lista” para criar a primeira.', 'rest'));
  batches.forEach((batch, index) => {
    const questions = batch.questions || [];
    const results = questions.map((q) => answers[q.id]);
    const answered = results.filter(Boolean).length;
    const correct = results.filter((r) => r?.correct).length;
    const count = questions.length || batch.generated_count || 0;
    const card = el('article', null, 'question-batch-card question-batch-row');
    card.dataset.batchId = batch.id;
    const head = el('div', null, 'list-row-head question-batch-head');
    const name = listName(batch, index, batches.length);
    const title = el('h3', name);
    const parts = [
      batch.requested_count && batch.requested_count > count
        ? `${count} de ${batch.requested_count} questões pedidas`
        : `${count} questões`,
      answered
        ? `${answered} respondidas · ${correct} ${correct === 1 ? 'acerto' : 'acertos'}`
        : 'ainda não respondidas',
      batch.created_at ? formatDate(batch.created_at) : '',
      batch.stale ? 'revisão anterior' : '',
    ];
    const metaLine = el('p', parts.filter(Boolean).join(' · '));
    const link = el(
      'a',
      !answered ? 'Responder' : answered < count ? 'Continuar' : 'Responder de novo',
      `${answered && answered < count ? 'primary-action' : 'secondary-action'} list-primary`,
    );
    const feedback = batch.config?.feedbackMode;
    link.href =
      `./responder.html?material=${encodeURIComponent(materialId)}&batch=${encodeURIComponent(batch.id)}` +
      (feedback ? `&feedback=${encodeURIComponent(feedback)}` : '');
    link.setAttribute('aria-label', `${link.textContent}: ${name}`);
    const menu = el('details', null, 'row-menu');
    menu.dataset.batchId = String(batch.id);
    const summary = el('summary', '⋯');
    summary.setAttribute('aria-label', `Ações da lista ${name}`);
    summary.title = 'Ações da lista';
    const options = el('div', null, 'row-menu-content');
    const add = (label, handler) => {
      const button = el('button', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        menu.open = false;
        handler();
        // The clicked item is hidden with the menu, so the browser cannot restore focus to it:
        // when the dialog it opened closes, focus returns to this list's ⋯ button (found again by
        // id, because renaming re-renders the lists).
        const opened = [...document.querySelectorAll('dialog[open]')].at(-1);
        opened?.addEventListener(
          'close',
          () => {
            const target =
              document.querySelector(`.row-menu[data-batch-id="${CSS.escape(String(batch.id))}"] > summary`) ||
              summary;
            if (target.isConnected) target.focus();
          },
          { once: true },
        );
      });
      options.append(button);
    };
    const questionsBlock = el('details', null, 'list-questions');
    add('Ver questões', () => {
      questionsBlock.open = true;
      questionsBlock.querySelector('summary').focus();
    });
    if (flags.study_authoring) add('Renomear', () => actions.rename(batch, name));
    if (actions.export) add('Exportar', () => actions.export(batch, name));
    if (actions.share && flags.study_authoring && flags.sharing)
      add('Compartilhar', () => actions.share(batch, name));
    menu.append(summary, options);
    menu.addEventListener('toggle', () => {
      if (menu.open)
        for (const other of container.querySelectorAll('.row-menu[open]'))
          if (other !== menu) other.open = false;
    });
    head.append(title, metaLine, link, menu);
    card.append(head);
    const { levels, skills } = listDetails(batch);
    if (levels.length || skills.length) {
      const tags = el('ul', null, 'list-tags');
      tags.setAttribute('aria-label', 'Dificuldade e habilidades');
      for (const label of [...levels, ...skills]) tags.append(el('li', label));
      card.append(tags);
    }
    const shortfall = COVERAGE_NOTES[batch.coverage?.shortfall];
    if (shortfall && batch.requested_count > count)
      card.append(
        el(
          'p',
          `Foram geradas ${count} de ${batch.requested_count}: ${shortfall}.`,
          'list-coverage-note',
        ),
      );
    const progress = el('div', null, 'question-batch-progress');
    progress.setAttribute('aria-hidden', 'true');
    progress.style.setProperty('--answered', String(count ? answered / count : 0));
    progress.style.setProperty('--correct', String(count ? correct / count : 0));
    card.append(progress);
    if (questions.length) {
      questionsBlock.append(el('summary', `Ver questões (${questions.length})`));
      const list = el('ol', null, 'question-list');
      questions.forEach((q, n) => {
        const item = el('li');
        const result = results[n];
        item.dataset.result = result ? (result.correct ? 'correct' : 'wrong') : 'pending';
        item.append(
          el('span', q.statement),
          el(
            'span',
            result ? (result.correct ? '✓ Acertou' : '✗ Errou') : '– Não respondida',
            'question-result',
          ),
        );
        list.append(item);
      });
      const listen = actions.listen?.(card);
      if (listen) questionsBlock.append(listen.element);
      questionsBlock.append(list);
      card.append(questionsBlock);
    }
    container.append(card);
  });
}
