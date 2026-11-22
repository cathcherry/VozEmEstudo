import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardFacts,
  cardState,
  connectionPairs,
  describeState,
  groupBySubject,
  milestonesOf,
} from '../js/utils/discovery-card.js';
import {
  createCollection,
  collectionItems,
  normalizeCollections,
  removeCollection,
  setMembership,
} from '../js/utils/discovery-collections.js';

// 3.6 Milestone E: evolving discovery cards are derived from stored learning data only.
const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const row = (extra = {}) => ({
  id: id(1), title: 'Energia', subject: 'Física', createdAt: '2026-11-01T10:00:00Z', version: 1,
  evidenceCount: 2, connectionCount: 0, revisitCount: 0, reflectionCount: 0, connections: [], stamps: [], ...extra,
});

test('an open investigation is a pencil sketch that says what turns it into ink', () => {
  const sketch = cardState({ investigation: { status: 'open', question: 'Por que a folha é verde?', explanation: 'curta', createdAt: 'x' }, evidence: [] });
  assert.equal(sketch.stage, 'sketch');
  assert.deepEqual(sketch.traits, []);
  assert.match(sketch.lines[0].text, /pergunta já está no cartão/);
  assert.match(sketch.lines[0].hint, /guardar um trecho conferido.*e explicar com as suas palavras/);
  const almost = cardState({ investigation: { status: 'open', question: 'Q', explanation: 'x'.repeat(20) }, evidence: [{}] });
  assert.equal(almost.stage, 'sketch', 'still open: not yet a discovery');
  assert.equal(almost.lines[0].hint, '');
});

test('a recorded discovery is inked; reflection stamps it; a connection binds it; a revisit presses a flower', () => {
  const inked = cardState(row());
  assert.equal(inked.stage, 'inked');
  assert.deepEqual(inked.traits, ['inked']);
  assert.match(inked.lines[0].text, /2 evidências conferidas/);
  assert.match(inked.lines[1].hint, /reflexão/);
  assert.equal(inked.lines[1].reached, false);

  const stamped = cardState(row({ reflectionCount: 1 }));
  assert.deepEqual(stamped.traits, ['inked', 'stamped']);
  assert.match(stamped.lines[1].text, /1 reflexão/);

  const bound = cardState(row({ reflectionCount: 1, connections: [{ otherId: id(2), acrossSubjects: true, createdAt: '2026-11-03T00:00:00Z' }] }));
  assert.deepEqual(bound.traits, ['inked', 'stamped', 'bound']);
  assert.equal(bound.stage, 'bound');
  assert.match(bound.lines[2].text, /1 outra descoberta/);
  assert.equal(bound.lines[2].note, 'A outra é de uma disciplina diferente.');
  assert.equal(bound.lines[2].at, '2026-11-03T00:00:00Z');

  const pressed = cardState(row({ revisitCount: 2, firstRevisitAt: '2026-11-05T00:00:00Z' }));
  assert.deepEqual(pressed.traits, ['inked', 'pressed'], 'traits are independent; none is required first');
  assert.match(pressed.lines[3].text, /em 2 dias diferentes/);
  assert.equal(describeState(pressed), 'Passado a tinta e flor prensada');
  assert.equal(describeState(bound), 'Passado a tinta, carimbado e costurado com linha');
});

test('the discovery page view gives dates for each change', () => {
  const view = {
    discovery: { id: id(1), createdAt: '2026-11-01T00:00:00Z' },
    investigation: { question: 'Q?' },
    evidence: [{}],
    reflections: [{ createdAt: '2026-11-04T00:00:00Z' }, { createdAt: '2026-11-02T00:00:00Z' }],
    connections: [{ acrossSubjects: false, createdAt: '2026-11-06T00:00:00Z' }, { acrossSubjects: true, createdAt: '2026-11-07T00:00:00Z' }],
    revisits: [{ createdAt: '2026-11-08T00:00:00Z' }],
  };
  const state = cardState(view);
  assert.deepEqual(state.traits, ['inked', 'stamped', 'bound', 'pressed']);
  assert.deepEqual(state.lines.map((l) => l.at), ['2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-06T00:00:00Z', '2026-11-08T00:00:00Z']);
  assert.equal(state.lines[2].note, 'Uma delas é de outra disciplina.');
  assert.equal(cardFacts(view).question, 'Q?');
});

test('a list row from before the archive migration falls back to counts and stamps, never guesses more', () => {
  const old = { id: id(1), evidenceCount: 1, connectionCount: 1, revisitCount: 0, stamps: ['stamp.first-reflection'], createdAt: 'x' };
  const facts = cardFacts(old);
  assert.equal(facts.reflections, 1, 'the first-reflection stamp of this discovery');
  assert.equal(facts.connections, 1);
  assert.equal(facts.acrossSubjects, null, 'unknown, not zero');
  assert.deepEqual(cardState(old).traits, ['inked', 'stamped', 'bound']);
  assert.equal(cardState(old).lines[2].note, '');
  assert.deepEqual(cardState({ ...old, stamps: [] }).traits, ['inked', 'bound']);
});

test('connection pairs are deduplicated and limited to discoveries in the list; groups by subject', () => {
  const a = row({ id: id(1), subject: 'Física', connections: [{ otherId: id(2), acrossSubjects: true, createdAt: '2' }, { otherId: id(9), acrossSubjects: false }] });
  const b = row({ id: id(2), subject: 'história', connections: [{ otherId: id(1), acrossSubjects: true, createdAt: '2' }] });
  const c = row({ id: id(3), subject: '' });
  const d = row({ id: id(4), subject: 'Física ' });
  const pairs = connectionPairs([a, b, c, d]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.id, pairs[0].b.id, pairs[0].acrossSubjects], [id(1), id(2), true]);
  const groups = groupBySubject([a, b, c, d]);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [['Física', 2], ['história', 1], ['', 1]]);
});

test('milestones come from unlock rows only, oldest first', () => {
  const list = milestonesOf([
    { id: 'stamp.connection', occurredAt: '2026-11-09' },
    { id: 'object.globe', occurredAt: '2026-11-01' },
    { id: 'stamp.first-investigation', occurredAt: '2026-11-02' },
  ]);
  assert.deepEqual(list.map((m) => m.label), ['Primeira descoberta registrada', 'Primeira ponte entre disciplinas']);
});

test('collections: create, membership, removal and validation; nothing touches discoveries', () => {
  const first = createCollection([], '  Energia  na  natureza ', () => 'abc123');
  const { created, error } = first;
  let { collections } = first;
  assert.equal(error, undefined);
  assert.deepEqual(created, { id: 'c-abc123', name: 'Energia na natureza', ids: [] });
  assert.match(createCollection(collections, 'energia NA natureza').error, /Já existe/);
  assert.match(createCollection(collections, '   ').error, /nome/);
  collections = setMembership(collections, 'c-abc123', id(1), true);
  collections = setMembership(collections, 'c-abc123', id(1), true);
  collections = setMembership(collections, 'c-abc123', 'not-a-uuid', true);
  assert.deepEqual(collections[0].ids, [id(1)]);
  assert.deepEqual(collectionItems(collections[0], [row({ id: id(2) }), row({ id: id(1) })]).map((r) => r.id), [id(1)]);
  assert.deepEqual(setMembership(collections, 'c-abc123', id(1), false)[0].ids, []);
  assert.deepEqual(removeCollection(collections, 'c-abc123'), []);
  assert.deepEqual(normalizeCollections([{ id: 'bad id', name: 'x' }, { id: 'c-1', name: '' }, { id: 'c-2', name: 'Ok', ids: [id(1), id(1)] }, { id: 'c-2', name: 'Dup' }]), [{ id: 'c-2', name: 'Ok', ids: [id(1)] }]);
  assert.deepEqual(normalizeCollections('nope'), []);
});
