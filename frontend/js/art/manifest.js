// Central art manifest: every illustration in the app is referenced by a stable semantic id.
// To replace a piece with hand-drawn art, drop a file with the same name and size in
// frontend/assets/art/, or edit `src` (and `width`/`height`) of one entry below.
// See docs/ART_DIRECTION_AND_ASSETS.md for the style guide and the full inventory.

export const ART_BASE = '/assets/art/';

/** Licence of everything drawn for this project (no third-party art is used). */
export const ORIGINAL = 'original, Voz em Estudo';

/** Lume's animation per state: which CSS part animations run (art.css). Reading never moves. */
const LUME_MOTION = {
  idle: ['breathe', 'blink', 'antenna-sway', 'wing-drift'],
  reading: [],
  thinking: ['blink', 'thought-dots', 'antenna-sway'],
  happy: ['hop', 'wing-flutter', 'sparkle'],
  sleepy: ['slow-breathe', 'sleep-dots'],
  celebrating: ['lantern-glow', 'wing-flutter', 'sparkle'],
};

const lume = (state, alt) => ({
  src: `characters/lume/lume-${state}.svg`,
  width: 240,
  height: 240,
  alt,
  license: ORIGINAL,
  inline: true,
  animation: LUME_MOTION[state],
});
const outfit = (name, title, alt) => ({
  src: `characters/lume/outfits/${name}.svg`,
  width: 240,
  height: 240,
  title,
  alt,
  license: ORIGINAL,
  inline: true,
  animation: [],
});
const stamp = (name, title, event) => ({
  src: `stamps/${name}.svg`,
  width: 120,
  height: 120,
  title,
  alt: `Selo “${title}”`,
  event,
  license: ORIGINAL,
  animation: [],
});
const object = (name, title, alt) => ({
  src: `objects/${name}.svg`,
  width: 160,
  height: 160,
  title,
  alt,
  license: ORIGINAL,
  animation: [],
});
const cover = (name, title, alt) => ({
  src: `covers/${name}.svg`,
  width: 240,
  height: 320,
  title,
  alt,
  license: ORIGINAL,
  animation: [],
});
const wallpaper = (name, title, alt, tone = 'light') => ({
  src: `wallpapers/${name}.svg`,
  width: 1600,
  height: 1000,
  title,
  alt,
  tone,
  license: ORIGINAL,
  animation: [],
});
const empty = (name, alt) => ({
  src: `empty/${name}.svg`,
  width: 320,
  height: 240,
  alt,
  license: ORIGINAL,
  animation: [],
});
const icon = (name, alt) => ({
  src: `icons/${name}.svg`,
  width: 24,
  height: 24,
  alt,
  license: ORIGINAL,
  mask: true,
  animation: [],
});

export const ART = Object.freeze({
  'character.lume.idle': lume('idle', 'Lume, a mariposa bibliotecária, segura a lanterna e sorri'),
  'character.lume.reading': lume('reading', 'Lume lê um livro aberto, com a lanterna ao lado'),
  'character.lume.thinking': lume('thinking', 'Lume pensa com a mão no queixo'),
  'character.lume.happy': lume('happy', 'Lume sorri contente e acena'),
  'character.lume.sleepy': lume('sleepy', 'Lume cochila tranquila ao lado da lanterna'),
  'character.lume.celebrating': lume(
    'celebrating',
    'Lume ergue a lanterna, que brilha com faíscas',
  ),

  'character.lume.outfit.winter-scarf': outfit(
    'winter-scarf',
    'Cachecol de inverno',
    'Cachecol listrado rosa',
  ),
  'character.lume.outfit.raincoat': outfit(
    'raincoat',
    'Capa de chuva',
    'Capa de chuva azul-névoa e chapéu amarelo',
  ),
  'character.lume.outfit.reading-glasses': outfit(
    'reading-glasses',
    'Óculos de leitura',
    'Óculos redondos de leitura',
  ),
  'character.lume.outfit.explorer-hat': outfit(
    'explorer-hat',
    'Chapéu de explorador',
    'Chapéu de explorador com fita verde',
  ),

  'stamp.first-evidence': stamp(
    'first-evidence',
    'Primeira evidência',
    'Registrou a primeira citação verificada de uma aula.',
  ),
  'stamp.own-explanation': stamp(
    'own-explanation',
    'Com as próprias palavras',
    'Escreveu uma explicação própria numa investigação.',
  ),
  'stamp.revisit': stamp(
    'revisit',
    'Revisita',
    'Voltou a uma descoberta para revê-la ou ampliá-la.',
  ),
  'stamp.connection': stamp(
    'connection',
    'Ponte entre disciplinas',
    'Ligou descobertas de duas disciplinas diferentes.',
  ),
  'stamp.first-investigation': stamp(
    'first-investigation',
    'Primeira investigação',
    'Concluiu a primeira investigação.',
  ),
  'stamp.careful-reviewer': stamp(
    'careful-reviewer',
    'Revisão cuidadosa',
    'Revisou cartões conferindo cada resposta.',
  ),
  'stamp.curious-question': stamp(
    'curious-question',
    'Pergunta curiosa',
    'Abriu uma investigação a partir de uma pergunta própria.',
  ),
  'stamp.gentle-evening': stamp(
    'gentle-evening',
    'Estudo ao entardecer',
    'Estudou à noite, no próprio ritmo.',
  ),
  'stamp.first-discovery': stamp(
    'first-discovery',
    'Primeira descoberta',
    'Registrou a primeira descoberta no caderno.',
  ),
  'stamp.deep-focus': stamp('deep-focus', 'Luz de foco', 'Concluiu uma sessão de foco planejada.'),
  'stamp.shared-note': stamp(
    'shared-note',
    'Bilhete compartilhado',
    'Compartilhou um material ou uma descoberta com a turma.',
  ),
  'stamp.new-subject': stamp(
    'new-subject',
    'Nova disciplina',
    'Começou a estudar uma disciplina nova.',
  ),

  'stamp.first-reflection': stamp(
    'first-reflection',
    'Primeira reflexão',
    'Registrou uma reflexão sobre o que investigou.',
  ),

  'object.desk-lamp': object(
    'desk-lamp',
    'Luminária de mesa',
    'Luminária articulada lavanda com cúpula verde acesa',
  ),
  'object.teacup': object('teacup', 'Xícara de chá', 'Xícara rosa com chá matcha fumegante'),
  'object.pressed-flower-jar': object(
    'pressed-flower-jar',
    'Pote de flores',
    'Pote de vidro com flores do campo',
  ),
  'object.globe': object('globe', 'Globo', 'Pequeno globo terrestre num suporte de madeira'),
  'object.inkwell': object('inkwell', 'Tinteiro', 'Tinteiro lavanda com uma pena branca'),
  'object.cactus': object(
    'cactus',
    'Cacto que nunca murcha',
    'Cacto redondo florido num vaso rosa',
  ),
  'object.hourglass': object('hourglass', 'Ampulheta', 'Ampulheta de madeira com areia cor de mel'),
  'object.magnifying-glass': object('magnifying-glass', 'Lupa', 'Lupa de aro dourado e cabo de madeira'),
  'object.specimen-box': object(
    'specimen-box',
    'Caixa de espécimes',
    'Caixa de madeira com folha, concha, pena e flor prensadas',
  ),

  'cover.matcha-linen': cover('matcha-linen', 'Linho matcha', 'Caderno com capa de linho verde'),
  'cover.lavender-dots': cover('lavender-dots', 'Bolinhas lavanda', 'Caderno lavanda com bolinhas'),
  'cover.honey-gingham': cover('honey-gingham', 'Xadrez mel', 'Caderno com capa xadrez amarela'),
  'cover.mist-marbled': cover(
    'mist-marbled',
    'Marmorizado névoa',
    'Caderno com capa marmorizada azul',
  ),
  'cover.rose-botanical': cover(
    'rose-botanical',
    'Botânico rosa',
    'Caderno rosa com raminhos de flores',
  ),
  'cover.night-stars': cover('night-stars', 'Noite estrelada', 'Caderno escuro com estrelas e lua'),

  'wallpaper.rainy-library': wallpaper(
    'rainy-library',
    'Biblioteca chuvosa',
    'Estantes de livros e uma janela em arco com chuva',
  ),
  'wallpaper.lavender-desk': wallpaper(
    'lavender-desk',
    'Escrivaninha lavanda',
    'Parede lavanda com luz da janela sobre a mesa',
  ),
  'wallpaper.matcha-afternoon': wallpaper(
    'matcha-afternoon',
    'Tarde de matcha',
    'Raios de sol e sombras de folhas sobre colinas verdes',
  ),
  'wallpaper.cozy-winter': wallpaper(
    'cozy-winter',
    'Inverno aconchegante',
    'Pinheiros e neve caindo sob um sol pálido',
  ),
  'wallpaper.ocean-study': wallpaper(
    'ocean-study',
    'Estudo à beira-mar',
    'Mar calmo com um farol ao longe',
  ),
  'wallpaper.night-garden': wallpaper(
    'night-garden',
    'Jardim noturno',
    'Jardim à noite com lua, flores e vaga-lumes',
    'dark',
  ),

  'empty.library': empty('library', 'Prateleira com espaço para os próximos livros'),
  'empty.discoveries': empty('discoveries', 'Caderno aberto esperando a primeira descoberta'),
  'empty.flashcards': empty('flashcards', 'Cartões em branco prontos para começar'),
  'empty.planner': empty('planner', 'Calendário livre com uma xícara de chá ao lado'),
  'empty.classrooms': empty('classrooms', 'Quadro e banquinho esperando a turma'),

  'icon.desk': icon('desk', 'Escrivaninha'),
  'icon.notebook': icon('notebook', 'Caderno'),
  'icon.cabinet': icon('cabinet', 'Gabinete'),
  'icon.stamp': icon('stamp', 'Selo'),
  'icon.lantern': icon('lantern', 'Lanterna'),
  'icon.lume': icon('lume', 'Lume'),
  'icon.evidence': icon('evidence', 'Evidência'),
  'icon.investigation': icon('investigation', 'Investigação'),
  'icon.leaf': icon('leaf', 'Folha'),
  'icon.teacup': icon('teacup', 'Xícara'),
  'icon.sparkle': icon('sparkle', 'Brilho'),
  'icon.bookmark': icon('bookmark', 'Marcador'),
  'icon.connection': icon('connection', 'Ligação'),
  'icon.question': icon('question', 'Pergunta'),
});

/** Lume's states, in display order. The art system always refers to a state, never to a file. */
export const LUME_STATES = Object.freeze([
  'idle',
  'reading',
  'thinking',
  'happy',
  'sleepy',
  'celebrating',
]);
export const LUME_OUTFITS = Object.freeze([
  'winter-scarf',
  'raincoat',
  'reading-glasses',
  'explorer-hat',
]);

/** Kinds, their folder and the id pattern each id must follow. */
export const ART_KINDS = Object.freeze({
  character: {
    folder: 'characters/',
    pattern: /^character\.lume\.(?:[a-z]+|outfit\.[a-z]+(?:-[a-z]+)*)$/,
  },
  stamp: { folder: 'stamps/', pattern: /^stamp\.[a-z]+(?:-[a-z]+)*$/ },
  object: { folder: 'objects/', pattern: /^object\.[a-z]+(?:-[a-z]+)*$/ },
  cover: { folder: 'covers/', pattern: /^cover\.[a-z]+(?:-[a-z]+)*$/ },
  wallpaper: { folder: 'wallpapers/', pattern: /^wallpaper\.[a-z]+(?:-[a-z]+)*$/ },
  empty: { folder: 'empty/', pattern: /^empty\.[a-z]+(?:-[a-z]+)*$/ },
  icon: { folder: 'icons/', pattern: /^icon\.[a-z]+(?:-[a-z]+)*$/ },
});

export const kindOf = (id) => String(id).split('.')[0];
