// Flashcards 3.0 — what a card looks like, decided apart from what it says.
// A set shows ONE look: one of the owner's templates (declarative tokens), a built-in base, or
// the account favourite. Applying a look only sets data attributes and CSS variables.

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
