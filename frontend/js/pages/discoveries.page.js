// Arquivo de Descobertas (3.5, Milestone 6): a notebook of discovery pages. Each page keeps the
// question, quotes checked against the lesson, the student's explanation (every version), links
// to their own material by reference, connections to other discoveries, reflections and the
// meaningful revisits. Stamps are shown as art slots ([data-game-ui]: hidden in quiet mode).
import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { applyExperienceMode, artSlot, describeCollectible, formatDay, passageHref } from '../utils/collectibles.js';
import * as api from '../api/discovery.api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const uuid = () => crypto.randomUUID();
const REVISIT_KIND = {
  explanation: 'reescreveu a explicação',
  evidence: 'reuniu uma nova evidência',
  reflection: 'escreveu uma reflexão',
  connection: 'ligou a outra descoberta',
  link: 'ligou um material seu',
};
const LINK_KIND = { question: 'Questão respondida', flashcard: 'Cartão', annotation: 'Destaque', notebook: 'Caderno da aula' };

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
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

function setStatus(text, kind = 'info') {
  const box = $('[data-discoveries-status]');
  box.textContent = text;
  box.dataset.state = kind;
}

function stampList(ids) {
  return ids.map((id) =>
    el('li', { className: 'stamp', title: describeCollectible(id).name }, artSlot(document, id.split('.')[0], id), el('span', { text: describeCollectible(id).name })),
  );
}

function showUnlocks(list = []) {
  if (!list.length) return;
  const box = $('[data-unlock-notice]');
  box.replaceChildren(
    ...list.map((unlock) =>
      el('p', { className: 'unlock-line' }, artSlot(document, unlock.kind, unlock.id), el('strong', { text: describeCollectible(unlock.id).name }), document.createTextNode(' — '), el('span', { text: describeCollectible(unlock.id).memory })),
    ),
  );
  box.hidden = false;
}

// ---- The notebook (list) --------------------------------------------------------------------
async function showHome() {
  $('[data-discoveries-home]').hidden = false;
  const list = $('[data-discoveries-list]');
  let items;
  try {
    items = await api.listDiscoveries();
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível abrir o Arquivo de Descobertas.', 'error');
    return;
  }
  if (!items.length) {
    list.replaceWith(
      emptyState('Nenhuma descoberta ainda', 'Abra uma aula confirmada e escolha “Investigar uma pergunta”. O que você descobrir fica guardado aqui.', {
        href: './historico.html',
        action: 'Abrir a Biblioteca',
        mascot: 'curious',
      }),
    );
    return;
  }
  list.replaceChildren(
    ...items.map((item) =>
      el(
        'li',
        { className: 'discovery-page-card' },
        el('h3', {}, el('a', { href: `./descobertas.html?id=${encodeURIComponent(item.id)}`, translate: 'no', text: item.title })),
        el(
          'p',
          { className: 'discovery-meta' },
          own('span', item.lessonTitle),
          item.subject ? document.createTextNode(' · ') : null,
          item.subject ? own('span', item.subject) : null,
          document.createTextNode(' · '),
          el('time', { datetime: item.createdAt, text: formatDay(item.createdAt) }),
        ),
        el(
          'p',
          { className: 'discovery-counts' },
          el('span', { text: plural(item.evidenceCount, 'evidência', 'evidências') }),
          document.createTextNode(' · '),
          el('span', { text: plural(item.connectionCount, 'conexão', 'conexões') }),
          document.createTextNode(' · '),
          el('span', { text: plural(item.revisitCount, 'revisita', 'revisitas') }),
        ),
        item.stamps.length ? el('ul', { className: 'stamp-row', 'data-game-ui': true, 'aria-label': 'Selos desta descoberta' }, ...stampList(item.stamps)) : null,
      ),
    ),
  );
}

// ---- One page ------------------------------------------------------------------------------
let current = null;

function renderDetail(view) {
  current = view;
  const d = view.discovery;
  $('[data-discovery-title]').textContent = d.title;
  $('[data-discovery-meta]').replaceChildren(
    el('a', { href: `./material.html?id=${encodeURIComponent(view.lesson.id)}`, translate: 'no', text: view.lesson.title }),
    d.subject ? document.createTextNode(' · ') : null,
    d.subject ? own('span', d.subject) : null,
    document.createTextNode(' · '),
    el('span', { text: `registrada em ${formatDay(d.createdAt)}` }),
    document.createTextNode(' · '),
    el('span', { text: `versão ${d.version}` }),
  );
  $('[data-discovery-stamps]').replaceChildren(...stampList(view.stamps.map((s) => s.id)));
  $('[data-discovery-question]').replaceChildren(el('span', { text: 'Pergunta: ' }), own('span', view.investigation.question));
  $('[data-discovery-explanation]').textContent = d.explanation;
  const form = $('[data-discovery-edit-form]');
  if (document.activeElement?.form !== form) {
    form.elements.title.value = d.title;
    form.elements.explanation.value = d.explanation;
  }
  $('[data-discovery-evidence]').replaceChildren(
    ...view.evidence.map((item) =>
      el(
        'li',
        { className: 'evidence-item' },
        own('blockquote', item.quote, 'evidence-quote'),
        item.note ? own('p', item.note, 'evidence-note') : null,
        el('p', { className: 'evidence-source' }, el('span', { text: `trecho ${item.segmentPosition + 1}` }), document.createTextNode(' · '), el('a', { href: passageHref(view.lesson.id, item.quote, item.segmentPosition), text: 'Ver na aula' })),
      ),
    ),
  );
  $('[data-more-evidence]').href = `./investigar.html?id=${encodeURIComponent(d.id)}&etapa=evidencias`;
  $('[data-discovery-links]').replaceChildren(
    ...(view.links.length
      ? view.links.map((link) =>
          el(
            'li',
            { className: 'discovery-link' },
            el('span', { className: 'discovery-link-kind', text: LINK_KIND[link.kind] || link.kind }),
            document.createTextNode(': '),
            link.missing ? el('span', { text: 'item não encontrado (pode ter sido apagado)' }) : own('span', link.target.label),
          ),
        )
      : [el('li', { className: 'tool-hint', text: 'Nenhuma ligação. Você pode ligar material seu na etapa Aplicar da investigação.' })]),
  );
  $('[data-discovery-connections]').replaceChildren(
    ...(view.connections.length
      ? view.connections.map((c) =>
          el(
            'li',
            { className: 'discovery-connection', 'data-across': String(c.acrossSubjects) },
            el('a', { href: `./descobertas.html?id=${encodeURIComponent(c.otherId)}`, translate: 'no', text: c.otherTitle }),
            el('span', { className: 'discovery-meta' }, document.createTextNode(' · '), own('span', c.otherLessonTitle), c.otherSubject ? document.createTextNode(' · ') : null, c.otherSubject ? own('span', c.otherSubject) : null),
            c.note ? own('p', c.note, 'discovery-connection-note') : null,
          ),
        )
      : [el('li', { className: 'tool-hint', text: 'Ainda sem conexões.' })]),
  );
  $('[data-discovery-reflections]').replaceChildren(
    ...view.reflections.map((r) => el('li', {}, own('p', r.text), el('time', { datetime: r.createdAt, className: 'discovery-meta', text: formatDay(r.createdAt) }))),
  );
  $('[data-discovery-revisits]').replaceChildren(
    ...(view.revisits.length
      ? view.revisits.map((r) => el('li', { text: `${formatDay(r.createdAt)}: você ${REVISIT_KIND[r.kind] || 'voltou a esta página'}.` }))
      : [el('li', { className: 'tool-hint', text: 'Nenhuma revisita ainda.' })]),
  );
  $('[data-discovery-versions]').replaceChildren(
    ...view.history.map((h) => el('li', {}, el('strong', { text: `Versão ${h.version} · ${formatDay(h.createdAt)}` }), own('p', h.title, 'discovery-version-title'), own('p', h.explanation))),
  );
}

async function loadOthers(id) {
  const form = $('[data-connect-form]');
  try {
    const all = await api.listDiscoveries();
    const linked = new Set(current.connections.map((c) => c.otherId));
    const others = all.filter((item) => item.id !== id && !linked.has(item.id));
    const select = form.elements.otherId;
    select.replaceChildren(
      ...others.map((item) => {
        const option = el('option', { value: item.id, translate: 'no' });
        option.textContent = item.subject ? `${item.title} (${item.subject})` : item.title;
        return option;
      }),
    );
    form.hidden = !others.length;
  } catch {
    form.hidden = true;
  }
}

async function act(task, success) {
  try {
    const result = await task();
    renderDetail(result);
    showUnlocks(result.newUnlocks);
    setStatus(success);
    await loadOthers(result.discovery.id);
    return result;
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível salvar. Tente novamente.', 'error');
    if (failure.code === 'DISCOVERY_VERSION_CONFLICT') renderDetail(await api.getDiscovery(current.discovery.id));
    return null;
  }
}

async function showDetail(id) {
  let view;
  try {
    view = await api.getDiscovery(id);
  } catch (failure) {
    setStatus(failure.message || 'Descoberta não encontrada.', 'error');
    $('[data-discoveries-home]').hidden = false;
    await showHome();
    return;
  }
  $('[data-discovery-detail]').hidden = false;
  renderDetail(view);
  await loadOthers(id);
  $('[data-discovery-edit-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { version: current.discovery.version, requestId: uuid(), title: form.elements.title.value.trim(), explanation: form.elements.explanation.value };
    if ([...body.explanation.trim()].length < 20) return setStatus('A explicação precisa de pelo menos 20 caracteres.', 'error');
    const saved = await act(() => api.updateDiscovery(current.discovery.id, body), 'Nova versão salva.');
    if (saved) $('[data-discovery-edit]').open = false;
  });
  $('[data-reflection-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = event.currentTarget.elements.text;
    const text = field.value.trim();
    if (!text) return;
    const saved = await act(() => api.addReflection(current.discovery.id, { id: uuid(), text }), 'Reflexão guardada.');
    if (saved) field.value = '';
  });
  $('[data-connect-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const otherId = form.elements.otherId.value;
    if (!otherId) return;
    const saved = await act(
      () => api.connectDiscoveries(current.discovery.id, { id: uuid(), otherId, note: form.elements.note.value.trim() }),
      'Descobertas ligadas.',
    );
    if (saved) form.elements.note.value = '';
  });
}

applyExperienceMode();
await initAuthenticatedShell();
const flags = await getFeatureFlags().catch(() => ({}));
if (!flags.discoveries) {
  const box = $('[data-tool-unavailable]');
  box.hidden = false;
  box.append(emptyState('O Arquivo de Descobertas ainda não está ativo', 'Ele aparece aqui quando for ativado neste servidor.', { href: './historico.html', action: 'Voltar à Biblioteca', mascot: 'rest' }));
} else {
  const id = new URLSearchParams(location.search).get('id');
  if (id) await showDetail(id);
  else await showHome();
}
