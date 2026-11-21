// Revisar › Conjuntos: "Mesclar conjuntos" and "Importar cartões". Both create a NEW personal
// set through the existing set API (no new tables): the sources never change and no review
// history is copied, so the new set starts fresh.
import {
  getFlashcardSet,
  createFlashcardSet,
  addFlashcardSetCards,
  previewFlashcardMerge,
  mergeFlashcardSets,
  createFlashcardDeck,
  importApkg,
  listCardTemplates,
} from '../api/flashcard.api.js';
import { CARD_TEMPLATES } from '../utils/card-templates.js';
import { parseCardFile, mergeCards, chunk, IMPORT_MAX } from '../utils/deck-tools.js';

const FILE_MAX = 2 * 1024 * 1024;
let counter = 0;

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Creates the set with the first 100 cards, then adds the rest 100 at a time. */
export async function saveNewSet({ name, cards, origin }, api = { createFlashcardSet, addFlashcardSetCards }) {
  const [first, ...rest] = chunk(cards);
  const id = crypto.randomUUID();
  await api.createFlashcardSet({ id, name, materialId: null, config: { origin }, cards: first });
  let saved = first.length;
  try {
    for (const part of rest) {
      await api.addFlashcardSetCards(id, part);
      saved += part.length;
    }
  } catch (error) {
    error.saved = saved;
    error.setId = id;
    throw error;
  }
  return { id, saved };
}

function dialogShell(title, hint) {
  const id = `deck-dialog-${++counter}`;
  const dialog = make('dialog', null, 'settings-dialog app-dialog deck-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const form = make('form');
  form.method = 'dialog';
  const heading = make('h2', title);
  heading.id = `${id}-title`;
  const help = make('p', hint, 'app-dialog-hint');
  const body = make('div', null, 'deck-dialog-body');
  const preview = make('div', null, 'deck-preview');
  preview.setAttribute('role', 'status');
  preview.setAttribute('aria-live', 'polite');
  const actions = make('div', null, 'form-actions');
  const cancel = make('button', 'Cancelar', 'secondary-action');
  cancel.type = 'button';
  const confirm = make('button', 'Criar conjunto', 'primary-action');
  confirm.type = 'submit';
  confirm.disabled = true;
  actions.append(cancel, confirm);
  form.append(heading, help, body, preview, actions);
  dialog.append(form);
  document.body.append(dialog);
  cancel.addEventListener('click', () => dialog.close());
  return { id, dialog, form, body, preview, confirm };
}

function nameField(id, value) {
  const label = make('label', 'Nome do novo conjunto');
  label.htmlFor = `${id}-name`;
  const input = make('input');
  input.id = `${id}-name`;
  input.required = true;
  input.maxLength = 120;
  input.autocomplete = 'off';
  input.value = value;
  label.append(input);
  return { label, input };
}

/** "Aparência do conjunto novo": favourite, a built-in base or one of the student's templates. */
async function lookSelect(id) {
  const label = make('label', 'Aparência do conjunto novo');
  label.htmlFor = `${id}-look`;
  const select = make('select');
  select.id = `${id}-look`;
  select.append(new Option('Igual à favorita', ''));
  for (const [value, name] of CARD_TEMPLATES) select.append(new Option(name, `base:${value}`));
  const templates = await listCardTemplates().catch(() => []);
  if (templates.length) {
    const group = document.createElement('optgroup');
    group.label = 'Meus modelos';
    for (const t of templates) group.append(new Option(t.name, `template:${t.id}`));
    select.append(group);
  }
  label.append(select);
  const value = () => {
    const [kind, key] = select.value.split(':');
    return kind === 'template' ? { templateId: key } : kind === 'base' ? { templateBase: key } : {};
  };
  return { label, value };
}

/** One choice per "same question, different answers": keep one answer or combine them. */
function conflictChoices(conflicts, decisions) {
  const box = make('div', null, 'merge-conflicts');
  conflicts.forEach((conflict, index) => {
    const group = make('fieldset', null, 'merge-conflict');
    group.append(make('legend', `Mesma pergunta, respostas diferentes: ${conflict.front}`));
    const name = `merge-conflict-${++counter}-${index}`;
    const option = (value, text) => {
      const row = make('label', null, 'merge-option');
      const input = make('input');
      input.type = 'radio';
      input.name = name;
      input.value = value;
      input.checked = (decisions[conflict.key] || 'combine') === value;
      input.addEventListener('change', () => {
        decisions[conflict.key] = value;
      });
      row.append(input, make('span', text));
      group.append(row);
    };
    option('combine', 'Juntar as respostas em um cartão');
    for (const choice of conflict.options) option(`keep:${choice.cardId}`, `Manter a de ${choice.label}: ${choice.back}`);
    box.append(group);
  });
  return box;
}

function summaryList(items) {
  const list = make('ul', null, 'deck-preview-list');
  for (const text of items) list.append(make('li', text));
  return list;
}

/** Runs one dialog to completion; resolves with the saved set or null when cancelled. */
function run({ dialog, form, confirm }, opener, submit) {
  return new Promise((resolve) => {
    let result = null;
    let busy = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || confirm.disabled) return;
      busy = true;
      confirm.disabled = true;
      confirm.textContent = 'Criando…';
      try {
        result = await submit();
        dialog.close();
      } catch (error) {
        const done = error.saved ? ` ${plural(error.saved, 'cartão foi salvo', 'cartões foram salvos')} no conjunto novo.` : '';
        form.querySelector('.deck-preview').append(
          make('p', `${error.message || 'Não foi possível criar o conjunto.'}${done}`, 'deck-error'),
        );
        confirm.disabled = false;
        confirm.textContent = 'Criar conjunto';
      } finally {
        busy = false;
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      opener?.focus?.();
      resolve(result);
    });
    dialog.showModal();
  });
}

/** "Mesclar conjuntos": pick 2+ sets, see what happens to repeated cards, create the new set. */
export function openMergeDialog({ sets, opener, v3 = false }) {
  const ui = dialogShell(
    'Mesclar conjuntos',
    'Escolha dois ou mais conjuntos. Um conjunto novo é criado com os cartões deles; os originais não mudam e o histórico de revisão não é copiado.',
  );
  const box = make('fieldset', null, 'deck-sources');
  box.append(make('legend', 'Conjuntos'));
  const chosen = new Map();
  const cache = new Map();
  for (const set of sets) {
    const label = make('label', null, 'deck-source');
    const check = make('input');
    check.type = 'checkbox';
    check.value = set.id;
    label.append(check, make('span', `${set.name} (${plural(set.card_count ?? 0, 'cartão', 'cartões')})`));
    box.append(label);
    check.addEventListener('change', () => {
      if (check.checked) chosen.set(set.id, set);
      else chosen.delete(set.id);
      void update();
    });
  }
  const name = nameField(ui.id, '');
  ui.body.append(box, name.label);
  // Flashcards 3.0: the server plans the merge (also for sets shared in a class) and the student
  // decides every "same question, different answers" case.
  const decisions = {};
  let look = null;
  if (v3)
    void lookSelect(ui.id).then((control) => {
      look = control;
      ui.body.append(control.label);
    });
  let merged = null;
  let ticket = 0;
  async function update() {
    const mine = ++ticket;
    merged = null;
    ui.confirm.disabled = true;
    const picked = [...chosen.values()];
    if (!name.input.dataset.edited)
      name.input.value = picked.length ? `Mesclado: ${picked.map((s) => s.name).join(' + ')}`.slice(0, 120) : '';
    if (picked.length < 2) {
      ui.preview.replaceChildren(make('p', 'Escolha pelo menos dois conjuntos.', 'flashcard-muted'));
      return;
    }
    ui.preview.replaceChildren(make('p', 'Lendo os cartões…', 'flashcard-muted'));
    if (v3) {
      try {
        const sources = picked.map((set) => (set.classroomId ? { classroomId: set.classroomId, sharedId: set.sharedId } : { setId: set.id }));
        const preview = await previewFlashcardMerge(sources);
        if (mine !== ticket) return;
        merged = { sources, preview };
        const lines = [plural(preview.resulting, 'cartão no conjunto novo', 'cartões no conjunto novo')];
        if (preview.duplicates)
          lines.push(`${plural(preview.duplicates, 'cartão repetido fica', 'cartões repetidos ficam')} de fora (mesma pergunta e mesma resposta).`);
        if (preview.conflicts.length)
          lines.push(`${plural(preview.conflicts.length, 'pergunta aparece', 'perguntas aparecem')} com respostas diferentes: escolha abaixo.`);
        if (preview.overLimit) lines.push(`Limite de ${IMPORT_MAX} cartões: ${preview.overLimit} ficam de fora.`);
        for (const key of Object.keys(decisions)) delete decisions[key];
        ui.preview.replaceChildren(summaryList(lines), conflictChoices(preview.conflicts, decisions));
        ui.confirm.disabled = preview.resulting === 0;
      } catch (error) {
        if (mine === ticket) ui.preview.replaceChildren(make('p', error.message || 'Não foi possível ler os conjuntos.', 'deck-error'));
      }
      return;
    }
    try {
      const full = await Promise.all(
        picked.map(async (set) => {
          if (!cache.has(set.id)) cache.set(set.id, await getFlashcardSet(set.id));
          return cache.get(set.id);
        }),
      );
      if (mine !== ticket) return;
      merged = mergeCards(full);
      const lines = [plural(merged.cards.length, 'cartão no conjunto novo', 'cartões no conjunto novo')];
      if (merged.duplicates)
        lines.push(`${plural(merged.duplicates, 'cartão repetido fica', 'cartões repetidos ficam')} de fora (mesma pergunta e mesma resposta).`);
      if (merged.sameQuestion.length)
        lines.push(
          `${plural(merged.sameQuestion.length, 'pergunta aparece', 'perguntas aparecem')} com respostas diferentes; ${merged.sameQuestion.length === 1 ? 'as duas ficam' : 'todas ficam'} para você decidir depois.`,
        );
      if (merged.overLimit) lines.push(`Limite de ${IMPORT_MAX} cartões: ${merged.overLimit} ficam de fora.`);
      ui.preview.replaceChildren(summaryList(lines));
      ui.confirm.disabled = merged.cards.length === 0;
    } catch (error) {
      if (mine === ticket)
        ui.preview.replaceChildren(make('p', error.message || 'Não foi possível ler os conjuntos.', 'deck-error'));
    }
  }
  name.input.addEventListener('input', () => {
    name.input.dataset.edited = '1';
  });
  void update();
  setTimeout(() => box.querySelector('input')?.focus());
  return run(ui, opener, async () => {
    const picked = [...chosen.values()];
    if (v3) {
      const created = await mergeFlashcardSets({
        id: crypto.randomUUID(),
        name: name.input.value.trim() || 'Conjunto mesclado',
        sources: merged.sources,
        decisions,
        ...(look ? look.value() : {}),
      });
      return { id: created.id, saved: created.added, message: `Conjunto mesclado criado com ${plural(created.added, 'cartão', 'cartões')}.` };
    }
    const result = await saveNewSet({
      name: name.input.value.trim() || 'Conjunto mesclado',
      cards: merged.cards,
      origin: { kind: 'merge', sets: picked.map((s) => ({ id: s.id, name: s.name })) },
    });
    return { ...result, message: `Conjunto mesclado criado com ${plural(result.saved, 'cartão', 'cartões')}.` };
  });
}

/** "Importar cartões": a text file from Anki, our CSV export or any two-column list. */
export function openImportDialog({ opener, v3 = false }) {
  const ui = dialogShell(
    'Importar cartões',
    'Use um arquivo .txt, .tsv ou .csv: do Anki (Arquivo › Exportar › "Notas em texto simples"), a exportação CSV daqui ou uma lista com pergunta e resposta em duas colunas.',
  );
  const fileLabel = make('label', 'Arquivo');
  fileLabel.htmlFor = `${ui.id}-file`;
  const file = make('input');
  file.type = 'file';
  file.id = `${ui.id}-file`;
  file.accept = `${v3 ? '.apkg,.colpkg,' : ''}.txt,.tsv,.csv,text/plain,text/csv,text/tab-separated-values`;
  fileLabel.append(file);
  const name = nameField(ui.id, '');
  ui.body.append(fileLabel, name.label);
  let parsed = null;
  let source = '';
  file.addEventListener('change', async () => {
    parsed = null;
    ui.confirm.disabled = true;
    const chosen = file.files?.[0];
    if (!chosen) return ui.preview.replaceChildren();
    source = chosen.name;
    if (v3 && /\.(apkg|colpkg)$/i.test(chosen.name)) {
      ui.preview.replaceChildren(make('p', 'Lendo o pacote do Anki…', 'flashcard-muted'));
      try {
        const report = await importApkg(chosen, { mode: 'preview' });
        parsed = { apkg: chosen, report };
        if (!name.input.dataset.edited) name.input.value = (report.deckName || chosen.name.replace(/\.[^.]+$/, '')).slice(0, 120);
        const lines = [plural(report.notes, 'cartão encontrado', 'cartões encontrados')];
        if (report.images) lines.push(plural(report.images, 'imagem será importada', 'imagens serão importadas'));
        if (report.skipped.audio) lines.push(`${plural(report.skipped.audio, 'som ignorado', 'sons ignorados')} (áudio ainda não é importado).`);
        if (report.skipped.empty) lines.push(`${plural(report.skipped.empty, 'nota ignorada', 'notas ignoradas')}: sem pergunta ou sem resposta.`);
        if (report.skipped.unsupported) lines.push(`${plural(report.skipped.unsupported, 'nota ignorada', 'notas ignoradas')}: tipo de nota desconhecido.`);
        if (report.skipped.overLimit) lines.push(`${plural(report.skipped.overLimit, 'nota ficou', 'notas ficaram')} de fora: limite de ${IMPORT_MAX} cartões por conjunto.`);
        const nodes = [summaryList(lines)];
        if (report.sample?.length) {
          const sample = make('dl', null, 'deck-sample');
          for (const card of report.sample) sample.append(make('dt', card.front), make('dd', card.back));
          nodes.push(make('p', 'Primeiros cartões:', 'flashcard-muted'), sample);
        }
        ui.preview.replaceChildren(...nodes);
        ui.confirm.disabled = report.notes === 0;
      } catch (error) {
        ui.preview.replaceChildren(make('p', error.message || 'Não foi possível ler o pacote.', 'deck-error'));
      }
      return;
    }
    if (/\.(apkg|colpkg)$/i.test(chosen.name))
      return ui.preview.replaceChildren(
        make('p', 'Pacotes .apkg ainda não são lidos. No Anki, exporte o baralho como "Notas em texto simples" (.txt) e escolha esse arquivo.', 'deck-error'),
      );
    if (chosen.size > FILE_MAX)
      return ui.preview.replaceChildren(make('p', 'O arquivo passa de 2 MB. Divida-o em partes menores.', 'deck-error'));
    parsed = parseCardFile(await chosen.text());
    if (!name.input.dataset.edited) name.input.value = chosen.name.replace(/\.[^.]+$/, '').slice(0, 120);
    const lines = [plural(parsed.cards.length, 'cartão encontrado', 'cartões encontrados')];
    const reasons = { empty: 'sem pergunta ou sem resposta', too_long: 'longas demais', limit: `além do limite de ${IMPORT_MAX}` };
    for (const [reason, text] of Object.entries(reasons)) {
      const count = parsed.skipped.filter((item) => item.reason === reason).length;
      if (count) lines.push(`${plural(count, 'linha ignorada', 'linhas ignoradas')}: ${text}.`);
    }
    const nodes = [summaryList(lines)];
    if (parsed.cards.length) {
      const sample = make('dl', null, 'deck-sample');
      for (const card of parsed.cards.slice(0, 3)) sample.append(make('dt', card.front), make('dd', card.back));
      nodes.push(make('p', 'Primeiros cartões:', 'flashcard-muted'), sample);
    }
    ui.preview.replaceChildren(...nodes);
    ui.confirm.disabled = parsed.cards.length === 0;
  });
  name.input.addEventListener('input', () => {
    name.input.dataset.edited = '1';
  });
  setTimeout(() => file.focus());
  return run(ui, opener, async () => {
    const deckName = name.input.value.trim() || 'Cartões importados';
    if (v3 && parsed.apkg) {
      const created = await importApkg(parsed.apkg, { mode: 'create', id: crypto.randomUUID(), name: deckName });
      return { id: created.id, saved: created.added, message: `${plural(created.added, 'cartão importado', 'cartões importados')} para um conjunto novo.` };
    }
    if (v3) {
      // Typed: a cloze line stays a cloze note (rendered by the server).
      const created = await createFlashcardDeck({
        id: crypto.randomUUID(),
        name: deckName,
        origin: 'text_import',
        cards: parsed.cards.map((card) =>
          card.clozeText
            ? { noteType: 'cloze', fields: { text: card.clozeText, ...(card.extra ? { extra: card.extra } : {}) } }
            : { noteType: 'basic', fields: { front: card.front, back: card.back } },
        ),
      });
      return { id: created.id, saved: created.added, message: `${plural(created.added, 'cartão importado', 'cartões importados')} para um conjunto novo.` };
    }
    const result = await saveNewSet({
      name: deckName,
      cards: parsed.cards,
      origin: { kind: 'import', file: source.slice(0, 160), format: parsed.format },
    });
    return { ...result, message: `${plural(result.saved, 'cartão importado', 'cartões importados')} para um conjunto novo.` };
  });
}
