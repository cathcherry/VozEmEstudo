import { createHash } from 'node:crypto';
import * as repository from '../repositories/flashcards-v3.repository.js';
import { buildNote, NoteError } from '../domain/flashcard-notes.js';
import { planMerge, previewMerge, resolveMerge } from '../domain/deck-merge.js';
import { readApkg, ApkgError } from '../domain/apkg.js';
import { AppError } from '../domain/errors.js';
import {
  validateTemplateSave,
  validateSetTemplate,
  validateDeckCreate,
  validateAddNote,
  validateMergePreview,
  validateMerge,
  validateApkgQuery,
} from '../validators/flashcards-v3.validator.js';

const asNote = (input) => {
  try {
    return buildNote(input);
  } catch (error) {
    if (error instanceof NoteError) throw new AppError(error.code, error.message, 400);
    throw error;
  }
};

/**
 * Reads the sources of a merge with the caller's authorization: own sets directly; sets shared
 * with a class through `classroomReader` (only members can read them, never review history).
 */
async function readSources(store, classroomReader, userId, sources) {
  const seen = new Set();
  const out = [];
  for (const { setId, classroomId } of sources) {
    if (seen.has(setId)) continue;
    seen.add(setId);
    if (classroomId) {
      if (!classroomReader)
        throw new AppError('CLASSROOMS_DISABLED', 'Turmas ainda não estão ativas neste servidor.', 400);
      const shared = await classroomReader(userId, classroomId, setId);
      out.push({
        setId,
        name: shared.name,
        kind: 'classroom',
        author: { id: shared.ownerId, label: shared.ownerLabel || shared.name },
        cards: shared.cards,
      });
    } else {
      const own = await store.ownSetWithCards(userId, setId);
      out.push({ setId, name: own.name, kind: 'own', author: { id: userId, label: own.name }, cards: own.cards });
    }
  }
  return out;
}

export function buildFlashcardsV3Service({ store = repository, classroomReader = null, parse = readApkg } = {}) {
  return {
    listTemplates: (userId) => store.listTemplates(userId),
    saveTemplate: (userId, id, body) => store.saveTemplate(userId, id, validateTemplateSave(body)),
    setTemplate: (userId, setId, body) => store.setTemplate(userId, setId, validateSetTemplate(body)),

    /** A personal deck written by hand or imported from text, with typed notes. */
    async createDeck(userId, body) {
      const data = validateDeckCreate(body);
      const cards = data.cards.map((card) => ({ ...asNote(card), originKind: data.origin === 'text_import' ? 'text_import' : null }));
      return store.createDeck(userId, data.id, {
        name: data.name,
        config: { origin: { kind: data.origin } },
        templateId: data.templateId || null,
        templateBase: data.templateBase || null,
        cards,
      });
    },
    async addNote(userId, setId, body) {
      const result = await store.addNotes(userId, setId, [asNote(validateAddNote(body))]);
      if (!result.added) throw new AppError('FLASHCARD_DUPLICATE', 'Esta pergunta já existe neste conjunto.', 409);
      return result;
    },

    async mergePreview(userId, body) {
      const { sources } = validateMergePreview(body);
      const read = await readSources(store, classroomReader, userId, sources);
      return {
        sources: read.map((s) => ({ setId: s.setId, name: s.name, kind: s.kind, author: s.author.label, cards: s.cards.length })),
        ...previewMerge(planMerge(read)),
      };
    },
    /** Creates the merged deck. The sources are only read; the new deck is personal and fresh. */
    async merge(userId, body) {
      const data = validateMerge(body);
      const read = await readSources(store, classroomReader, userId, data.sources);
      const cards = resolveMerge(planMerge(read), data.decisions);
      if (!cards.length) throw new AppError('FLASHCARD_INVALID_SET', 'Os conjuntos escolhidos não têm cartões ativos.', 400);
      return store.createDeck(userId, data.id, {
        name: data.name,
        config: { origin: { kind: 'merge', sources: read.map((s) => ({ setId: s.setId, name: s.name, kind: s.kind })) } },
        templateId: data.templateId || null,
        templateBase: data.templateBase || null,
        cards,
      });
    },

    /** Anki package: `preview` reads and reports; `create` also stores images and the deck. */
    async importApkg(userId, query, bytes) {
      const options = validateApkgQuery(query);
      let pack;
      try {
        pack = await parse(bytes);
      } catch (error) {
        if (error instanceof ApkgError) throw new AppError(error.code, error.message, error.status);
        throw error;
      }
      const counts = {
        deckName: pack.deckName,
        notes: pack.notes.length,
        types: pack.notes.reduce((acc, n) => ({ ...acc, [n.noteType]: (acc[n.noteType] || 0) + 1 }), {}),
        images: pack.images.size,
        skipped: pack.skipped,
        sample: [],
      };
      const notes = [];
      for (const note of pack.notes) {
        try {
          notes.push({ ...asNote(note), images: note.images });
        } catch {
          counts.skipped.empty += 1;
        }
      }
      counts.notes = notes.length;
      counts.sample = notes.slice(0, 3).map((n) => ({ noteType: n.noteType, front: n.front, back: n.back }));
      if (options.mode === 'preview') return counts;
      if (!notes.length) throw new AppError('APKG_EMPTY', 'O pacote não tem cartões que possam ser importados.', 400);
      // Images go to the private bucket under the user's folder, named by content (dedupe).
      const stored = new Map();
      const uploaded = [];
      try {
        for (const [file, image] of pack.images) {
          const digest = createHash('sha256').update(image.bytes).digest('hex').slice(0, 32);
          const ext = image.mime.split('/')[1].replace('jpeg', 'jpg');
          const path = `${userId}/${options.id}/${digest}.${ext}`;
          if (!uploaded.includes(path)) {
            await store.uploadMedia(path, image.bytes, image.mime);
            uploaded.push(path);
          }
          stored.set(file, { path, mime: image.mime, name: file.slice(0, 120) });
        }
        const result = await store.createDeck(userId, options.id, {
          name: options.name || pack.deckName.slice(0, 160),
          config: { origin: { kind: 'apkg', deck: pack.deckName.slice(0, 160) } },
          templateBase: options.templateBase || null,
          cards: notes.map(({ images, ...note }) => ({
            ...note,
            originKind: 'apkg',
            originLabel: pack.deckName.slice(0, 160),
            media: images.map((file) => stored.get(file)).filter(Boolean),
          })),
        });
        return { ...counts, ...result };
      } catch (error) {
        // Nothing half-imported: images of a failed import are removed.
        await store.removeMedia(uploaded).catch(() => {});
        throw error;
      }
    },
  };
}

export const flashcardsV3Service = buildFlashcardsV3Service();
