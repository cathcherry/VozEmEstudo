/** Notes 3.0: an anchor that ends in a later segment than it starts. */
export const isMultiSegment = (note) =>
  Number.isInteger(note?.end_segment_position) && note.end_segment_position > note.segment_position;
/** Segments joined in a multi-segment quote (the same separator the server validates). */
export const SEGMENT_BREAK = '\n';
const MAX_SEGMENTS = 50;
const MAX_QUOTE = 1000;

export function selectionAnchor(field, position) {
  const start = field.selectionStart,
    end = field.selectionEnd;
  if (end <= start) return null;
  return {
    segmentPosition: position,
    startOffset: [...field.value.slice(0, start)].length,
    endOffset: [...field.value.slice(0, end)].length,
    quote: field.value.slice(start, end),
  };
}
export function focusAnnotation(note, container, revision) {
  if (note.source_revision !== revision) return false;
  const element = [...container.querySelectorAll('.transcription-segment')].find(
    (item) => Number(item.dataset.segmentPosition) === note.segment_position,
  );
  const field = element?.querySelector('textarea');
  if (!field) return false;
  const chars = [...field.value];
  // A range over several segments: the editing view selects its first part (fields are separate).
  const multi = isMultiSegment(note);
  const end = multi ? chars.length : note.end_offset;
  const expected = multi ? note.quote.split(SEGMENT_BREAK)[0] : note.quote;
  if (chars.slice(note.start_offset, end).join('') !== expected) return false;
  element.scrollIntoView?.({ block: 'center' });
  field.focus({ preventScroll: true });
  field.setSelectionRange(
    chars.slice(0, note.start_offset).join('').length,
    chars.slice(0, end).join('').length,
  );
  return true;
}

/**
 * Anchor for a selection made in the reading view (p.segment-text), in the same coordinates the
 * server stores (code points of the segment's current text in the confirmed revision).
 * A selection that crosses segments returns {error:'multi'} unless `{multi:true}` (Notes 3.0):
 * then the anchor ends in a later segment (endSegmentPosition, endOffset inside it) and the quote
 * joins the pieces with a line break. {error:'empty'} when nothing usable is selected,
 * {error:'long'} past the limits (1,000 characters, 50 segments).
 */
export function readingSelectionAnchor(
  container,
  selection = globalThis.getSelection?.(),
  { multi = false } = {},
) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { error: 'empty' };
  const range = selection.getRangeAt(0);
  const textOf = (node) =>
    (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.segment-text');
  let start = textOf(range.startContainer),
    end = textOf(range.endContainer);
  if (!start || !end || !container.contains(start) || !container.contains(end))
    return { error: 'empty' };
  const offsetIn = (element, node, offset) => {
    const before = document.createRange();
    before.selectNodeContents(element);
    before.setEnd(node, offset);
    return [...before.toString()].length;
  };
  let startOffset = offsetIn(start, range.startContainer, range.startOffset);
  let endOffset = offsetIn(end, range.endContainer, range.endOffset);
  const single = (element, position, ms) => {
    const quote = [...element.textContent].slice(startOffset, endOffset).join('');
    if (!quote.trim()) return { error: 'empty' };
    if ([...quote].length > MAX_QUOTE) return { error: 'long' };
    return { segmentPosition: position, startOffset, endOffset, quote, startMs: ms };
  };
  if (start === end) {
    const article = start.closest('.transcription-segment');
    return single(start, Number(article.dataset.segmentPosition), Number(article.dataset.startMs));
  }
  if (!multi) return { error: 'multi' };
  const articles = [...container.querySelectorAll('.transcription-segment')];
  let from = articles.indexOf(start.closest('.transcription-segment')),
    to = articles.indexOf(end.closest('.transcription-segment'));
  if (from < 0 || to < 0 || to < from) return { error: 'empty' };
  const textAt = (index) => articles[index].querySelector('.segment-text');
  // A selection that ends at the very start of a segment (or starts at the very end of one, as a
  // triple click does) does not include that segment.
  if (endOffset === 0 && to > from) {
    to -= 1;
    end = textAt(to);
    endOffset = [...end.textContent].length;
  }
  if (startOffset >= [...start.textContent].length && from < to) {
    from += 1;
    start = textAt(from);
    startOffset = 0;
  }
  const span = articles.slice(from, to + 1);
  const positions = span.map((item) => Number(item.dataset.segmentPosition));
  if (positions.some((value, index) => index > 0 && value !== positions[index - 1] + 1))
    return { error: 'empty' };
  if (positions.length > MAX_SEGMENTS) return { error: 'long' };
  if (from === to) return single(start, positions[0], Number(articles[from].dataset.startMs));
  const pieces = span.map((item, index) => {
    const chars = [...item.querySelector('.segment-text').textContent];
    if (index === 0) return chars.slice(startOffset).join('');
    if (index === span.length - 1) return chars.slice(0, endOffset).join('');
    return chars.join('');
  });
  const quote = pieces.join(SEGMENT_BREAK);
  if (!quote.trim()) return { error: 'empty' };
  if ([...quote].length > MAX_QUOTE) return { error: 'long' };
  return {
    segmentPosition: positions[0],
    startOffset,
    endSegmentPosition: positions.at(-1),
    endOffset,
    quote,
    startMs: Number(articles[from].dataset.startMs),
  };
}

/** Text node and offset for a code-point index inside an element (the player may split words). */
function pointAt(element, codePoints) {
  const units = [...element.textContent].slice(0, codePoints).join('').length;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let seen = 0,
    last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent.length;
    if (units <= seen + length) return { node, offset: units - seen };
    seen += length;
    last = node;
  }
  return last ? { node: last, offset: last.textContent.length } : { node: element, offset: 0 };
}

/** Reading view: select the highlighted words (across segments too) and bring them into view. */
export function focusReadingAnnotation(note, container, revision) {
  if (note.source_revision !== revision) return false;
  const articles = [...container.querySelectorAll('.transcription-segment')];
  const find = (position) =>
    articles.find((item) => Number(item.dataset.segmentPosition) === position);
  const endPosition = isMultiSegment(note) ? note.end_segment_position : note.segment_position;
  const first = find(note.segment_position),
    last = find(endPosition);
  const startText = first?.querySelector('.segment-text'),
    endText = last?.querySelector('.segment-text');
  if (!startText || !endText) return false;
  const pieces = [];
  for (let position = note.segment_position; position <= endPosition; position += 1) {
    const text = find(position)?.querySelector('.segment-text');
    if (!text) return false;
    const chars = [...text.textContent];
    const from = position === note.segment_position ? note.start_offset : 0;
    const to = position === endPosition ? note.end_offset : chars.length;
    pieces.push(chars.slice(from, to).join(''));
  }
  if (pieces.join(SEGMENT_BREAK) !== note.quote) return false;
  const from = pointAt(startText, note.start_offset),
    to = pointAt(endText, note.end_offset);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  first.scrollIntoView?.({ block: 'center' });
  const selection = globalThis.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const targets = articles.filter((item) => {
    const position = Number(item.dataset.segmentPosition);
    return position >= note.segment_position && position <= endPosition;
  });
  for (const item of targets) item.classList.add('is-annotation-target');
  setTimeout(() => targets.forEach((item) => item.classList.remove('is-annotation-target')), 2400);
  return true;
}
