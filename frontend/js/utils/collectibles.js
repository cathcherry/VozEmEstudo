// Gabinete vocabulary (3.5, Milestone 6). The server decides what is unlocked and when; this
// module only names things. Wording says what the person DID (investigou, explicou, revisitou),
// never that they "master" a subject. Art is referenced by id (`stamp.*`, `object.*`, `cover.*`)
// through `data-art-slot` / `data-art-id`; the art system renders it, and nothing is shown when
// an asset is missing.

export const COLLECTIBLES = Object.freeze({
  'stamp.first-evidence': {
    name: 'Primeira evidência',
    memory: 'Você guardou o primeiro trecho conferido de uma aula como evidência.',
    hint: 'Aparece quando você guarda um trecho da aula como evidência.',
  },
  'stamp.own-explanation': {
    name: 'Com as próprias palavras',
    memory: 'Você explicou uma ideia com as suas palavras.',
    hint: 'Aparece quando você escreve a sua explicação numa investigação.',
  },
  'stamp.first-investigation': {
    name: 'Primeira investigação',
    memory: 'Você investigou uma pergunta até registrar uma descoberta.',
    hint: 'Aparece quando você registra a primeira descoberta.',
  },
  'stamp.first-reflection': {
    name: 'Primeira reflexão',
    memory: 'Você refletiu sobre o que investigou.',
    hint: 'Aparece quando você escreve uma reflexão sobre uma descoberta.',
  },
  'stamp.connection': {
    name: 'Ponte entre disciplinas',
    memory: 'Você ligou descobertas de disciplinas diferentes.',
    hint: 'Aparece quando você liga duas descobertas de disciplinas diferentes.',
  },
  'stamp.revisit': {
    name: 'Revisita',
    memory: 'Você voltou a uma descoberta e acrescentou algo.',
    hint: 'Aparece quando você volta a uma descoberta, pelo menos um dia depois, e muda algo nela.',
  },
  'object.magnifying-glass': {
    name: 'Lupa',
    memory: 'Você investigou três perguntas até o fim.',
    hint: 'Aparece depois de três investigações registradas.',
  },
  'object.desk-lamp': {
    name: 'Luminária de mesa',
    memory: 'Você investigou cinco perguntas até o fim.',
    hint: 'Aparece depois de cinco investigações registradas.',
  },
  'object.specimen-box': {
    name: 'Pote de espécimes',
    memory: 'Você reuniu dez evidências conferidas.',
    hint: 'Aparece depois de dez evidências reunidas.',
  },
  'object.pressed-flower-jar': {
    name: 'Flor prensada',
    memory: 'Você revisitou descobertas em três dias diferentes.',
    hint: 'Aparece depois de três revisitas.',
  },
  'object.globe': {
    name: 'Globo',
    memory: 'Você registrou descobertas em três disciplinas.',
    hint: 'Aparece quando você tem descobertas em três disciplinas.',
  },
  'cover.matcha-linen': {
    name: 'Capa de linho matcha',
    memory: 'Você fez três ligações entre descobertas.',
    hint: 'Aparece depois de três ligações entre descobertas.',
  },
});

export const DESK_SLOTS = Object.freeze({
  'desk-left': 'Mesa, à esquerda',
  'desk-center': 'Mesa, ao centro',
  'desk-right': 'Mesa, à direita',
  'shelf-left': 'Prateleira, à esquerda',
  'shelf-right': 'Prateleira, à direita',
  window: 'Janela',
  wall: 'Parede',
  'lamp-corner': 'Canto da luminária',
});

export const KIND_LABEL = Object.freeze({ stamp: 'Selos', object: 'Objetos de mesa', cover: 'Capas' });

/** Name and sentences of a collectible; an id this build does not know keeps its id as name. */
export function describeCollectible(id) {
  return COLLECTIBLES[id] || { name: id, memory: '', hint: '' };
}

/** Day of an unlock in the interface language (the memory keeps its date forever). */
export function formatDay(iso) {
  try {
    return new Intl.DateTimeFormat(globalThis.VOZ_LOCALE || 'pt-BR', { dateStyle: 'long' }).format(new Date(iso));
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

/** An art mount point: empty (and aria-hidden) until the art system fills it. */
export function artSlot(doc, slot, id, className = 'collectible-art') {
  const span = doc.createElement('span');
  span.className = className;
  span.dataset.artSlot = slot;
  span.dataset.artId = id;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

// ---- Experience modes: the same data, more or less game interface -------------------------
export const EXPERIENCE_MODES = Object.freeze(['quiet', 'cozy', 'adventure']);
const MODE_KEY = 'voz-experience-mode';

/**
 * The account's mode (Aparência; synced with the other appearance preferences). Before 3.5 M5 it
 * was a per-device value; theme-init.js migrates it, and this still reads it as a fallback.
 */
export function readExperienceMode(storage = globalThis.localStorage) {
  const account = globalThis.VozAppearance?.loadUi?.().experience;
  if (EXPERIENCE_MODES.includes(account)) return account;
  try {
    const value = storage?.getItem(MODE_KEY);
    return EXPERIENCE_MODES.includes(value) ? value : 'cozy';
  } catch {
    return 'cozy';
  }
}

/** Applies the mode to <html data-experience-mode>; CSS hides [data-game-ui] in quiet mode. */
export function applyExperienceMode(mode = readExperienceMode(), root = globalThis.document?.documentElement) {
  const value = EXPERIENCE_MODES.includes(mode) ? mode : 'cozy';
  if (root) {
    root.dataset.experienceMode = value;
    root.dataset.experience = value;
  }
  return value;
}

export function saveExperienceMode(mode, storage = globalThis.localStorage) {
  const value = applyExperienceMode(mode);
  try {
    storage?.setItem(MODE_KEY, value);
  } catch {
    // Private windows: the mode still applies to this page.
  }
  return value;
}

/** Link to a passage of a lesson (same deep link as the annotations: search, segment, #transcricao). */
export function passageHref(materialId, quote, position) {
  const params = new URLSearchParams({ id: materialId });
  const first = String(quote || '').split('\n')[0].trim();
  if (first) params.set('busca', first.length > 80 ? first.slice(0, 80).replace(/\s+\S*$/, '') : first);
  if (Number.isInteger(position)) params.set('trecho', String(position));
  return `./material.html?${params}#transcricao`;
}
