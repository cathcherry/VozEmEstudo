import { mascotReading } from './brand.js';

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
export function emptyState(title, description, { href = './nova-transcricao.html', action = 'Nova transcrição', mascot = true } = {}) {
  const card = document.createElement('div'); card.className = 'empty-state-card';
  if (mascot) { const img = document.createElement('img'); img.src = mascotReading; img.alt = ''; img.width = 90; img.height = 90; card.appendChild(img); }
  const content = document.createElement('div');
  const heading = document.createElement('strong'); heading.textContent = title;
  const paragraph = document.createElement('p'); paragraph.textContent = description;
  content.append(heading, paragraph);
  if (href) { const link = document.createElement('a'); link.className = 'secondary-action button-link'; link.href = href; link.textContent = action; content.appendChild(link); }
  card.appendChild(content); return card;
}
export function errorState(message, retry) {
  const card = emptyState('Não foi possível carregar os materiais.', message, { href: null, mascot: false });
  const button = document.createElement('button'); button.className = 'secondary-action'; button.type = 'button'; button.textContent = 'Tentar novamente'; button.addEventListener('click', retry);
  card.querySelector('div').appendChild(button); return card;
}
