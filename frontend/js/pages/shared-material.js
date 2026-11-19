import { NINO } from '../utils/brand.js';
const hash = new URLSearchParams(location.hash.slice(1));
const token = hash.get('token');
// "lista" links are question-list worksheets; anything else is the original material copy.
const isList = hash.get('tipo') === 'lista';
const status = document.querySelector('[data-shared-status]'),
  content = document.querySelector('[data-shared-content]'),
  print = document.querySelector('[data-shared-print]'),
  retry = document.querySelector('[data-shared-retry]');
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function renderWorksheet(data) {
  document.querySelector('[data-shared-title]').textContent = data.title;
  document.title = `${data.title} | Voz em Estudo`;
  status.textContent = [data.materialTitle, data.subject || 'Sem disciplina', data.revision ? `revisão ${data.revision}` : '']
    .filter(Boolean)
    .join(' · ');
  const list = make('ol', null, 'shared-questions');
  for (const question of data.questions) {
    const item = make('li');
    item.append(make('p', question.statement));
    const options = make('ol', null, 'shared-options');
    for (const option of question.options) options.append(make('li', option));
    item.append(options);
    list.append(item);
  }
  content.append(
    make('p', 'Folha de questões somente para leitura. As respostas não fazem parte deste link.', 'shared-note'),
    list,
  );
}
function renderMaterial(data) {
  document.querySelector('[data-shared-title]').textContent = data.title;
  status.textContent = `${data.subject || 'Sem disciplina'} · revisão ${data.revision}${data.summaryVersion ? ' · resumo versão ' + data.summaryVersion : ''}`;
  for (const [key, title] of [['transcript', 'Transcrição'], ['summary', 'Resumo']])
    if (typeof data[key] === 'string') {
      const section = make('section');
      section.append(make('h2', title), make('p', data[key]));
      content.append(section);
    }
}
async function load() {
  retry.disabled = true;
  content.replaceChildren();
  print.hidden = true;
  try {
    if (!/^[0-9a-f]{64}$/.test(token || '')) throw new Error('Link inválido. Solicite um novo endereço ao responsável.');
    const response = await fetch(isList ? '/api/shared-question-list' : '/api/shared-material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok)
      throw new Error(response.status === 404 ? 'Link indisponível, expirado ou revogado.' : 'Não foi possível abrir a cópia. Tente novamente.');
    const data = await response.json();
    if (isList) renderWorksheet(data);
    else renderMaterial(data);
    print.hidden = false;
  } catch (error) {
    status.textContent = error.message;
    // Dead end: a friendly Nino instead of an empty page (decorative, the message says it all).
    const nino = make('img', null, 'shared-nino');
    nino.src = NINO.curious;
    nino.alt = '';
    nino.width = 120;
    nino.height = 120;
    content.append(nino, make('p', 'Peça um novo link a quem compartilhou com você.', 'shared-note'));
  } finally {
    retry.disabled = false;
  }
}
retry.addEventListener('click', () => {
  void load();
});
print.addEventListener('click', () => window.print());
void load();
