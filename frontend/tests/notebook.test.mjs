import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  readingSelectionAnchor,
  focusReadingAnnotation,
  focusAnnotation,
  isMultiSegment,
} from '../js/utils/annotation-anchor.js';
import {
  createAutosave,
  emptyContent,
  keepBoth,
  hasMarkup,
  newBlock,
  referenceBlock,
  ADDABLE_BLOCKS,
  limitProblem,
} from '../js/utils/notebook-doc.js';
import {
  blocksToLines,
  linesToBlocks,
  renderLines,
  readLines,
  splitLine,
  joinBackward,
  deleteRange,
  removeAtom,
  setKind,
  toggleChecked,
  insertText,
  insertLines,
  insertAtom,
  shortcutFor,
  htmlToLines,
  textToLines,
} from '../js/utils/notebook-editor.js';

const SEGMENTS = ['Energia é conservada.', 'Uma afirmação citada pode ser refutada.', 'Calor é energia em trânsito.'];
function transcript() {
  const dom = new JSDOM(
    `<div id="segments">${SEGMENTS.map(
      (text, position) =>
        `<article class="transcription-segment" data-segment-position="${position}" data-start-ms="${position * 3000}"><button class="segment-timestamp">00:0${position}</button><p class="segment-text">${text}</p><textarea>${text}</textarea></article>`,
    ).join('')}</div>`,
  );
  const { window } = dom;
  Object.assign(globalThis, { document: window.document, NodeFilter: window.NodeFilter, getSelection: () => window.getSelection() });
  const texts = [...window.document.querySelectorAll('.segment-text')];
  const select = (fromSegment, fromOffset, toSegment, toOffset) => {
    const range = window.document.createRange();
    range.setStart(texts[fromSegment].firstChild, fromOffset);
    range.setEnd(texts[toSegment].firstChild, toOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  };
  return { dom, container: window.document.querySelector('#segments'), select, texts };
}

test('reading selection across segments: anchors, quote joined by line breaks, limits', () => {
  const { dom, container, select } = transcript();
  try {
    const two = select(0, 8, 1, 13);
    assert.deepEqual(readingSelectionAnchor(container, two), { error: 'multi' }, 'without Notes 3.0');
    const anchor = readingSelectionAnchor(container, two, { multi: true });
    assert.deepEqual(
      { ...anchor },
      { segmentPosition: 0, startOffset: 8, endSegmentPosition: 1, endOffset: 13, quote: 'é conservada.\nUma afirmação', startMs: 0 },
      'the timestamp button between segments is not part of the quote',
    );
    const three = readingSelectionAnchor(container, select(0, 0, 2, 5), { multi: true });
    assert.equal(three.quote, `${SEGMENTS[0]}\n${SEGMENTS[1]}\nCalor`);
    assert.equal(three.endSegmentPosition, 2);
    // Ending at the very start of the next segment (or starting at the end of one) drops it.
    const trimmed = readingSelectionAnchor(container, select(0, 21, 2, 0), { multi: true });
    assert.deepEqual([trimmed.segmentPosition, trimmed.startOffset, trimmed.endSegmentPosition ?? trimmed.segmentPosition, trimmed.endOffset], [1, 0, 1, SEGMENTS[1].length]);
    assert.equal(trimmed.endSegmentPosition, undefined, 'collapses to a single-segment anchor');
    // Single segment keeps the previous shape.
    const single = readingSelectionAnchor(container, select(2, 19, 2, 27));
    assert.equal(single.quote, 'trânsito');
    assert.equal(single.endSegmentPosition, undefined);
  } finally {
    dom.window.close();
  }
});

test('going back to a multi-segment highlight selects it again; another revision does not', () => {
  const { dom, container } = transcript();
  try {
    const note = { source_revision: 2, segment_position: 0, start_offset: 8, end_segment_position: 1, end_offset: 13, quote: 'é conservada.\nUma afirmação' };
    assert(isMultiSegment(note));
    assert(focusReadingAnnotation(note, container, 2));
    const range = dom.window.getSelection().getRangeAt(0);
    assert.equal(range.startContainer.textContent, SEGMENTS[0]);
    assert.equal(range.startOffset, 8);
    assert.equal(range.endContainer.textContent, SEGMENTS[1]);
    assert.equal(range.endOffset, 13);
    assert.equal(container.querySelectorAll('.is-annotation-target').length, 2);
    assert.equal(focusReadingAnnotation(note, container, 3), false);
    assert.equal(focusReadingAnnotation({ ...note, quote: 'é conservada. Uma afirmação' }, container, 2), false);
    // Editing view: the first part is selected in the first segment field.
    assert(focusAnnotation(note, container, 2));
    const field = container.querySelector('textarea');
    assert.equal(field.value.slice(field.selectionStart, field.selectionEnd), 'é conservada.');
  } finally {
    dom.window.close();
  }
});

function clock() {
  const timers = new Map();
  let next = 1;
  return {
    schedule: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    cancel: (id) => timers.delete(id),
    pending: () => [...timers.values()].map((t) => t.ms),
    async fire() {
      const entries = [...timers.entries()];
      timers.clear();
      for (const [, { fn }] of entries) fn();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const withText = (text) => ({ title: '', doc: { type: 'doc', schemaVersion: 1, blocks: [{ id: 'p', type: 'paragraph', text }] } });

test('autosave: debounced, one request at a time, same request id on retry, local copy until saved', async () => {
  const time = clock(),
    storage = memoryStorage(),
    sent = [],
    states = [];
  let fail = 1,
    serverVersion = 0,
    ids = 0;
  const autosave = createAutosave({
    send: async (wire) => {
      sent.push(structuredClone(wire));
      if (fail-- > 0) throw Object.assign(new Error('Failed to fetch'), {});
      serverVersion += 1;
      return { notebook: { version: serverVersion } };
    },
    uuid: () => `req-${++ids}`,
    storage,
    key: 'k',
    schedule: time.schedule,
    cancel: time.cancel,
    onState: (state, info) => states.push(info.offline ? `${state}:offline` : state),
    isOnline: () => false,
  });
  autosave.start({ version: 0, content: emptyContent() });
  autosave.edit(withText('a'));
  autosave.edit(withText('ab'));
  assert.deepEqual(time.pending(), [1200], 'one debounced save');
  assert.equal(JSON.parse(storage.getItem('k')).content.doc.blocks[0].text, 'ab', 'copy kept in this browser');
  await time.fire();
  assert.equal(sent.length, 1);
  assert.equal(autosave.state, 'retrying');
  assert.equal(states.at(-1), 'retrying:offline');
  // Edit while the first request's outcome is unknown: the same request goes first, then the edit.
  autosave.edit(withText('abc'));
  await time.fire();
  assert.equal(sent.length, 3);
  assert.equal(sent[1].requestId, sent[0].requestId, 'retry reuses the request id');
  assert.deepEqual(sent[1], sent[0], 'retry resends exactly the same body');
  assert.equal(sent[2].version, 1, 'next save builds on the saved version');
  assert.equal(sent[2].doc.blocks[0].text, 'abc');
  assert.equal(autosave.state, 'saved');
  assert.equal(storage.getItem('k'), null, 'local copy removed once the account has it');
  assert.equal(autosave.version, 2);
});

test('autosave: conflict stops saving until the person chooses; invalid waits for an edit', async () => {
  const time = clock(),
    storage = memoryStorage(),
    sent = [];
  let reply = () => ({ notebook: { version: 4 } });
  const autosave = createAutosave({
    send: async (wire) => {
      sent.push(wire);
      return reply(wire);
    },
    storage,
    key: 'k',
    schedule: time.schedule,
    cancel: time.cancel,
  });
  autosave.start({ version: 2, content: emptyContent() });
  reply = () => {
    throw Object.assign(new Error('O registro mudou em outro aparelho.'), { status: 409, code: 'LEARNING_VERSION_CONFLICT' });
  };
  autosave.edit(withText('meu'));
  await time.fire();
  assert.equal(autosave.state, 'conflict');
  autosave.edit(withText('meu texto'));
  assert.deepEqual(time.pending(), [], 'no automatic overwrite during a conflict');
  assert.equal(JSON.parse(storage.getItem('k')).content.doc.blocks[0].text, 'meu texto', 'still kept locally');
  reply = () => ({ notebook: { version: 4 } });
  await autosave.adopt({ version: 3, content: withText('meu texto') }, { save: true });
  assert.equal(sent.at(-1).version, 3);
  assert.equal(autosave.state, 'saved');
  reply = () => {
    throw Object.assign(new Error('Use apenas texto.'), { status: 400, code: 'NOTEBOOK_INVALID' });
  };
  autosave.edit(withText('x'));
  await time.fire();
  assert.equal(autosave.state, 'invalid');
  assert.deepEqual(time.pending(), [], 'a refused body is not retried in a loop');
  // Choosing the other device's version discards nothing silently: it is an explicit adopt.
  await autosave.adopt({ version: 4, content: withText('deles') }, { save: false });
  assert.equal(autosave.state, 'saved');
  assert.equal(storage.getItem('k'), null);
});

test('document helpers: keep both versions, plain text only, references carry the revision', () => {
  const theirs = withText('do outro aparelho'),
    mine = withText('deste aparelho');
  const both = keepBoth(theirs, mine, 'Cópia deste aparelho');
  assert.deepEqual(both.doc.blocks.map((b) => b.text), ['do outro aparelho', 'Cópia deste aparelho', 'deste aparelho']);
  assert.equal(new Set(both.doc.blocks.map((b) => b.id)).size, 3, 'no duplicated block ids');
  assert.equal(keepBoth(theirs, theirs, 'x').doc.blocks.length, 1, 'identical versions are not duplicated');
  const shared = { id: 's', type: 'quote', text: 'em comum' };
  const partial = keepBoth(
    { title: '', doc: { ...theirs.doc, blocks: [shared, ...theirs.doc.blocks] } },
    { title: '', doc: { ...mine.doc, blocks: [{ ...shared, id: 'other-id' }, ...mine.doc.blocks] } },
    'Cópia',
  );
  assert.deepEqual(partial.doc.blocks.map((b) => b.text), ['em comum', 'do outro aparelho', 'Cópia', 'deste aparelho'], 'shared blocks are not repeated');
  assert(hasMarkup(withText('<script>alert(1)</script>')));
  assert(!hasMarkup(withText('se a < b então b > a')));
  for (const type of ADDABLE_BLOCKS) assert.equal(newBlock(type).type, type);
  assert.deepEqual(
    { ...referenceBlock({ id: 'n1', source_revision_id: 'r1', source_revision: 2 }, 'b1') },
    { id: 'b1', type: 'annotation_ref', annotationId: 'n1', sourceRevisionId: 'r1', sourceRevision: 2 },
  );
});

// ---- Writing area (notebook-editor.js): the stored block format round-trips losslessly --------
const OLD_NOTEBOOK = [
  { id: 'h1', type: 'heading', level: 2, text: 'Fase clara' },
  { id: 'p1', type: 'paragraph', text: 'A luz vira energia química.\nATP e NADPH.' },
  { id: 'p0', type: 'paragraph', text: '' },
  { id: 'p3', type: 'paragraph', text: 'termina com quebra\n' },
  { id: 'p4', type: 'paragraph', text: 'espaços  duplos e a < b' },
  { id: 'l1', type: 'bullet_list', items: ['Clorofila', '', 'Tilacoide'] },
  { id: 'l2', type: 'bullet_list', items: ['outra lista colada à primeira'] },
  { id: 'o1', type: 'ordered_list', items: ['Luz', 'Água', 'Oxigênio'] },
  { id: 'c1', type: 'checklist', items: [{ text: 'Revisar ciclo', checked: true }, { text: 'Fazer resumo', checked: false }] },
  { id: 'c2', type: 'checklist', items: [] },
  { id: 'e1', type: 'bullet_list', items: [] },
  { id: 'h2', type: 'heading', level: 3, text: 'Citações' },
  { id: 'q1', type: 'quote', text: 'O carbono é fixado\nno ciclo de Calvin.' },
  { id: 'r1', type: 'annotation_ref', annotationId: 'a1', sourceRevisionId: 'r-1', sourceRevision: 2 },
  { id: 'r2', type: 'annotation_ref', annotationId: 'a2', sourceRevisionId: 'r-2' },
  { id: 'x1', type: 'future_block', payload: { text: 'de outra versão' } },
  { id: 'p2', type: 'paragraph', text: 'Fim.' },
];
const counter = () => {
  let n = 0;
  return () => `new${++n}`;
};

test('editor: blocks → lines → blocks keeps every old block exactly (ids, lists, checklist state, quotes, references)', () => {
  const lines = blocksToLines(OLD_NOTEBOOK);
  assert.deepEqual(linesToBlocks(lines, counter()), OLD_NOTEBOOK);
  assert.equal(lines.filter((line) => line.kind === 'atom').length, 3, 'references and the unknown block are kept as atoms');
  // A block with an unexpected shape is never trimmed into an editable one: it is kept whole.
  const odd = [{ id: 'z', type: 'paragraph', text: 'x', extra: true }];
  assert.deepEqual(linesToBlocks(blocksToLines(odd)), odd);
});

test('editor: blocks → editor DOM → blocks round trip (what reopening and saving does)', () => {
  const dom = new JSDOM('<div id="root"></div>');
  try {
    const root = dom.window.document.querySelector('#root');
    const lines = blocksToLines(OLD_NOTEBOOK);
    const atoms = new Map(lines.filter((l) => l.kind === 'atom').map((l) => [l.id, l.block]));
    renderLines(root, lines, { renderAtom: (block, figure) => figure.append(`cited ${block.id}`) });
    assert.equal(root.querySelector('h3').textContent, 'Fase clara');
    assert.equal(root.querySelector('h4').textContent, 'Citações');
    assert.equal(root.querySelectorAll('ol > li').length, 3);
    assert.deepEqual([...root.querySelectorAll('ul[data-type=checklist] input')].map((i) => i.checked), [true, false, false]);
    assert.equal(root.querySelectorAll('figure[contenteditable=false]').length, 3);
    assert.equal(root.querySelectorAll('script, [style]').length, 0);
    const read = readLines(root, atoms);
    assert.equal(read.irregular, false, 'the drawn markup reads back cleanly');
    assert.deepEqual(linesToBlocks(read.lines, counter()), OLD_NOTEBOOK);
  } finally {
    dom.window.close();
  }
});

test('editor: Enter, Backspace, list exit, type changes and checklist work on lines', () => {
  const make = counter();
  let state = { lines: blocksToLines([{ id: 'p', type: 'paragraph', text: 'abcdef' }]) };
  state = splitLine(state.lines, { line: 0, offset: 3 }, make);
  assert.deepEqual(linesToBlocks(state.lines, make), [
    { id: 'p', type: 'paragraph', text: 'abc' },
    { id: 'new1', type: 'paragraph', text: 'def' },
  ]);
  assert.deepEqual(state.caret, { line: 1, offset: 0 });
  state = joinBackward(state.lines, { line: 1, offset: 0 }, make);
  assert.deepEqual(linesToBlocks(state.lines, make), [{ id: 'p', type: 'paragraph', text: 'abcdef' }]);
  assert.deepEqual(state.caret, { line: 0, offset: 3 });
  // A list: Enter adds an item; Enter on an empty item leaves the list.
  let list = { lines: blocksToLines([{ id: 'l', type: 'bullet_list', items: ['um', 'dois', 'três'] }]) };
  list = splitLine(list.lines, { line: 0, offset: 2 }, make);
  assert.deepEqual(linesToBlocks(list.lines, make), [{ id: 'l', type: 'bullet_list', items: ['um', '', 'dois', 'três'] }]);
  list = splitLine(list.lines, { line: 1, offset: 0 }, make);
  const split = linesToBlocks(list.lines, make);
  assert.deepEqual(split.map((b) => b.type), ['bullet_list', 'paragraph', 'bullet_list'], 'the list is split around the new paragraph');
  assert.deepEqual([split[0].items, split[2].items], [['um'], ['dois', 'três']]);
  assert.equal(new Set(split.map((b) => b.id)).size, 3);
  // Backspace at the start of a heading makes it a paragraph (text kept).
  const heading = joinBackward(blocksToLines([{ id: 'h', type: 'heading', level: 2, text: 'T' }]), { line: 0, offset: 0 }, make);
  assert.deepEqual(linesToBlocks(heading.lines, make), [{ id: 'h', type: 'paragraph', text: 'T' }]);
  // A cited highlight is never removed by the keyboard.
  const withRef = blocksToLines([{ id: 'r', type: 'annotation_ref', annotationId: 'a', sourceRevisionId: 's' }, { id: 'p', type: 'paragraph', text: 'x' }]);
  assert.deepEqual(joinBackward(withRef, { line: 1, offset: 0 }, make), { blocked: 'atom' });
  assert.deepEqual(deleteRange(withRef, { line: 0, offset: 0 }, { line: 1, offset: 1 }), { blocked: 'atom' });
  assert.equal(linesToBlocks(removeAtom(withRef, 'r').lines, make).length, 1, 'only the explicit button removes it');
  // Type changes: paragraph → checklist (keeps its id as the list id) and back.
  const paragraphs = blocksToLines([
    { id: 'a', type: 'paragraph', text: 'um' },
    { id: 'b', type: 'paragraph', text: 'dois' },
  ]);
  const checked = setKind(paragraphs, 0, 1, 'check', make);
  assert.deepEqual(linesToBlocks(checked.lines, make), [
    { id: 'a', type: 'checklist', items: [{ text: 'um', checked: false }, { text: 'dois', checked: false }] },
  ]);
  const ticked = toggleChecked(checked.lines, 1);
  assert.equal(linesToBlocks(ticked.lines, make)[0].items[1].checked, true);
  const back = setKind(ticked.lines, 0, 1, 'check', make);
  assert.deepEqual(linesToBlocks(back.lines, make).map((b) => b.type), ['paragraph', 'paragraph'], 'same list type again toggles back');
  const ordered = setKind(paragraphs, 0, 0, 'ordered', make);
  assert.deepEqual(linesToBlocks(ordered.lines, make).map((b) => b.type), ['ordered_list', 'paragraph']);
  // Shift+Enter: a line break inside the paragraph.
  assert.equal(linesToBlocks(insertText(paragraphs, { line: 0, offset: 2 }, '\n').lines, make)[0].text, 'um\n');
  // Markdown-like starts.
  assert.deepEqual(['#', '##', '-', '1.', '[ ]', '[x]', '>', 'x'].map((m) => shortcutFor(m)?.kind ?? null), ['h2', 'h3', 'bullet', 'ordered', 'check', 'check', 'quote', null]);
  // Citing goes in below the caret's line, with a line after it to keep writing.
  const cited = insertAtom(paragraphs, { id: 'r', type: 'annotation_ref', annotationId: 'a', sourceRevisionId: 's' }, { line: 1, offset: 0 }, make);
  assert.deepEqual(cited.lines.map((l) => l.kind), ['p', 'p', 'atom', 'p']);
  assert.deepEqual(linesToBlocks(cited.lines, make).map((b) => b.type), ['paragraph', 'paragraph', 'annotation_ref'], 'the blank line is not stored');
});

test('editor: pasted HTML becomes plain text in the supported types; nothing executable survives', () => {
  const dom = new JSDOM('');
  try {
    const parser = new dom.window.DOMParser();
    const lines = htmlToLines(
      '<h1 onclick="x()">Título</h1><p style="color:red">Um <b>dois</b><br>três</p><script>alert(1)</script><style>p{}</style>' +
        '<img src=x onerror="alert(2)"><iframe src="javascript:alert(3)"></iframe><ul><li>a</li><li><input type="checkbox" checked> feito</li></ul>' +
        '<ol><li>primeiro</li></ol><blockquote>citado</blockquote><a href="javascript:alert(4)">link</a>',
      counter(),
      parser,
    );
    const blocks = linesToBlocks(lines, counter());
    assert.deepEqual(
      blocks.map(({ id: _id, ...rest }) => rest),
      [
        { type: 'heading', level: 2, text: 'Título' },
        { type: 'paragraph', text: 'Um dois\ntrês' },
        { type: 'bullet_list', items: ['a'] },
        { type: 'checklist', items: [{ text: 'feito', checked: true }] },
        { type: 'ordered_list', items: ['primeiro'] },
        { type: 'quote', text: 'citado' },
        { type: 'paragraph', text: 'link' },
      ],
    );
    assert(!JSON.stringify(blocks).includes('alert'), 'no script text');
    // Plain text: markdown-like lines keep their meaning; one line stays inline.
    assert.deepEqual(
      linesToBlocks(textToLines('# Tema\n- um\n- dois\n[x] feito\n\nTexto', counter()), counter()).map(({ id: _id, ...rest }) => rest),
      [
        { type: 'heading', level: 2, text: 'Tema' },
        { type: 'bullet_list', items: ['um', 'dois'] },
        { type: 'checklist', items: [{ text: 'feito', checked: true }] },
        { type: 'paragraph', text: 'Texto' },
      ],
    );
    const inline = insertLines(blocksToLines([{ id: 'p', type: 'paragraph', text: 'ab' }]), { line: 0, offset: 1 }, textToLines('X', counter()));
    assert.equal(inline.lines[0].text, 'aXb');
    const several = insertLines(blocksToLines([{ id: 'p', type: 'paragraph', text: 'ab' }]), { line: 0, offset: 1 }, textToLines('X\nY', counter()), counter());
    assert.deepEqual(several.lines.map((l) => l.text), ['a', 'X', 'Y', 'b']);
  } finally {
    dom.window.close();
  }
});

test('size limits are reported before saving, never by cutting text', () => {
  const long = (text) => ({ title: '', doc: { type: 'doc', schemaVersion: 1, blocks: [{ id: 'h', type: 'heading', level: 2, text }] } });
  assert.equal(limitProblem(long('x'.repeat(300))), null);
  assert.match(limitProblem(long('x'.repeat(301))), /título passou de 300/);
  assert.equal(limitProblem({ title: '', doc: { type: 'doc', schemaVersion: 1, blocks: OLD_NOTEBOOK } }), null);
});
