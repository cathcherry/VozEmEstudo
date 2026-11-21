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
  if (chars.slice(note.start_offset, note.end_offset).join('') !== note.quote) return false;
  element.scrollIntoView?.({ block: 'center' });
  field.focus({ preventScroll: true });
  field.setSelectionRange(
    chars.slice(0, note.start_offset).join('').length,
    chars.slice(0, note.end_offset).join('').length,
  );
  return true;
}

/**
 * Anchor for a selection made in the reading view (p.segment-text), in the same coordinates the
 * server stores (code points of the segment's current text in the confirmed revision).
 * Returns {error:'multi'} when the selection crosses segments (needs multi-segment anchors, a
 * later schema change), {error:'empty'} when nothing usable is selected.
 */
export function readingSelectionAnchor(container, selection = globalThis.getSelection?.()) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { error: 'empty' };
  const range = selection.getRangeAt(0);
  const textOf = (node) =>
    (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.segment-text');
  const start = textOf(range.startContainer),
    end = textOf(range.endContainer);
  if (!start || !end || !container.contains(start)) return { error: 'empty' };
  if (start !== end) return { error: 'multi' };
  const article = start.closest('.transcription-segment');
  const before = document.createRange();
  before.selectNodeContents(start);
  before.setEnd(range.startContainer, range.startOffset);
  const prefix = before.toString(),
    quote = range.toString();
  if (!quote.trim()) return { error: 'empty' };
  const startOffset = [...prefix].length;
  return {
    segmentPosition: Number(article.dataset.segmentPosition),
    startOffset,
    endOffset: startOffset + [...quote].length,
    quote,
    startMs: Number(article.dataset.startMs),
  };
}

/** Reading view: select the highlighted words and bring them into view. */
export function focusReadingAnnotation(note, container, revision) {
  if (note.source_revision !== revision) return false;
  const article = [...container.querySelectorAll('.transcription-segment')].find(
    (item) => Number(item.dataset.segmentPosition) === note.segment_position,
  );
  const text = article?.querySelector('.segment-text');
  if (!text) return false;
  const chars = [...text.textContent];
  if (chars.slice(note.start_offset, note.end_offset).join('') !== note.quote) return false;
  // Walk text nodes to place the range (the player may split the text into word spans).
  const from = chars.slice(0, note.start_offset).join('').length,
    to = chars.slice(0, note.end_offset).join('').length;
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0,
    started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent.length;
    if (!started && from <= seen + length) {
      range.setStart(node, from - seen);
      started = true;
    }
    if (started && to <= seen + length) {
      range.setEnd(node, to - seen);
      break;
    }
    seen += length;
  }
  article.scrollIntoView?.({ block: 'center' });
  const selection = globalThis.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(range);
  article.classList.add('is-annotation-target');
  setTimeout(() => article.classList.remove('is-annotation-target'), 2400);
  return true;
}
