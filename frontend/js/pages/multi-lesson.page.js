// Material integrado (Milestone C): the integrated summary and questions of several confirmed
// lessons. Every item shows the lesson passages that support it, each linking to the exact
// segment of that lesson ("Abrir no trecho da aula"). Generated text, lesson titles and quotes are
// user content: never translated (translate="no").
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { getMultiLesson, listMultiLessons } from '../api/multi-lesson.api.js';

const $ = (selector) => document.querySelector(selector);
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}
const own = (tag, text, className) => el(tag, { translate: 'no', className, text });
const STATUS = {
  queued: 'Na fila',
  running: 'Gerando',
  ready: 'Pronto',
  failed: 'Não foi possível gerar',
};
const REASON = {
  unconfirmed: 'transcrição ainda não confirmada',
  not_transcribed: 'ainda sem transcrição',
};
const FAILURE = {
  GENERATION_BUDGET_EXCEEDED: 'O limite diário de gerações foi atingido.',
  MULTI_LESSON_NO_KNOWLEDGE: 'Não foi possível extrair conteúdo sustentado por trechos destas aulas.',
  MULTI_LESSON_UNSUPPORTED: 'Nenhum item gerado tinha trecho das aulas que o sustentasse; nada foi salvo.',
  TRANSCRIPTION_CONFIRMATION_REQUIRED: 'Uma das transcrições deixou de estar confirmada.',
};

function setStatus(text, state = 'info') {
  const box = $('[data-multi-lesson-status]');
  box.textContent = text;
  box.dataset.state = state;
}

/** Same deep link as "Abrir no trecho da aula" in the annotations: search the quote, focus the segment. */
export function passageHref(citation) {
  const params = new URLSearchParams({ id: citation.materialId });
  const quote = String(citation.quote || '').split('\n')[0].trim();
  if (quote) params.set('busca', quote.length > 80 ? quote.slice(0, 80).replace(/\s+\S*$/, '') : quote);
  if (Number.isInteger(citation.position)) params.set('trecho', String(citation.position));
  return `./material.html?${params}#transcricao`;
}

function citations(list = []) {
  if (!list.length) return null;
  const box = el('ul', { className: 'multi-lesson-citations', 'aria-label': 'Trechos que sustentam' });
  for (const citation of list)
    box.append(
      el(
        'li',
        {},
        own('q', citation.quote, 'multi-lesson-quote'),
        el(
          'span',
          { className: 'multi-lesson-citation-source' },
          own('span', citation.lessonTitle),
          document.createTextNode(' · '),
          el('span', { text: `trecho ${citation.position + 1}` }),
          document.createTextNode(' · '),
          el('a', { href: passageHref(citation), text: 'Abrir no trecho da aula' }),
        ),
      ),
    );
  return box;
}

function renderSummary(summary) {
  const section = el('section', { className: 'multi-lesson-block', 'aria-labelledby': 'multi-lesson-summary-title' }, el('h3', { id: 'multi-lesson-summary-title', text: 'Resumo integrado' }));
  if (!summary.sections.length) section.append(el('p', { className: 'tool-hint', text: 'Nenhuma seção do resumo tinha trecho de apoio.' }));
  for (const item of summary.sections)
    section.append(el('article', { className: 'multi-lesson-section' }, own('h4', item.heading), own('p', item.text), citations(item.citations)));
  return section;
}

function renderQuestions(questions) {
  const section = el('section', { className: 'multi-lesson-block', 'aria-labelledby': 'multi-lesson-questions-title' }, el('h3', { id: 'multi-lesson-questions-title', text: 'Questões integradas' }));
  const list = el('ol', { className: 'multi-lesson-questions' });
  questions.forEach((question, index) => {
    const answerId = `multi-lesson-answer-${index}`;
    const answer = el(
      'div',
      { id: answerId, className: 'multi-lesson-answer', hidden: true },
      el('p', {}, el('strong', { text: 'Resposta: ' }), own('span', question.options[question.correctIndex])),
      question.explanation ? own('p', question.explanation) : null,
      citations(question.citations),
    );
    const reveal = el('button', { type: 'button', className: 'secondary-action', 'aria-expanded': 'false', 'aria-controls': answerId, text: 'Ver resposta e trechos' });
    reveal.addEventListener('click', () => {
      const open = answer.hidden;
      answer.hidden = !open;
      reveal.setAttribute('aria-expanded', String(open));
      reveal.textContent = open ? 'Ocultar resposta' : 'Ver resposta e trechos';
    });
    const options = el('ol', { className: 'multi-lesson-options', type: 'A' });
    for (const option of question.options) options.append(own('li', option));
    list.append(el('li', { className: 'multi-lesson-question' }, own('p', question.statement, 'multi-lesson-statement'), options, reveal, answer));
  });
  section.append(list);
  return section;
}

function renderFlashcards(cards) {
  const section = el('section', { className: 'multi-lesson-block', 'aria-labelledby': 'multi-lesson-cards-title' }, el('h3', { id: 'multi-lesson-cards-title', text: 'Flashcards' }));
  const list = el('ul', { className: 'multi-lesson-cards' });
  for (const card of cards)
    list.append(el('li', {}, el('details', {}, own('summary', card.front), own('p', card.back), citations(card.citations))));
  section.append(list);
  return section;
}

function renderReport(report = {}) {
  const dropped = (report.droppedSections || 0) + (report.droppedQuestions || 0) + (report.droppedFlashcards || 0);
  const notes = [];
  if (dropped) notes.push(dropped === 1 ? '1 item sem trecho das aulas que o sustentasse foi descartado.' : `${dropped} itens sem trecho das aulas que os sustentasse foram descartados.`);
  for (const lesson of report.lessonsWithoutKnowledge || [])
    notes.push({ lesson: lesson.title });
  if (!notes.length) return null;
  const box = el('div', { className: 'multi-lesson-report', role: 'note' }, el('h3', { text: 'Transparência da geração' }));
  for (const note of notes)
    box.append(
      typeof note === 'string'
        ? el('p', { text: note })
        : el('p', {}, el('span', { text: 'Sem conteúdo sustentado por trechos: ' }), own('span', note.lesson)),
    );
  return box;
}

let timer = null;
async function showDetail(id) {
  const detail = $('[data-multi-lesson-detail]');
  let record;
  try {
    record = await getMultiLesson(id);
  } catch (failure) {
    setStatus(failure.message || 'Material integrado não encontrado.', 'error');
    return;
  }
  detail.hidden = false;
  $('[data-multi-lesson-title]').textContent = record.title;
  document.title = 'Voz em Estudo | Material integrado';
  const lessonCount = record.sources.length === 1 ? '1 aula' : `${record.sources.length} aulas`;
  $('[data-multi-lesson-meta]').replaceChildren(el('span', { text: STATUS[record.status] || record.status }), document.createTextNode(' · '), el('span', { text: lessonCount }));
  const sources = $('[data-multi-lesson-sources]');
  sources.replaceChildren(
    ...record.sources.map((source) =>
      el('li', {}, el('a', { href: `./material.html?id=${encodeURIComponent(source.materialId)}#transcricao`, translate: 'no', text: source.title }), document.createTextNode(' · '), el('span', { text: `revisão ${source.revision}` })),
    ),
  );
  const excluded = $('[data-multi-lesson-excluded]');
  excluded.replaceChildren();
  if (record.excluded?.length) {
    const list = el('ul', { className: 'multi-lesson-excluded' });
    for (const item of record.excluded)
      list.append(el('li', {}, own('span', item.title), document.createTextNode(' — '), el('span', { text: REASON[item.reason] || 'indisponível' })));
    excluded.append(el('h4', { text: 'Ficaram de fora' }), list);
  }
  const content = $('[data-multi-lesson-content]');
  content.replaceChildren();
  clearTimeout(timer);
  if (record.status === 'queued' || record.status === 'running') {
    const retrying = record.job?.status === 'retry';
    setStatus(retrying ? 'Houve uma falha temporária; uma nova tentativa já está programada.' : 'Gerando o material integrado. Esta página atualiza sozinha.', 'info');
    timer = setTimeout(() => showDetail(id), 3000);
    return;
  }
  if (record.status === 'failed') {
    setStatus(FAILURE[record.error_code] || 'Não foi possível gerar este material. Você pode pedir de novo pela Biblioteca.', 'error');
    return;
  }
  setStatus('Material pronto.', 'success');
  const result = record.result || {};
  const report = renderReport(result.report);
  if (report) content.append(report);
  if (result.summary) content.append(renderSummary(result.summary));
  if (result.questions) content.append(renderQuestions(result.questions));
  if (result.flashcards) content.append(renderFlashcards(result.flashcards));
}

async function showHome() {
  $('[data-multi-lesson-home]').hidden = false;
  const list = $('[data-multi-lesson-list]');
  try {
    const items = await listMultiLessons();
    if (!items.length) {
      list.replaceWith(emptyState('Nenhum material integrado ainda', 'Selecione aulas confirmadas na Biblioteca para estudá-las juntas.', { href: './historico.html', action: 'Abrir a Biblioteca', mascot: 'curious' }));
      return;
    }
    list.replaceChildren(
      ...items.map((item) =>
        el(
          'li',
          { className: 'multi-lesson-list-item' },
          el('a', { href: `./integrado.html?id=${encodeURIComponent(item.id)}`, translate: 'no', text: item.title }),
          el('span', { className: 'status-chip', 'data-state': item.status, text: STATUS[item.status] || item.status }),
          el('span', { className: 'multi-lesson-meta', text: item.source_count === 1 ? '1 aula' : `${item.source_count} aulas` }),
        ),
      ),
    );
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível carregar os materiais integrados.', 'error');
  }
}

await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
if (!flags.multi_lesson) {
  const unavailable = $('[data-tool-unavailable]');
  unavailable.hidden = false;
  unavailable.append(emptyState('O material integrado ainda não está ativo', 'Ele aparece aqui quando for ativado neste servidor.', { href: './historico.html', action: 'Voltar à Biblioteca', mascot: 'rest' }));
} else {
  const id = new URLSearchParams(location.search).get('id');
  if (id) await showDetail(id);
  else await showHome();
}
