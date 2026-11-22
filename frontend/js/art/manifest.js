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

// ---- 3.6: scrapbook set and discipline emblems -------------------------------------------------
/** Discipline emblem: a stationery motif on a tinted label plate (the tint is the `family`). */
const emblem = (name, title, alt, family) => ({
  src: `emblems/${name}.svg`,
  width: 64,
  height: 64,
  title,
  alt,
  family,
  license: ORIGINAL,
  animation: [],
});
const piece = (folder, width, height) => (name, title, alt) => ({
  src: `${folder}/${name}.svg`,
  width,
  height,
  title,
  alt,
  license: ORIGINAL,
  animation: [],
});
const paper = piece('papers', 200, 260);
const tape = piece('tapes', 160, 44);
const sticker = piece('stickers', 96, 96);
const frame = piece('frames', 200, 240);
const divider = piece('dividers', 320, 24);
const label = piece('labels', 200, 72);

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
  'object.magnifying-glass': object(
    'magnifying-glass',
    'Lupa',
    'Lupa de aro dourado e cabo de madeira',
  ),
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
  'cover.cloth-lavender': cover(
    'cloth-lavender',
    'Tecido lavanda',
    'Caderno com capa de tecido lavanda e estrela gravada',
  ),
  'cover.leather-matcha': cover(
    'leather-matcha',
    'Couro matcha',
    'Caderno de couro verde com costura dourada',
  ),
  'cover.marbled-honey': cover(
    'marbled-honey',
    'Marmorizado mel',
    'Caderno com papel marmorizado em mel e rosa',
  ),
  'cover.botanical-press': cover(
    'botanical-press',
    'Herbário',
    'Caderno claro com uma samambaia e flores prensadas',
  ),
  'cover.constellation': cover(
    'constellation',
    'Constelação',
    'Caderno azul-noite com uma constelação desenhada',
  ),
  'cover.field-notes': cover(
    'field-notes',
    'Caderneta de campo',
    'Caderneta de papel kraft com linhas para anotar',
  ),

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
  'wallpaper.old-notebook': wallpaper(
    'old-notebook',
    'Caderno acadêmico antigo',
    'Folha pautada com margem, fita marcadora e folhas prensadas',
  ),
  'wallpaper.dreamy-pastel': wallpaper(
    'dreamy-pastel',
    'Pastel sonhador',
    'Céu lilás com nuvens, lua, estrelinhas e um arco-íris claro',
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

  // ---- 3.6: discipline emblems (Biblioteca folders) ----
  'emblem.biologia': emblem('biologia', 'Biologia', 'Dupla hélice de DNA', 'matcha'),
  'emblem.quimica': emblem(
    'quimica',
    'Química',
    'Frasco de laboratório com líquido e bolhas',
    'lavender',
  ),
  'emblem.fisica': emblem('fisica', 'Física', 'Átomo com três órbitas', 'mist'),
  'emblem.matematica': emblem('matematica', 'Matemática', 'Esquadro com régua e compasso', 'honey'),
  'emblem.historia': emblem('historia', 'História', 'Coluna clássica', 'wood'),
  'emblem.geografia': emblem('geografia', 'Geografia', 'Globo terrestre no suporte', 'matcha'),
  'emblem.literatura': emblem(
    'literatura',
    'Português e literatura',
    'Livro aberto com fita marcadora',
    'rose',
  ),
  'emblem.linguas': emblem('linguas', 'Línguas', 'Dois balões de conversa', 'lavender'),
  'emblem.artes': emblem('artes', 'Artes', 'Paleta de pintura com pincel', 'rose'),
  'emblem.musica': emblem('musica', 'Música', 'Duas colcheias unidas', 'lavender'),
  'emblem.filosofia': emblem('filosofia', 'Filosofia', 'Coruja de olhos atentos', 'mist'),
  'emblem.sociologia': emblem('sociologia', 'Sociologia', 'Três pessoas lado a lado', 'honey'),
  'emblem.direito': emblem('direito', 'Direito', 'Balança da justiça', 'wood'),
  'emblem.saude': emblem('saude', 'Medicina e saúde', 'Coração com linha de pulso', 'rose'),
  'emblem.economia': emblem('economia', 'Economia', 'Gráfico de barras e moeda', 'honey'),
  'emblem.computacao': emblem(
    'computacao',
    'Computação',
    'Computador clássico com tela acesa',
    'mist',
  ),
  'emblem.engenharia': emblem('engenharia', 'Engenharia', 'Duas engrenagens encaixadas', 'wood'),
  'emblem.psicologia': emblem(
    'psicologia',
    'Psicologia',
    'Perfil de cabeça com uma flor dentro',
    'lavender',
  ),
  'emblem.educacao-fisica': emblem(
    'educacao-fisica',
    'Educação física',
    'Bola com costuras e linhas de movimento',
    'matcha',
  ),
  'emblem.astronomia': emblem(
    'astronomia',
    'Astronomia',
    'Planeta com anéis e estrelas',
    'lavender',
  ),
  'emblem.botanica': emblem('botanica', 'Botânica', 'Broto num vaso de barro', 'matcha'),
  'emblem.idiomas': emblem('idiomas', 'Idiomas', 'Envelope de correio aéreo com selo', 'mist'),
  'emblem.geral': emblem('geral', 'Geral', 'Caderno espiral com etiqueta', 'lavender'),
  'emblem.pesquisa': emblem('pesquisa', 'Pesquisa', 'Lupa sobre uma folha de anotações', 'honey'),

  'paper.ruled': paper('ruled', 'Pautado', 'Folha pautada com margem rosa'),
  'paper.grid': paper('grid', 'Quadriculado', 'Folha quadriculada azul-névoa'),
  'paper.dot': paper('dot', 'Pontilhado', 'Folha com grade de pontos lavanda'),
  'paper.kraft': paper('kraft', 'Kraft', 'Papel kraft com fibras e borda irregular'),
  'paper.linen': paper('linen', 'Linho', 'Papel linho com trama fina'),
  'paper.vellum': paper('vellum', 'Vegetal', 'Papel vegetal translúcido'),
  'paper.aged-cream': paper(
    'aged-cream',
    'Creme envelhecido',
    'Papel creme envelhecido, com manchas leves e borda irregular',
  ),

  'tape.lavender-dots': tape(
    'lavender-dots',
    'Bolinhas lavanda',
    'Fita washi lavanda com bolinhas brancas',
  ),
  'tape.matcha-stripes': tape(
    'matcha-stripes',
    'Listras matcha',
    'Fita washi verde com listras diagonais',
  ),
  'tape.honey-gingham': tape('honey-gingham', 'Xadrez mel', 'Fita washi amarela xadrez'),
  'tape.rose-floral': tape('rose-floral', 'Florzinhas rosa', 'Fita washi rosa com florzinhas'),
  'tape.mist-grid': tape('mist-grid', 'Grade névoa', 'Fita washi azul-névoa quadriculada'),
  'tape.kraft': tape('kraft', 'Kraft', 'Fita de papel kraft lisa'),
  'tape.stars': tape('stars', 'Estrelinhas', 'Fita washi azul-noite com estrelinhas douradas'),
  'tape.check': tape('check', 'Xadrez lavanda e matcha', 'Fita washi xadrez em lavanda e verde'),

  'sticker.pressed-flower': sticker(
    'pressed-flower',
    'Flor prensada',
    'Flor prensada de pétalas rosadas',
  ),
  'sticker.leaf': sticker('leaf', 'Folha', 'Folha verde com nervuras'),
  'sticker.moth': sticker('moth', 'Mariposa', 'Mariposa lavanda de asas abertas'),
  'sticker.teacup': sticker('teacup', 'Xícara', 'Xícara de chá com vapor'),
  'sticker.pencil': sticker('pencil', 'Lápis', 'Lápis amarelo apontado'),
  'sticker.paperclip': sticker('paperclip', 'Clipe', 'Clipe de papel lavanda'),
  'sticker.star': sticker('star', 'Estrela', 'Estrela dourada'),
  'sticker.moon': sticker('moon', 'Lua', 'Lua crescente com estrelinha'),
  'sticker.bookmark': sticker('bookmark', 'Marcador', 'Marcador de página com borla'),
  'sticker.mushroom': sticker('mushroom', 'Cogumelo', 'Cogumelo de chapéu rosado com pintas'),
  'sticker.fern': sticker('fern', 'Samambaia', 'Ramo de samambaia'),
  'sticker.snail': sticker('snail', 'Caracol', 'Caracol de concha espiral'),
  'sticker.lamp': sticker('lamp', 'Luminária', 'Luminária de mesa acesa'),
  'sticker.envelope': sticker('envelope', 'Envelope', 'Envelope fechado com coração'),
  'sticker.wax-seal': sticker('wax-seal', 'Selo de cera', 'Selo de cera lavanda com uma estrela'),
  'sticker.ribbon-bow': sticker('ribbon-bow', 'Laço de fita', 'Laço de fita rosa'),
  'sticker.bee': sticker('bee', 'Abelha', 'Abelha listrada com asas claras'),
  'sticker.clover': sticker('clover', 'Trevo', 'Trevo de quatro folhas'),
  'sticker.cloud': sticker('cloud', 'Nuvem', 'Nuvem macia'),
  'sticker.book-heart': sticker(
    'book-heart',
    'Coração de livros',
    'Pilha de livros com um coração em cima',
  ),

  'frame.polaroid': frame(
    'polaroid',
    'Polaroide',
    'Moldura de foto instantânea com margem larga embaixo',
  ),
  'frame.deckle': frame('deckle', 'Borda deckle', 'Foto antiga com borda recortada em zigue-zague'),
  'frame.tape-corners': frame(
    'tape-corners',
    'Cantoneiras',
    'Quatro cantoneiras de papel kraft para prender uma foto',
  ),
  'frame.scalloped': frame('scalloped', 'Recorte ondulado', 'Moldura creme de borda ondulada'),
  'frame.stamp-border': frame(
    'stamp-border',
    'Borda de selo',
    'Moldura branca com picote de selo postal',
  ),

  'divider.wave': divider('wave', 'Onda à mão', 'Linha ondulada desenhada à mão'),
  'divider.sprig': divider('sprig', 'Raminho', 'Linha fina com um raminho de folhas no centro'),
  'divider.stitch': divider('stitch', 'Costura', 'Dupla costura tracejada rosa'),
  'divider.diamond': divider('diamond', 'Losango', 'Fio duplo com um losango dourado'),
  'divider.moon-dots': divider('moon-dots', 'Pontos e lua', 'Linha pontilhada com uma pequena lua'),

  'label.brass-holder': label(
    'brass-holder',
    'Porta-etiqueta de latão',
    'Porta-etiqueta de latão com um cartão em branco',
  ),
  'label.bookplate': label(
    'bookplate',
    'Ex-libris',
    'Placa de ex-libris creme com fio duplo e cantos recortados',
  ),
  'label.ticket': label('ticket', 'Bilhete', 'Bilhete rosa com picote e recortes laterais'),
  'label.tag': label('tag', 'Etiqueta kraft', 'Etiqueta de papel kraft com ilhós e barbante'),
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
  emblem: { folder: 'emblems/', pattern: /^emblem\.[a-z]+(?:-[a-z]+)*$/ },
  paper: { folder: 'papers/', pattern: /^paper\.[a-z]+(?:-[a-z]+)*$/ },
  tape: { folder: 'tapes/', pattern: /^tape\.[a-z]+(?:-[a-z]+)*$/ },
  sticker: { folder: 'stickers/', pattern: /^sticker\.[a-z]+(?:-[a-z]+)*$/ },
  frame: { folder: 'frames/', pattern: /^frame\.[a-z]+(?:-[a-z]+)*$/ },
  divider: { folder: 'dividers/', pattern: /^divider\.[a-z]+(?:-[a-z]+)*$/ },
  label: { folder: 'labels/', pattern: /^label\.[a-z]+(?:-[a-z]+)*$/ },
});

/** Discipline emblems in picker order (the id is what Biblioteca stores for a folder). */
export const EMBLEM_IDS = Object.freeze(Object.keys(ART).filter((id) => id.startsWith('emblem.')));

export const kindOf = (id) => String(id).split('.')[0];
