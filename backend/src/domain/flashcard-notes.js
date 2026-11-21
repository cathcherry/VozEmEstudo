import { createHash } from 'node:crypto';

// Flashcards 3.0 — structured note types. The educational content of a card is a type plus its
// fields; the study text (front/back) is rendered from them on the server, so every client, the
// review queue and exports keep working with plain front/back. Appearance never lives here.

const text = (max) => ({ kind: 'text', max });
const list = (max, items) => ({ kind: 'list', max, items });

/** Fields per type: [name, spec, required]. */
export const NOTE_TYPES = Object.freeze({
  basic: [['front', text(1000), true], ['back', text(2000), true]],
  term: [['term', text(300), true], ['definition', text(2000), true], ['example', text(600), false]],
  cloze: [['text', text(2000), true], ['extra', text(1000), false]],
  cause_effect: [['cause', text(800), true], ['effect', text(800), true], ['mechanism', text(800), false]],
  comparison: [['a', text(300), true], ['b', text(300), true], ['criterion', text(300), true], ['answer', text(1500), true]],
  sequence: [['title', text(300), true], ['steps', list(12, 300), true]],
  application: [['situation', text(1000), true], ['answer', text(1500), true]],
  error_spotting: [['statement', text(800), true], ['correction', text(1500), true]],
});
export const NOTE_TYPE_KEYS = Object.freeze(Object.keys(NOTE_TYPES));

export class NoteError extends Error {
  constructor(message) {
    super(message);
    this.code = 'FLASHCARD_NOTE_INVALID';
    this.status = 400;
  }
}

const clean = (value) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();

/** Validates and normalises the fields of a type. Plain text only: markup is not interpreted. */
export function normalizeFields(type, input = {}) {
  const spec = NOTE_TYPES[type];
  if (!spec) throw new NoteError('Tipo de cartão desconhecido.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NoteError('Campos inválidos.');
  const known = new Set(spec.map(([name]) => name));
  for (const key of Object.keys(input)) if (!known.has(key)) throw new NoteError(`Campo desconhecido: ${key}.`);
  const fields = {};
  for (const [name, rule, required] of spec) {
    if (rule.kind === 'list') {
      const items = (Array.isArray(input[name]) ? input[name] : []).map(clean).filter(Boolean);
      if (items.length > rule.max || items.some((item) => item.length > rule.items))
        throw new NoteError('Lista longa demais.');
      if (required && items.length < 2) throw new NoteError('Informe pelo menos duas etapas.');
      if (items.length) fields[name] = items;
      continue;
    }
    const value = clean(input[name]);
    if (value.length > rule.max) throw new NoteError(`O campo ${name} passou do limite.`);
    if (required && !value) throw new NoteError(`Preencha o campo ${name}.`);
    if (value) fields[name] = value;
  }
  if (type === 'cloze' && !/\{\{c\d+::[\s\S]+?\}\}/.test(fields.text))
    throw new NoteError('Marque pelo menos uma lacuna com {{c1::resposta}}.');
  return fields;
}

const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Study text of a note: what the review queue shows on each side. */
export function renderNote(type, fields) {
  switch (type) {
    case 'basic':
      return { front: fields.front, back: fields.back };
    case 'term':
      return {
        front: fields.term,
        back: fields.example ? `${fields.definition}\n\nExemplo: ${fields.example}` : fields.definition,
      };
    case 'cloze': {
      const front = fields.text.replace(CLOZE, (_, _answer, hint) => (hint ? `[${hint}]` : '[…]'));
      const back = fields.text.replace(CLOZE, '$1');
      return { front, back: fields.extra ? `${back}\n\n${fields.extra}` : back };
    }
    case 'cause_effect':
      return {
        front: `Qual é o efeito de: ${fields.cause}?`,
        back: fields.mechanism ? `${fields.effect}\n\nPor quê: ${fields.mechanism}` : fields.effect,
      };
    case 'comparison':
      return { front: `${fields.a} × ${fields.b}: ${fields.criterion}?`, back: fields.answer };
    case 'sequence':
      return {
        front: `Quais são as etapas de: ${fields.title}?`,
        back: fields.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
      };
    case 'application':
      return { front: fields.situation, back: fields.answer };
    case 'error_spotting':
      return { front: `Onde está o erro? ${fields.statement}`, back: fields.correction };
    default:
      throw new NoteError('Tipo de cartão desconhecido.');
  }
}

/** Key for "the same card": case, accents, punctuation and spacing do not matter. */
export function contentKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export const questionKey = (front) => contentKey(front);
export const contentHash = (front, back) =>
  createHash('sha256').update(`${contentKey(front)}\u0000${contentKey(back)}`).digest('hex');

/** A typed note ready for the database (front/back rendered and fingerprinted). */
export function buildNote({ noteType = 'basic', fields, front, back }) {
  const type = NOTE_TYPE_KEYS.includes(noteType) ? noteType : null;
  if (!type) throw new NoteError('Tipo de cartão desconhecido.');
  const normalized = normalizeFields(type, fields ?? (type === 'basic' ? { front, back } : {}));
  const rendered = renderNote(type, normalized);
  if (rendered.front.length > 1000 || rendered.back.length > 2000)
    throw new NoteError('O cartão ficou longo demais.');
  return {
    noteType: type,
    fields: normalized,
    front: rendered.front,
    back: rendered.back,
    contentHash: contentHash(rendered.front, rendered.back),
  };
}
