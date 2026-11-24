/**
 * Keyboard shortcuts help: "?" opens a dialog listing the shortcuts that exist in the app.
 * Only documents behaviour implemented elsewhere (preferences.js, media-player.js, tabs).
 */
const GROUPS = [
  {
    title: 'Geral',
    items: [
      ['?', 'Mostrar esta lista de atalhos'],
      ['Alt + F', 'Ligar ou desligar o modo foco'],
      ['Alt + L', 'Ouvir a página ou o texto selecionado (com leitura em voz alta em todo o site)'],
      ['Esc', 'Fechar menus, diálogos e a navegação reaberta no modo foco'],
      ['Tab / Shift + Tab', 'Avançar ou voltar entre os controles'],
    ],
  },
  {
    title: 'Player (com o player selecionado)',
    items: [
      ['Espaço ou K', 'Reproduzir ou pausar'],
      ['← / →', 'Voltar ou avançar 10 segundos'],
      ['Alças do recorte: ← / →', 'Mover 1 segundo (Shift: 10 segundos); Home/End vão às pontas'],
    ],
  },
  {
    title: 'Aula',
    items: [
      ['← / → nas abas', 'Trocar entre Transcrição, Resumo e Questões'],
      ['Home / End nas abas', 'Ir para a primeira ou a última aba'],
      ['Enter no horário', 'Tocar a gravação a partir daquele trecho'],
    ],
  },
  {
    title: 'Flashcards',
    items: [
      ['Espaço / Enter no cartão', 'Virar o cartão (frente e verso)'],
      ['← / → nas seções', 'Trocar entre Revisar cartões, Conjuntos, Criar cartão e as outras seções'],
    ],
  },
];

function isTyping(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

export function initShortcutsHelp() {
  let dialog = null;
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'shortcuts-dialog';
    dialog.setAttribute('aria-labelledby', 'shortcuts-title');
    const head = document.createElement('div');
    head.className = 'shortcuts-head';
    const title = document.createElement('h2');
    title.id = 'shortcuts-title';
    title.textContent = 'Atalhos de teclado';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dialog-close';
    close.setAttribute('aria-label', 'Fechar');
    close.textContent = '×';
    close.addEventListener('click', () => dialog.close());
    head.append(title, close);
    dialog.append(head);
    for (const group of GROUPS) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const list = document.createElement('dl');
      for (const [keys, description] of group.items) {
        const term = document.createElement('dt');
        for (const [i, key] of keys.split(' / ').entries()) {
          if (i) term.append(' / ');
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          term.append(kbd);
        }
        const detail = document.createElement('dd');
        detail.textContent = description;
        list.append(term, detail);
      }
      section.append(heading, list);
      dialog.append(section);
    }
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
  }
  function open() {
    if (!dialog) build();
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target) || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    open();
  });
  document
    .querySelectorAll('[data-open-shortcuts]')
    .forEach((button) => button.addEventListener('click', open));
  return { open };
}
