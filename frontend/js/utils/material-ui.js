import { mascotReading, NINO } from './brand.js';

export function materialState(material) {
  if (['PRONTO', 'PARCIAL', 'CONCLUIDA', 'CONCLUIDO'].includes(material.status)) return 'ready';
  if (['ERRO', 'FALHOU', 'FALHA', 'CANCELADO', 'CANCELADA'].includes(material.status)) return 'failed';
  return 'processing';
}
export function statusLabel(material) {
  return ({ PRONTO: 'Pronto', PARCIAL: 'Revisão disponível', CONCLUIDA: 'Pronto', CONCLUIDO: 'Pronto', ERRO: 'Com erro', FALHOU: 'Com erro', FALHA: 'Com erro', CANCELADO: 'Cancelado', CANCELADA: 'Cancelado', PROCESSANDO: 'Processando', AGUARDANDO: 'Na fila', PENDENTE: 'Na fila', RECEBIDO: 'Recebido' })[material.status] || 'Em processamento';
}
export function statusChip(material) {
  const chip = document.createElement('span');
  chip.className = 'status-chip'; chip.dataset.state = materialState(material); chip.textContent = statusLabel(material);
  return chip;
}
/** Decorative Nino illustration (alt="" so screen readers only hear the message). */
export function ninoImage(pose = 'reading', size = 90) {
  const img = document.createElement('img');
  img.src = pose === 'reading' ? mascotReading : NINO[pose] || mascotReading;
  img.alt = '';
  img.width = size;
  img.height = size;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.className = 'nino-art';
  img.dataset.nino = pose;
  return img;
}
export function emptyState(title, description, { href = './nova-transcricao.html', action = 'Nova transcrição', mascot = true, pose = 'reading', size = 90 } = {}) {
  const card = document.createElement('div'); card.className = 'empty-state-card';
  // Art mount point: the art system (js/art) may replace the illustration in this slot.
  if (mascot) {
    const art = document.createElement('span');
    art.className = 'empty-state-art';
    art.dataset.artSlot = 'empty';
    art.append(ninoImage(typeof mascot === 'string' ? mascot : pose, size));
    card.appendChild(art);
  }
  const content = document.createElement('div');
  const heading = document.createElement('strong'); heading.textContent = title;
  const paragraph = document.createElement('p'); paragraph.textContent = description;
  content.append(heading, paragraph);
  if (href) { const link = document.createElement('a'); link.className = 'secondary-action button-link'; link.href = href; link.textContent = action; content.appendChild(link); }
  card.appendChild(content); return card;
}
/**
 * Empty state for lists inside panels and tabs: Nino and the text share one card, with an
 * optional title and a single action (the next step), so Nino never floats beside loose text.
 */
export function ninoNote(text, pose = 'rest', { className = '', title = '', action = null } = {}) {
  const note = document.createElement('div');
  note.className = `nino-note ${className}`.trim();
  const body = document.createElement('div');
  body.className = 'nino-note-body';
  if (title) {
    const heading = document.createElement('strong');
    heading.className = 'nino-note-title';
    heading.textContent = title;
    body.append(heading);
  }
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  body.append(paragraph);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-action nino-note-action';
    button.textContent = action.label;
    button.addEventListener('click', () => action.onClick(button));
    body.append(button);
  }
  const figure = document.createElement('span');
  figure.className = 'nino-note-figure';
  figure.dataset.artSlot = 'empty';
  figure.append(ninoImage(pose, 56));
  note.append(figure, body);
  return note;
}
export function errorState(message, retry) {
  const card = emptyState('Não foi possível carregar os materiais.', message, { href: null, mascot: 'curious' });
  const button = document.createElement('button'); button.className = 'secondary-action'; button.type = 'button'; button.textContent = 'Tentar novamente'; button.addEventListener('click', retry);
  card.querySelector('div').appendChild(button); return card;
}
