import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import {
  completeInvestigation,
  createDiscoveriesDatabase,
  discoveryApi,
  multiRevisionId,
} from './fixtures/discoveries-db.fixture.js';

// Real SQL (PGlite) for the Diário de estudo (3.6 Milestone D). No mock of the rules: every
// assertion goes through the server functions of 20261124100000_journals.sql.
const read = (path) => readFileSync(new URL(`../../database/${path}`, import.meta.url), 'utf8');
const migration = read('migrations/20261124100000_journals.sql');
const a = identities.a.id;
const b = identities.b.id;
const A = resourceIds.materialA;
const B = resourceIds.materialB;

function journalApi(call) {
  return {
    list: (user) => call('journal_list_admin', [user]),
    get: (user, id) => call('journal_get_admin', [user, id]),
    options: (user) => call('journal_link_options_admin', [user]),
    save: (user, id, version, body, requestId = randomUUID()) =>
      call('journal_save_admin', [user, id, version, requestId, JSON.stringify(body)]),
    page: (user, journal, page, version, body, requestId = randomUUID()) =>
      call('journal_page_save_admin', [user, journal, page, version, requestId, JSON.stringify(body)]),
  };
}
async function migrated() {
  const f = await createAcademicDatabase();
  await f.db.exec(migration);
  return { ...f, api: journalApi(f.call) };
}
const sticker = (id, extra = {}) => ({ id, art: 'sticker.moon', x: 10, y: 20, rotation: -4, scale: 1, ...extra });

test('migration is guarded, transactional, additive and server-only', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /JOURNALS_ABORT: faltam pré-requisitos/);
  assert.match(migration, /JOURNALS_ABORT: estruturas do diario ja existem/);
  assert.doesNotMatch(
    migration,
    /\b(drop\s+(table|column|constraint|function|trigger|policy|index)|truncate\s+(table\s+)?public|create or replace|alter table public\.(materials|study_|transcription|discoveries|collection))/i,
  );
  for (const name of ['journals', 'journal_pages'])
    assert.match(migration, new RegExp(`alter table public\\.${name} enable row level security`));
  assert.match(migration, /revoke all on table public\.journals, public\.journal_pages from public, anon, authenticated;/);
  for (const [, name, header] of migration.matchAll(/create function public\.(\w+)\(([^$]*?)as \$\$/g))
    assert.match(header, /security invoker set search_path = ''/, name);
  assert.match(migration, /\^\(sticker\|tape\|stamp\|frame\|divider\|label\)/, 'decoration allowlist');
});

test('guard refuses to run twice; existing rows are untouched', async () => {
  const f = await createAcademicDatabase();
  try {
    const before = (await f.db.query('select * from public.materials order by id')).rows;
    await f.db.exec(migration);
    assert.deepEqual((await f.db.query('select * from public.materials order by id')).rows, before);
    await assert.rejects(f.db.exec(migration), /JOURNALS_ABORT: estruturas do diario ja existem/);
    await f.db.exec('rollback');
  } finally {
    await f.db.close();
  }
});

test('journals: create, replay by request id, versions, rename, cover, limit and delete', async () => {
  const f = await migrated();
  try {
    const id = randomUUID();
    const request = randomUUID();
    const body = { title: '  Diário de Física ', cover: 'cover.constellation' };
    const created = await f.api.save(a, id, 0, body, request);
    assert.equal(created.replayed, false);
    assert.equal(created.journal.title, 'Diário de Física');
    assert.equal(created.journal.paper, 'ruled');
    assert.equal(created.journal.version, 1);
    assert.equal(created.journal.pageCount, 0);
    const replay = await f.api.save(a, id, 0, body, request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.journal.version, 1, 'a retry writes nothing');
    await assert.rejects(f.api.save(a, id, 0, { title: 'Outro', cover: 'cover.kraft' }, request), /JOURNAL_REQUEST_CONFLICT/);
    await assert.rejects(f.api.save(a, id, 0, body), /JOURNAL_VERSION_CONFLICT/, 'creating twice');
    const renamed = await f.api.save(a, id, 1, { title: 'Física 1', cover: 'cover.field-notes', paper: 'dot' });
    assert.deepEqual([renamed.journal.title, renamed.journal.cover, renamed.journal.paper, renamed.journal.version], ['Física 1', 'cover.field-notes', 'dot', 2]);
    await assert.rejects(f.api.save(a, id, 1, { title: 'Velho' }), /JOURNAL_VERSION_CONFLICT/);
    for (const bad of [
      { title: '' },
      { title: '<b>x</b>' },
      { cover: 'sticker.moon' },
      { paper: 'papyrus' },
      { title: 'x', score: 1 },
      { deleted: 'yes' },
    ])
      await assert.rejects(f.api.save(a, id, 2, bad), /JOURNAL_INVALID/, JSON.stringify(bad));
    await assert.rejects(f.api.save(a, randomUUID(), 0, { title: 'Sem capa' }), /JOURNAL_INVALID/);
    for (let i = 1; i < 24; i += 1) await f.api.save(a, randomUUID(), 0, { title: `Diário ${i}`, cover: 'cover.kraft' });
    await assert.rejects(f.api.save(a, randomUUID(), 0, { title: 'Demais', cover: 'cover.kraft' }), /JOURNAL_LIMIT/);
    assert.equal((await f.api.list(a)).journals.length, 24);
    const gone = await f.api.save(a, id, 2, { deleted: true });
    assert.equal(gone.journal.version, 3);
    assert.equal((await f.api.list(a)).journals.length, 23);
    await assert.rejects(f.api.get(a, id), /JOURNAL_NOT_FOUND/);
    await assert.rejects(f.api.save(a, id, 3, { title: 'De volta' }), /JOURNAL_NOT_FOUND/);
  } finally {
    await f.db.close();
  }
});

test('pages: templates, positions, content in plain text, versions and replays', async () => {
  const f = await migrated();
  try {
    const journal = randomUUID();
    await f.api.save(a, journal, 0, { title: 'Diário', cover: 'cover.cloth-lavender', paper: 'grid' });
    const first = randomUUID();
    const request = randomUUID();
    const page = { template: 'ruled', title: 'Fotossíntese', content: { body: 'A luz vira energia química.' } };
    const made = await f.api.page(a, journal, first, 0, page, request);
    assert.equal(made.page.position, 0);
    assert.equal(made.page.paper, 'grid', 'new pages take the journal paper');
    assert.equal(made.page.version, 1);
    assert.equal(made.journal.pageCount, 1);
    assert.equal((await f.api.page(a, journal, first, 0, page, request)).replayed, true);
    await assert.rejects(f.api.page(a, journal, first, 0, { ...page, title: 'Outra' }, request), /JOURNAL_REQUEST_CONFLICT/);
    const second = randomUUID();
    const collage = await f.api.page(a, journal, second, 0, {
      template: 'collage',
      paper: 'kraft',
      content: { photos: [{ caption: 'Cloroplasto', art: 'sticker.leaf', frame: 'frame.polaroid' }], note: '' },
    });
    assert.equal(collage.page.position, 1);
    const edited = await f.api.page(a, journal, first, 1, { title: 'Fotossíntese (revisto)', paper: 'aged' });
    assert.deepEqual([edited.page.title, edited.page.paper, edited.page.version], ['Fotossíntese (revisto)', 'aged', 2]);
    assert.equal(edited.page.content.body, 'A luz vira energia química.', 'fields not sent are kept');
    await assert.rejects(f.api.page(a, journal, first, 1, { title: 'Velha' }), /JOURNAL_VERSION_CONFLICT/);
    await assert.rejects(f.api.page(a, journal, first, 2, { template: 'free' }), /JOURNAL_INVALID/, 'the template never changes');
    for (const bad of [
      { content: { body: '<script>alert(1)</script>' } },
      { content: { body: 'x'.repeat(25000) } },
      { title: 'x'.repeat(121) },
      { paper: 'papyrus' },
      { colour: 'red' },
    ])
      await assert.rejects(f.api.page(a, journal, first, 2, bad), /JOURNAL_(INVALID|TOO_LARGE)/, JSON.stringify(bad).slice(0, 60));
    await assert.rejects(
      f.api.page(a, journal, second, 1, { content: { photos: [{ caption: 'x', art: 'stamp.revisit', frame: 'frame.polaroid' }] } }),
      /JOURNAL_DECORATION_INVALID/,
      'only stickers go inside a collage frame',
    );
    await assert.rejects(f.api.page(a, journal, randomUUID(), 0, { title: 'Sem modelo' }), /JOURNAL_INVALID/);
    const fetched = await f.api.get(a, journal);
    assert.deepEqual(fetched.pages.map((p) => p.id), [first, second]);
    const removed = await f.api.page(a, journal, second, 1, { deleted: true });
    assert.equal(removed.journal.pageCount, 1);
    assert.deepEqual((await f.api.get(a, journal)).pages.map((p) => p.id), [first]);
    await assert.rejects(f.api.page(a, journal, second, 2, { title: 'De volta' }), /JOURNAL_NOT_FOUND/);
  } finally {
    await f.db.close();
  }
});

test('decorations: allowlist, ranges, unique ids, limit of 24 and rounding', async () => {
  const f = await migrated();
  try {
    const journal = randomUUID();
    await f.api.save(a, journal, 0, { title: 'Diário', cover: 'cover.kraft' });
    const page = randomUUID();
    await f.api.page(a, journal, page, 0, { template: 'free' });
    const saved = await f.api.page(a, journal, page, 1, {
      decorations: [
        sticker('s1', { x: 12.345678 }),
        { id: 't1', art: 'tape.lavender-dots', x: 50, y: 0, rotation: 180, scale: 0.4 },
        { id: 'f1', art: 'frame.polaroid', x: 100, y: 100, rotation: -180, scale: 2.5 },
        { id: 'd1', art: 'divider.sprig', x: 0, y: 50, rotation: 0, scale: 1 },
        { id: 'l1', art: 'label.ticket', x: 30, y: 60, rotation: 3, scale: 1.2 },
      ],
    });
    assert.equal(saved.page.decorations.length, 5);
    assert.equal(saved.page.decorations[0].x, 12.35);
    let version = 2;
    for (const [label, items] of [
      ['unknown art kind', [sticker('x', { art: 'object.globe' })]],
      ['art with a path', [sticker('x', { art: 'sticker.../../x' })]],
      ['x outside the page', [sticker('x', { x: 101 })]],
      ['negative y', [sticker('x', { y: -1 })]],
      ['rotation', [sticker('x', { rotation: 181 })]],
      ['scale', [sticker('x', { scale: 3 })]],
      ['text number', [sticker('x', { x: '10' })]],
      ['extra key', [{ ...sticker('x'), url: 'https://example.test' }]],
      ['missing key', [{ id: 'x', art: 'sticker.moon', x: 1, y: 1, rotation: 0 }]],
      ['duplicate id', [sticker('x'), sticker('x')]],
      ['bad id', [sticker('a b')]],
    ])
      await assert.rejects(f.api.page(a, journal, page, version, { decorations: items }), /JOURNAL_DECORATION_INVALID/, label);
    const many = Array.from({ length: 25 }, (_, i) => sticker(`s${i}`));
    await assert.rejects(f.api.page(a, journal, page, version, { decorations: many }), /JOURNAL_LIMIT/);
    const full = await f.api.page(a, journal, page, version, { decorations: many.slice(0, 24) });
    assert.equal(full.page.decorations.length, 24);
    version += 1;
    // Stamps need the Gabinete: without the discoveries migration there is nothing unlocked.
    await assert.rejects(
      f.api.page(a, journal, page, version, { decorations: [sticker('st', { art: 'stamp.first-evidence' })] }),
      /JOURNAL_DECORATION_LOCKED/,
    );
  } finally {
    await f.db.close();
  }
});

test('links: own lessons and discoveries only; a quote keeps its source; stamps only once unlocked', async () => {
  const f = await createDiscoveriesDatabase();
  try {
    await f.db.exec(migration);
    const api = journalApi(f.call);
    const discoveries = discoveryApi(f.call);
    const journal = randomUUID();
    await api.save(a, journal, 0, { title: 'Diário', cover: 'cover.kraft' });
    const page = randomUUID();
    await api.page(a, journal, page, 0, { template: 'concept', content: { term: 'Energia', definition: '', example: '' } });
    const options = await api.options(a);
    assert.deepEqual(options.lessons.map((l) => l.id), [A]);
    assert.deepEqual(options.discoveries, []);
    assert.deepEqual((await api.options(b)).lessons.map((l) => l.id), [B]);
    await assert.rejects(api.page(a, journal, page, 1, { links: [{ kind: 'lesson', id: B }] }), /JOURNAL_LINK_INVALID/, 'a lesson of another account');
    await assert.rejects(api.page(a, journal, page, 1, { links: [{ kind: 'discovery', id: randomUUID() }] }), /JOURNAL_LINK_INVALID/);
    await assert.rejects(api.page(a, journal, page, 1, { links: [{ kind: 'quiz', id: A }] }), /JOURNAL_LINK_INVALID/);
    await assert.rejects(
      api.page(a, journal, page, 1, { links: [{ kind: 'lesson', id: A }, { kind: 'lesson', id: A.toUpperCase() }] }),
      /JOURNAL_LINK_INVALID/,
      'duplicates (case-insensitive)',
    );
    // A quote needs its source among the page's links.
    const quote = { term: 'Energia', definition: '', example: '', quote: { text: 'Energia é conservada.', source: { kind: 'lesson', id: A } } };
    await assert.rejects(api.page(a, journal, page, 1, { content: quote }), /JOURNAL_QUOTE_SOURCE_REQUIRED/);
    await assert.rejects(
      api.page(a, journal, page, 1, { content: { ...quote, quote: { text: 'Energia é conservada.', source: null } }, links: [{ kind: 'lesson', id: A }] }),
      /JOURNAL_QUOTE_SOURCE_REQUIRED/,
    );
    const linked = await api.page(a, journal, page, 1, { content: quote, links: [{ kind: 'lesson', id: A }] });
    assert.deepEqual(linked.page.links, [{ kind: 'lesson', id: A }]);
    await assert.rejects(api.page(a, journal, page, 2, { links: [] }), /JOURNAL_QUOTE_SOURCE_REQUIRED/, 'removing the source of a quote');
    // A discovery (and the stamps its investigation unlocked).
    const { id: discovery } = await completeInvestigation(discoveries, a, A, {
      question: 'Por que a energia se conserva?',
      revisionId: multiRevisionId,
      explanation: 'A energia muda de forma, mas o total continua o mesmo.',
      quote: { segmentPosition: 0, startOffset: 0, endOffset: 7, quote: 'Energia' },
    });
    assert.deepEqual((await api.options(a)).discoveries.map((d) => d.id), [discovery]);
    assert.deepEqual((await api.options(b)).discoveries, []);
    const both = await api.page(a, journal, page, 2, {
      links: [{ kind: 'lesson', id: A }, { kind: 'discovery', id: discovery }],
      decorations: [sticker('st', { art: 'stamp.first-evidence' })],
    });
    assert.equal(both.page.links.length, 2);
    await assert.rejects(
      api.page(a, journal, page, 3, { decorations: [sticker('st', { art: 'stamp.connection' })] }),
      /JOURNAL_DECORATION_LOCKED/,
      'a stamp the account has not found',
    );
    const got = await api.get(a, journal);
    assert.deepEqual(got.linkTargets.map((t) => t.kind).sort(), ['discovery', 'lesson']);
    assert(got.linkTargets.every((t) => t.title));
    // Account B cannot see, edit or link into A's journal.
    await assert.rejects(api.get(b, journal), /JOURNAL_NOT_FOUND/);
    await assert.rejects(api.page(b, journal, page, 3, { title: 'invasão' }), /JOURNAL_NOT_FOUND/);
    await assert.rejects(api.page(b, journal, randomUUID(), 0, { template: 'free' }), /JOURNAL_NOT_FOUND/);
    await assert.rejects(api.save(b, journal, 1, { title: 'Meu agora' }), /JOURNAL_NOT_FOUND/);
    await assert.rejects(api.save(b, journal, 0, { title: 'Colisão', cover: 'cover.kraft' }), /JOURNAL_NOT_FOUND/, 'an id already used by another account');
    // B's own journal with the same page id is refused too (ids are global).
    const theirs = randomUUID();
    await api.save(b, theirs, 0, { title: 'B', cover: 'cover.kraft' });
    await assert.rejects(api.page(b, theirs, page, 0, { template: 'free' }), /JOURNAL_NOT_FOUND/);
    assert.deepEqual((await api.list(b)).journals.map((j) => j.id), [theirs]);
  } finally {
    await f.db.close();
  }
});

test('browsers have no access to the tables or the functions', async () => {
  const f = await migrated();
  try {
    const journal = randomUUID();
    await f.api.save(a, journal, 0, { title: 'Privado', cover: 'cover.kraft' });
    for (const role of ['authenticated', 'anon']) {
      for (const sql of [
        'select * from public.journals',
        'select * from public.journal_pages',
        `select public.journal_list_admin('${a}')`,
        `select public.journal_get_admin('${a}', '${journal}')`,
      ])
        await assert.rejects(
          f.db.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.query(sql);
          }),
          /permission denied/,
          `${role}: ${sql}`,
        );
    }
  } finally {
    await f.db.close();
  }
});

test('concurrent saves of the same page (two tabs) keep one winner and refuse the stale one', async () => {
  const f = await migrated();
  try {
    const journal = randomUUID();
    await f.api.save(a, journal, 0, { title: 'Abas', cover: 'cover.kraft' });
    const page = randomUUID();
    await f.api.page(a, journal, page, 0, { template: 'free' });
    // PGlite has one connection, so these are serialized like the row locks serialize them in Postgres.
    const results = await Promise.allSettled([
      f.api.page(a, journal, page, 1, { title: 'Aba 1' }),
      f.api.page(a, journal, page, 1, { title: 'Aba 2' }),
    ]);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected']);
    assert.match(results[1].reason.message, /JOURNAL_VERSION_CONFLICT/);
    assert.equal((await f.api.get(a, journal)).pages[0].title, 'Aba 1');
  } finally {
    await f.db.close();
  }
});

test('preflight and postflight checks run read-only; the documented rollback removes everything new', async () => {
  const f = await createAcademicDatabase();
  const row = (results, key) => results.find((r) => r.rows[0] && key in r.rows[0]).rows[0];
  try {
    const { db } = f;
    const pre = await db.exec(read('checks/journals-preflight.sql'));
    const prereq = row(pre, 'has_materials');
    assert(prereq.has_materials && prereq.has_auth_users, JSON.stringify(prereq));
    assert(Object.values(row(pre, 'journals_must_be_null')).every((value) => value === null));
    const before = row(pre, 'materials');
    await db.exec(migration);
    const post = await db.exec(read('checks/journals-postflight.sql'));
    const objects = row(post, 'has_journals');
    assert(Object.values(objects).every((value) => value === true), JSON.stringify(objects));
    const tables = post.find((r) => r.rows[0] && 'rls_enabled' in r.rows[0]).rows;
    assert.equal(tables.length, 2);
    for (const t of tables) assert(t.rls_enabled && t.hidden_from_browser && t.hidden_from_anon && t.server_can_write, JSON.stringify(t));
    const functions = post.find((r) => r.rows[0] && 'server_only' in r.rows[0]).rows;
    assert(functions.length >= 11);
    for (const fn of functions) assert(fn.server_only && fn.hidden_from_anon && fn.security_invoker && fn.fixed_search_path, JSON.stringify(fn));
    const counts = row(post, 'journals_must_be_0');
    assert.equal(Number(counts.materials), Number(before.materials));
    assert.equal(Number(counts.journals_must_be_0), 0);
    const rollback = read('rollback/journals-rollback.md').split('## 3.')[1].match(/```sql\n([\s\S]*?)```/)[1];
    await db.exec(rollback);
    const left = (await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'journal\\_%'")).rows[0].n;
    assert.equal(left, 0, 'no function left behind');
    const again = await db.exec(read('checks/journals-preflight.sql'));
    assert(Object.values(row(again, 'journals_must_be_null')).every((value) => value === null));
    await db.exec(migration);
  } finally {
    await f.db.close();
  }
});
