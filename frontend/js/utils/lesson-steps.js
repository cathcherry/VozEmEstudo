// The study path of one lesson: check the transcript, summarise, practise with questions and
// (when enabled) create flashcards. Shows where the lesson is and the one thing to do next.

/**
 * @param {{ready:boolean, summaries:number, lists:number, answered:boolean, flashcards:boolean|null}} s
 *   flashcards: null when flashcards are off; otherwise whether the lesson has any.
 * @returns {{steps: {id:string,label:string,state:'done'|'current'|'todo'}[], next: {id:string,label:string,hint:string}|null}}
 */
export function lessonProgress(s) {
  const steps = [
    { id: 'transcription', label: 'Conferir transcrição', done: s.ready },
    { id: 'summary', label: 'Resumo', done: s.summaries > 0 },
    { id: 'questions', label: 'Questões', done: s.lists > 0 && s.answered },
  ];
  if (s.flashcards !== null)
    steps.push({ id: 'flashcards', label: 'Flashcards', done: Boolean(s.flashcards) });
  const firstOpen = steps.find((step) => !step.done);
  const next = !s.ready
    ? {
        id: 'transcription',
        label: 'Conferir e confirmar a transcrição',
        hint: 'Revise o texto reconhecido. Resumo e questões usam a versão que você confirmar.',
      }
    : !s.summaries
      ? {
          id: 'summary',
          label: 'Gerar resumo',
          hint: 'A transcrição está confirmada. Um resumo ajuda a fixar as ideias principais.',
        }
      : !s.lists
        ? {
            id: 'questions',
            label: 'Criar questões',
            hint: 'Teste o que você aprendeu com uma lista de questões desta aula.',
          }
        : !s.answered
          ? {
              id: 'answer',
              label: 'Responder a lista',
              hint: 'Sua lista está pronta. Responda para ver o que já domina.',
            }
          : s.flashcards === false
            ? {
                id: 'flashcards',
                label: 'Criar flashcards',
                hint: 'Transforme o resumo em cartões para revisar nos próximos dias.',
              }
            : null;
  return {
    steps: steps.map((step) => ({
      id: step.id,
      label: step.label,
      state: step.done ? 'done' : step === firstOpen ? 'current' : 'todo',
      // Summary, questions and flashcards use the confirmed transcript.
      locked: !s.ready && step.id !== 'transcription',
    })),
    next,
  };
}

/**
 * Renders the steps into `container`. `onStep(id)` runs when a step or the next action is chosen.
 * `done` is shown when every step is complete.
 */
export function renderLessonSteps(container, progress, { onStep, done }) {
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const list = make('ol', null, 'lesson-steps-list');
  progress.steps.forEach((step, index) => {
    const item = make('li', null, `lesson-step is-${step.state}`);
    const button = make('button', null, 'lesson-step-button');
    button.type = 'button';
    const marker = make(
      'span',
      step.state === 'done' ? '✓' : String(index + 1),
      'lesson-step-marker',
    );
    marker.setAttribute('aria-hidden', 'true');
    const state = { done: 'concluída', current: 'próxima etapa', todo: 'a fazer' }[step.state];
    button.append(marker, make('span', step.label, 'lesson-step-label'));
    button.setAttribute('aria-label', `${index + 1}. ${step.label}: ${state}`);
    if (step.state === 'current') button.setAttribute('aria-current', 'step');
    button.disabled = step.locked;
    if (step.locked) button.title = 'Disponível depois de confirmar a transcrição';
    button.addEventListener('click', () => onStep(`view:${step.id}`));
    item.append(button);
    list.append(item);
  });
  const next = make('div', null, 'lesson-next');
  if (progress.next) {
    const copy = make('p', null, 'lesson-next-copy');
    copy.append(make('strong', 'Próximo passo'), make('span', progress.next.hint));
    const action = make('button', progress.next.label, 'primary-action');
    action.type = 'button';
    action.addEventListener('click', () => onStep(progress.next.id));
    next.append(copy, action);
  } else if (done) {
    next.append(done);
  }
  container.replaceChildren(list, next);
  container.hidden = false;
}
