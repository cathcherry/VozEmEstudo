// Internal art review (arte.html): every manifest entry, every Lume state and outfit, live.
// Not linked from the app; the page is noindex. Built from the manifest, so it never drifts.
import { ART, LUME_OUTFITS, LUME_STATES, kindOf } from '../art/manifest.js';
import { mountArtSlots, mountCompanion, renderArt } from '../art/art.js';
import { ICON_MAP, ICON_NAMES, icon } from '../utils/icons.js';

function h(tag, attributes = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((child) => child != null));
  return el;
}

const STATE_NOTES = {
  idle: 'Em repouso: respira e pisca.',
  reading: 'Durante a leitura ou o foco. Fica parada, para não distrair.',
  thinking: 'Enquanto a IA ou a busca trabalham.',
  happy: 'Depois de algo concluído.',
  sleepy: 'À noite ou em pausas longas. Cochila, nunca fica triste.',
  celebrating: 'Numa descoberta registrada: um breve brilho da lanterna.',
};
const STATE_NAMES = {
  idle: 'Em repouso',
  reading: 'Lendo',
  thinking: 'Pensando',
  happy: 'Contente',
  sleepy: 'Sonolenta',
  celebrating: 'Celebrando',
};

const ids = (kind) => Object.keys(ART).filter((id) => kindOf(id) === kind);

function facts(id, extra = []) {
  const entry = ART[id];
  return h(
    'dl',
    { class: 'review-facts' },
    h('dt', { text: 'Id' }),
    h(
      'dd',
      {},
      h('code', {}, ...id.split('.').flatMap((part, i) => (i ? [h('wbr'), `.${part}`] : [part]))),
    ),
    h('dt', { text: 'Tamanho' }),
    h('dd', { text: `${entry.width} × ${entry.height}` }),
    h('dt', { text: 'Licença' }),
    h('dd', { text: entry.license }),
    ...extra,
  );
}

function tile(id, sizes, { decorative = false, extra = [] } = {}) {
  const entry = ART[id];
  return h(
    'figure',
    { class: `review-tile review-${kindOf(id)}`, 'data-review-id': id },
    h(
      'div',
      { class: 'review-sizes' },
      sizes.map((size, i) => renderArt(id, { size, decorative: decorative || i > 0, lazy: false })),
    ),
    h(
      'figcaption',
      {},
      h('strong', { text: entry.title || entry.alt }),
      entry.event ? h('span', { class: 'review-event', text: entry.event }) : null,
      facts(id, extra),
    ),
  );
}

function section(key, title, intro, ...content) {
  return h(
    'section',
    { class: 'review-section', 'aria-labelledby': `sec-${key}` },
    h('h2', { id: `sec-${key}`, text: title }),
    intro ? h('p', { class: 'review-intro', text: intro }) : null,
    ...content,
  );
}

const companions = [];

function lumeSection() {
  const states = h('div', { class: 'review-grid review-grid-lume' });
  for (const state of LUME_STATES) {
    const id = `character.lume.${state}`;
    const big = h('div', { class: 'review-lume-stage' });
    const small = h('div', { class: 'review-lume-small' });
    states.append(
      h(
        'figure',
        { class: 'review-tile review-character', 'data-review-id': id, 'data-lume-state': state },
        h('div', { class: 'review-sizes' }, big, small),
        h(
          'figcaption',
          {},
          h('strong', { text: STATE_NAMES[state] }),
          h('span', { class: 'review-event', text: STATE_NOTES[state] }),
          facts(id, [
            h('dt', { text: 'Movimento' }),
            h('dd', { text: ART[id].animation.join(', ') || 'nenhum (parada)' }),
          ]),
        ),
      ),
    );
    companions.push(mountCompanion(big, { state, size: 176, decorative: false }));
    companions.push(mountCompanion(small, { state, size: 48 }));
  }
  const outfits = h('div', { class: 'review-grid review-grid-lume' });
  for (const outfit of LUME_OUTFITS) {
    const id = `character.lume.outfit.${outfit}`;
    const big = h('div', { class: 'review-lume-stage' });
    const small = h('div', { class: 'review-lume-small' });
    outfits.append(
      h(
        'figure',
        { class: 'review-tile review-character', 'data-review-id': id },
        h(
          'div',
          { class: 'review-sizes' },
          big,
          small,
          renderArt(id, { size: 72, decorative: true, lazy: false }),
        ),
        h('figcaption', {}, h('strong', { text: ART[id].title }), facts(id)),
      ),
    );
    companions.push(mountCompanion(big, { state: 'idle', outfit, size: 176, decorative: false }));
    companions.push(mountCompanion(small, { state: 'idle', outfit, size: 48 }));
  }
  return section(
    'lume',
    'Lume, a mariposa bibliotecária',
    'Seis estados com as partes animadas por CSS (asas, antenas, pálpebras, lanterna). O desenho grande está em 176 px e o pequeno em 48 px. Com movimento desligado, tudo fica parado.',
    states,
    h('h3', { text: 'Trajes colecionáveis' }),
    h('p', {
      class: 'review-intro',
      text: 'Cada traje é uma camada sobre qualquer estado. Ao lado, o arquivo do traje sozinho.',
    }),
    outfits,
  );
}

function wallpaperSection() {
  const grid = h('div', { class: 'review-grid review-grid-wide' });
  for (const id of ids('wallpaper')) {
    const entry = ART[id];
    const art = renderArt(id, { decorative: false, lazy: false });
    grid.append(
      h(
        'figure',
        { class: 'review-tile review-wallpaper', 'data-review-id': id, 'data-tone': entry.tone },
        h(
          'div',
          { class: 'review-wallpaper-frame' },
          art,
          h(
            'div',
            { class: 'review-sample-panel', 'aria-hidden': 'true' },
            h('span', { text: 'Painel de exemplo' }),
            h('span', { text: 'O texto continua legível sobre o fundo.' }),
          ),
        ),
        h(
          'figcaption',
          {},
          h('strong', { text: entry.title }),
          facts(id, [
            h('dt', { text: 'Tom' }),
            h('dd', { text: entry.tone === 'dark' ? 'escuro' : 'claro' }),
          ]),
        ),
      ),
    );
  }
  return section(
    'wallpapers',
    'Papéis de parede das atmosferas',
    'Cenas de 1600 × 1000 em baixo contraste, recortadas com "cover". O painel de exemplo mostra a leitura sobre cada uma.',
    grid,
  );
}

function hooksSection() {
  const companionSlot = h('div', {
    'data-art-slot': 'companion',
    'data-art-state': 'idle',
    'data-art-size': '96',
    'data-review-slot': 'companion',
  });
  const emptySlot = h('div', {
    'data-art-slot': 'empty',
    'data-art-id': 'empty.library',
    'data-art-size': '240',
  });
  const missingSlot = h('div', {
    'data-art-slot': 'empty',
    'data-art-id': 'empty.does-not-exist',
    'data-review-slot': 'missing',
  });
  const buttons = h(
    'div',
    { class: 'review-segmented', role: 'group', 'aria-label': 'Estado da Lume no gancho' },
    LUME_STATES.map((state) =>
      h('button', {
        type: 'button',
        'data-slot-state': state,
        'aria-pressed': String(state === 'idle'),
        text: STATE_NAMES[state],
      }),
    ),
  );
  buttons.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-slot-state]');
    if (!button) return;
    companionSlot.dataset.artState = button.dataset.slotState;
    for (const other of buttons.querySelectorAll('button'))
      other.setAttribute('aria-pressed', String(other === button));
  });
  return section(
    'hooks',
    'Ganchos para as páginas',
    'As páginas deixam data-art-slot="companion" ou data-art-slot="empty" com data-art-id e data-art-state; o módulo art.js preenche sozinho. Um id inexistente não desenha nada (o terceiro quadro fica vazio de propósito).',
    h(
      'div',
      { class: 'review-hooks' },
      h('div', { class: 'review-hook' }, companionSlot, buttons),
      h('div', { class: 'review-hook' }, emptySlot),
      h('div', { class: 'review-hook review-hook-missing' }, missingSlot),
    ),
  );
}

const FAMILY_NAMES = {
  lavender: 'lavanda',
  matcha: 'matcha',
  honey: 'mel',
  mist: 'névoa',
  rose: 'rosa',
  wood: 'madeira',
};

function scrapbookSections() {
  const grid = (kind, sizes, extra = '') =>
    h(
      'div',
      { class: `review-grid ${extra}`.trim() },
      ids(kind).map((id) =>
        tile(id, sizes, {
          extra:
            kind === 'emblem'
              ? [h('dt', { text: 'Etiqueta' }), h('dd', { text: FAMILY_NAMES[ART[id].family] })]
              : [],
        }),
      ),
    );
  return [
    section(
      'emblems',
      'Emblemas das disciplinas',
      'Um desenho de papelaria sobre uma etiqueta tingida. A cor da etiqueta agrupa a família; o desenho diz a disciplina. Legíveis de 32 a 96 px. A Biblioteca guarda o id escolhido para cada pasta.',
      grid('emblem', [96, 48, 32], 'review-grid-compact'),
    ),
    section(
      'stickers',
      'Adesivos',
      'Recorte branco e uma sombra curta, como um adesivo de verdade. Funcionam sobre papel claro e sobre a noite.',
      grid('sticker', [96, 48], 'review-grid-compact'),
    ),
    section(
      'tapes',
      'Fitas washi',
      'Semitransparentes, com pontas rasgadas. O CSS também tem a versão leve (.washi[data-tape]).',
      grid('tape', [240, 120], 'review-grid-wide'),
    ),
    section(
      'papers',
      'Papéis',
      'Folhas soltas para notas, diários e fundos de cartões.',
      grid('paper', [150, 64]),
    ),
    section(
      'frames',
      'Molduras',
      'A janela é transparente: uma foto ou nota colocada atrás aparece por dentro.',
      grid('frame', [150, 72]),
    ),
    section(
      'dividers',
      'Divisores',
      'Fios desenhados à mão para separar trechos de uma página.',
      grid('divider', [320], 'review-grid-wide'),
    ),
    section(
      'labels',
      'Etiquetas',
      'Placas em branco: o app escreve o nome por cima.',
      grid('label', [200, 100], 'review-grid-wide'),
    ),
  ];
}

/** Live CSS primitives from materials.css, composed as a small scrapbook desk. */
function materialsSection() {
  const scope = (tone) => {
    const root = h('div', { class: 'mat-scope review-materials', 'data-tone': tone });
    root.innerHTML = `
      <div class="review-mat-col">
        <div class="paper page-stack review-mat-note" data-paper="ruled">
          <span class="washi" data-tape="lavender-dots" style="--tilt:-5deg"></span>
          <span class="bookmark-ribbon" data-tint="lavender"></span>
          <p>Fotossíntese: a luz vira açúcar na folha.</p><p>Revisar o ciclo de Calvin.</p>
        </div>
        <div class="tab-strip" role="presentation">
          <span class="paper-tab" data-tint="lavender">Aulas</span><span class="paper-tab" aria-current="page">Notas</span><span class="paper-tab" data-tint="matcha">Cartões</span>
        </div>
        <div class="paper" data-paper="grid" style="padding:14px 16px">Papel quadriculado</div>
      </div>
      <div class="review-mat-col">
        <figure class="polaroid" style="--tilt:2deg"><span></span><figcaption>Excursão ao jardim</figcaption></figure>
        <div class="index-card"><strong>Mitose</strong><br>Divisão em duas células iguais.</div>
        <div class="paper" data-paper="kraft" data-edge="deckle" style="padding:14px 16px 20px">Kraft com borda deckle</div>
      </div>
      <div class="review-mat-col">
        <div class="review-mat-covers">
          <div class="book-cover" data-cover="cloth-lavender"><span class="book-cover-label">Biologia</span></div>
          <div class="book-cover" data-cover="leather-matcha"><span class="book-cover-label" data-relief="embossed">Diário</span></div>
          <div class="book-cover" data-cover="kraft"><span class="book-cover-label">Campo</span></div>
          <div class="book-cover" data-cover="night"><span class="book-cover-label">Noite</span></div>
        </div>
        <div class="review-mat-drawers">
          <span class="drawer"><span class="label-holder">Selos</span><span class="drawer-pull"></span></span>
          <span class="drawer"><span class="label-holder">Folhas</span><span class="drawer-pull"></span></span>
        </div>
        <p class="review-mat-labels"><span class="embossed-label">BIOLOGIA</span> <span class="embossed-label" data-tint="matcha">REVISAR</span> <span class="embossed-label" data-tint="rose">PROVA</span></p>
        <div class="paper" data-paper="aged" data-edge="torn" style="padding:14px 16px">Papel envelhecido, borda rasgada</div>
      </div>`;
    return root;
  };
  return section(
    'materials',
    'Materiais (CSS)',
    'Primitivos de frontend/css/materials.css, ao vivo: papel, pilha de folhas, fita, marcador, abas, polaroide, ficha, capas de tecido e couro, gavetas com puxador de latão e etiquetas em relevo. Em alto contraste e cores forçadas, a decoração some e fica só a borda.',
    h('div', { class: 'review-mat-pair' }, scope('light'), scope('dark')),
  );
}

/** The functional icon sprite (Phosphor, MIT), with semantic and pack names. */
function uiIconsSection() {
  const grid = h('div', { class: 'review-ui-icons' });
  for (const name of ICON_NAMES)
    grid.append(
      h(
        'figure',
        { class: 'review-ui-icon' },
        icon(name, { size: 28 }),
        h('figcaption', {}, h('code', { text: name }), h('span', { text: ICON_MAP[name] })),
      ),
    );
  return section(
    'ui-icons',
    'Ícones de interface',
    `Phosphor Icons 2.1.1 (licença MIT), peso duotone, ${ICON_NAMES.length} ícones num sprite (frontend/assets/icons/sprite.svg). O código usa o nome semântico; a camada clara usa a cor --icon-tint.`,
    grid,
  );
}

function controls() {
  const motion = h(
    'div',
    { class: 'review-segmented', role: 'group', 'aria-label': 'Movimento' },
    h('button', {
      type: 'button',
      'data-motion-choice': 'on',
      'aria-pressed': 'true',
      text: 'Movimento ligado',
    }),
    h('button', {
      type: 'button',
      'data-motion-choice': 'off',
      'aria-pressed': 'false',
      text: 'Movimento desligado',
    }),
  );
  motion.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-motion-choice]');
    if (!button) return;
    if (button.dataset.motionChoice === 'off') document.documentElement.dataset.motion = 'off';
    else delete document.documentElement.dataset.motion;
    for (const other of motion.querySelectorAll('button'))
      other.setAttribute('aria-pressed', String(other === button));
  });
  const surface = h(
    'div',
    { class: 'review-segmented', role: 'group', 'aria-label': 'Fundo da página' },
    h('button', { type: 'button', 'data-surface': 'paper', 'aria-pressed': 'true', text: 'Papel' }),
    h('button', {
      type: 'button',
      'data-surface': 'night',
      'aria-pressed': 'false',
      text: 'Noite',
    }),
  );
  surface.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-surface]');
    if (!button) return;
    document.body.dataset.surface = button.dataset.surface;
    for (const other of surface.querySelectorAll('button'))
      other.setAttribute('aria-pressed', String(other === button));
  });
  return h('div', { class: 'review-controls' }, motion, surface);
}

function build() {
  const main = document.getElementById('arte');
  const total = Object.keys(ART).length;
  main.append(
    h(
      'header',
      { class: 'review-header' },
      h('h1', { text: 'Revisão de arte' }),
      h('p', {
        class: 'review-lede',
        text: `Página interna com as ${total} peças do manifesto (frontend/js/art/manifest.js). Toda a arte é original, desenhada em SVG para o Voz em Estudo; trocar uma peça é trocar um arquivo com o mesmo nome e tamanho.`,
      }),
      controls(),
    ),
    lumeSection(),
    section(
      'stamps',
      'Selos',
      'Um selo por evento de aprendizagem verificado, legível de 48 a 96 px. Nenhum selo fala de sequência ou de tempo de tela.',
      h(
        'div',
        { class: 'review-grid' },
        ids('stamp').map((id) => tile(id, [96, 48])),
      ),
    ),
    section(
      'objects',
      'Objetos da escrivaninha',
      'Todos apoiados na mesma linha de base, com a mesma sombra suave.',
      h(
        'div',
        { class: 'review-grid' },
        ids('object').map((id) => tile(id, [128, 56])),
      ),
    ),
    section(
      'covers',
      'Capas de caderno',
      'A etiqueta fica em branco: o app escreve o título por cima.',
      h(
        'div',
        { class: 'review-grid' },
        ids('cover').map((id) => tile(id, [150, 60])),
      ),
    ),
    wallpaperSection(),
    section(
      'empty',
      'Estados vazios',
      'Cada cena mostra espaço para o primeiro item, com um contorno tracejado do que vai chegar.',
      h(
        'div',
        { class: 'review-grid review-grid-wide' },
        ids('empty').map((id) => tile(id, [320, 160])),
      ),
    ),
    section(
      'icons',
      'Ícones ilustrados',
      'Traço de 1,6 em 24 × 24, na cor do texto ao redor. Usados como arte (Descobertas, Gabinete, mesa); os ícones de função ficam no sprite Phosphor, mais abaixo.',
      h(
        'div',
        { class: 'review-grid review-grid-icons' },
        ids('icon').map((id) => tile(id, [32, 24, 16])),
      ),
    ),
    ...scrapbookSections(),
    materialsSection(),
    uiIconsSection(),
    hooksSection(),
  );
  mountArtSlots(main);
  Promise.all(companions.map((companion) => companion.ready)).then(() =>
    main.setAttribute('aria-busy', 'false'),
  );
}

build();
