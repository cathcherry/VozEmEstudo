export function activeSegmentIndex(segments, seconds) {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return -1;
  return segments.findIndex((item) => ms >= item.startMs && ms < item.endMs);
}

const fold = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

/**
 * Where `query` occurs in `text`, ignoring accents and case, as [start, end) ranges of the
 * ORIGINAL text (so "acao" finds and marks "Ação" exactly).
 */
export function highlightRanges(text, query) {
  const needle = fold(String(query || '').trim());
  if (!needle) return [];
  let folded = '';
  const origin = [];
  const chars = [...String(text)];
  let offset = 0;
  for (const char of chars) {
    // One origin entry per UTF-16 unit of the folded text, so indices line up with indexOf.
    const piece = fold(char);
    for (let unit = 0; unit < piece.length; unit += 1) origin.push(offset);
    folded += piece;
    offset += char.length;
  }
  origin.push(offset);
  const ranges = [];
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    const endIndex = at + needle.length;
    // The end maps to the start of the next original character (or the end of the text).
    const end = endIndex < origin.length - 1 ? origin[endIndex] : offset;
    ranges.push([origin[at], end]);
  }
  return ranges;
}

/** Rewrites a reading paragraph with <mark> around matches, always from its saved plain text. */
function markMatches(paragraph, query) {
  if (!paragraph) return;
  if (paragraph.dataset.plain === undefined) paragraph.dataset.plain = paragraph.textContent;
  const text = paragraph.dataset.plain;
  const ranges = highlightRanges(text, query);
  if (!ranges.length) {
    if (paragraph.childElementCount) paragraph.textContent = text;
    return;
  }
  const parts = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement('mark');
    mark.className = 'search-hit';
    mark.textContent = text.slice(start, end);
    parts.push(mark);
    cursor = end;
  }
  if (cursor < text.length) parts.push(document.createTextNode(text.slice(cursor)));
  paragraph.replaceChildren(...parts);
}

export function initTranscriptPlayer({ container, toolbar, player, onActiveChange }) {
  // Compact search: one field with previous/next, a result count, and an optional follow switch.
  const label = document.createElement('label');
  label.className = 'transcript-search';
  const labelText = document.createElement('span');
  labelText.className = 'sr-only';
  labelText.textContent = 'Buscar na transcrição';
  const search = document.createElement('input');
  search.type = 'search';
  search.maxLength = 200;
  search.placeholder = 'Buscar';
  label.append(labelText, search);
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'icon-step';
  previous.textContent = '‹';
  previous.setAttribute('aria-label', 'Resultado anterior');
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'icon-step';
  next.textContent = '›';
  next.setAttribute('aria-label', 'Próximo resultado');
  previous.disabled = next.disabled = true;
  const followLabel = document.createElement('label');
  followLabel.className = 'follow-switch';
  followLabel.dataset.followControl = '';
  const follow = document.createElement('input');
  follow.type = 'checkbox';
  follow.setAttribute('role', 'switch');
  follow.dataset.followAudio = '';
  followLabel.append(follow, ' Seguir áudio');
  const status = document.createElement('span');
  status.className = 'search-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  toolbar.append(label, previous, next, status, followLabel);
  let segments = [],
    matches = [],
    selected = -1,
    active = -1;
  const normalize = (value) =>
    value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
  const scroll = (element) => element.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });

  function updateTime() {
    const index = activeSegmentIndex(segments, player.currentTime);
    if (index === active) return;
    if (segments[active]) {
      segments[active].element.classList.remove('is-playing');
      segments[active].element.removeAttribute('aria-current');
    }
    active = index;
    if (segments[active]) {
      const element = segments[active].element;
      element.classList.add('is-playing');
      element.setAttribute('aria-current', 'true');
      if (follow.checked && document.activeElement?.tagName !== 'TEXTAREA') scroll(element);
      onActiveChange?.(active);
    }
  }
  function find() {
    const query = normalize(search.value.trim());
    matches = [];
    segments.forEach((segment) => {
      const field = segment.element.querySelector('textarea');
      const text = field ? field.value : segment.element.textContent;
      const match = Boolean(query) && normalize(text).includes(query);
      segment.element.classList.toggle('search-match', match);
      // Reading mode shows the searched words in bold; edit fields keep plain text.
      markMatches(segment.element.querySelector('.segment-text'), match ? search.value : '');
      if (match) matches.push(segment);
    });
    selected = -1;
    previous.disabled = next.disabled = !matches.length;
    status.textContent = query ? `${matches.length} trechos encontrados` : '';
  }
  function navigate(direction) {
    if (!matches.length) return;
    selected = (selected + direction + matches.length) % matches.length;
    const match = matches[selected];
    if (player.source) player.seekTo(match.startMs / 1000, false);
    scroll(match.element);
    match.element.querySelector('button')?.focus({ preventScroll: true });
    status.textContent = `Trecho ${selected + 1} de ${matches.length}`;
  }
  previous.addEventListener('click', () => navigate(selected < 0 ? matches.length : -1));
  next.addEventListener('click', () => navigate(1));
  search.addEventListener('input', find);
  const onEdit = () => {
    if (search.value.trim()) find();
  };
  container.addEventListener('input', onEdit);
  for (const media of [player.audio, player.video]) {
    media.addEventListener('timeupdate', updateTime);
    media.addEventListener('seeked', updateTime);
  }
  return {
    /** Fills the search box (e.g. from the dashboard search) and optionally jumps to a passage. */
    search(query, position) {
      search.value = String(query || '').slice(0, 200);
      find();
      const target = matches.find((m) => m.element.dataset.segmentPosition === String(position));
      if (target) {
        selected = matches.indexOf(target);
        scroll(target.element);
        status.textContent = `Trecho ${selected + 1} de ${matches.length}`;
      }
    },
    refresh() {
      segments = [...container.querySelectorAll('.transcription-segment')]
        .map((element) => ({
          element,
          startMs: Number(element.dataset.startMs),
          endMs: Number(element.dataset.endMs),
        }))
        .filter((segment) => Number.isFinite(segment.startMs) && segment.endMs > segment.startMs);
      active = -1;
      find();
      updateTime();
    },
    destroy() {
      container.removeEventListener('input', onEdit);
      for (const media of [player.audio, player.video]) {
        media.removeEventListener('timeupdate', updateTime);
        media.removeEventListener('seeked', updateTime);
      }
    },
  };
}
