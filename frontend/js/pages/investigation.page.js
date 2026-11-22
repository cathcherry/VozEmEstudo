// Investigação (3.5, Milestone 6): a calm notebook page with a rail of steps. Question →
// explore the confirmed transcript → gather evidence (selected text, checked by the server
// exactly like annotation anchors) → own explanation → apply (links by reference) → reflect →
// discovery. Only question + one piece of evidence + the explanation are required.
// Lesson titles, transcript, quotes and the student's text are user content (translate="no").
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { readingSelectionAnchor } from '../utils/annotation-anchor.js';
import { suggestQuestions, missingForDiscovery } from '../utils/investigation-prompts.js';
import { applyExperienceMode, artSlot, describeCollectible, passageHref } from '../utils/collectibles.js';
import * as api from '../api/discovery.api.js';
import { discoveryCard } from '../utils/discovery-card-ui.js';

const STEPS = ['question', 'explore', 'evidence', 'explain', 'apply', 'reflect'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const params = new URLSearchParams(location.search);
const uuid = () => crypto.randomUUID();
const LINK_KIND = { question: 'Questões que você respondeu', flashcard: 'Cartões', annotation: 'Destaques', notebook: 'Caderno da aula' };
const KIND_ONE = { question: 'Questão', flashcard: 'Cartão', annotation: 'Destaque', notebook: 'Caderno' };

const state = { source: null, view: null, step: 'question', anchor: null, busy: false, options: null };

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

function setStatus(text, kind = 'info') {
  const box = $('[data-investigation-status]');
  box.textContent = text;
  box.dataset.state = kind;
}

/** A celebration of what the server just unlocked (hidden in quiet mode; never blocks). */
function showUnlocks(list = []) {
  if (!list.length) return;
  const box = $('[data-unlock-notice]');
  box.replaceChildren(
    ...list.map((unlock) => {
      const info = describeCollectible(unlock.id);
      return el(
        'p',
        { className: 'unlock-line' },
        artSlot(document, unlock.id.split('.')[0], unlock.id),
        el('strong', { text: info.name }),
        document.createTextNode(' — '),
        el('span', { text: info.memory }),
      );
    }),
  );
  box.hidden = false;
}

const isCompleted = () => state.view?.investigation.status === 'completed';

function stepDone(step) {
  const view = state.view;
  if (!view) return false;
  const inv = view.investigation;
  return {
    question: true,
    explore: inv.explored,
    evidence: view.evidence.length > 0,
    explain: [...inv.explanation.trim()].length >= 20,
    apply: view.links.length > 0,
    reflect: inv.reflection.trim().length > 0,
  }[step];
}

function renderRail() {
  for (const step of STEPS) {
    const button = $(`[data-step-button="${step}"]`);
    button.disabled = !state.view && step !== 'question';
    if (step === state.step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    const mark = $(`[data-step-state="${step}"]`);
    mark.textContent = stepDone(step) ? 'feito' : '';
    button.closest('li').dataset.done = String(Boolean(stepDone(step)));
  }
}

function selectStep(step, { focus = false } = {}) {
  if (!STEPS.includes(step)) step = 'question';
  if (!state.view && step !== 'question') step = 'question';
  state.step = step;
  for (const section of $$('[data-step]')) section.hidden = section.dataset.step !== step;
  $('[data-transcript-box]').hidden = !['explore', 'evidence'].includes(step);
  $('[data-investigation-segments]').dataset.mode = step;
  renderRail();
  if (step === 'apply') void loadLinkOptions();
  if (focus) $(`[data-step="${step}"] h2`)?.focus?.();
}

// ---- Transcript (the confirmed revision's frozen segments) ---------------------------------
function renderSegments() {
  const box = $('[data-investigation-segments]');
  box.replaceChildren(
    ...state.source.segments.map((segment) => {
      const article = el('article', {
        className: 'transcription-segment',
        'data-segment-position': segment.position,
        'data-start-ms': segment.startMs ?? 0,
      });
      article.append(own('p', segment.text, 'segment-text'));
      const whole = el('button', { type: 'button', className: 'text-action evidence-whole', text: 'Usar o trecho inteiro', 'data-whole-segment': segment.position });
      whole.addEventListener('click', () =>
        void saveEvidence({ segmentPosition: segment.position, startOffset: 0, endOffset: [...segment.text].length, quote: segment.text }),
      );
      return el('div', { className: 'investigation-segment-row', 'data-row-position': segment.position }, article, whole);
    }),
  );
  $('[data-transcript-revision]').textContent = `Revisão ${state.source.revision}, confirmada por você.`;
}

function filterSegments() {
  const term = $('[data-segment-filter]').value.trim().toLocaleLowerCase();
  for (const row of $$('.investigation-segment-row'))
    row.hidden = Boolean(term) && !row.textContent.toLocaleLowerCase().includes(term);
}

function trackSelection() {
  const box = $('[data-investigation-segments]');
  const anchor = readingSelectionAnchor(box, globalThis.getSelection(), { multi: true });
  const preview = $('[data-selection-preview]');
  if (anchor.error) {
    // Keep the last valid selection while focus moves to the button.
    if (anchor.error === 'long') {
      state.anchor = null;
      preview.textContent = 'A seleção passou do limite (1.000 caracteres ou 50 trechos).';
    }
  } else {
    state.anchor = anchor;
    preview.replaceChildren(document.createTextNode('Seleção: '), own('q', anchor.quote));
  }
  $('[data-use-selection]').disabled = !state.anchor || !state.view;
}

// ---- Rendering of the investigation ---------------------------------------------------------
function renderEvidence() {
  const list = $('[data-evidence-list]');
  if (!state.view.evidence.length) {
    list.replaceChildren(el('li', { className: 'evidence-empty', text: 'Nenhuma evidência ainda.' }));
    return;
  }
  list.replaceChildren(
    ...state.view.evidence.map((item) => {
      const remove = el('button', { type: 'button', className: 'text-action', text: 'Remover' });
      remove.addEventListener('click', () => void dropEvidence(item.id));
      return el(
        'li',
        { className: 'evidence-item' },
        own('blockquote', item.quote, 'evidence-quote'),
        item.note ? own('p', item.note, 'evidence-note') : null,
        el(
          'p',
          { className: 'evidence-source' },
          el('span', { text: `trecho ${item.segmentPosition + 1}` }),
          document.createTextNode(' · '),
          el('a', { href: passageHref(state.view.investigation.materialId, item.quote, item.segmentPosition), text: 'Ver na aula' }),
          document.createTextNode(' · '),
          remove,
        ),
      );
    }),
  );
}

// The card this investigation becomes (3.6): a pencil sketch until the discovery is recorded,
// then ink. Derived from the investigation itself (utils/discovery-card.js).
function renderCard() {
  const box = $('[data-investigation-card]');
  box.hidden = false;
  $('[data-investigation-card-body]').replaceChildren(
    discoveryCard(state.view, { title: state.view.investigation.question, headingLevel: 3, lesson: '', subject: state.view.lesson?.subject || '', open: !isCompleted() }),
  );
}

function renderFooter() {
  const footer = $('[data-investigation-footer]');
  footer.hidden = !state.view || isCompleted();
  if (footer.hidden) return;
  const missing = missingForDiscovery(state.view);
  const text = { evidence: 'uma evidência', explanation: 'a sua explicação (20 caracteres ou mais)' };
  $('[data-missing]').textContent = missing.length
    ? `Para registrar a descoberta falta: ${missing.map((m) => text[m]).join(' e ')}.`
    : 'Tudo pronto: você pode registrar a descoberta quando quiser.';
  $('[data-complete]').disabled = state.busy || missing.length > 0;
}

function renderCounter() {
  const count = [...$('[data-explanation-input]').value.trim()].length;
  $('[data-explanation-counter]').textContent = count >= 20 ? `${count} caracteres` : `${count} de 20 caracteres no mínimo`;
}

function render() {
  const view = state.view;
  $('[data-question-new]').hidden = Boolean(view);
  $('[data-question-existing]').hidden = !view;
  if (view) {
    const inv = view.investigation;
    $('[data-question-text]').textContent = inv.question;
    $('[data-question-edit]').hidden = isCompleted();
    if (document.activeElement !== $('[data-question-edit-input]')) $('[data-question-edit-input]').value = inv.question;
    $('[data-mark-explored]').hidden = inv.explored || isCompleted();
    if (document.activeElement !== $('[data-explanation-input]')) $('[data-explanation-input]').value = inv.explanation;
    if (document.activeElement !== $('[data-reflection-input]')) $('[data-reflection-input]').value = inv.reflection;
    for (const selector of ['[data-explanation-input]', '[data-reflection-input]', '[data-save-explanation]', '[data-save-reflection]'])
      $(selector).disabled = isCompleted();
    renderEvidence();
    renderCounter();
    renderCard();
    if (isCompleted()) {
      const link = $('[data-open-discovery]');
      link.href = `./descobertas.html?id=${encodeURIComponent(inv.id)}`;
      setStatus('Esta investigação já virou uma descoberta. Você ainda pode reunir evidências e ligar materiais; o texto se edita no Arquivo de Descobertas.');
    }
  }
  renderFooter();
  renderRail();
}

// ---- Actions --------------------------------------------------------------------------------
async function run(task, success) {
  if (state.busy) return null;
  state.busy = true;
  renderFooter();
  try {
    const result = await task();
    if (success) setStatus(success);
    return result;
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível salvar. Tente novamente.', 'error');
    if (failure.code === 'DISCOVERY_VERSION_CONFLICT' && state.view) await reloadView();
    return null;
  } finally {
    state.busy = false;
    renderFooter();
  }
}

function adopt(result) {
  if (!result) return;
  state.view = result;
  showUnlocks(result.newUnlocks);
  render();
}

async function reloadView() {
  state.view = await api.getInvestigation(state.view.investigation.id);
  render();
}

async function start() {
  const question = $('[data-question-input]').value.trim();
  if ([...question].length < 3) {
    setStatus('Escreva uma pergunta (pelo menos 3 caracteres).', 'error');
    $('[data-question-input]').focus();
    return;
  }
  const id = uuid();
  const origin = $('[data-question-input]').dataset.origin === 'prompt' && question === $('[data-question-input]').dataset.prompt ? 'prompt' : 'student';
  const result = await run(
    () =>
      api.saveInvestigation(id, {
        version: 0,
        requestId: uuid(),
        body: { materialId: state.source.lesson.id, sourceRevisionId: state.source.revisionId, question, questionOrigin: origin },
      }),
    'Investigação começada. Agora explore os trechos da aula.',
  );
  if (!result) return;
  history.replaceState(null, '', `./investigar.html?id=${encodeURIComponent(id)}`);
  adopt(result);
  selectStep('explore', { focus: true });
}

const patch = (body, success) =>
  run(
    () => api.saveInvestigation(state.view.investigation.id, { version: state.view.investigation.version, requestId: uuid(), body }),
    success,
  ).then(adopt);

async function saveEvidence(anchor) {
  if (!state.view) return;
  const note = $('[data-evidence-note]').value.trim();
  const result = await run(
    () => api.addEvidence(state.view.investigation.id, { id: uuid(), ...pickAnchor(anchor), ...(note ? { note } : {}) }),
    'Evidência conferida e guardada.',
  );
  if (!result) return;
  $('[data-evidence-note]').value = '';
  state.anchor = null;
  globalThis.getSelection()?.removeAllRanges();
  $('[data-selection-preview]').textContent = 'Nenhuma seleção ainda.';
  $('[data-use-selection]').disabled = true;
  adopt(result);
}
function pickAnchor(anchor) {
  const out = { segmentPosition: anchor.segmentPosition, startOffset: anchor.startOffset, endOffset: anchor.endOffset, quote: anchor.quote };
  if (anchor.endSegmentPosition !== undefined && anchor.endSegmentPosition !== anchor.segmentPosition)
    out.endSegmentPosition = anchor.endSegmentPosition;
  return out;
}

async function dropEvidence(evidenceId) {
  const result = await run(() => api.removeEvidence(state.view.investigation.id, evidenceId), 'Evidência removida.');
  adopt(result);
}

async function loadLinkOptions() {
  const box = $('[data-link-options]');
  if (!state.view) return;
  try {
    state.options = await api.getLinkOptions(state.view.investigation.id);
  } catch (failure) {
    box.replaceChildren(el('p', { className: 'tool-hint', text: failure.message || 'Não foi possível carregar o seu material.' }));
    return;
  }
  renderLinkOptions();
}

function renderLinkOptions() {
  const box = $('[data-link-options]');
  const linked = new Set(state.view.links.map((link) => `${link.kind}:${link.refId}`));
  const groups = Object.entries(LINK_KIND)
    .map(([kind, title]) => {
      const items = state.options?.[`${kind === 'question' ? 'questions' : kind === 'flashcard' ? 'flashcards' : kind === 'annotation' ? 'annotations' : 'notebooks'}`] || [];
      if (!items.length) return null;
      const headingId = `links-${kind}`;
      return el(
        'section',
        { className: 'link-group', 'aria-labelledby': headingId },
        el('h3', { id: headingId, text: title }),
        el(
          'ul',
          {},
          ...items.map((item) => {
            const on = linked.has(`${kind}:${item.id}`);
            const toggle = el('button', { type: 'button', className: 'secondary-action', 'aria-pressed': String(on), text: on ? 'Ligado' : 'Ligar' });
            toggle.addEventListener('click', () => void toggleLink(kind, item.id, on));
            return el('li', { className: 'link-option' }, own('span', item.label || KIND_ONE[kind], 'link-label'), toggle);
          }),
        ),
      );
    })
    .filter(Boolean);
  box.replaceChildren(
    ...(groups.length
      ? groups
      : [el('p', { className: 'tool-hint', text: 'Ainda não há questões respondidas, cartões, destaques ou caderno desta aula para ligar. Esta etapa é opcional.' })]),
  );
}

async function toggleLink(kind, refId, on) {
  const result = await run(
    () => (on ? api.removeLink(state.view.investigation.id, kind, refId) : api.addLink(state.view.investigation.id, kind, refId)),
    on ? 'Ligação desfeita.' : 'Ligado à investigação.',
  );
  if (!result) return;
  adopt(result);
  renderLinkOptions();
}

async function complete() {
  const result = await run(() => api.completeInvestigation(state.view.investigation.id, uuid()), 'Descoberta registrada.');
  if (!result) return;
  showUnlocks(result.newUnlocks);
  state.view = await api.getInvestigation(state.view.investigation.id);
  render();
  const done = $('[data-investigation-done]');
  done.hidden = false;
  const stamps = $('[data-done-stamps]');
  stamps.replaceChildren(
    ...result.stamps.map((unlock) =>
      el('li', { className: 'stamp' }, artSlot(document, unlock.kind, unlock.id), el('span', { text: describeCollectible(unlock.id).name })),
    ),
  );
  done.focus();
}

function renderPrompts() {
  const prompts = suggestQuestions(state.source);
  const list = $('[data-prompts]');
  list.replaceChildren(
    ...prompts.map((prompt) => {
      const button = el('button', { type: 'button', className: 'text-action investigation-prompt', ...(prompt.own ? { translate: 'no' } : {}) });
      button.textContent = prompt.text;
      button.addEventListener('click', () => {
        const input = $('[data-question-input]');
        // The visible (possibly translated) text is what the student chose.
        input.value = button.textContent.trim();
        input.dataset.origin = 'prompt';
        input.dataset.prompt = input.value;
        input.focus();
      });
      return el('li', {}, button);
    }),
  );
  $('[data-prompts-box]').hidden = !prompts.length;
  const previous = state.source.investigations || [];
  $('[data-previous-box]').hidden = !previous.length;
  $('[data-previous-list]').replaceChildren(
    ...previous.map((item) =>
      el(
        'li',
        {},
        el('a', { href: `./investigar.html?id=${encodeURIComponent(item.id)}`, translate: 'no', text: item.question }),
        el('span', { className: 'investigation-previous-state', text: item.status === 'completed' ? ' · descoberta registrada' : ' · em andamento' }),
      ),
    ),
  );
}

function wire() {
  for (const step of STEPS) $(`[data-step-button="${step}"]`).addEventListener('click', () => selectStep(step, { focus: true }));
  $('[data-start-investigation-button]').addEventListener('click', () => void start());
  $('[data-save-question]').addEventListener('click', () => {
    const question = $('[data-question-edit-input]').value.trim();
    void patch({ question, questionOrigin: 'student' }, 'Pergunta salva.');
  });
  $('[data-mark-explored]').addEventListener('click', () => void patch({ explored: true }, 'Exploração registrada. Reúna as evidências.').then(() => selectStep('evidence', { focus: true })));
  $('[data-segment-filter]').addEventListener('input', filterSegments);
  document.addEventListener('selectionchange', trackSelection);
  $('[data-use-selection]').addEventListener('click', () => state.anchor && void saveEvidence(state.anchor));
  $('[data-explanation-input]').addEventListener('input', renderCounter);
  $('[data-save-explanation]').addEventListener('click', () => void patch({ explanation: $('[data-explanation-input]').value }, 'Explicação salva.'));
  $('[data-save-reflection]').addEventListener('click', () => void patch({ reflection: $('[data-reflection-input]').value }, 'Reflexão salva.'));
  $('[data-complete]').addEventListener('click', () => void complete());
}

function unavailable(title, text, link = { href: './historico.html', action: 'Voltar à Biblioteca' }) {
  const box = $('[data-tool-unavailable]');
  box.hidden = false;
  box.replaceChildren(emptyState(title, text, { ...link, mascot: 'rest' }));
}

async function main() {
  applyExperienceMode();
  await initAuthenticatedShell();
  const flags = await getFeatureFlags().catch(() => ({}));
  if (!flags.discoveries) return unavailable('As investigações ainda não estão ativas', 'Elas aparecem aqui quando forem ativadas neste servidor.');
  wire();
  try {
    const id = params.get('id');
    if (id) state.view = await api.getInvestigation(id);
    const materialId = state.view?.investigation.materialId || params.get('aula');
    if (!materialId) return unavailable('Escolha uma aula para investigar', 'Abra uma aula confirmada e escolha “Investigar uma pergunta”.');
    state.source = await api.getInvestigationSource(materialId);
  } catch (failure) {
    if (failure.code === 'DISCOVERY_REVISION_UNCONFIRMED')
      return unavailable('Confirme a transcrição primeiro', 'A investigação usa só trechos da transcrição que você confirmou.', {
        href: `./material.html?id=${encodeURIComponent(params.get('aula') || '')}`,
        action: 'Abrir a aula',
      });
    return unavailable('Não foi possível abrir a investigação', failure.message || 'Ela pode ter sido excluída ou pertencer a outra conta.');
  }
  const lesson = state.source.lesson;
  $('[data-investigation-lesson]').textContent = lesson.title;
  const lessonLink = $('[data-investigation-lesson-link]');
  lessonLink.textContent = lesson.title;
  lessonLink.href = `./material.html?id=${encodeURIComponent(lesson.id)}`;
  $('[data-investigation-layout]').hidden = false;
  renderSegments();
  renderPrompts();
  render();
  // An investigation keeps quoting the revision it started with; after a newer confirmation its
  // evidence stays, but new quotes would not match, so gathering stops here.
  if (state.view && state.view.investigation.sourceRevisionId !== state.source.revisionId) {
    $('[data-selection-box]').hidden = true;
    for (const button of $$('.evidence-whole')) button.hidden = true;
    setStatus('Esta investigação usa uma revisão anterior da transcrição. As evidências continuam guardadas; para citar a revisão nova, comece outra investigação.');
  }
  // From the lesson's selection toolbar ("Investigar"): the selected passage seeds the question,
  // which the student can rewrite before starting.
  const passage = String(params.get('trecho') || '').replace(/\s+/g, ' ').trim();
  const input = $('[data-question-input]');
  if (!state.view && passage && !input.value) {
    input.value = `O que quer dizer “${[...passage].slice(0, 240).join('')}”?`;
    input.dataset.origin = 'student';
  }
  const wanted = { evidencias: 'evidence', explicar: 'explain', aplicar: 'apply', refletir: 'reflect' }[params.get('etapa')];
  selectStep(wanted || (state.view ? (state.view.evidence.length ? 'explain' : 'evidence') : 'question'));
}

await main();
