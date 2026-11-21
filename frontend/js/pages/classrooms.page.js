// Turmas: private classes. Teachers publish lessons and review submissions; students submit
// recordings and share flashcard sets. Only members see what was explicitly published or shared;
// personal progress, notes, reviews and attempts are never sent here.
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { initToolTabs } from '../utils/tool-tabs.js';
import { toast } from '../utils/toast.js';
import * as api from '../api/classroom.api.js';
import { listMaterials, getMaterial } from '../api/material.api.js';
import { listFlashcardSets } from '../api/flashcard.api.js';

const ROLE = { teacher: 'Professor(a)', assistant: 'Monitor(a)', student: 'Aluno(a)' };
const STATUS = {
  submitted: 'Enviado',
  approved_for_processing: 'Aprovado para processar',
  processing: 'Em processamento',
  transcription_confirmed: 'Transcrição confirmada',
  published: 'Publicado na turma',
  rejected: 'Recusado',
  withdrawn: 'Retirado',
};
const ACTION = {
  approved_for_processing: 'Aprovar para processar',
  processing: 'Já processei a gravação',
  transcription_confirmed: 'Conferir e confirmar transcrição',
  published: 'Publicar na turma',
  rejected: 'Recusar',
  withdrawn: 'Retirar envio',
};
const INVITE_STATE = {
  active: 'Ativo',
  expired: 'Expirado',
  revoked: 'Revogado',
  full: 'Esgotado',
};

const $ = (selector) => document.querySelector(selector);
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(
    ...children.filter((child) => child !== null && child !== undefined && child !== false),
  );
  return node;
}
/** User content (names, titles, transcripts) is never translated. */
const own = (tag, text, className) => el(tag, { translate: 'no', className, text });
const chip = (text, state) =>
  el('span', { className: 'status-chip classroom-chip', 'data-state': state, text });
/** A button whose failures are announced in the page status instead of being lost. */
const button = (text, onclick, className = 'secondary-action') =>
  el('button', {
    type: 'button',
    className,
    text,
    async onclick(event) {
      try {
        await onclick(event);
      } catch (failure) {
        setStatus(failure.message || 'Não foi possível concluir. Tente novamente.', 'error');
      }
    },
  });
const formatDate = (value) =>
  new Date(value).toLocaleDateString(document.documentElement.lang || 'pt-BR');

function setStatus(text, state = 'info') {
  const box = $('[data-classrooms-status]');
  box.textContent = text;
  box.dataset.state = state;
}

let dialogCounter = 0;
/**
 * A modal form in the app's dialog style. `fields` describe labelled inputs; `extra` adds nodes
 * (e.g. a transcript to review). `onSubmit(values)` may throw to keep the dialog open with the
 * message. Escape and Cancel close it; focus returns to the control that opened it.
 */
function formDialog({ title, fields = [], extra = [], submitLabel = 'Salvar', onSubmit, opener }) {
  const origin = opener || document.activeElement;
  const id = `classroom-dialog-${++dialogCounter}`;
  const form = el('form', { method: 'dialog', novalidate: true });
  const dialog = el(
    'dialog',
    { className: 'app-dialog classroom-dialog', 'aria-labelledby': `${id}-title` },
    form,
  );
  form.append(el('h2', { id: `${id}-title`, text: title }));
  const inputs = {};
  for (const field of fields) {
    const inputId = `${id}-${field.name}`;
    let input;
    if (field.type === 'select') {
      input = el('select', { id: inputId, name: field.name, required: field.required });
      for (const option of field.options || [])
        input.append(
          el('option', {
            value: option.value,
            text: option.label,
            translate: option.own ? 'no' : null,
          }),
        );
    } else if (field.type === 'textarea') {
      input = el('textarea', { id: inputId, name: field.name, maxlength: field.max, rows: 3 });
    } else {
      input = el('input', {
        id: inputId,
        name: field.name,
        type: field.type || 'text',
        required: field.required,
        maxlength: field.max,
        min: field.min,
        max: field.maxValue,
        pattern: field.pattern,
        autocomplete: 'off',
      });
    }
    if (field.value !== undefined) input.value = field.value;
    inputs[field.name] = input;
    const label = el('label', { for: inputId }, field.label, input);
    form.append(label);
    if (field.hint) form.append(el('p', { className: 'app-dialog-hint', text: field.hint }));
    if (field.onchange) input.addEventListener('change', () => field.onchange(input.value, form));
  }
  form.append(...extra);
  const error = el('p', { className: 'classroom-dialog-error', role: 'alert' });
  const submit = el('button', { type: 'submit', className: 'primary-action', text: submitLabel });
  const cancel = el('button', { type: 'button', className: 'secondary-action', text: 'Cancelar' });
  form.append(error, el('div', { className: 'form-actions' }, cancel, submit));
  document.body.append(dialog);
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    setTimeout(() => origin?.isConnected && origin.focus(), 0);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    for (const input of Object.values(inputs))
      if (!input.checkValidity()) {
        input.reportValidity();
        input.focus();
        return;
      }
    const values = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value.trim()]));
    submit.disabled = true;
    try {
      if ((await onSubmit(values, form)) !== false) dialog.close();
    } catch (failure) {
      error.textContent = failure.message || 'Não foi possível concluir. Tente novamente.';
    } finally {
      submit.disabled = false;
    }
  });
  dialog.showModal();
  (Object.values(inputs)[0] || submit).focus();
  return { dialog, form, submit, inputs };
}
const confirmDialog = (title, text, submitLabel, action, opener) =>
  formDialog({ title, extra: [el('p', { text })], submitLabel, onSubmit: action, opener });

const session = await initAuthenticatedShell();
const meta = session.user?.user_metadata || {};
const myName = String(meta.display_name || meta.full_name || meta.name || '').slice(0, 80);
const flags = await getFeatureFlags().catch(() => ({}));
const classId = new URLSearchParams(location.search).get('turma');

if (!flags.classrooms) {
  const unavailable = $('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(
    emptyState(
      'Turmas ainda não estão ativas',
      'As turmas privadas aparecem aqui quando forem ativadas neste servidor.',
      {
        href: './painel.html',
        action: 'Voltar ao início',
        mascot: 'rest',
      },
    ),
  );
} else if (classId) {
  await showClassroom(classId);
} else {
  await showHome();
}

// ---------------------------------------------------------------- list of classes -------------
async function showHome() {
  const home = $('[data-classrooms-home]');
  home.hidden = false;
  const list = $('[data-classrooms-list]');
  async function render() {
    list.setAttribute('aria-busy', 'true');
    try {
      const classes = await api.listClassrooms();
      list.replaceChildren(
        ...classes.map((room) =>
          el(
            'li',
            {},
            el(
              'a',
              {
                className: 'classroom-card',
                href: `./turmas.html?turma=${encodeURIComponent(room.id)}`,
              },
              own('strong', room.name, 'classroom-card-name'),
              el(
                'span',
                { className: 'classroom-card-meta' },
                chip(ROLE[room.role], room.role),
                room.status === 'archived' ? chip('Arquivada', 'archived') : null,
                el('span', { text: `${room.memberCount} membros` }),
                el('span', { text: `${room.lessonCount} aulas` }),
              ),
            ),
          ),
        ),
      );
      if (!classes.length)
        list.append(
          el(
            'li',
            {},
            emptyState(
              'Nenhuma turma ainda',
              'Crie uma turma ou entre com o código que o professor enviou.',
              { href: null, mascot: 'rest' },
            ),
          ),
        );
    } catch (failure) {
      setStatus(failure.message, 'error');
    } finally {
      list.setAttribute('aria-busy', 'false');
    }
  }
  const nameField = {
    name: 'displayName',
    label: 'Como você aparece para a turma',
    value: myName,
    required: true,
    max: 80,
  };
  const openCreate = (opener) =>
    formDialog({
      title: 'Nova turma',
      opener,
      submitLabel: 'Criar turma',
      fields: [
        { name: 'name', label: 'Nome da turma', required: true, max: 120 },
        { name: 'description', label: 'Descrição (opcional)', type: 'textarea', max: 2000 },
        nameField,
      ],
      async onSubmit(values) {
        const room = await api.createClassroom({
          id: crypto.randomUUID(),
          name: values.name,
          description: values.description || null,
          displayName: values.displayName,
        });
        location.href = `./turmas.html?turma=${encodeURIComponent(room.id)}`;
      },
    });
  const openJoin = (opener, code = '') =>
    formDialog({
      title: 'Entrar numa turma',
      opener,
      submitLabel: 'Entrar na turma',
      fields: [
        {
          name: 'code',
          label: 'Código ou link do convite',
          value: code,
          required: true,
          max: 300,
          hint: 'Peça o código ao professor. Ele vale por tempo limitado.',
        },
        nameField,
      ],
      async onSubmit(values) {
        const room = await api.joinClassroom({
          code: api.inviteCodeFrom(values.code),
          displayName: values.displayName,
        });
        location.href = `./turmas.html?turma=${encodeURIComponent(room.id)}`;
      },
    });
  home
    .querySelector('[data-classroom-open="create"]')
    .addEventListener('click', (event) => openCreate(event.currentTarget));
  home
    .querySelector('[data-classroom-open="join"]')
    .addEventListener('click', (event) => openJoin(event.currentTarget));
  await render();
  // An invitation link (#convite=CODE): the code stays in the fragment, never sent to a server log.
  const invited = location.hash.match(/^#convite=([A-Za-z0-9-]+)$/);
  if (invited) {
    history.replaceState(null, '', location.pathname);
    openJoin(home.querySelector('[data-classroom-open="join"]'), invited[1]);
  }
}

// ---------------------------------------------------------------- one class -------------------
async function showClassroom(id) {
  let room;
  try {
    room = await api.getClassroom(id);
  } catch (failure) {
    const unavailable = $('[data-tool-unavailable]');
    unavailable.hidden = false;
    unavailable.append(
      emptyState(
        'Turma indisponível',
        failure.status === 404
          ? 'Você não participa desta turma, ou ela não existe mais.'
          : failure.message,
        {
          href: './turmas.html',
          action: 'Ver minhas turmas',
          mascot: 'rest',
        },
      ),
    );
    return;
  }
  const detail = $('[data-classroom-detail]');
  detail.hidden = false;
  const manager = room.canManage;
  const teacher = room.role === 'teacher';
  document.title = `Voz em Estudo | ${room.name}`;
  $('[data-classroom-name]').textContent = room.name;
  $('[data-classroom-description]').textContent = room.description || '';
  $('[data-classroom-meta]').replaceChildren(
    ...[
      chip(ROLE[room.role], room.role),
      room.status === 'archived' ? chip('Arquivada', 'archived') : null,
      el('span', { text: `${room.memberCount} membros` }),
      room.teacherName
        ? el(
            'span',
            { className: 'classroom-teacher' },
            el('span', { text: 'Professor(a):' }),
            ' ',
            own('span', room.teacherName),
          )
        : null,
    ].filter(Boolean),
  );
  // Sharing needs the person's own named sets (Flashcards 2.0).
  if (!flags.flashcard_sets) detail.querySelector('[data-classroom-open="share"]').hidden = true;
  detail.querySelectorAll('[data-manager-only]').forEach((node) => (node.hidden = !manager));
  detail
    .querySelectorAll('[data-student-only]')
    .forEach((node) => (node.hidden = room.role !== 'student'));
  const actions = $('[data-classroom-actions]');
  if (teacher) {
    const archived = room.status === 'archived';
    actions.append(
      button(archived ? 'Reativar turma' : 'Arquivar turma', (event) =>
        confirmDialog(
          archived ? 'Reativar turma' : 'Arquivar turma',
          archived
            ? 'A turma volta a aceitar convites, envios e publicações.'
            : 'Os membros continuam lendo o que já foi publicado, mas nada novo pode ser enviado, publicado ou compartilhado.',
          archived ? 'Reativar' : 'Arquivar',
          async () => {
            await api.updateClassroom(id, { archived: !archived });
            location.reload();
          },
          event.currentTarget,
        ),
      ),
    );
  } else {
    actions.append(
      button('Sair da turma', (event) =>
        confirmDialog(
          'Sair da turma',
          'Você deixa de ver o conteúdo desta turma. Os conjuntos que você compartilhou deixam de aparecer para a turma e seus envios em aberto são retirados. Seus materiais continuam na sua biblioteca.',
          'Sair',
          async () => {
            await api.leaveClassroom(id);
            location.href = './turmas.html';
          },
          event.currentTarget,
        ),
      ),
    );
  }
  initToolTabs($('[data-classroom-tabs]'), ['aulas', 'envios', 'flashcards', 'membros']);
  $('[data-submissions-hint]').textContent = manager
    ? 'Cada envio passa por etapas separadas: aprovação para processar, processamento pelo aluno, sua conferência da transcrição e publicação. Nada é publicado automaticamente.'
    : 'Envie uma gravação sua. O professor aprova o processamento, confere a transcrição e decide publicar; nada fica visível para a turma antes disso.';

  const failure = (error) => setStatus(error.message || 'Não foi possível carregar.', 'error');
  const loaders = {
    lessons: () => renderLessons(id, manager).catch(failure),
    resources: () => renderResources(id, manager).catch(failure),
    submissions: () => renderSubmissions(id, manager, reloadAll).catch(failure),
    shared: () => renderShared(id, manager).catch(failure),
    members: () => renderMembers(id, teacher, manager).catch(failure),
  };
  async function reloadAll() {
    await Promise.all(Object.values(loaders).map((load) => load()));
  }
  await reloadAll();
  wireDialogs(id, loaders);
}

async function renderLessons(id, manager) {
  const list = $('[data-lessons-list]');
  const lessons = await api.listLessons(id);
  list.replaceChildren(
    ...lessons.map((lesson) => {
      const open = button('Abrir aula', (event) => openLesson(id, lesson.id, event.currentTarget));
      return el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          own('strong', lesson.title),
          el(
            'small',
            {},
            own('span', lesson.author?.displayName || ''),
            ' · ',
            el('span', { text: `revisão ${lesson.revision}` }),
            lesson.source === 'submission' ? el('span', { text: ' · enviada por aluno' }) : null,
          ),
        ),
        el(
          'div',
          { className: 'classroom-item-actions' },
          open,
          manager
            ? button('Despublicar', (event) =>
                confirmDialog(
                  'Despublicar aula',
                  'A aula deixa de aparecer para a turma. O material continua com o dono.',
                  'Despublicar',
                  async () => {
                    await api.unpublishLesson(id, lesson.id);
                    $('[data-lesson-reader]').hidden = true;
                    await renderLessons(id, manager);
                    toast('Aula despublicada.');
                  },
                  event.currentTarget,
                ),
              )
            : null,
        ),
      );
    }),
  );
  if (!lessons.length)
    list.append(
      el('li', {
        className: 'classroom-empty',
        text: manager
          ? 'Nenhuma aula publicada. Publique uma aula sua com a transcrição confirmada.'
          : 'O professor ainda não publicou aulas.',
      }),
    );
}

async function openLesson(id, lessonId, opener) {
  const reader = $('[data-lesson-reader]');
  const lesson = await api.getLesson(id, lessonId).catch((error) => {
    setStatus(error.message, 'error');
    return null;
  });
  if (!lesson) return;
  const close = button('Fechar aula', () => {
    reader.hidden = true;
    opener?.focus();
  });
  const parts = [
    el('header', { className: 'classroom-reader-header' }, own('h3', lesson.title), close),
    el('p', {
      className: 'tool-hint',
      text: `Transcrição publicada na revisão ${lesson.transcript.revision}. Só leitura.`,
    }),
  ];
  if (lesson.summary)
    parts.push(
      el(
        'section',
        { 'aria-label': 'Resumo' },
        el('h4', { text: 'Resumo' }),
        own('div', lesson.summary.text, 'classroom-reader-text'),
      ),
    );
  parts.push(
    el(
      'section',
      { 'aria-label': 'Transcrição' },
      el('h4', { text: 'Transcrição' }),
      el(
        'div',
        { className: 'classroom-reader-text', translate: 'no' },
        ...lesson.transcript.segments.map((s) => el('p', { text: s.text })),
      ),
    ),
  );
  for (const list of lesson.questionLists) {
    parts.push(
      el(
        'section',
        { className: 'classroom-questions' },
        el('h4', {}, el('span', { text: 'Lista:' }), ' ', own('span', list.title || '—')),
        el(
          'ol',
          {},
          ...list.questions.map((q) =>
            el(
              'li',
              {},
              own('p', q.statement),
              el(
                'ul',
                { translate: 'no' },
                ...q.options.map((option) => el('li', { text: option })),
              ),
              el(
                'details',
                {},
                el('summary', { text: 'Ver resposta' }),
                own(
                  'p',
                  `${q.options[q.correctIndex] ?? ''}${q.explanation ? ` — ${q.explanation}` : ''}`,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
  reader.replaceChildren(...parts);
  reader.querySelector('h3').id = 'lesson-reader-title';
  reader.hidden = false;
  reader.focus();
}

async function renderResources(id, manager) {
  const list = $('[data-resources-list]');
  const resources = await api.listResources(id);
  list.replaceChildren(
    ...resources.map((resource) =>
      el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          el('a', {
            href: resource.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            translate: 'no',
            text: resource.title,
          }),
          resource.description ? own('small', resource.description) : null,
        ),
        manager
          ? el(
              'div',
              { className: 'classroom-item-actions' },
              button('Remover', async () => {
                await api.removeResource(id, resource.id);
                await renderResources(id, manager);
                toast('Link removido.');
              }),
            )
          : null,
      ),
    ),
  );
  if (!resources.length)
    list.append(
      el('li', { className: 'classroom-empty', text: 'Nenhum material de apoio ainda.' }),
    );
}

async function renderSubmissions(id, manager, reloadAll) {
  const list = $('[data-submissions-list]');
  const submissions = await api.listSubmissions(id);
  const move = async (submission, to, extra = {}) => {
    await api.moveSubmission(id, submission.id, { to, requestId: crypto.randomUUID(), ...extra });
    await reloadAll();
    toast(`Envio: ${STATUS[to]}.`);
  };
  list.replaceChildren(
    ...submissions.map((submission) => {
      const buttons = submission.actions.map((to) =>
        button(
          to === 'processing' && !submission.isMine ? STATUS.processing : ACTION[to],
          async (event) => {
            const opener = event.currentTarget;
            if (to === 'rejected')
              return formDialog({
                title: 'Recusar envio',
                opener,
                submitLabel: 'Recusar',
                fields: [
                  {
                    name: 'note',
                    label: 'Motivo (opcional, o aluno verá)',
                    type: 'textarea',
                    max: 1000,
                  },
                ],
                onSubmit: (values) => move(submission, to, { note: values.note || null }),
              });
            if (to === 'withdrawn')
              return confirmDialog(
                'Retirar envio',
                'O envio sai da fila e, se estiver publicado, deixa de aparecer para a turma.',
                'Retirar',
                () => move(submission, to),
                opener,
              );
            if (to === 'transcription_confirmed')
              return reviewTranscript(id, submission, opener, move);
            try {
              opener.disabled = true;
              await move(submission, to);
            } catch (error) {
              setStatus(error.message, 'error');
              opener.disabled = false;
            }
          },
          to === 'rejected' || to === 'withdrawn' ? 'text-action' : 'secondary-action',
        ),
      );
      return el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          own('strong', submission.materialTitle || 'Gravação'),
          el(
            'small',
            {},
            manager ? own('span', submission.student?.displayName || '') : null,
            manager ? ' · ' : null,
            chip(STATUS[submission.status], submission.status),
          ),
          submission.note ? own('small', submission.note) : null,
          submission.decisionNote
            ? el(
                'small',
                {},
                el('span', { text: 'Professor(a):' }),
                ' ',
                own('span', submission.decisionNote),
              )
            : null,
        ),
        buttons.length ? el('div', { className: 'classroom-item-actions' }, ...buttons) : null,
      );
    }),
  );
  if (!submissions.length)
    list.append(
      el('li', {
        className: 'classroom-empty',
        text: manager
          ? 'Nenhum envio dos alunos.'
          : 'Você ainda não enviou gravações para esta turma.',
      }),
    );
}

async function reviewTranscript(id, submission, opener, move) {
  const detail = await api.getSubmission(id, submission.id);
  const review = detail.review;
  if (!review) return setStatus('A transcrição ainda não está pronta.', 'error');
  const text = own('div', review.fullText, 'classroom-review-text');
  text.tabIndex = 0;
  text.setAttribute('role', 'region');
  text.setAttribute('aria-label', 'Transcrição enviada');
  const notice = el('p', {
    className: 'app-dialog-hint',
    text: review.studentConfirmed
      ? `O aluno confirmou a revisão ${review.revision}. Sua confirmação é separada da dele.`
      : 'O aluno ainda não confirmou esta revisão; peça que ele confira a transcrição primeiro.',
  });
  const { submit } = formDialog({
    title: 'Conferir transcrição',
    opener,
    extra: [text, notice],
    submitLabel: 'Confirmo que conferi',
    onSubmit: () => move(submission, 'transcription_confirmed', { revisionId: review.revisionId }),
  });
  submit.disabled = !review.studentConfirmed;
}

async function renderShared(id, manager) {
  const list = $('[data-shared-list]');
  const sets = await api.listSharedSets(id);
  list.replaceChildren(
    ...sets.map((set) => {
      const cards = el('ul', {
        className: 'classroom-cards',
        hidden: true,
        id: `shared-${set.sharedId}`,
      });
      const toggle = el('button', {
        type: 'button',
        className: 'secondary-action',
        'aria-expanded': 'false',
        'aria-controls': cards.id,
        text: 'Ver cartões',
      });
      toggle.addEventListener('click', async () => {
        const opening = cards.hidden;
        if (opening && !cards.childElementCount) {
          const full = await api.getSharedSet(id, set.sharedId).catch((failure) => {
            setStatus(failure.message, 'error');
            return null;
          });
          if (!full) return;
          cards.append(
            ...full.cards.map((card) =>
              el(
                'li',
                { translate: 'no' },
                el('strong', { text: card.front }),
                el('span', { text: card.back }),
              ),
            ),
          );
        }
        cards.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
        toggle.textContent = opening ? 'Ocultar cartões' : 'Ver cartões';
      });
      const revoke =
        set.isMine || manager
          ? button(
              set.isMine ? 'Parar de compartilhar' : 'Ocultar da turma',
              async () => {
                await api.revokeSharedSet(id, set.sharedId);
                await renderShared(id, manager);
                toast('Conjunto não está mais compartilhado.');
              },
              'text-action',
            )
          : null;
      return el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          own('strong', set.name),
          el(
            'small',
            {},
            own('span', set.author?.displayName || ''),
            ' · ',
            el('span', { text: `${set.cardCount} cartões` }),
          ),
        ),
        el('div', { className: 'classroom-item-actions' }, toggle, revoke),
        cards,
      );
    }),
  );
  if (!sets.length)
    list.append(
      el('li', { className: 'classroom-empty', text: 'Ninguém compartilhou conjuntos ainda.' }),
    );
}

async function renderMembers(id, teacher, manager) {
  const list = $('[data-members-list]');
  const members = await api.listMembers(id);
  list.replaceChildren(
    ...members.map((member) => {
      const actions = [];
      if (teacher && member.role !== 'teacher') {
        const next = member.role === 'student' ? 'assistant' : 'student';
        actions.push(
          button(next === 'assistant' ? 'Tornar monitor(a)' : 'Tornar aluno(a)', async () => {
            await api.setMemberRole(id, member.userId, next);
            await renderMembers(id, teacher, manager);
            toast('Papel atualizado.');
          }),
          button(
            'Remover',
            (event) =>
              confirmDialog(
                'Remover da turma',
                'A pessoa perde o acesso à turma na hora, e o que ela compartilhou deixa de aparecer. Convites antigos não servem mais para ela.',
                'Remover',
                async () => {
                  await api.removeMember(id, member.userId);
                  await renderMembers(id, teacher, manager);
                  toast('Membro removido.');
                },
                event.currentTarget,
              ),
            'text-action',
          ),
        );
      }
      return el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          own('strong', member.displayName),
          el(
            'small',
            {},
            chip(ROLE[member.role], member.role),
            member.isMe ? el('span', { text: ' (você)' }) : null,
          ),
        ),
        actions.length ? el('div', { className: 'classroom-item-actions' }, ...actions) : null,
      );
    }),
  );
  if (!manager) return;
  const invites = await api.listInvites(id);
  const box = $('[data-invites-list]');
  box.replaceChildren(
    ...invites.map((invite) =>
      el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          el(
            'small',
            {},
            chip(INVITE_STATE[invite.state], invite.state),
            ' ',
            el('span', { text: `${invite.useCount} de ${invite.maxUses} usos` }),
            ' · ',
            el('span', { text: `até ${formatDate(invite.expiresAt)}` }),
          ),
        ),
        invite.state === 'active'
          ? el(
              'div',
              { className: 'classroom-item-actions' },
              button(
                'Revogar',
                async () => {
                  await api.revokeInvite(id, invite.id);
                  await renderMembers(id, teacher, manager);
                  toast('Convite revogado.');
                },
                'text-action',
              ),
            )
          : null,
      ),
    ),
  );
  if (!invites.length)
    box.append(el('li', { className: 'classroom-empty', text: 'Nenhum convite criado.' }));
}

function wireDialogs(id, loaders) {
  const open = (name, handler) =>
    document
      .querySelectorAll(`[data-classroom-open="${name}"]`)
      .forEach((node) => node.addEventListener('click', (event) => handler(event.currentTarget)));

  open('invite', (opener) =>
    formDialog({
      title: 'Convidar alunos',
      opener,
      submitLabel: 'Criar convite',
      fields: [
        {
          name: 'days',
          label: 'Validade',
          type: 'select',
          value: '7',
          options: [
            { value: '1', label: '1 dia' },
            { value: '7', label: '7 dias' },
            { value: '30', label: '30 dias' },
          ],
        },
        {
          name: 'maxUses',
          label: 'Número máximo de alunos',
          type: 'number',
          value: '30',
          min: 1,
          maxValue: 500,
          required: true,
        },
      ],
      async onSubmit(values) {
        const code = api.generateInviteCode();
        await api.createInvite(id, {
          id: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          code,
          days: Number(values.days),
          maxUses: Number(values.maxUses),
        });
        await loaders.members();
        showInvite(code, opener);
      },
    }),
  );

  open('publish', async (opener) => {
    const materials = await listMaterials().catch(() => []);
    const options = [
      { value: '', label: 'Escolha uma aula sua' },
      ...materials.map((m) => ({ value: m.id, label: m.title, own: true })),
    ];
    const content = el('div', { className: 'classroom-publish-options', 'aria-live': 'polite' });
    let chosen = null;
    const { submit } = formDialog({
      title: 'Publicar aula',
      opener,
      submitLabel: 'Publicar',
      fields: [
        {
          name: 'materialId',
          label: 'Aula',
          type: 'select',
          options,
          required: true,
          async onchange(value) {
            chosen = null;
            content.replaceChildren();
            submit.disabled = true;
            if (!value) return;
            const material = await getMaterial(value).catch(() => null);
            if (!material) {
              content.append(
                el('p', { className: 'app-dialog-hint', text: 'Não foi possível carregar.' }),
              );
              return;
            }
            if (
              material.review?.state !== 'ready_to_generate' ||
              !material.review.sourceRevisionId
            ) {
              content.append(
                el('p', {
                  className: 'app-dialog-hint',
                  text: 'Confira e confirme a transcrição desta aula antes de publicar.',
                }),
              );
              return;
            }
            chosen = material;
            const revision = material.review.revision;
            const summaries = (material.summaries || []).filter(
              (s) => s.source_transcription_revision === revision,
            );
            const lists = (material.questionBatches || []).filter(
              (b) => b.source_transcription_revision === revision,
            );
            content.append(
              el('p', {
                className: 'app-dialog-hint',
                text: `A turma verá a transcrição da revisão ${revision}, mesmo que você a edite depois.`,
              }),
            );
            if (summaries.length) {
              const select = el(
                'select',
                { id: 'publish-summary', name: 'summaryId' },
                el('option', { value: '', text: 'Sem resumo' }),
                ...summaries.map((s, i) =>
                  el('option', {
                    value: s.id,
                    translate: 'no',
                    text: s.label || `Resumo ${s.version || i + 1}`,
                  }),
                ),
              );
              content.append(el('label', { for: 'publish-summary' }, 'Resumo', select));
            }
            if (lists.length)
              content.append(
                el(
                  'fieldset',
                  { className: 'classroom-checks' },
                  el('legend', { text: 'Listas de questões' }),
                  ...lists.map((b, i) =>
                    el(
                      'label',
                      {},
                      el('input', { type: 'checkbox', name: 'questionBatchIds', value: b.id }),
                      own('span', b.title || `Conjunto ${i + 1}`),
                    ),
                  ),
                ),
              );
            submit.disabled = false;
          },
        },
      ],
      extra: [content],
      async onSubmit(_values, form) {
        if (!chosen) throw new Error('Escolha uma aula com a transcrição confirmada.');
        await api.publishLesson(id, {
          id: crypto.randomUUID(),
          materialId: chosen.id,
          revisionId: chosen.review.sourceRevisionId,
          summaryId: form.querySelector('[name="summaryId"]')?.value || null,
          questionBatchIds: [...form.querySelectorAll('[name="questionBatchIds"]:checked')].map(
            (input) => input.value,
          ),
        });
        await loaders.lessons();
        toast('Aula publicada para a turma.');
      },
    });
    submit.disabled = true;
  });

  open('resource', (opener) =>
    formDialog({
      title: 'Adicionar link',
      opener,
      submitLabel: 'Adicionar',
      fields: [
        { name: 'title', label: 'Título', required: true, max: 160 },
        {
          name: 'url',
          label: 'Endereço (https://)',
          type: 'url',
          required: true,
          max: 2048,
          pattern: 'https://.*',
        },
        { name: 'description', label: 'Descrição (opcional)', type: 'textarea', max: 1000 },
      ],
      async onSubmit(values) {
        await api.addResource(id, {
          id: crypto.randomUUID(),
          title: values.title,
          url: values.url,
          description: values.description || null,
        });
        await loaders.resources();
      },
    }),
  );

  open('submit', async (opener) => {
    const materials = await listMaterials().catch(() => []);
    formDialog({
      title: 'Enviar gravação',
      opener,
      submitLabel: 'Enviar para aprovação',
      fields: [
        {
          name: 'materialId',
          label: 'Gravação',
          type: 'select',
          required: true,
          options: [
            { value: '', label: 'Escolha uma gravação sua' },
            ...materials.map((m) => ({ value: m.id, label: m.title, own: true })),
          ],
        },
        { name: 'note', label: 'Recado para o professor (opcional)', type: 'textarea', max: 1000 },
      ],
      extra: [
        el('p', {
          className: 'app-dialog-hint',
          text: 'Só envie gravações que você tem permissão para compartilhar. A turma só verá a aula se o professor publicar.',
        }),
      ],
      async onSubmit(values) {
        await api.submitRecording(id, {
          id: crypto.randomUUID(),
          materialId: values.materialId,
          note: values.note || null,
        });
        await loaders.submissions();
        toast('Gravação enviada para aprovação.');
      },
    });
  });

  open('share', async (opener) => {
    const sets = await listFlashcardSets().catch(() => []);
    const active = (Array.isArray(sets) ? sets : sets.sets || []).filter(
      (s) => s.status !== 'archived',
    );
    formDialog({
      title: 'Compartilhar conjunto',
      opener,
      submitLabel: 'Compartilhar',
      fields: [
        {
          name: 'setId',
          label: 'Conjunto de flashcards',
          type: 'select',
          required: true,
          options: [
            { value: '', label: 'Escolha um conjunto seu' },
            ...active.map((s) => ({ value: s.id, label: s.name, own: true })),
          ],
        },
      ],
      extra: [
        el('p', {
          className: 'app-dialog-hint',
          text: 'Os membros verão a frente e o verso dos cartões e o seu nome na turma. Seu histórico de revisão continua privado. Você pode parar de compartilhar quando quiser; cópias que outros já fizeram não voltam.',
        }),
      ],
      async onSubmit(values) {
        await api.shareSet(id, { id: crypto.randomUUID(), setId: values.setId });
        await loaders.shared();
        toast('Conjunto compartilhado com a turma.');
      },
    });
  });
}

function showInvite(code, opener) {
  const link = api.inviteLink(code);
  const input = el('input', {
    id: 'classroom-invite-link',
    readonly: true,
    value: link,
    translate: 'no',
  });
  input.value = link;
  const copied = el('p', { className: 'app-dialog-hint', role: 'status', 'aria-live': 'polite' });
  const copy = button('Copiar link', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copied.textContent = 'Link copiado.';
    } catch {
      input.select();
      copied.textContent = 'Selecione o link e copie.';
    }
  });
  formDialog({
    title: 'Convite criado',
    opener,
    submitLabel: 'Concluir',
    extra: [
      el('label', { for: 'classroom-invite-link' }, 'Link do convite', input),
      el(
        'p',
        {},
        el('span', { text: 'Código:' }),
        ' ',
        own('strong', code, 'classroom-invite-code'),
      ),
      copy,
      copied,
      el('p', {
        className: 'app-dialog-hint',
        text: 'Guarde agora: por segurança, o código não pode ser exibido de novo. Revogue o convite quando não precisar mais dele.',
      }),
    ],
    onSubmit: () => true,
  });
}
