export function activeSegmentIndex(segments, seconds) {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return -1;
  return segments.findIndex((item) => ms >= item.startMs && ms < item.endMs);
}

export function initTranscriptPlayer({ container, toolbar, player }) {
  const label = document.createElement('label');
  label.textContent = 'Buscar na transcrição';
  const search = document.createElement('input');
  search.type = 'search'; search.maxLength = 200;
  label.append(search);
  const previous = document.createElement('button');
  previous.type = 'button'; previous.textContent = 'Resultado anterior';
  const next = document.createElement('button');
  next.type = 'button'; next.textContent = 'Próximo resultado';
  const followLabel = document.createElement('label');
  const follow = document.createElement('input'); follow.type = 'checkbox';
  followLabel.append(follow, ' Acompanhar o trecho em reprodução');
  const status = document.createElement('span');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  toolbar.append(label, previous, next, followLabel, status);
  let segments = [], matches = [], selected = -1, active = -1;
  const normalize = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
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
      element.classList.add('is-playing'); element.setAttribute('aria-current', 'true');
      if (follow.checked && document.activeElement?.tagName !== 'TEXTAREA') scroll(element);
    }
  }
  function find() {
    const query = normalize(search.value.trim());
    matches = [];
    segments.forEach((segment) => {
      const match = Boolean(query) && normalize(segment.element.querySelector('textarea').value).includes(query);
      segment.element.classList.toggle('search-match', match);
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
    scroll(match.element); match.element.querySelector('button')?.focus({ preventScroll: true });
    status.textContent = `Trecho ${selected + 1} de ${matches.length}`;
  }
  previous.addEventListener('click', () => navigate(selected < 0 ? matches.length : -1));
  next.addEventListener('click', () => navigate(1));
  search.addEventListener('input', find);
  const onEdit = () => { if (search.value.trim()) find(); };
  container.addEventListener('input', onEdit);
  for (const media of [player.audio, player.video]) {
    media.addEventListener('timeupdate', updateTime);
    media.addEventListener('seeked', updateTime);
  }
  return {
    refresh() {
      segments = [...container.querySelectorAll('.transcription-segment')].map((element) => ({
        element, startMs: Number(element.dataset.startMs), endMs: Number(element.dataset.endMs),
      })).filter((segment) => Number.isFinite(segment.startMs) && segment.endMs > segment.startMs);
      active = -1; find(); updateTime();
    },
    destroy() {
      container.removeEventListener('input', onEdit);
      for (const media of [player.audio, player.video]) {
        media.removeEventListener('timeupdate', updateTime); media.removeEventListener('seeked', updateTime);
      }
    },
  };
}
