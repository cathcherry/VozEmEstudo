/**
 * Reading guide (Aparência → Conforto de leitura → "Guia de leitura").
 * - "ruler": a band the height of one or two lines that follows the pointer, or the focused
 *   element when using the keyboard, inside reading areas; everything else is dimmed.
 * - "focus": handled in CSS (dims transcript segments / paragraphs other than the current one).
 * Reads the preference from <html data-reading-ruler>, so it follows the same saved state.
 */
const READING_AREAS =
  '.reading-measure, .markdown-content, [data-transcription-segments], .reading-preview-text';
const LINE_TARGETS = 'p, li, h1, h2, h3, h4, .transcription-segment, textarea, blockquote';

export function initReadingRuler(root = document.documentElement) {
  const ruler = document.createElement('div');
  ruler.className = 'reading-ruler';
  ruler.setAttribute('aria-hidden', 'true');
  ruler.hidden = true;
  document.body.append(ruler);
  let frame = 0;
  const enabled = () => root.dataset.readingRuler === 'ruler';
  const hide = () => {
    ruler.hidden = true;
  };
  function place(area, target, y) {
    const box = area.getBoundingClientRect();
    const style = getComputedStyle(target);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 26;
    const height = Math.max(line * 1.25, 28);
    ruler.style.left = `${Math.max(0, box.left - 8)}px`;
    ruler.style.width = `${Math.min(window.innerWidth, box.width + 16)}px`;
    ruler.style.height = `${height}px`;
    ruler.style.top = `${y - height / 2}px`;
    ruler.hidden = false;
  }
  function fromPoint(event) {
    if (!enabled() || event.pointerType === 'touch') return hide();
    const area = event.target.closest?.(READING_AREAS);
    if (!area) return hide();
    const target = event.target.closest(LINE_TARGETS) || area;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => place(area, target, event.clientY));
  }
  function fromFocus(event) {
    if (!enabled()) return hide();
    const area = event.target.closest?.(READING_AREAS);
    if (!area) return hide();
    const target = event.target.closest(LINE_TARGETS) || event.target;
    const box = target.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(target).lineHeight) || 26;
    place(area, target, box.top + Math.min(box.height, line) / 2);
  }
  document.addEventListener('pointermove', fromPoint, { passive: true });
  document.addEventListener('focusin', fromFocus);
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
  new MutationObserver(() => {
    if (!enabled()) hide();
  }).observe(root, { attributes: true, attributeFilter: ['data-reading-ruler'] });
  return { ruler, hide };
}
