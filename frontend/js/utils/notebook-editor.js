// Writing surface of the lesson notebook ("Caderno da aula"). One editable region where a person
// clicks and types; Enter starts a new paragraph. The stored format does NOT change: it is still
// the block document of notebook-doc.js (heading, paragraph, bullet_list, ordered_list, checklist,
// quote, annotation_ref), and this module converts blocks <-> editor losslessly.
//
// How it stays predictable:
// - In between, the document is a list of LINES: one per paragraph, heading or quote and one per
//   list item (list items carry their list's block id as `group`). Structural edits (Enter,
//   Backspace at the start of a line, joining lines, changing a line's type, pasting, citing) are
//   pure functions on lines, then the region is drawn again and the caret put back. Only typing
//   inside a line is left to the browser; after each input the region is read back into lines.
// - Plain text only, as before: nothing is ever written with innerHTML; pasted HTML is parsed in
//   an inert document and reduced to text and the supported line types (no scripts, links,
//   styles, images or attributes survive).
// - Blocks the editor cannot edit (a cited highlight, or any block it does not recognise) are
//   kept as read-only "atoms" with their original JSON, so saving never drops them.
import { blockId } from './notebook-doc.js';

export const TEXT_KINDS = Object.freeze(['p', 'h2', 'h3', 'quote']);
export const LIST_KINDS = Object.freeze(['bullet', 'ordered', 'check']);
const LIST_TYPE = { bullet: 'bullet_list', ordered: 'ordered_list', check: 'checklist' };
const LIST_KIND = { bullet_list: 'bullet', ordered_list: 'ordered', checklist: 'check' };
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const isList = (kind) => LIST_KINDS.includes(kind);
const isText = (kind) => TEXT_KINDS.includes(kind);
const clone = (value) => JSON.parse(JSON.stringify(value));
const keys = (object) => Object.keys(object).sort().join();
const isString = (value) => typeof value === 'string';

/** True when a block has exactly the shape this editor edits; anything else is kept as an atom. */
function editable(block) {
  if (!block || typeof block !== 'object' || !isString(block.id)) return false;
  switch (block.type) {
    case 'heading':
      return keys(block) === 'id,level,text,type' && (block.level === 2 || block.level === 3) && isString(block.text);
    case 'paragraph':
    case 'quote':
      return keys(block) === 'id,text,type' && isString(block.text);
    case 'bullet_list':
    case 'ordered_list':
      return keys(block) === 'id,items,type' && Array.isArray(block.items) && block.items.every(isString);
    case 'checklist':
      return (
        keys(block) === 'id,items,type' &&
        Array.isArray(block.items) &&
        block.items.every((item) => item && keys(item) === 'checked,text' && isString(item.text) && typeof item.checked === 'boolean')
      );
    default:
      return false;
  }
}

/** Blocks → lines. Lists become one line per item; an empty list becomes one "phantom" line. */
export function blocksToLines(blocks = []) {
  const lines = [];
  for (const block of blocks) {
    if (!editable(block)) {
      lines.push({ kind: 'atom', id: block?.id, block: clone(block) });
      continue;
    }
    if (block.type === 'heading') lines.push({ kind: block.level === 2 ? 'h2' : 'h3', id: block.id, text: block.text });
    else if (block.type === 'paragraph') lines.push({ kind: 'p', id: block.id, text: block.text });
    else if (block.type === 'quote') lines.push({ kind: 'quote', id: block.id, text: block.text });
    else {
      const kind = LIST_KIND[block.type];
      if (!block.items.length) lines.push({ kind, group: block.id, text: '', phantom: true });
      for (const item of block.items)
        lines.push(
          kind === 'check'
            ? { kind, group: block.id, text: item.text, checked: item.checked }
            : { kind, group: block.id, text: item },
        );
    }
  }
  return lines;
}

/**
 * Lines → blocks. Consecutive list lines of the same kind and group form one list block; a group
 * seen again later, or a repeated id, gets a new id (block ids stay unique). An empty "filler"
 * line (the blank line offered for writing) is not stored.
 */
export function linesToBlocks(lines, makeId = blockId) {
  const blocks = [];
  const used = new Set();
  const take = (id) => {
    const value = isString(id) && ID.test(id) && !used.has(id) ? id : makeId();
    used.add(value);
    return value;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind === 'atom') {
      const block = clone(line.block);
      if (block && typeof block === 'object' && isString(block.id)) {
        if (used.has(block.id)) block.id = makeId();
        used.add(block.id);
      }
      blocks.push(block);
      continue;
    }
    if (isText(line.kind)) {
      if (line.filler && line.text === '') continue;
      const id = take(line.id);
      if (line.kind === 'p') blocks.push({ id, type: 'paragraph', text: line.text });
      else if (line.kind === 'quote') blocks.push({ id, type: 'quote', text: line.text });
      else blocks.push({ id, type: 'heading', level: line.kind === 'h2' ? 2 : 3, text: line.text });
      continue;
    }
    const run = [line];
    while (
      index + 1 < lines.length &&
      lines[index + 1].kind === line.kind &&
      lines[index + 1].group === line.group &&
      line.group !== undefined
    )
      run.push(lines[(index += 1)]);
    const id = take(line.group);
    const empty = run.length === 1 && run[0].phantom && run[0].text === '';
    const items = empty
      ? []
      : run.map((item) => (line.kind === 'check' ? { text: item.text, checked: Boolean(item.checked) } : item.text));
    blocks.push({ id, type: LIST_TYPE[line.kind], items });
  }
  return blocks;
}

// ---- Pure editing operations on lines. Each returns { lines, caret } (caret = {line, offset}). ----

const copyLines = (lines) => lines.map((line) => ({ ...line, ...(line.block ? { block: clone(line.block) } : {}) }));
const plain = (line, changes) => {
  const next = { ...line, ...changes };
  delete next.filler;
  delete next.phantom;
  return next;
};
const textLine = (kind, text, makeId) => ({ kind, id: makeId(), text });

/** Enter: splits the line at the caret. An empty list item leaves the list instead. */
export function splitLine(lines, { line: index, offset }, makeId = blockId) {
  const out = copyLines(lines);
  const line = out[index];
  if (!line || line.kind === 'atom') return { lines: out, caret: { line: index, offset: 0 } };
  if (isList(line.kind) && line.text === '') {
    out[index] = textLine('p', '', makeId);
    // The items after it continue as a new list (linesToBlocks gives the second run a new id).
    for (let next = index + 1; next < out.length && out[next].group === line.group; next += 1)
      out[next] = { ...out[next], group: `${line.group}-${index}` };
    return { lines: out, caret: { line: index, offset: 0 } };
  }
  const head = line.text.slice(0, offset);
  const tail = line.text.slice(offset);
  if (!isList(line.kind) && offset === 0 && line.text !== '') {
    // At the start of a written line: a blank paragraph opens above it.
    out.splice(index, 0, textLine('p', '', makeId));
    return { lines: out, caret: { line: index + 1, offset: 0 } };
  }
  out[index] = plain(line, { text: head });
  let next;
  if (isList(line.kind)) next = { kind: line.kind, group: line.group, text: tail, ...(line.kind === 'check' ? { checked: false } : {}) };
  else next = textLine(line.kind === 'p' || tail === '' ? 'p' : line.kind, tail, makeId);
  out.splice(index + 1, 0, next);
  return { lines: out, caret: { line: index + 1, offset: 0 } };
}

/** Inserts text inside one line (e.g. a line break from Shift+Enter). */
export function insertText(lines, { line: index, offset }, text) {
  const out = copyLines(lines);
  const line = out[index];
  if (!line || line.kind === 'atom') return { lines: out, caret: { line: index, offset } };
  out[index] = plain(line, { text: line.text.slice(0, offset) + text + line.text.slice(offset) });
  return { lines: out, caret: { line: index, offset: offset + text.length } };
}

/**
 * Backspace at the start of a line: a list item, heading or quote becomes a paragraph first;
 * a paragraph joins the line above. Never deletes an atom: returns { blocked: 'atom' }.
 * Returns null when there is nothing to do (the first line).
 */
export function joinBackward(lines, { line: index }, makeId = blockId) {
  const out = copyLines(lines);
  const line = out[index];
  if (!line || line.kind === 'atom') return null;
  if (line.kind !== 'p') {
    const wasList = isList(line.kind);
    out[index] = { kind: 'p', id: wasList ? makeId() : line.id, text: line.text };
    if (wasList)
      for (let next = index + 1; next < out.length && out[next].group === line.group; next += 1)
        out[next] = { ...out[next], group: `${line.group}-${index}` };
    return { lines: out, caret: { line: index, offset: 0 } };
  }
  const previous = out[index - 1];
  if (!previous) return null;
  if (previous.kind === 'atom') {
    if (line.text === '' && index < out.length - 1) {
      out.splice(index, 1);
      return { lines: out, caret: { line: index, offset: 0 } };
    }
    return { blocked: 'atom' };
  }
  const offset = previous.text.length;
  out[index - 1] = plain(previous, { text: previous.text + line.text });
  out.splice(index, 1);
  return { lines: out, caret: { line: index - 1, offset } };
}

/** Delete at the end of a line: the next line joins this one (never an atom). */
export function joinForward(lines, { line: index }) {
  const out = copyLines(lines);
  const line = out[index];
  const next = out[index + 1];
  if (!line || line.kind === 'atom' || !next) return null;
  if (next.kind === 'atom') return { blocked: 'atom' };
  const offset = line.text.length;
  out[index] = plain(line, { text: line.text + next.text });
  out.splice(index + 1, 1);
  return { lines: out, caret: { line: index, offset } };
}

/**
 * Removes the text between two caret positions (a selection across lines), joining the first
 * line's start with the last line's end. Refuses ({ blocked: 'atom' }) when an atom is inside.
 */
export function deleteRange(lines, start, end) {
  if (start.line === end.line) {
    const out = copyLines(lines);
    const line = out[start.line];
    if (!line || line.kind === 'atom') return { blocked: 'atom' };
    out[start.line] = plain(line, { text: line.text.slice(0, start.offset) + line.text.slice(end.offset) });
    return { lines: out, caret: { ...start } };
  }
  for (let index = start.line; index <= end.line; index += 1) if (lines[index]?.kind === 'atom') return { blocked: 'atom' };
  const out = copyLines(lines);
  const first = out[start.line];
  const last = out[end.line];
  out[start.line] = plain(first, { text: first.text.slice(0, start.offset) + last.text.slice(end.offset) });
  out.splice(start.line + 1, end.line - start.line);
  return { lines: out, caret: { ...start } };
}

/**
 * Changes the type of lines `from`..`to` (atoms are left alone). Choosing the list type the lines
 * already have turns them back into paragraphs (a toggle, as in text editors).
 */
export function setKind(lines, from, to, kind, makeId = blockId) {
  const out = copyLines(lines);
  const range = out.slice(from, to + 1).filter((line) => line.kind !== 'atom');
  if (!range.length) return { lines: out };
  const target = isList(kind) && range.every((line) => line.kind === kind) ? 'p' : kind;
  let group;
  if (isList(target)) {
    const before = out[from - 1];
    group = before?.kind === target ? before.group : range.find((line) => line.id)?.id || makeId();
  }
  const splitGroups = new Set();
  for (let index = from; index <= to; index += 1) {
    const line = out[index];
    if (line.kind === 'atom') continue;
    if (isList(line.kind) && line.kind !== target) splitGroups.add(line.group);
    if (isList(target)) out[index] = { kind: target, group, text: line.text, ...(target === 'check' ? { checked: Boolean(line.checked) } : {}) };
    else out[index] = { kind: target, id: !isList(line.kind) ? line.id : makeId(), text: line.text };
  }
  // List items after the changed ones continue as their own list.
  for (let index = to + 1; index < out.length && splitGroups.has(out[index].group); index += 1)
    out[index] = { ...out[index], group: `${out[index].group}-${to}` };
  return { lines: out };
}

export function toggleChecked(lines, index) {
  const out = copyLines(lines);
  if (out[index]?.kind !== 'check') return { lines: out };
  out[index] = plain(out[index], { checked: !out[index].checked });
  return { lines: out };
}

/**
 * Inserts lines at the caret (paste). A single plain paragraph goes inside the current line; more
 * lines split it, keeping the text before and after the caret.
 */
export function insertLines(lines, { line: index, offset }, incoming, makeId = blockId) {
  if (!incoming.length) return { lines: copyLines(lines), caret: { line: index, offset } };
  const out = copyLines(lines);
  const line = out[index];
  if (!line) {
    out.push(...copyLines(incoming));
    const last = out.length - 1;
    return { lines: out, caret: { line: last, offset: out[last].text?.length || 0 } };
  }
  if (line.kind === 'atom') {
    out.splice(index + 1, 0, ...copyLines(incoming));
    const last = index + incoming.length;
    return { lines: out, caret: { line: last, offset: out[last].text?.length || 0 } };
  }
  if (incoming.length === 1 && incoming[0].kind === 'p') return insertText(lines, { line: index, offset }, incoming[0].text);
  const head = line.text.slice(0, offset);
  const tail = line.text.slice(offset);
  const replacement = [];
  if (head !== '') replacement.push(plain(line, { text: head }));
  replacement.push(...copyLines(incoming));
  const caretLine = index + replacement.length - 1;
  const caretOffset = replacement.at(-1).text?.length || 0;
  if (tail !== '')
    replacement.push(
      isList(line.kind)
        ? { kind: line.kind, group: line.group, text: tail, ...(line.kind === 'check' ? { checked: false } : {}) }
        : { kind: line.kind, id: head === '' ? line.id : makeId(), text: tail },
    );
  out.splice(index, 1, ...replacement);
  return { lines: out, caret: { line: caretLine, offset: caretOffset } };
}

/**
 * Inserts an atom (a cited highlight) near the caret: above an empty line, otherwise below the
 * current line; with no caret, at the end. A blank line always follows, to keep writing.
 */
export function insertAtom(lines, block, at = null, makeId = blockId) {
  const out = copyLines(lines).filter((line, index, all) => !(line.filler && line.text === '' && index === all.length - 1 && !at));
  const atom = { kind: 'atom', id: block.id, block: clone(block) };
  let index;
  if (at && out[at.line] && out[at.line].kind !== 'atom' && out[at.line].text === '') index = at.line;
  else if (at && out[at.line]) index = at.line + 1;
  else index = out.length;
  out.splice(index, 0, atom);
  if (!out[index + 1]) out.push({ ...textLine('p', '', makeId), filler: true });
  return { lines: out, caret: { line: index + 1, offset: 0 } };
}

/** Removes the atom with this block id. */
export function removeAtom(lines, id) {
  const out = copyLines(lines);
  const index = out.findIndex((line) => line.kind === 'atom' && line.id === id);
  if (index < 0) return null;
  out.splice(index, 1);
  return { lines: out, caret: { line: Math.min(index, Math.max(out.length - 1, 0)), offset: 0 } };
}

/** Markdown-like start of a line ("# ", "- ", "1. ", "[ ] ", "> ") → the line type it asks for. */
export function shortcutFor(prefix) {
  const marks = {
    '#': { kind: 'h2' },
    '##': { kind: 'h3' },
    '###': { kind: 'h3' },
    '-': { kind: 'bullet' },
    '*': { kind: 'bullet' },
    '•': { kind: 'bullet' },
    '1.': { kind: 'ordered' },
    '1)': { kind: 'ordered' },
    '[]': { kind: 'check', checked: false },
    '[ ]': { kind: 'check', checked: false },
    '[x]': { kind: 'check', checked: true },
    '[X]': { kind: 'check', checked: true },
    '>': { kind: 'quote' },
  };
  return marks[prefix] || null;
}

/** A line written with a markdown-like start (plain text paste): its type and text. */
function markdownLine(raw) {
  const patterns = [
    [/^#\s+(.*)$/, () => ({ kind: 'h2' })],
    [/^#{2,6}\s+(.*)$/, () => ({ kind: 'h3' })],
    [/^[-*•]\s+\[([ xX]?)\]\s+(.*)$/, (m) => ({ kind: 'check', checked: /x/i.test(m[1]), text: m[2] })],
    [/^\[([ xX]?)\]\s+(.*)$/, (m) => ({ kind: 'check', checked: /x/i.test(m[1]), text: m[2] })],
    [/^[-*•]\s+(.*)$/, () => ({ kind: 'bullet' })],
    [/^\d{1,3}[.)]\s+(.*)$/, () => ({ kind: 'ordered' })],
    [/^>\s?(.*)$/, () => ({ kind: 'quote' })],
  ];
  for (const [pattern, make] of patterns) {
    const match = raw.match(pattern);
    if (match) return { text: match[1], ...make(match) };
  }
  return { kind: 'p', text: raw };
}

/** Groups consecutive list lines of the same kind (pasted content). */
function grouped(items, makeId) {
  const out = [];
  let group = null;
  let previous = null;
  for (const item of items) {
    if (isList(item.kind)) {
      if (previous !== item.kind || item.newList) group = makeId();
      out.push({ kind: item.kind, group, text: item.text, ...(item.kind === 'check' ? { checked: Boolean(item.checked) } : {}) });
    } else out.push({ kind: item.kind, id: makeId(), text: item.text });
    previous = item.kind;
  }
  return out;
}

/** Pasted plain text → lines. One line of text stays inline; markdown-like starts are honoured. */
export function textToLines(text, makeId = blockId) {
  const rows = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (rows.length === 1) return [{ kind: 'p', id: makeId(), text: rows[0] }];
  return grouped(
    rows.filter((row) => row.trim() !== '').map((row) => markdownLine(row.replace(/\s+$/, ''))),
    makeId,
  );
}

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'HEAD', 'TITLE',
  'META', 'LINK', 'BUTTON', 'SELECT', 'OPTION', 'TEXTAREA', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'PICTURE', 'SOURCE',
]);
const BLOCK = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'PRE',
  'TABLE', 'TBODY', 'THEAD', 'TR', 'DL', 'DT', 'DD', 'HR', 'ADDRESS', 'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY',
]);

/**
 * Pasted HTML → lines of the supported types. The HTML is parsed into an inert document (nothing
 * runs or loads) and only text is read from it: formatting outside the supported subset becomes
 * plain text; scripts, styles, media and form controls are dropped entirely.
 */
export function htmlToLines(html, makeId = blockId, parser = new globalThis.DOMParser()) {
  const doc = parser.parseFromString(String(html), 'text/html');
  const items = [];
  let buffer = '';
  let kind = 'p';
  let checked = false;
  let newList = false;
  const flush = () => {
    const text = buffer
      .replace(/[ \t\f\v\u00a0]*\n[ \t\f\v\u00a0]*/g, '\n')
      .replace(/^\n+|\n+$/g, '')
      .replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, '');
    if (text) {
      items.push({ kind, text, checked, newList });
      newList = false;
    }
    buffer = '';
    checked = false;
  };
  const walk = (node, pre) => {
    if (node.nodeType === 3) {
      buffer += pre ? node.data : node.data.replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (tag === 'BR') {
      buffer += '\n';
      return;
    }
    if (tag === 'INPUT') {
      if (String(node.getAttribute('type')).toLowerCase() === 'checkbox') {
        if (kind === 'bullet' || kind === 'ordered' || kind === 'check') kind = 'check';
        checked = node.hasAttribute('checked');
      }
      return;
    }
    const children = () => [...node.childNodes].forEach((child) => walk(child, pre || tag === 'PRE'));
    const inKind = (next, fn) => {
      const saved = kind;
      kind = next;
      fn();
      kind = saved;
    };
    if (/^H[1-6]$/.test(tag)) {
      flush();
      inKind(tag === 'H1' || tag === 'H2' ? 'h2' : 'h3', () => {
        children();
        flush();
      });
    } else if (tag === 'BLOCKQUOTE') {
      flush();
      inKind('quote', () => {
        children();
        flush();
      });
    } else if (tag === 'UL' || tag === 'OL') {
      flush();
      if (!isList(kind)) newList = true;
      const listKind = tag === 'OL' ? 'ordered' : 'bullet';
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && child.tagName.toUpperCase() === 'LI') {
          inKind(listKind, () => {
            [...child.childNodes].forEach((grand) => walk(grand, pre));
            if (/^\s*\[([ xX]?)\]\s+/.test(buffer)) {
              checked = /x/i.test(buffer.match(/^\s*\[([ xX]?)\]/)[1]);
              buffer = buffer.replace(/^\s*\[[ xX]?\]\s+/, '');
              kind = 'check';
            }
            flush();
          });
        } else walk(child, pre);
      }
      flush();
    } else if (tag === 'LI') {
      flush();
      inKind(isList(kind) ? kind : 'bullet', () => {
        children();
        flush();
      });
    } else if (BLOCK.has(tag) || tag === 'TD' || tag === 'TH') {
      if (tag === 'TD' || tag === 'TH') {
        if (buffer && !/\s$/.test(buffer)) buffer += ' ';
        children();
        return;
      }
      flush();
      children();
      flush();
    } else children();
  };
  walk(doc.body, false);
  flush();
  return grouped(items, makeId);
}

// ---- DOM: drawing lines, reading them back, caret <-> {line, offset} --------------------------

const TAG_OF = { p: 'P', h2: 'H3', h3: 'H4', quote: 'BLOCKQUOTE' };
const KIND_OF_TAG = { P: 'p', DIV: 'p', H1: 'h2', H2: 'h2', H3: 'h2', H4: 'h3', H5: 'h3', H6: 'h3', BLOCKQUOTE: 'quote' };

/** Text with line breaks as <br>; an empty or newline-ending text gets the extra <br> it needs to show. */
function fillText(doc, element, text) {
  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (index) element.append(doc.createElement('br'));
    if (part) element.append(doc.createTextNode(part));
  });
  if (text === '' || text.endsWith('\n')) element.append(doc.createElement('br'));
}

function checkBox(doc, checked) {
  const wrap = doc.createElement('span');
  wrap.className = 'nb-check';
  wrap.setAttribute('contenteditable', 'false');
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.tabIndex = -1;
  input.checked = checked;
  input.setAttribute('aria-label', 'Concluído');
  wrap.append(input);
  return wrap;
}

/** Draws lines into the editable root. `renderAtom(block, figure)` fills a read-only atom. */
export function renderLines(root, lines, { renderAtom = () => {} } = {}) {
  const doc = root.ownerDocument;
  const nodes = [];
  let list = null;
  for (const line of lines) {
    if (isList(line.kind)) {
      if (!list || list.kind !== line.kind || list.group !== line.group) {
        const element = doc.createElement(line.kind === 'ordered' ? 'ol' : 'ul');
        if (line.kind === 'check') element.dataset.type = 'checklist';
        if (line.group) element.dataset.blockId = line.group;
        list = { kind: line.kind, group: line.group, element };
        nodes.push(element);
      }
      const item = doc.createElement('li');
      if (line.kind === 'check') {
        item.dataset.checked = String(Boolean(line.checked));
        item.append(checkBox(doc, Boolean(line.checked)));
      }
      if (line.phantom) item.dataset.nbPhantom = '';
      fillText(doc, item, line.text);
      list.element.append(item);
      continue;
    }
    list = null;
    if (line.kind === 'atom') {
      const figure = doc.createElement('figure');
      figure.className = 'nb-atom';
      figure.setAttribute('contenteditable', 'false');
      if (isString(line.id)) figure.dataset.blockId = line.id;
      renderAtom(line.block, figure);
      nodes.push(figure);
      continue;
    }
    const element = doc.createElement(TAG_OF[line.kind]);
    if (line.id) element.dataset.blockId = line.id;
    if (line.filler) element.dataset.nbFiller = '';
    fillText(doc, element, line.text);
    nodes.push(element);
  }
  root.replaceChildren(...nodes);
}

/** Lines with a writable blank line wherever a person could not otherwise place the caret. */
export function withWritableEnd(lines, makeId = blockId) {
  if (!lines.length || lines.at(-1).kind === 'atom') return [...lines, { kind: 'p', id: makeId(), text: '', filler: true }];
  return lines;
}

const skipNode = (node) => node.nodeType === 1 && (node.classList?.contains('nb-check') || node.getAttribute?.('contenteditable') === 'false');

/** Text of one line element: text nodes and <br> as "\n"; a final <br> is only the browser's placeholder. */
function lineText(element, flags) {
  const tokens = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (child.data) tokens.push(child.data);
      } else if (child.nodeType === 1) {
        if (skipNode(child)) continue;
        const tag = child.tagName.toUpperCase();
        if (tag === 'BR') tokens.push('\n');
        else {
          flags.irregular = true;
          if ((BLOCK.has(tag) || KIND_OF_TAG[tag] || tag === 'LI') && tokens.length && tokens.at(-1) !== '\n') tokens.push('\n');
          walk(child);
        }
      }
    }
  };
  walk(element);
  if (tokens.at(-1) === '\n') tokens.pop();
  return tokens.join('');
}

/** The elements that hold one line each, in order (top-level blocks, and list items). */
export function lineElements(root) {
  const out = [];
  for (const child of root.children) {
    const tag = child.tagName.toUpperCase();
    if (tag === 'UL' || tag === 'OL') out.push(...[...child.children].filter((item) => item.tagName.toUpperCase() === 'LI'));
    else out.push(child);
  }
  return out;
}

/**
 * Reads the region back into lines. `atoms` maps an atom's block id to its stored block.
 * `irregular` says the markup is not exactly what renderLines draws (the browser added a <div>,
 * a <span>, text outside a paragraph…): the caller then draws the lines again.
 */
export function readLines(root, atoms = new Map()) {
  const flags = { irregular: false };
  const lines = [];
  let run = null;
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3 || (node.nodeType === 1 && !KIND_OF_TAG[node.tagName.toUpperCase()] && !['UL', 'OL', 'FIGURE', 'BR'].includes(node.tagName.toUpperCase()))) {
      if (node.nodeType === 3 && !/\S/.test(node.data) && !run) continue;
      flags.irregular = true;
      if (!run) {
        run = { kind: 'p', text: '' };
        lines.push(run);
      }
      run.text += node.nodeType === 3 ? node.data : lineText(node, flags);
      continue;
    }
    run = null;
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();
    if (tag === 'BR') {
      flags.irregular = true;
      continue;
    }
    if (tag === 'FIGURE') {
      const block = atoms.get(node.dataset.blockId);
      if (block) lines.push({ kind: 'atom', id: node.dataset.blockId, block: clone(block) });
      else flags.irregular = true;
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      const kind = tag === 'OL' ? 'ordered' : node.dataset.type === 'checklist' ? 'check' : 'bullet';
      const group = node.dataset.blockId || undefined;
      if (!group) flags.irregular = true;
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3 && !/\S/.test(child.data)) continue;
        const isItem = child.nodeType === 1 && child.tagName.toUpperCase() === 'LI';
        if (!isItem) flags.irregular = true;
        const text = child.nodeType === 3 ? child.data : lineText(child, flags);
        const line = { kind, group, text };
        if (kind === 'check') {
          line.checked = isItem && child.dataset.checked === 'true';
          const box = isItem ? child.querySelector(':scope > .nb-check') : null;
          if (!box || box !== child.firstChild) flags.irregular = true;
        }
        if (isItem && 'nbPhantom' in child.dataset && text === '') line.phantom = true;
        lines.push(line);
      }
      continue;
    }
    if (tag !== 'P' && tag !== 'H3' && tag !== 'H4' && tag !== 'BLOCKQUOTE') flags.irregular = true;
    const line = { kind: KIND_OF_TAG[tag], id: node.dataset.blockId || undefined, text: lineText(node, flags) };
    if ('nbFiller' in node.dataset && line.text === '') line.filler = true;
    lines.push(line);
  }
  // Repeated ids (the browser copies attributes when it splits an element) are made unique.
  const seen = new Set();
  for (const line of lines) {
    if (line.kind === 'atom' || isList(line.kind) || !line.id) continue;
    if (seen.has(line.id)) {
      line.id = undefined;
      flags.irregular = true;
    } else seen.add(line.id);
  }
  return { lines, irregular: flags.irregular };
}

/** Text offset of a DOM point inside a line element (text and <br> count; the check box does not). */
function offsetIn(element, container, offset) {
  const doc = element.ownerDocument;
  const range = doc.createRange();
  range.setStart(element, 0);
  try {
    range.setEnd(container, offset);
  } catch {
    return 0;
  }
  let count = 0;
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (skipNode(child)) continue;
      if (child === container && child.nodeType === 3) {
        count += offset;
        return true;
      }
      if (child.nodeType === 3) {
        if (range.comparePoint(child, child.data.length) <= 0) count += child.data.length;
        else return true;
      } else if (child.nodeType === 1) {
        if (child.tagName.toUpperCase() === 'BR') {
          const parent = child.parentNode;
          const index = [...parent.childNodes].indexOf(child);
          if (range.comparePoint(parent, index + 1) <= 0) count += 1;
          else return true;
        } else if (walk(child)) return true;
      }
    }
    return false;
  };
  walk(element);
  return count;
}

/** {line, offset} of a DOM point inside the region, or null. */
export function pointToCaret(root, container, offset) {
  const elements = lineElements(root);
  if (container === root) {
    // Between top-level children: start of the next line, or end of the previous one.
    const child = root.childNodes[offset];
    const before = root.childNodes[offset - 1];
    const firstOf = (node) => elements.findIndex((element) => element === node || node?.contains?.(element));
    if (child) {
      const index = firstOf(child);
      if (index >= 0) return { line: index, offset: 0 };
    }
    if (before) {
      const matches = elements.map((element, index) => (element === before || before.contains(element) ? index : -1)).filter((i) => i >= 0);
      const index = matches.at(-1);
      if (index !== undefined) return { line: index, offset: lineLength(elements[index]) };
    }
    return elements.length ? { line: 0, offset: 0 } : null;
  }
  const index = elements.findIndex((element) => element === container || element.contains(container));
  if (index < 0) {
    // Inside a list but outside its items (between <li>s).
    const list = [...root.children].find((child) => child.contains(container));
    if (list) {
      const item = list.children[Math.min(offset, list.children.length - 1)];
      const at = elements.indexOf(item);
      if (at >= 0) return { line: at, offset: 0 };
    }
    return null;
  }
  const element = elements[index];
  if (element.tagName.toUpperCase() === 'FIGURE') return { line: index, offset: 0, atom: true };
  return { line: index, offset: offsetIn(element, container, offset) };
}

function lineLength(element) {
  return lineText(element, { irregular: false }).length;
}

/** Current selection as {start, end, collapsed} in line coordinates, or null when outside. */
export function selectionInLines(root) {
  const selection = root.ownerDocument.getSelection?.();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = pointToCaret(root, range.startContainer, range.startOffset);
  const end = range.collapsed ? start : pointToCaret(root, range.endContainer, range.endOffset);
  if (!start || !end) return null;
  return { start, end, collapsed: range.collapsed || (start.line === end.line && start.offset === end.offset) };
}

/** Puts the caret at {line, offset}. */
export function placeCaret(root, { line, offset }) {
  const doc = root.ownerDocument;
  const elements = lineElements(root);
  const element = elements[Math.max(0, Math.min(line, elements.length - 1))];
  const selection = doc.getSelection?.();
  if (!element || !selection) return;
  const range = doc.createRange();
  if (element.tagName.toUpperCase() === 'FIGURE') {
    range.setStartBefore(element);
  } else {
    let left = Math.max(0, offset);
    let placed = false;
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (placed) return;
        if (skipNode(child)) continue;
        if (child.nodeType === 3) {
          if (left <= child.data.length) {
            range.setStart(child, left);
            placed = true;
            return;
          }
          left -= child.data.length;
        } else if (child.nodeType === 1) {
          if (child.tagName.toUpperCase() === 'BR') {
            if (left === 0) {
              range.setStartBefore(child);
              placed = true;
              return;
            }
            left -= 1;
          } else walk(child);
        }
      }
    };
    walk(element);
    if (!placed) {
      // End of the line: before its placeholder <br>, if any.
      const last = element.lastChild;
      if (last?.nodeType === 1 && last.tagName.toUpperCase() === 'BR') range.setStartBefore(last);
      else range.setStart(element, element.childNodes.length);
    }
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// ---- The editor ------------------------------------------------------------------------------

const KIND_NAMES = {
  p: 'Texto',
  h2: 'Título',
  h3: 'Subtítulo',
  bullet: 'Lista',
  ordered: 'Lista numerada',
  check: 'Checklist',
  quote: 'Citação',
};
export const KIND_LABELS = Object.freeze(KIND_NAMES);

/**
 * Turns `root` (an element) into the notebook's writing region.
 * onChange(blocks) after every change; onCaret(kind) when the caret moves to a line of another type;
 * renderAtom(block, figure) draws a read-only block; announce(text) speaks a short message.
 */
export function createNotebookEditor({
  root,
  onChange = () => {},
  onCaret = () => {},
  renderAtom = () => {},
  announce = () => {},
  makeId = blockId,
}) {
  const doc = root.ownerDocument;
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.spellcheck = true;
  root.setAttribute('translate', 'no');
  let lines = withWritableEnd([], makeId);
  let atoms = new Map();
  let composing = false;
  let lastCaret = null;
  let lastKind = null;
  const undo = [];
  const redo = [];
  let typingAt = 0;

  const snapshot = () => ({ lines: copyLines(lines), caret: lastCaret ? { ...lastCaret } : null });
  const remember = () => {
    undo.push(snapshot());
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    typingAt = 0;
  };
  const indexAtoms = () => {
    atoms = new Map(lines.filter((line) => line.kind === 'atom' && isString(line.id)).map((line) => [line.id, line.block]));
  };
  const emptyState = () => lines.length === 1 && lines[0].kind === 'p' && lines[0].text === '';
  const paintEmpty = () => root.classList.toggle('is-empty', emptyState());

  function draw(next, caret, { focus = true } = {}) {
    lines = withWritableEnd(next, makeId);
    indexAtoms();
    renderLines(root, lines, { renderAtom });
    paintEmpty();
    if (caret && focus) {
      if (doc.activeElement !== root) root.focus({ preventScroll: true });
      placeCaret(root, caret);
      lastCaret = { ...caret };
    }
    trackCaret();
  }
  function emit() {
    onChange(linesToBlocks(lines, makeId));
  }
  function apply(result, { record = true } = {}) {
    if (!result) return false;
    if (result.blocked) {
      announce('A citação da aula não é apagada pelo teclado. Use o botão “Remover citação” dela.');
      return false;
    }
    if (record) remember();
    draw(result.lines, result.caret || lastCaret);
    emit();
    return true;
  }
  function sync() {
    const read = readLines(root, atoms);
    lines = read.lines;
    if (read.irregular && !composing) {
      const caret = selectionInLines(root)?.start || lastCaret;
      draw(lines, caret, { focus: doc.activeElement === root });
    } else paintEmpty();
    emit();
  }
  function trackCaret() {
    const selection = selectionInLines(root);
    if (!selection) return;
    lastCaret = { ...selection.start };
    delete lastCaret.atom;
    const kind = lines[selection.start.line]?.kind || null;
    if (kind !== lastKind) {
      lastKind = kind;
      onCaret(kind);
    }
  }
  const lengthOf = (index) => lines[index]?.text?.length ?? 0;
  const touchesAtom = (selection) => {
    for (let index = selection.start.line; index <= selection.end.line; index += 1) if (lines[index]?.kind === 'atom') return true;
    return false;
  };

  root.addEventListener('beforeinput', (event) => {
    const type = event.inputType || '';
    if (type.startsWith('format')) {
      event.preventDefault();
      return;
    }
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (type === 'historyUndo') undoStep();
      else redoStep();
      return;
    }
    if (type === 'insertFromDrop' || type === 'deleteByDrag') {
      event.preventDefault();
      return;
    }
    if (composing || event.isComposing) return;
    const selection = selectionInLines(root);
    if (!selection) return;
    if (!selection.collapsed && touchesAtom(selection) && (type.startsWith('insert') || type.startsWith('delete'))) {
      event.preventDefault();
      announce('A seleção inclui uma citação da aula. Para tirá-la, use o botão “Remover citação”.');
      return;
    }
    const crossLines = !selection.collapsed && selection.start.line !== selection.end.line;
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      remember();
      let state = { lines, caret: selection.start };
      if (!selection.collapsed) state = deleteRange(lines, selection.start, selection.end);
      const result = type === 'insertParagraph' ? splitLine(state.lines, state.caret, makeId) : insertText(state.lines, state.caret, '\n');
      apply(result, { record: false });
      return;
    }
    if (type.startsWith('delete') && crossLines) {
      event.preventDefault();
      apply(deleteRange(lines, selection.start, selection.end));
      return;
    }
    if (type === 'insertText' && crossLines) {
      event.preventDefault();
      remember();
      const removed = deleteRange(lines, selection.start, selection.end);
      apply(insertText(removed.lines, removed.caret, event.data || ''), { record: false });
      return;
    }
    if (selection.collapsed && type === 'deleteContentBackward' && selection.start.offset === 0) {
      event.preventDefault();
      apply(joinBackward(lines, selection.start, makeId));
      return;
    }
    if (selection.collapsed && type === 'deleteContentForward' && selection.start.offset >= lengthOf(selection.start.line)) {
      event.preventDefault();
      apply(joinForward(lines, selection.start));
      return;
    }
    if (type === 'insertText' && event.data === ' ' && selection.collapsed) {
      const line = lines[selection.start.line];
      const mark = line?.kind === 'p' ? shortcutFor(line.text.slice(0, selection.start.offset)) : null;
      if (mark) {
        event.preventDefault();
        remember();
        const trimmed = copyLines(lines);
        trimmed[selection.start.line] = plain(line, { text: line.text.slice(selection.start.offset) });
        const changed = setKind(trimmed, selection.start.line, selection.start.line, mark.kind, makeId);
        if (mark.checked) changed.lines[selection.start.line].checked = true;
        draw(changed.lines, { line: selection.start.line, offset: 0 });
        emit();
        announce(`${KIND_NAMES[mark.kind]}.`);
        return;
      }
    }
    // Plain typing: one undo step per burst of typing.
    if (type.startsWith('insert') || type.startsWith('delete')) {
      const now = Date.now();
      if (now - typingAt > 1000) {
        undo.push(snapshot());
        if (undo.length > 100) undo.shift();
        redo.length = 0;
      }
      typingAt = now;
    }
  });
  root.addEventListener('input', () => {
    if (!composing) sync();
  });
  root.addEventListener('compositionstart', () => {
    composing = true;
  });
  root.addEventListener('compositionend', () => {
    composing = false;
    sync();
  });
  root.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    const selection = selectionInLines(root) || (lastCaret && { start: lastCaret, end: lastCaret, collapsed: true });
    if (!selection) return;
    if (!selection.collapsed && touchesAtom(selection)) {
      announce('A seleção inclui uma citação da aula. Para tirá-la, use o botão “Remover citação”.');
      return;
    }
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    let incoming = html ? htmlToLines(html, makeId) : textToLines(text, makeId);
    if (!incoming.length && text) incoming = textToLines(text, makeId);
    if (!incoming.length) return;
    remember();
    let state = { lines, caret: selection.start };
    if (!selection.collapsed) state = deleteRange(lines, selection.start, selection.end);
    apply(insertLines(state.lines, state.caret, incoming, makeId), { record: false });
  });
  root.addEventListener('drop', (event) => event.preventDefault());
  root.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoStep();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redoStep();
    } else if (['b', 'i', 'u'].includes(key) && !event.altKey) {
      event.preventDefault();
    } else if (key === 'enter') {
      event.preventDefault();
      const caret = selectionInLines(root)?.start;
      if (caret && lines[caret.line]?.kind === 'check') {
        apply({ ...toggleChecked(lines, caret.line), caret });
        announce(lines[caret.line].checked ? 'Item marcado.' : 'Item desmarcado.');
      }
    } else if (event.altKey && ['0', '1', '2'].includes(event.key)) {
      event.preventDefault();
      setLineKind({ 0: 'p', 1: 'h2', 2: 'h3' }[event.key]);
    } else if (event.shiftKey && ['7', '8', '9'].includes(event.code?.replace('Digit', '') || event.key)) {
      event.preventDefault();
      setLineKind({ 7: 'ordered', 8: 'bullet', 9: 'check' }[event.code?.replace('Digit', '') || event.key]);
    }
  });
  // Ticking a checklist item (the box sits in the text, outside the editable flow).
  root.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof doc.defaultView.HTMLInputElement) || input.type !== 'checkbox') return;
    const item = input.closest('li');
    const index = lineElements(root).indexOf(item);
    if (index < 0) return;
    remember();
    const toggled = toggleChecked(lines, index);
    lines = toggled.lines;
    item.dataset.checked = String(input.checked);
    lines[index].checked = input.checked;
    emit();
    announce(input.checked ? 'Item marcado.' : 'Item desmarcado.');
  });
  doc.addEventListener('selectionchange', () => {
    if (doc.activeElement === root) trackCaret();
  });

  function undoStep() {
    const previous = undo.pop();
    if (!previous) {
      announce('Nada para desfazer.');
      return;
    }
    redo.push(snapshot());
    typingAt = 0;
    draw(previous.lines, previous.caret || { line: 0, offset: 0 });
    emit();
  }
  function redoStep() {
    const next = redo.pop();
    if (!next) return;
    undo.push(snapshot());
    typingAt = 0;
    draw(next.lines, next.caret || { line: 0, offset: 0 });
    emit();
  }
  function currentRange() {
    const selection = selectionInLines(root);
    if (selection) return selection;
    if (lastCaret) return { start: lastCaret, end: lastCaret, collapsed: true };
    return null;
  }
  function setLineKind(kind) {
    const range = currentRange() || { start: { line: lines.length - 1, offset: lengthOf(lines.length - 1) }, end: null };
    const end = range.end || range.start;
    const result = setKind(lines, range.start.line, end.line, kind, makeId);
    apply({ lines: result.lines, caret: range.start });
    const now = lines[range.start.line]?.kind;
    lastKind = now;
    onCaret(now);
    announce(`${KIND_NAMES[now] || 'Texto'}.`);
  }

  return {
    /** Shows a document (blocks) — on load, after a conflict, never while typing. */
    setBlocks(blocks) {
      undo.length = 0;
      redo.length = 0;
      draw(blocksToLines(blocks), null, { focus: false });
    },
    getBlocks: () => linesToBlocks(lines, makeId),
    get lines() {
      return copyLines(lines);
    },
    setLineKind,
    currentKind: () => lastKind,
    /** Cites a block (an annotation reference) at the caret, or at the end. */
    insertAtom(block) {
      apply(insertAtom(lines, block, lastCaret, makeId));
    },
    removeAtom(id) {
      return apply(removeAtom(lines, id));
    },
    /** Draws the atoms again (e.g. when the reference data arrives); the text is untouched. */
    refreshAtoms() {
      for (const figure of root.querySelectorAll(':scope > figure.nb-atom')) {
        const block = atoms.get(figure.dataset.blockId);
        if (!block) continue;
        figure.replaceChildren();
        renderAtom(block, figure);
      }
    },
    /** Focus with the caret at the end of the text (or on a given line). */
    focus(caret) {
      const last = lines.length - 1;
      const target = caret || { line: last, offset: lengthOf(last) };
      root.focus({ preventScroll: Boolean(caret) });
      placeCaret(root, target);
      lastCaret = { ...target };
      trackCaret();
    },
    lineOfBlock(id) {
      return lines.findIndex((line) => line.id === id || line.group === id);
    },
    undo: undoStep,
    redo: redoStep,
  };
}
