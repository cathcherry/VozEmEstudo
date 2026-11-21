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
import { fillLookOptions } from '../utils/card-looks.js';
import { parseCardFile, mergeCards, saveNewSet as saveSetInParts, IMPORT_MAX } from '../utils/deck-tools.js';

const FILE_MAX = 2 * 1024 * 1024;
let counter = 0;

const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Saves a new set through the 3.2 set API, safe to retry with the same id (see deck-tools.js). */
export const saveNewSet = (input, api = { createFlashcardSet, addFlashcardSetCards, getFlashcardSet }) =>
  saveSetInParts(input, api);

/** A readable message for a failed request; says plainly that nothing was created. */
export function problemText(error, fallback) {
  if (!error?.status) return 'Sem conexão com o servidor. Verifique a internet e tente de novo; nada foi criado.';
  if (error.status === 409) return `${error.message || fallback} Nada foi criado.`;
  if (error.status === 404)
    return 'Um dos conjuntos não está mais disponível (foi excluído ou deixou de ser compartilhado). Atualize a prévia.';
  return error.message || fallback;
}

function dialogShell(title, hint) {
  const id = `deck-dialog-${++counter}`;
  const dialog = make('dialog', null, 'settings-dialog app-dialog deck-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-hint`);
  const form = make('form');
  form.method = 'dialog';
  form.noValidate = true;
  const heading = make('h2', title);
  heading.id = `${id}-title`;
  const help = make('p', hint, 'app-dialog-hint');
  help.id = `${id}-hint`;
  const body = make('div', null, 'deck-dialog-body');
  // Only short summaries go to the live region; long lists and choices stay out of it.
  const preview = make('div', null, 'deck-preview');
  preview.setAttribute('role', 'status');
  preview.setAttribute('aria-live', 'polite');
  const extra = make('div', null, 'deck-dialog-body deck-dialog-extra');
  const alert = make('p', null, 'deck-error deck-submit-error');
  alert.setAttribute('role', 'alert');
  const actions = make('div', null, 'form-actions');
  const cancel = make('button', 'Cancelar', 'secondary-action');
  cancel.type = 'button';
  const confirm = make('button', 'Criar conjunto', 'primary-action');
  confirm.type = 'submit';
  confirm.disabled = true;
  actions.append(cancel, confirm);
  form.append(heading, help, body, preview, extra, alert, actions);
  dialog.append(form);
  document.body.append(dialog);
  cancel.addEventListener('click', () => dialog.close());
  return { id, dialog, form, body, preview, extra, alert, confirm, cancel };
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
function lookSelect(id) {
  const label = make('label', 'Aparência do conjunto novo');
  label.htmlFor = `${id}-look`;
  const select = make('select');
  select.id = `${id}-look`;
  select.setAttribute('aria-describedby', `${id}-look-hint`);
  fillLookOptions(select, []);
  const hint = make(
    'span',
    'Um único modelo visual vale para todos os cartões do conjunto novo. Dá para trocar depois.',
    'deck-field-hint',
  );
  hint.id = `${id}-look-hint`;
  label.append(select, hint);
  // The student's own templates arrive a moment later; a choice made meanwhile is kept.
  void listCardTemplates()
    .catch(() => [])
    .then((templates) => {
      if (!templates?.length) return;
      const chosen = select.value;
      fillLookOptions(select, templates);
      select.value = chosen;
    });
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

function step(number, title) {
  const section = make('section', null, 'deck-step');
  const id = `deck-step-${++counter}`;
  section.setAttribute('aria-labelledby', id);
  const heading = make('h3', null, 'deck-step-title');
  heading.id = id;
  const badge = make('span', String(number), 'deck-step-number');
  badge.setAttribute('aria-hidden', 'true');
  heading.append(badge, make('span', title));
  section.append(heading);
  return section;
}

/** Runs one dialog to completion; resolves with the saved set or null when cancelled. */
function run({ dialog, form, confirm, alert, cancel }, opener, submit) {
  return new Promise((resolve) => {
    let result = null;
    let busy = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || confirm.disabled) return;
      const invalid = form.querySelector('input:invalid');
      if (invalid) {
        alert.textContent = 'Dê um nome ao conjunto novo.';
        invalid.focus();
        return;
      }
      busy = true;
      confirm.disabled = true;
      cancel.disabled = true;
      form.setAttribute('aria-busy', 'true');
      confirm.textContent = 'Criando…';
      alert.textContent = '';
      try {
        result = await submit();
        dialog.close();
      } catch (error) {
        // Without an answer the request may still have reached the server. The dialog keeps one
        // set id, so trying again resumes that set and never makes a second one.
        if (error.saved && !error.status)
          alert.textContent = `Sem conexão com o servidor. ${plural(error.saved, 'cartão já está', 'cartões já estão')} no conjunto novo. Tente de novo para salvar o restante, sem duplicar o conjunto.`;
        else if (!error.status)
          alert.textContent = 'Sem conexão com o servidor. Verifique a internet e tente de novo; o conjunto não será criado duas vezes.';
        else {
          const done = error.saved
            ? ` ${plural(error.saved, 'cartão foi salvo', 'cartões foram salvos')} no conjunto novo.`
            : '';
          alert.textContent = `${problemText(error, 'Não foi possível criar o conjunto.')}${done}`;
        }
        confirm.disabled = false;
        confirm.textContent = 'Criar conjunto';
        confirm.focus();
      } finally {
        busy = false;
        cancel.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
    // Escape while saving would hide a request that is still running.
    dialog.addEventListener('cancel', (event) => {
      if (busy) event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      // After a success the caller moves focus to the confirmation; otherwise back to the opener.
      if (!result) opener?.focus?.();
      resolve(result);
    });
    dialog.showModal();
  });
}

export const SOURCES_MAX = 12; // sets per merge (server rule)

/**
 * "Mesclar conjuntos" in steps: choose the sets (own and, with Turmas, shared by classmates) →
 * see what happens to repeated cards → decide each "same question, different answers" → name
 * and ONE look for the whole new set. The sources are only read, never changed.
 */
export function openMergeDialog({ sets, opener, v3 = false }) {
  const ui = dialogShell(
    'Mesclar conjuntos',
    'Um conjunto novo, só seu, é criado com os cartões dos conjuntos escolhidos. Os originais (os seus e os compartilhados por colegas) nunca são alterados, e o histórico de revisão não é copiado: o conjunto novo começa do zero.',
  );
  // One id per dialog: retrying after a dropped connection never creates two sets.
  const deckId = crypto.randomUUID();
  const chooseStep = step(1, 'Escolha os conjuntos');
  const box = make('fieldset', null, 'deck-sources');
  box.append(make('legend', 'Conjuntos para juntar (dois ou mais)'));
  const chosen = new Map();
  const checks = [];
  const limitNote = make('p', null, 'flashcard-muted deck-limit-note');
  const groups = [
    ['Meus conjuntos', sets.filter((set) => !set.classroomId)],
    ['Compartilhados nas turmas', sets.filter((set) => set.classroomId)],
  ].filter(([, list]) => list.length);
  for (const [title, list] of groups) {
    if (groups.length > 1) box.append(make('p', title, 'deck-source-group'));
    for (const set of list) {
      const label = make('label', null, 'deck-source');
      const check = make('input');
      check.type = 'checkbox';
      check.value = set.id;
      const text = make('span', null, 'deck-source-text');
      // Names are the students' own words: never run through the interface translation.
      const setName = make('span', set.name, 'deck-source-name');
      setName.translate = false;
      const meta = make('span', null, 'deck-source-meta');
      meta.append(make('span', plural(set.card_count ?? 0, 'cartão', 'cartões')));
      if (set.classroomId) {
        const who = make('span', ` · ${set.authorName || 'colega'} · ${set.classroomName || 'turma'}`);
        who.translate = false;
        meta.append(who);
      }
      text.append(setName, meta);
      label.append(check, text);
      box.append(label);
      checks.push(check);
      check.addEventListener('change', () => {
        if (check.checked) chosen.set(set.id, set);
        else chosen.delete(set.id);
        const full = chosen.size >= SOURCES_MAX;
        for (const other of checks) other.disabled = full && !other.checked;
        limitNote.textContent = full ? `Até ${SOURCES_MAX} conjuntos por mesclagem.` : '';
        void update();
      });
    }
  }
  chooseStep.append(box, limitNote);
  const previewStep = step(2, 'Confira a prévia');
  previewStep.append(ui.preview);
  const conflictStep = step(3, 'Resolva as perguntas com respostas diferentes');
  conflictStep.append(
    make(
      'p',
      'Para cada pergunta, mantenha uma das respostas ou junte todas em um cartão. Sem escolha, as respostas são juntadas: nada se perde.',
      'flashcard-muted',
    ),
  );
  const conflictSlot = make('div');
  conflictStep.append(conflictSlot);
  conflictStep.hidden = true;
  // Flashcards 3.0: the server plans the merge (also for sets shared in a class) and the student
  // decides every "same question, different answers" case.
  const finishStep = step(v3 ? 4 : 3, v3 ? 'Nome e aparência' : 'Nome');
  const name = nameField(ui.id, '');
  finishStep.append(name.label);
  const look = v3 ? lookSelect(ui.id) : null;
  if (look) finishStep.append(look.label);
  ui.body.append(chooseStep, previewStep);
  ui.extra.append(conflictStep, finishStep);
  const retry = make('button', 'Atualizar prévia', 'secondary-action deck-retry');
  retry.type = 'button';
  retry.addEventListener('click', () => void update());
  const decisions = {};
  const cache = new Map();
  let merged = null;
  let ticket = 0;
  const showProblem = (text) => {
    ui.preview.replaceChildren(make('p', text, 'deck-error'));
    previewStep.append(retry);
  };
  const lines = ({ resulting, fresh, duplicates, conflicts, overLimit, v3: typed }) => {
    const out = [plural(resulting, 'cartão no conjunto novo', 'cartões no conjunto novo')];
    if (fresh !== null) out.push(`${plural(fresh, 'cartão sem repetição entra como está', 'cartões sem repetição entram como estão')}.`);
    if (duplicates)
      out.push(
        `${plural(duplicates, 'cartão repetido fica', 'cartões repetidos ficam')} de fora (mesma pergunta e mesma resposta).`,
      );
    if (conflicts && typed)
      out.push(`${plural(conflicts, 'pergunta aparece', 'perguntas aparecem')} com respostas diferentes: escolha no passo 3.`);
    else if (conflicts)
      out.push(
        `${plural(conflicts, 'pergunta aparece', 'perguntas aparecem')} com respostas diferentes; ${conflicts === 1 ? 'as duas ficam' : 'todas ficam'} para você decidir depois.`,
      );
    if (overLimit) out.push(`Limite de ${IMPORT_MAX} cartões por conjunto: ${overLimit} ficam de fora.`);
    return summaryList(out);
  };
  async function update() {
    const mine = ++ticket;
    merged = null;
    ui.confirm.disabled = true;
    retry.remove();
    ui.alert.textContent = '';
    conflictStep.hidden = true;
    conflictSlot.replaceChildren();
    const picked = [...chosen.values()];
    if (!name.input.dataset.edited)
      name.input.value = picked.length ? `Mesclado: ${picked.map((s) => s.name).join(' + ')}`.slice(0, 120) : '';
    if (picked.length < 2) {
      ui.preview.removeAttribute('aria-busy');
      ui.preview.replaceChildren(
        make(
          'p',
          picked.length ? 'Escolha mais um conjunto para ver a prévia.' : 'Escolha pelo menos dois conjuntos.',
          'flashcard-muted',
        ),
      );
      return;
    }
    ui.preview.setAttribute('aria-busy', 'true');
    ui.preview.replaceChildren(make('p', 'Lendo os cartões…', 'flashcard-muted'));
    try {
      if (v3) {
        const sources = picked.map((set) =>
          set.classroomId ? { classroomId: set.classroomId, sharedId: set.sharedId } : { setId: set.id },
        );
        const preview = await previewFlashcardMerge(sources);
        if (mine !== ticket) return;
        merged = { sources, preview };
        const inConflict = preview.conflicts.reduce((sum, c) => sum + c.options.length, 0);
        ui.preview.replaceChildren(
          lines({
            resulting: preview.resulting,
            fresh: Math.max(0, preview.total - preview.duplicates - inConflict),
            duplicates: preview.duplicates,
            conflicts: preview.conflicts.length,
            overLimit: preview.overLimit,
            v3: true,
          }),
        );
        for (const key of Object.keys(decisions)) delete decisions[key];
        if (preview.conflicts.length) {
          conflictSlot.append(conflictChoices(preview.conflicts, decisions));
          conflictStep.hidden = false;
        }
        if (!preview.resulting) ui.preview.append(make('p', 'Os conjuntos escolhidos não têm cartões ativos.', 'deck-error'));
        ui.confirm.disabled = preview.resulting === 0;
        return;
      }
      const full = await Promise.all(
        picked.map(async (set) => {
          if (!cache.has(set.id)) cache.set(set.id, await getFlashcardSet(set.id));
          return cache.get(set.id);
        }),
      );
      if (mine !== ticket) return;
      merged = mergeCards(full);
      ui.preview.replaceChildren(
        lines({
          resulting: merged.cards.length,
          fresh: null,
          duplicates: merged.duplicates,
          conflicts: merged.sameQuestion.length,
          overLimit: merged.overLimit,
        }),
      );
      ui.confirm.disabled = merged.cards.length === 0;
    } catch (error) {
      if (mine === ticket) showProblem(problemText(error, 'Não foi possível ler os conjuntos.'));
    } finally {
      if (mine === ticket) ui.preview.removeAttribute('aria-busy');
    }
  }
  name.input.addEventListener('input', () => {
    name.input.dataset.edited = '1';
  });
  void update();
  setTimeout(() => box.querySelector('input')?.focus());
  return run(ui, opener, async () => {
    const picked = [...chosen.values()];
    const deckName = name.input.value.trim() || 'Conjunto mesclado';
    if (v3) {
      const { preview } = merged;
      const created = await mergeFlashcardSets({
        id: deckId,
        name: deckName,
        sources: merged.sources,
        decisions,
        ...(look ? look.value() : {}),
      });
      // A replay (an earlier try did reach the server) reports 0 added: the preview has the count.
      const added = created.replayed ? preview.resulting : created.added;
      const details = [];
      if (preview.duplicates)
        details.push(`${plural(preview.duplicates, 'cartão repetido ficou', 'cartões repetidos ficaram')} de fora.`);
      if (preview.conflicts.length)
        details.push(`${plural(preview.conflicts.length, 'pergunta com respostas diferentes resolvida', 'perguntas com respostas diferentes resolvidas')}.`);
      return {
        id: created.id || deckId,
        saved: added,
        message: `Conjunto mesclado criado com ${plural(added, 'cartão', 'cartões')}.`,
        details: [...details, 'Os conjuntos originais não mudaram.'],
      };
    }
    const result = await saveNewSet({
      id: deckId,
      name: deckName,
      cards: merged.cards,
      origin: { kind: 'merge', sets: picked.map((s) => ({ id: s.id, name: s.name })) },
    });
    return {
      ...result,
      message: `Conjunto mesclado criado com ${plural(result.saved, 'cartão', 'cartões')}.`,
      details: [
        ...(merged.duplicates
          ? [`${plural(merged.duplicates, 'cartão repetido ficou', 'cartões repetidos ficaram')} de fora.`]
          : []),
        'Os conjuntos originais não mudaram.',
      ],
    };
  });
}

/** "Importar cartões": a text file from Anki, our CSV export or any two-column list. */
export function openImportDialog({ opener, v3 = false }) {
  const ui = dialogShell(
    'Importar cartões',
    v3
      ? 'Use um pacote do Anki (.apkg), um arquivo .txt, .tsv ou .csv do Anki (Arquivo › Exportar › "Notas em texto simples"), a exportação CSV daqui ou uma lista com pergunta e resposta em duas colunas. Um conjunto novo é criado; nada que você já tem muda.'
      : 'Use um arquivo .txt, .tsv ou .csv: do Anki (Arquivo › Exportar › "Notas em texto simples"), a exportação CSV daqui ou uma lista com pergunta e resposta em duas colunas.',
  );
  const deckId = crypto.randomUUID(); // one per dialog: a retry never creates two sets
  const fileLabel = make('label', 'Arquivo');
  fileLabel.htmlFor = `${ui.id}-file`;
  const file = make('input');
  file.type = 'file';
  file.id = `${ui.id}-file`;
  file.accept = `${v3 ? '.apkg,.colpkg,' : ''}.txt,.tsv,.csv,text/plain,text/csv,text/tab-separated-values`;
  fileLabel.append(file);
  const name = nameField(ui.id, '');
  ui.body.append(fileLabel, name.label);
  // Flashcards 3.0: one look (a base or one of the student's templates) for the whole new deck.
  const look = v3 ? lookSelect(ui.id) : null;
  if (look) ui.body.append(look.label);
  let parsed = null;
  let source = '';
  // The first cards are shown outside the live region: only the counts are announced.
  const showSample = (cards = []) => {
    if (!cards.length) return;
    const sample = make('dl', null, 'deck-sample');
    for (const card of cards.slice(0, 3)) sample.append(make('dt', card.front), make('dd', card.back));
    ui.extra.replaceChildren(make('p', 'Primeiros cartões:', 'flashcard-muted'), sample);
  };
  file.addEventListener('change', async () => {
    parsed = null;
    ui.confirm.disabled = true;
    ui.alert.textContent = '';
    ui.extra.replaceChildren();
    const chosen = file.files?.[0];
    if (!chosen) return ui.preview.replaceChildren();
    source = chosen.name;
    if (v3 && /\.(apkg|colpkg)$/i.test(chosen.name)) {
      ui.preview.replaceChildren(make('p', 'Lendo o pacote do Anki…', 'flashcard-muted'));
      ui.preview.setAttribute('aria-busy', 'true');
      file.disabled = true;
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
        ui.preview.replaceChildren(summaryList(lines));
        showSample(report.sample);
        ui.confirm.disabled = report.notes === 0;
      } catch (error) {
        ui.preview.replaceChildren(make('p', problemText(error, 'Não foi possível ler o pacote.'), 'deck-error'));
      } finally {
        ui.preview.removeAttribute('aria-busy');
        file.disabled = false;
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
    ui.preview.replaceChildren(summaryList(lines));
    showSample(parsed.cards);
    ui.confirm.disabled = parsed.cards.length === 0;
  });
  name.input.addEventListener('input', () => {
    name.input.dataset.edited = '1';
  });
  setTimeout(() => file.focus());
  const imported = (id, saved) => ({
    id: id || deckId,
    saved,
    message: `${plural(saved, 'cartão importado', 'cartões importados')} para um conjunto novo.`,
    details: ['Os cartões começam do zero na revisão.'],
  });
  return run(ui, opener, async () => {
    const deckName = name.input.value.trim() || 'Cartões importados';
    if (v3 && parsed.apkg) {
      const created = await importApkg(parsed.apkg, { mode: 'create', id: deckId, name: deckName, ...look.value() });
      return imported(created.id, created.replayed ? parsed.report.notes : created.added);
    }
    if (v3) {
      // Typed: a cloze line stays a cloze note (rendered by the server).
      const created = await createFlashcardDeck({
        id: deckId,
        name: deckName,
        origin: 'text_import',
        ...look.value(),
        cards: parsed.cards.map((card) =>
          card.clozeText
            ? { noteType: 'cloze', fields: { text: card.clozeText, ...(card.extra ? { extra: card.extra } : {}) } }
            : { noteType: 'basic', fields: { front: card.front, back: card.back } },
        ),
      });
      return imported(created.id, created.replayed ? parsed.cards.length : created.added);
    }
    const result = await saveNewSet({
      id: deckId,
      name: deckName,
      cards: parsed.cards,
      origin: { kind: 'import', file: source.slice(0, 160), format: parsed.format },
    });
    return imported(result.id, result.saved);
  });
}
