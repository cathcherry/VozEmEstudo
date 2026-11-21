// Flashcards 3.0 — what a card looks like, decided apart from what it says.
// A set shows ONE look: one of the owner's templates (declarative tokens), a built-in base, or
// the account favourite. Applying a look only sets data attributes and CSS variables.
import { CARD_TEMPLATES } from './card-templates.js';

export const NOTE_TYPES = [
  ['basic', 'Pergunta e resposta', [['front', 'Pergunta', 'area'], ['back', 'Resposta', 'area']]],
  ['term', 'Termo e definição', [['term', 'Termo'], ['definition', 'Definição', 'area'], ['example', 'Exemplo (opcional)', 'area', true]]],
  ['cloze', 'Lacunas (cloze)', [['text', 'Texto com lacunas: {{c1::resposta}}', 'area'], ['extra', 'Complemento (opcional)', 'area', true]]],
  ['cause_effect', 'Causa e efeito', [['cause', 'Causa'], ['effect', 'Efeito', 'area'], ['mechanism', 'Por quê (opcional)', 'area', true]]],
  ['comparison', 'Comparação', [['a', 'Item A'], ['b', 'Item B'], ['criterion', 'Critério'], ['answer', 'Diferença', 'area']]],
  ['sequence', 'Sequência', [['title', 'Processo'], ['steps', 'Etapas (uma por linha)', 'list']]],
  ['application', 'Aplicação', [['situation', 'Situação', 'area'], ['answer', 'O que acontece / o que fazer', 'area']]],
  ['error_spotting', 'Encontre o erro', [['statement', 'Afirmação com erro', 'area'], ['correction', 'Correção', 'area']]],
];
export const noteTypeLabel = (type) => NOTE_TYPES.find(([key]) => key === type)?.[1] || '';

export const TEMPLATE_BASES = ['classic', 'notebook', 'sticky', 'window', 'polaroid'];
export const TOKEN_FONTS = [
  ['theme', 'Do tema'],
  ['serif', 'Serifa'],
  ['rounded', 'Arredondada'],
  ['mono', 'Monoespaçada'],
  ['handwritten', 'Manuscrita'],
];
export const TOKEN_PATTERNS = [
  ['none', 'Liso'],
  ['dots', 'Bolinhas'],
  ['grid', 'Quadriculado'],
  ['lines', 'Pautado'],
];
export const TOKEN_SHADOWS = [
  ['none', 'Sem sombra'],
  ['soft', 'Suave'],
  ['lifted', 'Destacada'],
];

/** The look of a card in a set: {base, tokens, variants} or null for the account favourite. */
export function lookFor(set, templates = []) {
  if (!set) return null;
  if (set.template_id) {
    const template = templates.find((t) => t.id === set.template_id);
    if (template) return { base: template.base, tokens: template.tokens || {}, variants: template.variants || {} };
  }
  if (set.template_base) return { base: set.template_base, tokens: {}, variants: {} };
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Applies a look to an element: data attributes plus validated CSS variables. */
export function applyLook(element, look, noteType = 'basic') {
  for (const name of ['--card-accent', '--card-paper', '--card-ink', '--card-radius'])
    element.style.removeProperty(name);
  for (const key of ['cardFont', 'cardPattern', 'cardShadow', 'cardLayout']) delete element.dataset[key];
  if (!look) return;
  element.dataset.cardTemplate = TEMPLATE_BASES.includes(look.base) ? look.base : 'classic';
  const t = look.tokens || {};
  if (HEX.test(t.accent || '')) element.style.setProperty('--card-accent', t.accent);
  if (HEX.test(t.paper || '')) element.style.setProperty('--card-paper', t.paper);
  if (HEX.test(t.ink || '')) element.style.setProperty('--card-ink', t.ink);
  if (Number.isInteger(t.radius)) element.style.setProperty('--card-radius', `${Math.min(32, Math.max(0, t.radius))}px`);
  if (TOKEN_FONTS.some(([k]) => k === t.font)) element.dataset.cardFont = t.font;
  if (TOKEN_PATTERNS.some(([k]) => k === t.pattern)) element.dataset.cardPattern = t.pattern;
  if (TOKEN_SHADOWS.some(([k]) => k === t.shadow)) element.dataset.cardShadow = t.shadow;
  const variant = look.variants?.[noteType];
  if (variant?.layout === 'left' || variant?.layout === 'centered') element.dataset.cardLayout = variant.layout;
}

const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const baseLabel = (base) => CARD_TEMPLATES.find(([key]) => key === base)?.[1] || CARD_TEMPLATES[0][1];
const dayLabel = (iso) => {
  const date = new Date(iso || '');
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const repeated = (labels, i) => labels.filter((label) => label === labels[i]).length > 1;

/**
 * Option labels for the student's templates. A unique name shows alone; templates that share a
 * name also show their base style and, when that still repeats, the day it was last saved
 * (and, as a last resort, a number) — so two "Matcha" are never indistinguishable.
 * @returns {Map<string,string>} template id → label
 */
export function templateLabels(templates = []) {
  const labels = new Map();
  const groups = new Map();
  for (const template of templates) {
    const key = nameKey(template.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(template);
  }
  for (const group of groups.values()) {
    if (group.length === 1) {
      labels.set(group[0].id, group[0].name);
      continue;
    }
    const withBase = group.map((t) => `${String(t.name || '').trim()} · ${baseLabel(t.base)}`);
    const withDay = group.map((t, i) =>
      repeated(withBase, i) && dayLabel(t.updated_at) ? `${withBase[i]} · ${dayLabel(t.updated_at)}` : withBase[i],
    );
    group.forEach((t, i) => {
      const n = withDay.slice(0, i + 1).filter((label) => label === withDay[i]).length;
      labels.set(t.id, repeated(withDay, i) ? `${withDay[i]} · ${n}` : withDay[i]);
    });
  }
  return labels;
}

/** Another of the student's templates already uses this name (ignoring case and spaces)? */
export const templateNameTaken = (name, templates = [], ownId = null) =>
  templates.some((t) => t.id !== ownId && nameKey(t.name) === nameKey(name));

/** Fills a look <select>: favourite, the built-in bases, then "Meus modelos" (disambiguated). */
export function fillLookOptions(select, templates = []) {
  select.replaceChildren(new Option('Igual à favorita', ''));
  for (const [value, name] of CARD_TEMPLATES) select.append(new Option(name, `base:${value}`));
  if (!templates.length) return;
  const labels = templateLabels(templates);
  const group = document.createElement('optgroup');
  group.label = 'Meus modelos';
  for (const t of templates) {
    const option = new Option(labels.get(t.id), `template:${t.id}`);
    option.translate = false; // the student's own name for it
    group.append(option);
  }
  select.append(group);
}

/** Relative luminance contrast of two #rrggbb colours (WCAG). */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
