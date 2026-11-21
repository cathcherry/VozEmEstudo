// Lesson notebook (Notes 3.0): document model and reliable autosave. Pure module (no DOM), so it
// runs in unit tests. The server validates the same schema (backend/src/validators/notebook.validator.js).

export const BLOCK_LABELS = Object.freeze({
  heading: 'Título',
  paragraph: 'Parágrafo',
  bullet_list: 'Lista',
  ordered_list: 'Lista numerada',
  checklist: 'Checklist',
  quote: 'Citação',
  annotation_ref: 'Destaque citado',
});
/** Blocks a person adds from the toolbar (references come from "Citar no caderno"). */
export const ADDABLE_BLOCKS = Object.freeze(['heading', 'paragraph', 'bullet_list', 'ordered_list', 'checklist', 'quote']);
export const NOTEBOOK_MAX_BLOCKS = 300;
const TAG = /<\/?[a-zA-Z!?]/;

export const emptyDoc = () => ({ type: 'doc', schemaVersion: 1, blocks: [] });
export const emptyContent = () => ({ title: '', doc: emptyDoc() });
export const blockId = () => 'b' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export function newBlock(type, id = blockId()) {
  if (type === 'heading') return { id, type, level: 2, text: '' };
  if (type === 'bullet_list' || type === 'ordered_list') return { id, type, items: [''] };
  if (type === 'checklist') return { id, type, items: [{ text: '', checked: false }] };
  if (type === 'paragraph' || type === 'quote') return { id, type, text: '' };
  throw new Error(`Bloco desconhecido: ${type}`);
}

/** Reference to an annotation, keeping the revision it was made in. */
export const referenceBlock = (note, id = blockId()) => ({
  id,
  type: 'annotation_ref',
  annotationId: note.id,
  sourceRevisionId: note.source_revision_id,
  ...(Number.isInteger(note.source_revision) ? { sourceRevision: note.source_revision } : {}),
});

/** Plain text only: true when some text of the notebook looks like an HTML tag. */
export function hasMarkup(content) {
  const strings = [];
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(content);
  return strings.some((text) => TAG.test(text));
}

export const sameContent = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * "Keep both" after a conflict: the other device's document, then a marked copy of this device's
 * blocks (new ids, so nothing collides). Nothing is lost; the person tidies up afterwards.
 */
export function keepBoth(theirs, mine, label) {
  // Blocks both versions share (same content) are not repeated in the copy.
  const shape = ({ id: _id, ...rest }) => JSON.stringify(rest);
  const known = new Set(theirs.doc.blocks.map(shape));
  const copied = mine.doc.blocks
    .filter((block) => !known.has(shape(block)))
    .map((block) => ({ ...clone(block), id: blockId() }));
  if (!copied.length) return clone({ ...theirs, title: theirs.title || mine.title });
  return {
    title: theirs.title || mine.title,
    doc: {
      ...emptyDoc(),
      blocks: [
        ...clone(theirs.doc.blocks),
        { id: blockId(), type: 'heading', level: 3, text: label },
        ...copied,
      ],
    },
  };
}

/**
 * Autosave with optimistic concurrency and idempotent retries.
 * - Each edit is copied to `storage[key]` ({baseVersion, content, at}) until the server has it.
 * - Saves are debounced; one request at a time; later edits go in the next request.
 * - A request whose outcome is unknown (network, 5xx, 408, 429) is retried with the SAME request id
 *   and body (the server replays it), with backoff; newer edits are sent only after it.
 * - 409 LEARNING_VERSION_CONFLICT stops saving: state 'conflict' until `adopt()`.
 * - Other 4xx: state 'invalid' (message from the server); the next edit tries again.
 * States: saved, dirty, saving, retrying, conflict, invalid.
 */
export function createAutosave({
  send,
  uuid = () => globalThis.crypto.randomUUID(),
  storage = null,
  key = null,
  debounceMs = 1200,
  retryDelays = [2000, 5000, 15000, 30000],
  onState = () => {},
  onSaved = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  isOnline = () => globalThis.navigator?.onLine !== false,
}) {
  let version = 0,
    current = emptyContent(),
    lastSaved = emptyContent(),
    wire = null,
    inflight = null,
    timer = null,
    attempts = 0,
    state = 'saved';
  const set = (next, info = {}) => {
    state = next;
    onState(next, info);
  };
  const persist = () => {
    if (!storage || !key) return;
    try {
      storage.setItem(key, JSON.stringify({ baseVersion: version, content: current, at: Date.now() }));
    } catch {
      /* Storage full or blocked: the in-memory copy and the retry still work. */
    }
  };
  const forget = () => {
    try {
      storage?.removeItem(key);
    } catch {
      /* optional */
    }
  };
  const stopTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  async function run() {
    for (;;) {
      if (!wire) {
        if (sameContent(current, lastSaved)) {
          forget();
          set('saved');
          return;
        }
        wire = { version, requestId: uuid(), title: current.title, doc: clone(current.doc) };
      }
      set('saving');
      try {
        const result = await send(wire);
        version = result?.notebook?.version ?? version + 1;
        lastSaved = { title: wire.title, doc: wire.doc };
        wire = null;
        attempts = 0;
        onSaved(result);
        if (!sameContent(current, lastSaved)) persist();
      } catch (error) {
        if (error?.status === 409 && error.code === 'LEARNING_VERSION_CONFLICT') {
          wire = null;
          set('conflict', { message: error.message });
          return;
        }
        if (error?.status && error.status < 500 && ![408, 429].includes(error.status)) {
          wire = null;
          set('invalid', { message: error.message });
          return;
        }
        const delay = retryDelays[Math.min(attempts, retryDelays.length - 1)];
        attempts += 1;
        set('retrying', { offline: !isOnline(), message: error?.message });
        timer = schedule(() => void flush(), delay);
        return;
      }
    }
  }
  function flush() {
    stopTimer();
    if (inflight) return inflight;
    if (state === 'conflict') return Promise.resolve();
    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  }
  return {
    get state() {
      return state;
    },
    get version() {
      return version;
    },
    /** Server state after loading. */
    start({ version: serverVersion, content }) {
      version = serverVersion;
      current = clone(content);
      lastSaved = clone(content);
      set('saved');
    },
    /** This device's copy not yet received by the server, if any. */
    localCopy() {
      try {
        const value = JSON.parse(storage?.getItem(key) || 'null');
        return value && Number.isInteger(value.baseVersion) && value.content?.doc ? value : null;
      } catch {
        return null;
      }
    },
    edit(content) {
      current = clone(content);
      persist();
      if (state === 'conflict') return;
      if (!inflight) set('dirty');
      stopTimer();
      timer = schedule(() => void flush(), debounceMs);
    },
    flush,
    retry() {
      attempts = 0;
      if (state === 'conflict') return Promise.resolve();
      return flush();
    },
    /** Enters the conflict state without a request (a local copy older than the server's). */
    hold(content) {
      stopTimer();
      current = clone(content);
      state = 'conflict';
    },
    /** Leaves the conflict state on a base the server has, saving `content` when asked. */
    adopt({ version: serverVersion, content }, { save }) {
      stopTimer();
      wire = null;
      version = serverVersion;
      current = clone(content);
      if (save) {
        lastSaved = null;
        persist();
        state = 'dirty';
        return flush();
      }
      lastSaved = clone(content);
      forget();
      set('saved');
      return Promise.resolve();
    },
  };
}
