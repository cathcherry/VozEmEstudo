// Pure profile block helpers (no DOM, no network): section visibility, widths, data block
// definitions, duplicate and move. Used by profile-editor.js and the profile page.

export const PROFILE_LAYOUT_KEY = 'profile-layout';

/** Fixed profile sections that can be hidden (never deleted). */
export const PROFILE_SECTIONS = Object.freeze([
  { id: 'about', label: 'Sobre mim', selector: '.profile-about-section' },
  { id: 'journey', label: 'Meu percurso', selector: '.profile-stats-section' },
  { id: 'achievements', label: 'Marcos de estudo', selector: '.achievements-section' },
]);
const SECTION_IDS = new Set(PROFILE_SECTIONS.map((section) => section.id));

export function normalizeProfileLayout(raw) {
  const hidden = Array.isArray(raw?.hiddenSections) ? raw.hiddenSections : [];
  return { version: 1, hiddenSections: [...new Set(hidden.filter((id) => SECTION_IDS.has(id)))] };
}

/** Widths offered as a keyboard alternative to dragging the resize handle (12-column grid). */
export const BLOCK_SIZES = Object.freeze([
  ['Estreito', 4],
  ['Médio', 6],
  ['Largo', 8],
  ['Linha inteira', 12],
]);

/** Blocks filled with the person's own data (nothing is invented: empty data says so). */
export const DATA_BLOCKS = Object.freeze({
  recent: { title: 'Aulas recentes', description: 'As últimas aulas que você abriu.' },
  subjects: {
    title: 'Disciplinas favoritas',
    description: 'As disciplinas que você mais revisita.',
  },
  goals: {
    title: 'Meus objetivos',
    description: 'Objetivos ativos do Planejar, com as tarefas feitas.',
    flag: 'planning',
  },
  week: {
    title: 'Minha semana de estudo',
    description: 'Minutos registrados nesta semana e a sua meta.',
    flag: 'study_tracking',
  },
});

export function newDataBlock(source) {
  const spec = DATA_BLOCKS[source];
  if (!spec) throw new Error('Escolha um bloco de dados.');
  return {
    id: crypto.randomUUID(),
    title: spec.title,
    type: 'data',
    source,
    // Read by older versions of the app, which show it as plain text.
    content: spec.description,
    layout: { columns: 6, height: 320 },
  };
}

/** A copy placed right after the original, with its own id and unchecked checklist. */
export function duplicateBlock(blocks, id) {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0) return blocks;
  const copy = structuredClone(blocks[index]);
  copy.id = crypto.randomUUID();
  copy.title = `${copy.title} (cópia)`.slice(0, 80);
  copy.hidden = false;
  if (copy.checkedItems) copy.checkedItems = {};
  return [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)];
}

export function moveBlock(blocks, id, direction) {
  const index = blocks.findIndex((block) => block.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
