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
import { listMultiLessons } from '../api/multi-lesson.api.js';
import { isUnpublish, submissionActionLabel } from '../utils/submission-actions.js';

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
// Where a submission is on the main path (rejected and withdrawn are off it).
const STEP = {
  submitted: 1,
  approved_for_processing: 2,
  processing: 3,
  transcription_confirmed: 4,
  published: 5,
};
// What each status means for whoever is looking: the student who sent it or the reviewers.
const STATUS_HELP = {
  student: {
    submitted: 'Aguardando a aprovação do professor.',
    approved_for_processing:
      'Aprovado. Processe a gravação na sua Biblioteca e depois marque “Já processei a gravação”.',
    processing:
      'Aguardando o professor conferir a transcrição. Confirme a sua transcrição na Biblioteca, se ainda não confirmou.',
    transcription_confirmed: 'Transcrição conferida pelo professor. Aguardando a publicação.',
    published: 'Publicado: a turma já pode ler esta aula.',
    rejected: 'Recusado pelo professor.',
    withdrawn: 'Este envio foi retirado.',
  },
  manager: {
    submitted: 'Aguardando a sua aprovação para processar.',
    approved_for_processing: 'Aguardando o aluno processar a gravação.',
    processing: 'Pronto para você conferir a transcrição.',
    transcription_confirmed: 'Pronto para publicar.',
    published: 'Publicado na turma.',
    rejected: 'Recusado.',
    withdrawn: 'Retirado.',
  },
};
const EVENT_NOTE = {
  membership_ended: 'A participação na turma terminou.',
  lesson_unpublished: 'A aula foi despublicada.',
};
const CONTRIBUTION_STATUS = {
  pending: 'Aguardando revisão',
  approved: 'Compartilhado com a turma',
  rejected: 'Recusado',
  withdrawn: 'Retirado',
  revoked: 'Não está mais compartilhado',
};
const CONTRIBUTION_KIND = {
  flashcard_set: 'Conjunto de flashcards',
  integrated_material: 'Material integrado',
};
const CONTRIBUTIONS_UNAVAILABLE = api.CONTRIBUTIONS_SCHEMA_REQUIRED;
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

/** A list waiting for the server: announced as busy, with a visible placeholder. */
function loading(list) {
  list.setAttribute('aria-busy', 'true');
  list.replaceChildren(el('li', { className: 'classroom-empty', text: 'Carregando…' }));
}
const loaded = (list) => list.setAttribute('aria-busy', 'false');
/** Updates ?turma=…&aula=… (or material=…) without reloading, keeping the tab in the hash. */
function setQuery(key, value) {
  const params = new URLSearchParams(location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  history.replaceState(null, '', `?${params}${location.hash}`);
}
/** "Professor(a): …" / "Monitor(a): …" — feedback with the reviewer's role. */
const feedbackLine = (role, text) =>
  el('small', {}, el('span', { text: `${ROLE[role] || ROLE.teacher}:` }), ' ', own('span', text));

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
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
/** A stable cover colour per class (the same tones as the Biblioteca's folders). */
function classroomTone(id) {
  const tones = ['lavender', 'matcha', 'honey', 'mist', 'rose'];
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}
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
                'data-tone': classroomTone(room.id),
              },
              own('strong', room.name, 'classroom-card-name'),
              room.description ? own('span', room.description, 'classroom-card-description') : null,
              el(
                'span',
                { className: 'classroom-card-meta' },
                chip(ROLE[room.role], room.role),
                room.status === 'archived' ? chip('Arquivada', 'archived') : null,
                el('span', { text: plural(room.memberCount, 'membro', 'membros') }),
                el('span', { text: plural(room.lessonCount, 'aula', 'aulas') }),
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
              { href: null, mascot: 'rest', artId: 'empty.classrooms' },
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
  // The class becomes the page's subject: "Turmas" steps back to a breadcrumb (CSS).
  detail.closest('main').dataset.view = 'classroom';
  const manager = room.canManage;
  const teacher = room.role === 'teacher';
  document.title = `Voz em Estudo | ${room.name}`;
  $('[data-classroom-name]').textContent = room.name;
  $('[data-classroom-description]').textContent = room.description || '';
  $('[data-classroom-meta]').replaceChildren(
    ...[
      chip(ROLE[room.role], room.role),
      room.status === 'archived' ? chip('Arquivada', 'archived') : null,
      el('span', { text: plural(room.memberCount, 'membro', 'membros') }),
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
    ? 'Cada envio passa por aprovação, processamento, conferência da transcrição e publicação.'
    : 'Envie uma gravação sua. O professor aprova, confere a transcrição e decide publicar.';

  const failure = (error) => setStatus(error.message || 'Não foi possível carregar.', 'error');
  // Contributions need their own migration: without it those sections stay hidden.
  const ctx = { manager, student: room.role === 'student', contributions: true };
  const optional = (error) => {
    if (error.code !== CONTRIBUTIONS_UNAVAILABLE) return failure(error);
    ctx.contributions = false;
    $('[data-contributions-section]').hidden = true;
    $('[data-integrated-section]').hidden = true;
  };
  const loaders = {
    lessons: () => renderLessons(id, manager).catch(failure),
    resources: () => renderResources(id, manager).catch(failure),
    submissions: () => renderSubmissions(id, manager, reloadAll).catch(failure),
    shared: () => renderShared(id, manager).catch(failure),
    members: () => renderMembers(id, teacher, manager).catch(failure),
    contributions: () =>
      ctx.contributions ? renderContributions(id, ctx, reloadAll).catch(optional) : null,
    integrated: () =>
      ctx.contributions ? renderIntegrated(id, ctx, reloadAll).catch(optional) : null,
  };
  async function reloadAll() {
    await Promise.all(Object.values(loaders).map((load) => load()));
  }
  await reloadAll();
  wireDialogs(id, loaders, ctx);
  // Deep links: ?turma=…&aula=… opens a published lesson, &material=… a shared integrated one.
  const params = new URLSearchParams(location.search);
  if (params.get('aula')) await openLesson(id, params.get('aula'), null);
  else if (params.get('material') && ctx.contributions)
    await openIntegrated(id, params.get('material'), null);
}

async function renderLessons(id, manager) {
  const list = $('[data-lessons-list]');
  loading(list);
  const lessons = await api.listLessons(id).finally(() => loaded(list));
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
                'text-action',
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
  reader.setAttribute('aria-busy', 'true');
  const lesson = await api
    .getLesson(id, lessonId)
    .catch((error) => {
      setQuery('aula', null);
      setStatus(
        error.status === 404
          ? 'Esta aula não está mais publicada nesta turma.'
          : error.message || 'Não foi possível abrir a aula.',
        'error',
      );
      return null;
    })
    .finally(() => reader.setAttribute('aria-busy', 'false'));
  if (!lesson) return;
  setQuery('aula', lesson.id);
  const close = button('Fechar aula', () => {
    reader.hidden = true;
    setQuery('aula', null);
    (opener?.isConnected ? opener : $('[data-lessons-list] button'))?.focus();
  });
  const parts = [
    el('header', { className: 'classroom-reader-header' }, own('h3', lesson.title), close),
    el('p', {
      className: 'tool-hint',
      text: `Transcrição publicada na revisão ${lesson.transcript.revision}. Só leitura.`,
    }),
    el('p', {
      className: 'tool-hint',
      text: 'Aulas publicadas pelo professor.',
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
                  `${q.options[q.correctIndex] ?? ''}${q.explanation ? ` · ${q.explanation}` : ''}`,
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
  loading(list);
  const resources = await api.listResources(id).finally(() => loaded(list));
  list.replaceChildren(
    ...resources.map((resource) =>
      el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          el(
            'a',
            { href: resource.url, target: '_blank', rel: 'noopener noreferrer' },
            own('span', resource.title),
            el('span', { className: 'sr-only', text: '(abre em nova aba)' }),
          ),
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
  loading(list);
  const submissions = await api.listSubmissions(id).finally(() => loaded(list));
  const move = async (submission, to, extra = {}) => {
    await api.moveSubmission(id, submission.id, { to, requestId: crypto.randomUUID(), ...extra });
    await reloadAll();
    toast(isUnpublish(submission.status, to) ? 'Aula despublicada da turma.' : `Envio: ${STATUS[to]}.`);
  };
  list.replaceChildren(
    ...submissions.map((submission) => {
      const buttons = submission.actions.map((to) =>
        button(
          submissionActionLabel(submission, to, STATUS.processing),
          async (event) => {
            const opener = event.currentTarget;
            // From "published", the transcription_confirmed edge unpublishes: say so, never
            // reuse the confirmation dialog.
            if (isUnpublish(submission.status, to))
              return confirmDialog(
                'Despublicar da turma',
                'A aula sai da turma na hora e o envio volta para a etapa 4 (transcrição confirmada).',
                'Despublicar',
                () => move(submission, to),
                opener,
              );
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
            if (to === 'approved_for_processing')
              return formDialog({
                title: 'Aprovar para processar',
                opener,
                submitLabel: 'Aprovar',
                fields: [
                  {
                    name: 'note',
                    label: 'Recado para o aluno (opcional)',
                    type: 'textarea',
                    max: 1000,
                  },
                ],
                extra: [
                  el('p', {
                    className: 'app-dialog-hint',
                    text: 'O aluno processa a gravação na conta dele.',
                  }),
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
      buttons.push(
        button(
          'Ver andamento',
          (event) => showSubmissionHistory(id, submission, event.currentTarget),
          'text-action',
        ),
      );
      const step = STEP[submission.status];
      const help = STATUS_HELP[submission.isMine ? 'student' : 'manager'][submission.status];
      return el(
        'li',
        { className: 'classroom-item', 'data-submission': submission.id },
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
            step ? ' ' : null,
            step ? el('span', { text: `Etapa ${step} de 5` }) : null,
          ),
          help ? el('small', { className: 'classroom-status-help', text: help }) : null,
          submission.note ? own('small', submission.note) : null,
          submission.decisionNote ? feedbackLine('teacher', submission.decisionNote) : null,
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

/** The submission log, read only: each step, who did it and any message left. */
async function showSubmissionHistory(id, submission, opener) {
  const detail = await api.getSubmission(id, submission.id);
  const events = el(
    'ol',
    { className: 'classroom-timeline' },
    ...(detail.events || []).map((event) =>
      el(
        'li',
        {},
        el(
          'span',
          {},
          el('strong', { text: STATUS[event.toStatus] || event.toStatus }),
          ' · ',
          el('span', {
            text: event.actorRole === 'system' ? 'Sistema' : ROLE[event.actorRole] || '',
          }),
          ' · ',
          el('time', { datetime: event.at, text: formatDate(event.at) }),
        ),
        event.note
          ? EVENT_NOTE[event.note]
            ? el('small', { text: EVENT_NOTE[event.note] })
            : own('small', event.note)
          : null,
      ),
    ),
  );
  formDialog({
    title: 'Andamento do envio',
    opener,
    submitLabel: 'Fechar',
    extra: [
      own('p', detail.materialTitle || 'Gravação', 'classroom-dialog-subject'),
      events,
    ],
    onSubmit: () => true,
  });
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
  loading(list);
  const sets = await api.listSharedSets(id).finally(() => loaded(list));
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

// ---------------------------------------------------------------- contributions ---------------
async function renderContributions(id, ctx, reloadAll) {
  const section = $('[data-contributions-section]');
  const list = $('[data-contributions-list]');
  loading(list);
  const items = await api.listContributions(id).finally(() => loaded(list));
  section.hidden = false;
  $('[data-contributions-hint]').textContent = ctx.manager
    ? 'Conjuntos de flashcards e materiais integrados que os alunos querem compartilhar.'
    : 'O que você ofereceu à turma e a resposta do professor.';
  const end = (item, opener) =>
    confirmDialog(
      item.status === 'pending' ? 'Retirar contribuição' : 'Parar de compartilhar',
      item.status === 'pending'
        ? 'A contribuição sai da fila de revisão. O item continua só seu.'
        : 'O item deixa de aparecer para a turma na hora. O original continua só seu.',
      item.status === 'pending' ? 'Retirar' : 'Parar de compartilhar',
      async () => {
        await api.endContribution(id, item.id);
        await reloadAll();
        toast(
          item.status === 'pending' ? 'Contribuição retirada.' : 'Não está mais compartilhado.',
        );
      },
      opener,
    );
  const review = (item, decision, opener) =>
    formDialog({
      title: decision === 'approved' ? 'Aprovar contribuição' : 'Recusar contribuição',
      opener,
      submitLabel: decision === 'approved' ? 'Aprovar e compartilhar' : 'Recusar',
      fields: [
        {
          name: 'feedback',
          label:
            decision === 'approved'
              ? 'Recado para o aluno (opcional)'
              : 'Motivo (opcional, o aluno verá)',
          type: 'textarea',
          max: 1000,
        },
      ],
      extra: [
        el('p', {
          className: 'app-dialog-hint',
          text:
            decision === 'approved'
              ? 'Ao aprovar, todos os membros da turma passam a ver o conteúdo, com o nome do aluno.'
              : 'Nada é compartilhado. O aluno pode ajustar e enviar de novo.',
        }),
      ],
      async onSubmit(values) {
        await api.reviewContribution(id, item.id, {
          decision,
          requestId: crypto.randomUUID(),
          feedback: values.feedback || null,
        });
        await reloadAll();
        toast(decision === 'approved' ? 'Contribuição aprovada.' : 'Contribuição recusada.');
      },
    });
  // Staff: the students' contributions (their own shares need no review and appear elsewhere).
  const visible = ctx.manager ? items.filter((item) => !item.isMine) : items;
  list.replaceChildren(
    ...visible.map((item) => {
      const actions = [];
      if (['pending', 'approved'].includes(item.status))
        actions.push(
          button('Ver conteúdo', (event) => previewContribution(id, item, event.currentTarget)),
        );
      if (item.actions.includes('approve'))
        actions.push(button('Aprovar', (event) => review(item, 'approved', event.currentTarget)));
      if (item.actions.includes('reject'))
        actions.push(
          button(
            'Recusar',
            (event) => review(item, 'rejected', event.currentTarget),
            'text-action',
          ),
        );
      if (item.isMine && (item.actions.includes('withdraw') || item.actions.includes('revoke')))
        actions.push(
          button(
            item.status === 'pending' ? 'Retirar' : 'Parar de compartilhar',
            (event) => end(item, event.currentTarget),
            'text-action',
          ),
        );
      return el(
        'li',
        { className: 'classroom-item', 'data-contribution': item.id },
        el(
          'div',
          { className: 'classroom-item-copy' },
          own('strong', item.title || CONTRIBUTION_KIND[item.kind]),
          el(
            'small',
            {},
            el('span', { text: CONTRIBUTION_KIND[item.kind] }),
            ctx.manager ? ' · ' : null,
            ctx.manager ? own('span', item.author?.displayName || '') : null,
            ' ',
            chip(CONTRIBUTION_STATUS[item.status], item.status),
          ),
          item.note ? own('small', item.note) : null,
          item.feedback ? feedbackLine(item.reviewedRole, item.feedback) : null,
        ),
        actions.length ? el('div', { className: 'classroom-item-actions' }, ...actions) : null,
      );
    }),
  );
  if (!visible.length)
    list.append(
      el('li', {
        className: 'classroom-empty',
        text: ctx.manager
          ? 'Nenhuma contribuição dos alunos.'
          : 'Você ainda não ofereceu flashcards nem materiais integrados a esta turma.',
      }),
    );
}

/** Read-only preview of a contribution (cards, or the integrated content) in a dialog. */
async function previewContribution(id, item, opener) {
  const detail = await api.getContribution(id, item.id);
  const body = [];
  if (!detail.preview)
    body.push(
      el('p', { className: 'app-dialog-hint', text: 'Este item não está mais disponível.' }),
    );
  else if (item.kind === 'flashcard_set')
    body.push(
      el(
        'ul',
        { className: 'classroom-cards' },
        ...detail.preview.cards.map((card) =>
          el(
            'li',
            { translate: 'no' },
            el('strong', { text: card.front }),
            el('span', { text: card.back }),
          ),
        ),
      ),
    );
  else body.push(...integratedContent(detail.preview, `preview-${item.id}`));
  formDialog({
    title: 'Conteúdo da contribuição',
    opener,
    submitLabel: 'Fechar',
    extra: [
      own('p', item.title || CONTRIBUTION_KIND[item.kind], 'classroom-dialog-subject'),
      ...body,
      el('p', { className: 'app-dialog-hint', text: 'Só leitura.' }),
    ],
    onSubmit: () => true,
  });
}

// ---------------------------------------------------------------- integrated materials --------
function citationList(list = []) {
  if (!list.length) return null;
  return el(
    'ul',
    { className: 'classroom-citations', 'aria-label': 'Trechos que sustentam' },
    ...list.map((citation) =>
      el(
        'li',
        {},
        own('q', citation.quote),
        ' ',
        el(
          'small',
          {},
          own('span', citation.lessonTitle || ''),
          ' · ',
          el('span', { text: `trecho ${Number(citation.position) + 1}` }),
        ),
      ),
    ),
  );
}

/** The generated content of an integrated material, read only. `prefix` keeps ids unique. */
function integratedContent({ sources = [], content = {} }, prefix) {
  const parts = [];
  if (sources.length)
    parts.push(
      el(
        'p',
        { className: 'tool-hint' },
        el('span', { text: 'Feito a partir de:' }),
        ' ',
        own('span', sources.map((source) => source.title).join(' · ')),
      ),
    );
  if (content.summary?.sections?.length)
    parts.push(
      el(
        'section',
        { 'aria-labelledby': `${prefix}-summary` },
        el('h4', { id: `${prefix}-summary`, text: 'Resumo integrado' }),
        ...content.summary.sections.map((section) =>
          el(
            'article',
            { className: 'classroom-integrated-section' },
            own('h5', section.heading),
            own('p', section.text, 'classroom-reader-text'),
            citationList(section.citations),
          ),
        ),
      ),
    );
  if (content.questions?.length)
    parts.push(
      el(
        'section',
        { className: 'classroom-questions', 'aria-labelledby': `${prefix}-questions` },
        el('h4', { id: `${prefix}-questions`, text: 'Questões integradas' }),
        el(
          'ol',
          {},
          ...content.questions.map((q) =>
            el(
              'li',
              {},
              own('p', q.statement),
              el(
                'ul',
                { translate: 'no' },
                ...(q.options || []).map((option) => el('li', { text: option })),
              ),
              el(
                'details',
                {},
                el('summary', { text: 'Ver resposta' }),
                own(
                  'p',
                  `${q.options?.[q.correctIndex] ?? ''}${q.explanation ? ` · ${q.explanation}` : ''}`,
                ),
                citationList(q.citations),
              ),
            ),
          ),
        ),
      ),
    );
  if (content.flashcards?.length)
    parts.push(
      el(
        'section',
        { 'aria-labelledby': `${prefix}-cards` },
        el('h4', { id: `${prefix}-cards`, text: 'Flashcards' }),
        el(
          'ul',
          { className: 'classroom-cards' },
          ...content.flashcards.map((card) =>
            el(
              'li',
              { translate: 'no' },
              el('strong', { text: card.front }),
              el('span', { text: card.back }),
            ),
          ),
        ),
      ),
    );
  return parts;
}

async function renderIntegrated(id, ctx, reloadAll) {
  const section = $('[data-integrated-section]');
  const list = $('[data-integrated-list]');
  loading(list);
  const items = await api.listIntegratedMaterials(id).finally(() => loaded(list));
  section.hidden = false;
  const stop = (item, opener) =>
    confirmDialog(
      item.isMine ? 'Parar de compartilhar' : 'Ocultar da turma',
      'O material deixa de aparecer para a turma na hora. O original continua só de quem o criou.',
      item.isMine ? 'Parar de compartilhar' : 'Ocultar',
      async () => {
        await api.endContribution(id, item.id);
        $('[data-integrated-reader]').hidden = true;
        setQuery('material', null);
        await reloadAll();
        toast('Material não está mais compartilhado.');
      },
      opener,
    );
  list.replaceChildren(
    ...items.map((item) =>
      el(
        'li',
        { className: 'classroom-item' },
        el(
          'div',
          { className: 'classroom-item-copy' },
          own('strong', item.title),
          el(
            'small',
            {},
            own('span', item.author?.displayName || ''),
            ' · ',
            el('span', { text: item.sourceCount === 1 ? '1 aula' : `${item.sourceCount} aulas` }),
          ),
        ),
        el(
          'div',
          { className: 'classroom-item-actions' },
          button('Abrir material', (event) => openIntegrated(id, item.id, event.currentTarget)),
          item.isMine || ctx.manager
            ? button(
                item.isMine ? 'Parar de compartilhar' : 'Ocultar da turma',
                (event) => stop(item, event.currentTarget),
                'text-action',
              )
            : null,
        ),
      ),
    ),
  );
  if (!items.length)
    list.append(
      el('li', {
        className: 'classroom-empty',
        text: 'Nenhum material integrado compartilhado ainda.',
      }),
    );
}

async function openIntegrated(id, contributionId, opener) {
  const reader = $('[data-integrated-reader]');
  reader.setAttribute('aria-busy', 'true');
  const material = await api
    .getIntegratedMaterial(id, contributionId)
    .catch((error) => {
      setQuery('material', null);
      setStatus(
        error.status === 404
          ? 'Este material não está mais compartilhado nesta turma.'
          : error.message || 'Não foi possível abrir o material.',
        'error',
      );
      return null;
    })
    .finally(() => reader.setAttribute('aria-busy', 'false'));
  if (!material) return;
  setQuery('material', material.id);
  const close = button('Fechar material', () => {
    reader.hidden = true;
    setQuery('material', null);
    (opener?.isConnected ? opener : $('[data-integrated-list] button'))?.focus();
  });
  reader.replaceChildren(
    el('header', { className: 'classroom-reader-header' }, own('h3', material.title), close),
    el(
      'p',
      { className: 'tool-hint' },
      el('span', { text: 'Compartilhado por' }),
      ' ',
      own('span', material.author?.displayName || ''),
      el('span', { text: '. Só leitura.' }),
    ),
    ...integratedContent(material, 'integrated'),
  );
  reader.querySelector('h3').id = 'integrated-reader-title';
  reader.hidden = false;
  reader.focus();
}

async function renderMembers(id, teacher, manager) {
  const list = $('[data-members-list]');
  loading(list);
  const members = await api.listMembers(id).finally(() => loaded(list));
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

function wireDialogs(id, loaders, ctx) {
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

  // Students' contributions go through review when the contributions migration is present.
  const reviewed = () => ctx.contributions && ctx.student;
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
          text: 'Os membros verão a frente e o verso dos cartões e o seu nome na turma. Cópias que outros já fizeram continuam com eles.',
        }),
        reviewed()
          ? el('p', {
              className: 'app-dialog-hint',
              text: 'O professor revisa o conjunto antes de a turma ver. Acompanhe a resposta em Envios.',
            })
          : null,
      ],
      async onSubmit(values) {
        const body = { id: crypto.randomUUID(), setId: values.setId };
        const result = ctx.contributions
          ? await api.contribute(id, { id: body.id, kind: 'flashcard_set', itemId: body.setId })
          : await api.shareSet(id, body);
        await Promise.all([loaders.shared(), loaders.contributions()]);
        toast(
          result?.status === 'pending'
            ? 'Conjunto enviado para a revisão do professor.'
            : 'Conjunto compartilhado com a turma.',
        );
      },
    });
  });

  // A READY integrated material of one's own (Milestone C). Students' wait for review.
  $('[data-integrated-share]').hidden = !flags.multi_lesson;
  open('share-integrated', async (opener) => {
    const records = await listMultiLessons().catch(() => []);
    const ready = (Array.isArray(records) ? records : []).filter((r) => r.status === 'ready');
    if (!ready.length) {
      formDialog({
        title: 'Compartilhar material integrado',
        opener,
        submitLabel: 'Fechar',
        extra: [
          el('p', {
            text: 'Você ainda não tem material integrado pronto. Crie um em Material integrado, a partir de aulas com a transcrição confirmada.',
          }),
          el('a', { href: './integrado.html', text: 'Ir para Material integrado' }),
        ],
        onSubmit: () => true,
      });
      return;
    }
    formDialog({
      title: 'Compartilhar material integrado',
      opener,
      submitLabel: reviewed() ? 'Enviar para revisão' : 'Compartilhar',
      fields: [
        {
          name: 'itemId',
          label: 'Material integrado',
          type: 'select',
          required: true,
          options: [
            { value: '', label: 'Escolha um material seu' },
            ...ready.map((r) => ({ value: r.id, label: r.title, own: true })),
          ],
        },
        ...(reviewed()
          ? [
              {
                name: 'note',
                label: 'Recado para o professor (opcional)',
                type: 'textarea',
                max: 1000,
              },
            ]
          : []),
      ],
      extra: [
        el('p', {
          className: 'app-dialog-hint',
          text: 'Os membros verão o resumo, as questões, os flashcards e os trechos citados, com o seu nome.',
        }),
        reviewed()
          ? el('p', {
              className: 'app-dialog-hint',
              text: 'O professor revisa o material antes de a turma ver.',
            })
          : null,
      ],
      async onSubmit(values) {
        const result = await api.contribute(id, {
          id: crypto.randomUUID(),
          kind: 'integrated_material',
          itemId: values.itemId,
          note: values.note || null,
        });
        await Promise.all([loaders.integrated(), loaders.contributions()]);
        toast(
          result.status === 'pending'
            ? 'Material enviado para a revisão do professor.'
            : 'Material compartilhado com a turma.',
        );
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
