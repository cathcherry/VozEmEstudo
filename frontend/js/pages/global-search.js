import { searchLibrary } from '../api/search.api.js';
import { listMaterials } from '../api/material.api.js';
import { materialHref } from '../utils/library-ui.js';
import { formatDate, formatTimestamp } from '../utils/format.js';
import { highlightRanges } from '../utils/transcript-player.js';
import { emptyState, errorState } from '../utils/material-ui.js';
import { studyFor } from '../utils/study-store.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const fold = (value = '') =>
  String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

export const SCOPES = Object.freeze({
  all: 'em tudo',
  lessons: 'nos títulos das aulas',
  questions: 'nas questões',
  transcripts: 'nas transcrições',
});
const TAB_LABELS = { lessons: 'Aulas', questions: 'Questões', transcripts: 'Transcrições' };

/** Text with the searched words in bold (<mark>), built from text nodes only. */
export function markedText(tag, text, query, className) {
  const node = el(tag, null, className);
  let cursor = 0;
  for (const [start, end] of highlightRanges(text, query)) {
    if (start > cursor) node.append(document.createTextNode(text.slice(cursor, start)));
    node.append(el('mark', text.slice(start, end), 'search-hit'));
    cursor = end;
  }
  if (cursor < text.length) node.append(document.createTextNode(text.slice(cursor)));
  return node;
}

/** Only categories with results become tabs; with one category there is no tab bar at all. */
export function resultGroups(result) {
  return ['lessons', 'questions', 'transcripts']
    .map((key) => ({
      key,
      label: TAB_LABELS[key],
      count:
        key === 'transcripts'
          ? result[key].reduce((sum, lesson) => sum + lesson.total, 0)
          : result[key].length,
      items: result[key],
    }))
    .filter((group) => group.items.length);
}

/**
 * Painel search bar: suggestions (matching lesson titles + where to search) and results on the
 * dashboard, separated in tabs for lessons, questions and transcripts.
 */
export function initGlobalSearch({ form, main, heading }) {
  const input = form.querySelector('input[type=search]');
  input.setAttribute('aria-label', 'Buscar em aulas, questões e transcrições');
  input.placeholder = 'Buscar aulas, questões e transcrições';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';
  const listbox = el('ul', null, 'search-suggestions');
  listbox.id = 'global-search-suggestions';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Sugestões de busca');
  listbox.hidden = true;
  input.setAttribute('aria-controls', listbox.id);
  form.append(listbox);
  const results = el('section', null, 'global-search-results');
  results.dataset.searchResults = '';
  results.setAttribute('aria-labelledby', 'global-search-title');
  results.hidden = true;
  heading.after(results);
  let materials = null,
    options = [],
    active = -1,
    request = 0;

  const loadMaterials = async () => (materials ||= await listMaterials().catch(() => []));

  function close() {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }
  function highlight(index) {
    active = index;
    options.forEach((option, i) =>
      option.element.setAttribute('aria-selected', String(i === index)),
    );
    if (options[index]) input.setAttribute('aria-activedescendant', options[index].element.id);
    else input.removeAttribute('aria-activedescendant');
  }
  async function suggest() {
    const q = input.value.trim();
    if (q.length < 2) return close();
    const all = await loadMaterials();
    if (input.value.trim() !== q) return;
    const needle = fold(q);
    const lessons = all
      .filter(
        (m) =>
          fold(m.title).includes(needle) ||
          studyFor(m.id).tags.some((t) => fold(t).includes(needle)),
      )
      .slice(0, 4);
    options = [
      ...lessons.map((m) => ({ kind: 'lesson', material: m })),
      ...Object.keys(SCOPES).map((scope) => ({ kind: 'scope', scope })),
    ];
    listbox.replaceChildren();
    if (lessons.length) {
      const group = el('li', 'Aulas', 'suggestion-group');
      group.setAttribute('role', 'presentation');
      listbox.append(group);
    }
    options.forEach((option, index) => {
      if (option.kind === 'scope' && (index === 0 || options[index - 1].kind !== 'scope')) {
        const group = el('li', 'Procurar', 'suggestion-group');
        group.setAttribute('role', 'presentation');
        listbox.append(group);
      }
      const item = el('li', null, `suggestion suggestion-${option.kind}`);
      item.id = `global-search-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      if (option.kind === 'lesson')
        item.append(
          markedText('span', option.material.title, q),
          el('small', option.material.subject || 'Sem disciplina'),
        );
      else item.append(el('span', `“${q}” `), el('strong', SCOPES[option.scope]));
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => choose(index));
      option.element = item;
      listbox.append(item);
    });
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  }
  function choose(index) {
    const option = options[index];
    close();
    if (!option) return run(input.value.trim(), 'all');
    if (option.kind === 'lesson') location.href = materialHref(option.material.id);
    else run(input.value.trim(), option.scope);
  }

  input.addEventListener('input', () => void suggest());
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) void suggest();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (listbox.hidden) void suggest();
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlight((active + step + options.length) % options.length);
    } else if (event.key === 'Escape' && !listbox.hidden) {
      event.preventDefault();
      close();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (input.value.trim().length < 2) {
      input.setCustomValidity('Digite pelo menos 2 caracteres.');
      input.reportValidity();
      input.setCustomValidity('');
      return;
    }
    choose(active);
  });

  function setSearching(on) {
    main.dataset.searching = String(on);
    results.hidden = !on;
  }
  function clear() {
    setSearching(false);
    results.replaceChildren();
    input.value = '';
    history.replaceState(null, '', location.pathname);
    input.focus();
  }

  function lessonItem(lesson, q) {
    const link = el('a', null, 'search-result');
    link.href = materialHref(lesson.materialId);
    link.append(
      markedText('strong', lesson.title, q),
      el(
        'small',
        [lesson.subject || 'Sem disciplina', lesson.createdAt ? formatDate(lesson.createdAt) : '']
          .filter(Boolean)
          .join(' · '),
      ),
    );
    if (lesson.byTag) link.append(el('small', 'encontrada pelas suas tags'));
    return link;
  }
  function questionItem(question, q) {
    const link = el('a', null, 'search-result');
    link.href = `${materialHref(question.materialId)}#questoes`;
    link.append(
      el('small', `${question.lessonTitle} · questão ${question.number}`),
      markedText('span', question.statement, q),
    );
    return link;
  }
  function transcriptItem(lesson, q) {
    const block = el('article', null, 'search-transcript');
    block.append(
      el('h3', lesson.lessonTitle),
      el(
        'p',
        `${lesson.subject || 'Sem disciplina'} · ${lesson.total} ${lesson.total === 1 ? 'trecho' : 'trechos'}`,
        'search-meta',
      ),
    );
    const list = el('ul');
    for (const hit of lesson.hits) {
      const item = el('li');
      const link = el('a', null, 'search-result search-hit-row');
      // Opens the lesson on this passage with the term already highlighted.
      link.href = `${materialHref(lesson.materialId)}&busca=${encodeURIComponent(q)}&trecho=${hit.position}#transcricao`;
      link.append(
        el('span', formatTimestamp(hit.startMs), 'search-time'),
        markedText('span', hit.snippet, q),
      );
      item.append(link);
      list.append(item);
    }
    block.append(list);
    if (lesson.total > lesson.hits.length)
      block.append(
        el(
          'p',
          `Mais ${lesson.total - lesson.hits.length} na aula — abra para ver todos.`,
          'search-meta',
        ),
      );
    return block;
  }

  function render(result, q, scope) {
    results.replaceChildren();
    const title = el('h2', `Resultados para “${q}”`);
    title.id = 'global-search-title';
    title.tabIndex = -1;
    const back = el('button', 'Voltar ao painel', 'text-action');
    back.type = 'button';
    back.addEventListener('click', clear);
    const head = el('div', null, 'search-results-head');
    head.append(title, back);
    results.append(head);
    if (scope !== 'all') results.append(el('p', `Procurando ${SCOPES[scope]}.`, 'search-meta'));
    const groups = resultGroups(result);
    if (!groups.length) {
      const empty = emptyState(
        `Nada encontrado para “${q}”`,
        scope === 'all'
          ? 'O Nino procurou nos títulos, nas questões e nas transcrições. Confira a grafia ou tente outra palavra.'
          : `Nada ${SCOPES[scope]}. Que tal procurar em tudo?`,
        { href: null, mascot: 'curious', size: 128 },
      );
      if (scope !== 'all') {
        const everywhere = el('button', 'Buscar em tudo', 'secondary-action');
        everywhere.type = 'button';
        everywhere.addEventListener('click', () => run(q, 'all'));
        empty.querySelector('div').append(everywhere);
      }
      results.append(empty);
      title.focus();
      return;
    }
    const panels = groups.map((group) => {
      const panel = el('div', null, 'search-panel');
      panel.id = `search-panel-${group.key}`;
      const list = el('div', null, 'search-list');
      for (const item of group.items)
        list.append(
          group.key === 'lessons'
            ? lessonItem(item, q)
            : group.key === 'questions'
              ? questionItem(item, q)
              : transcriptItem(item, q),
        );
      panel.append(list);
      return panel;
    });
    if (groups.length === 1) {
      const only = el('h3', `${groups[0].label} (${groups[0].count})`, 'search-single-heading');
      results.append(only, panels[0]);
    } else {
      const tablist = el('div', null, 'search-tabs');
      tablist.setAttribute('role', 'tablist');
      tablist.setAttribute('aria-label', 'Tipos de resultado');
      const tabs = groups.map((group, index) => {
        const tab = el('button', `${group.label} (${group.count})`);
        tab.type = 'button';
        tab.id = `search-tab-${group.key}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panels[index].id);
        panels[index].setAttribute('role', 'tabpanel');
        panels[index].setAttribute('aria-labelledby', tab.id);
        return tab;
      });
      const select = (index, focus = false) => {
        tabs.forEach((tab, i) => {
          tab.setAttribute('aria-selected', String(i === index));
          tab.tabIndex = i === index ? 0 : -1;
          panels[i].hidden = i !== index;
        });
        if (focus) tabs[index].focus();
      };
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(index));
        tab.addEventListener('keydown', (event) => {
          const next = {
            ArrowRight: index + 1,
            ArrowLeft: index - 1,
            Home: 0,
            End: tabs.length - 1,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          select((next + tabs.length) % tabs.length, true);
        });
      });
      tablist.append(...tabs);
      results.append(tablist, ...panels);
      select(0);
    }
    title.focus();
  }

  async function run(q, scope = 'all') {
    if (q.length < 2) return;
    input.value = q;
    close();
    const params = new URLSearchParams({ busca: q, ...(scope !== 'all' ? { em: scope } : {}) });
    history.replaceState(null, '', `${location.pathname}?${params}`);
    setSearching(true);
    results.setAttribute('aria-busy', 'true');
    results.replaceChildren(el('p', 'Procurando…', 'loading-state'));
    const version = ++request;
    try {
      const result = await searchLibrary(q, scope);
      if (version !== request) return;
      // Tags live in this browser, so lessons found by tag are added here.
      if (scope === 'all' || scope === 'lessons') {
        const known = new Set(result.lessons.map((lesson) => lesson.materialId));
        for (const m of await loadMaterials())
          if (!known.has(m.id) && studyFor(m.id).tags.some((tag) => fold(tag).includes(fold(q))))
            result.lessons.push({
              materialId: m.id,
              title: m.title,
              subject: m.subject,
              createdAt: m.created_at,
              byTag: true,
            });
      }
      render(result, q, scope);
    } catch (error) {
      if (version === request)
        results.replaceChildren(
          errorState(error.message || 'A busca não está disponível agora.', () => run(q, scope)),
        );
    } finally {
      if (version === request) results.setAttribute('aria-busy', 'false');
    }
  }

  const params = new URLSearchParams(location.search);
  if (params.get('busca'))
    void run(
      params.get('busca'),
      Object.hasOwn(SCOPES, params.get('em')) ? params.get('em') : 'all',
    );
  return { run, clear };
}
