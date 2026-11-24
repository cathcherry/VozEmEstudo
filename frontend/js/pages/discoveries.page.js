// Arquivo de Descobertas (3.5, Milestone 6): a notebook of discovery pages. Each page keeps the
// question, quotes checked against the lesson, the student's explanation (every version), links
// to their own material by reference, connections to other discoveries, reflections and the
// meaningful revisits. Stamps are shown as art slots ([data-game-ui]: hidden in quiet mode).
import { initAuthenticatedShell } from '../utils/shell.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { emptyState } from '../utils/material-ui.js';
import { applyExperienceMode, artSlot, describeCollectible, formatDay, passageHref } from '../utils/collectibles.js';
import * as api from '../api/discovery.api.js';
import { getUiPreferences, setUiPreference } from '../utils/preferences.js';
import { discoveryCard } from '../utils/discovery-card-ui.js';
import { connectionPairs, groupBySubject, milestonesOf } from '../utils/discovery-card.js';
import { collectionItems, createCollection, normalizeCollections, removeCollection, setMembership } from '../utils/discovery-collections.js';
import { emblemFor } from '../utils/folder-icons.js';
import { resolveAtmosphere, availableCovers } from '../utils/atmospheres.js';

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
      el('p', { className: 'unlock-line' }, artSlot(document, unlock.kind, unlock.id), el('strong', { text: describeCollectible(unlock.id).name }), document.createTextNode(': '), el('span', { text: describeCollectible(unlock.id).memory })),
    ),
  );
  box.hidden = false;
}

// ---- The archive (list): cards grouped by subject, threads, collections, milestones ---------
let rows = [];
let collections = [];

const subjectEmblem = (subject) => {
  const id = emblemFor(subject) || 'emblem.geral';
  return el('span', { className: 'archive-emblem', 'data-art-slot': 'emblem', 'data-art-id': id, 'data-art-size': '36', 'aria-hidden': 'true' });
};
const cardFor = (row) =>
  discoveryCard(row, {
    href: `./descobertas.html?id=${encodeURIComponent(row.id)}`,
    headingLevel: 4,
    extra: [row.stamps?.length ? el('ul', { className: 'stamp-row', 'data-game-ui': true, 'aria-label': 'Selos desta descoberta' }, ...stampList(row.stamps)) : null],
  });

function renderSubjects() {
  const groups = groupBySubject(rows, globalThis.VOZ_LOCALE || 'pt-BR');
  $('[data-archive-panel="subjects"]').replaceChildren(
    ...groups.map((group, index) =>
      el(
        'section',
        { className: 'archive-group', 'aria-labelledby': `archive-group-${index}` },
        el(
          'header',
          { className: 'archive-group-head' },
          subjectEmblem(group.label),
          el('h3', { id: `archive-group-${index}` }, group.label ? own('span', group.label) : el('span', { text: 'Sem disciplina' })),
          el('span', { className: 'archive-group-count', text: plural(group.items.length, 'cartão', 'cartões') }),
        ),
        el('ul', { className: 'archive-cards' }, ...group.items.map((row) => el('li', {}, cardFor(row)))),
      ),
    ),
  );
}

function threadSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 24');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M2 12 C 22 2, 38 22, 60 12 S 98 2, 118 12');
  svg.append(path);
  return svg;
}

function renderThreads() {
  const panel = $('[data-archive-panel="threads"]');
  const pairs = connectionPairs(rows);
  const legacy = rows.some((row) => !Array.isArray(row.connections) && row.connectionCount > 0);
  if (!pairs.length) {
    panel.replaceChildren(
      el('p', {
        className: 'archive-empty-note',
        text: legacy
          ? 'Abra uma descoberta para ver com quais outras ela está ligada.'
          : 'Ainda não há ligações. Na página de uma descoberta, use “Ligar a outra descoberta” para unir duas ideias, inclusive de disciplinas diferentes.',
      }),
    );
    return;
  }
  const mini = (row) =>
    el(
      'div',
      { className: 'archive-pair-card' },
      row.subject ? own('span', row.subject, 'specimen-subject') : null,
      el('a', { href: `./descobertas.html?id=${encodeURIComponent(row.id)}`, translate: 'no', text: row.title }),
    );
  panel.replaceChildren(
    el('p', { className: 'tool-hint', text: 'Cada fio liga duas descobertas que você uniu. Os fios vermelhos atravessam disciplinas.' }),
    el(
      'ul',
      { className: 'archive-pairs' },
      ...pairs.map((pair) =>
        el(
          'li',
          { className: 'archive-pair', 'data-across': String(pair.acrossSubjects) },
          mini(pair.a),
          el('span', { className: 'archive-thread', 'aria-hidden': 'true' }, threadSvg()),
          mini(pair.b),
          el(
            'p',
            { className: 'archive-pair-note' },
            el('span', { text: pair.acrossSubjects ? 'Entre disciplinas' : 'Na mesma disciplina' }),
            pair.createdAt ? el('time', { datetime: pair.createdAt, text: formatDay(pair.createdAt) }) : null,
          ),
        ),
      ),
    ),
  );
}

function saveCollections(next, message) {
  collections = next;
  setUiPreference('discoveryCollections', next);
  renderCollections();
  if (message) setStatus(message);
}
function renderCollections() {
  const host = $('[data-collections]');
  // Keep open what the person opened (choosing cards re-renders the list).
  const wasOpen = new Set([...host.querySelectorAll('[data-collection]:has(> details[open])')].map((n) => n.dataset.collection));
  if (!collections.length) {
    host.replaceChildren(el('p', { className: 'archive-empty-note', text: 'Nenhuma coleção ainda. Dê um nome a um tema e escolha os cartões que entram nele.' }));
    return;
  }
  host.replaceChildren(
    ...collections.map((collection, index) => {
      const items = collectionItems(collection, rows);
      const remove = el('button', { type: 'button', className: 'text-action', 'data-remove-collection': collection.id, text: 'Excluir a coleção' });
      remove.addEventListener('click', () => {
        if (!confirm(`Excluir a coleção “${collection.name}”? As descobertas continuam no Arquivo.`)) return;
        saveCollections(removeCollection(collections, collection.id), 'Coleção excluída. As descobertas continuam no Arquivo.');
        $('#archive-collection-name')?.focus();
      });
      const choices = el(
        'fieldset',
        { className: 'archive-collection-choices' },
        el('legend', { className: 'sr-only', text: 'Cartões desta coleção' }),
        ...rows.map((row, n) => {
          const id = `collection-${index}-${n}`;
          const box = el('input', { type: 'checkbox', id, checked: collection.ids.includes(row.id) || null });
          box.addEventListener('change', () => {
            saveCollections(setMembership(collections, collection.id, row.id, box.checked));
            document.getElementById(id)?.focus();
          });
          return el('div', { className: 'archive-choice' }, box, el('label', { for: id, translate: 'no', text: row.title }));
        }),
      );
      return el(
        'section',
        { className: 'archive-collection', 'data-collection': collection.id, 'aria-labelledby': `archive-collection-${index}` },
        el('span', { className: 'washi', 'data-tape': 'matcha-stripes', style: '--tilt:-2deg', 'aria-hidden': 'true' }),
        el(
          'header',
          { className: 'archive-collection-head' },
          el('h3', { id: `archive-collection-${index}` }, own('span', collection.name)),
          el('span', { className: 'archive-group-count', text: plural(items.length, 'cartão', 'cartões') }),
          remove,
        ),
        items.length
          ? el('ul', { className: 'archive-cards' }, ...items.map((row) => el('li', {}, cardFor(row))))
          : el('p', { className: 'archive-empty-note', text: 'Coleção vazia. Escolha abaixo os cartões que entram nela.' }),
        el('details', { className: 'archive-collection-edit', open: !items.length || wasOpen.has(collection.id) || null }, el('summary', { text: 'Escolher os cartões' }), choices),
      );
    }),
  );
}

function renderMilestones(unlocks) {
  const list = milestonesOf(unlocks);
  $('[data-archive-milestones]').hidden = !list.length;
  $('[data-milestones-list]').replaceChildren(
    ...list.map((m) =>
      el(
        'li',
        { className: 'archive-milestone', 'data-milestone': m.id },
        el('span', { className: 'archive-milestone-art', 'data-game-ui': true }, artSlot(document, 'stamp', m.id)),
        el('strong', { text: m.label }),
        el('time', { datetime: m.occurredAt, text: formatDay(m.occurredAt) }),
        m.lessonTitle ? own('span', m.lessonTitle, 'archive-milestone-lesson') : null,
        m.currentDiscoveryId ? el('a', { href: `./descobertas.html?id=${encodeURIComponent(m.currentDiscoveryId)}`, text: 'Abrir a descoberta' }) : null,
      ),
    ),
  );
}

const TAB_KEY = 'voz-archive-view';
function selectTab(name, { focus = false } = {}) {
  for (const tab of document.querySelectorAll('[data-archive-tab]')) {
    const on = tab.dataset.archiveTab === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  for (const panel of document.querySelectorAll('[data-archive-panel]')) panel.hidden = panel.dataset.archivePanel !== name;
  try {
    localStorage.setItem(TAB_KEY, name);
  } catch {
    /* private window: the view is not remembered */
  }
}
function wireTabs() {
  const tabs = [...document.querySelectorAll('[data-archive-tab]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset.archiveTab));
    tab.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[(next + tabs.length) % tabs.length].dataset.archiveTab, { focus: true });
    });
  }
  let saved = 'subjects';
  try {
    saved = localStorage.getItem(TAB_KEY) || 'subjects';
  } catch {
    /* ignore */
  }
  selectTab(tabs.some((t) => t.dataset.archiveTab === saved) ? saved : 'subjects');
}

async function showHome(collectionPromise) {
  $('[data-discoveries-home]').hidden = false;
  try {
    rows = await api.listDiscoveries();
  } catch (failure) {
    setStatus(failure.message || 'Não foi possível abrir o Arquivo de Descobertas.', 'error');
    return;
  }
  void collectionPromise.then((c) => renderMilestones(c?.unlocks || []));
  if (!rows.length) {
    $('[data-archive-panel="subjects"]').replaceChildren(
      emptyState(
        'Nenhuma descoberta ainda',
        'Abra uma aula confirmada e escolha “Investigar uma pergunta”.',
        { href: './historico.html', action: 'Abrir a Biblioteca', mascot: 'curious', artId: 'empty.discoveries' },
      ),
    );
    return;
  }
  collections = normalizeCollections(getUiPreferences().discoveryCollections);
  $('[data-archive-toolbar]').hidden = false;
  renderSubjects();
  renderThreads();
  renderCollections();
  wireTabs();
  $('[data-new-collection]').addEventListener('submit', (event) => {
    event.preventDefault();
    const field = event.currentTarget.elements.name;
    const result = createCollection(collections, field.value);
    if (result.error) {
      setStatus(result.error, 'error');
      field.focus();
      return;
    }
    field.value = '';
    saveCollections(result.collections, `Coleção criada: ${result.created.name}. Escolha os cartões que entram nela.`);
  });
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
  $('[data-discovery-card]').replaceChildren(discoveryCard(view, { headingLevel: 4, open: true, dates: true, lesson: '', subject: d.subject || '' }));
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

async function showDetail(id, collectionPromise) {
  let view;
  try {
    view = await api.getDiscovery(id);
  } catch (failure) {
    setStatus(failure.message || 'Descoberta não encontrada.', 'error');
    await showHome(collectionPromise);
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
  // The notebook's cover (Aparência > Estúdio); a collectible cover only once it was found.
  const cover = $('[data-discoveries-cover]');
  const paint = (unlocks) => {
    const look = resolveAtmosphere(getUiPreferences(), { available: { covers: availableCovers(unlocks) } });
    cover.dataset.artId = look.cover;
  };
  paint([]);
  const collectionPromise = api.getCollection().catch(() => null);
  void collectionPromise.then((c) => c && paint(c.unlocks || []));
  const id = new URLSearchParams(location.search).get('id');
  if (id) await showDetail(id, collectionPromise);
  else await showHome(collectionPromise);
}
