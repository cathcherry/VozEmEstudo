import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { migrateClassrooms, identities } from './fixtures/classroom-db.fixture.js';
import { buildFlashcardsV3Service, readSharedClassroomSet } from '../src/services/flashcards-v3.service.js';

const v3 = readFileSync(new URL('../../database/migrations/20261121150000_flashcards_3_0.sql', import.meta.url), 'utf8');
const hash = (text) => createHash('sha256').update(text).digest('hex');

test('a student merges decks from 4 of 7 classmates into a new personal deck with ONE look; sources and histories untouched', async () => {
  const f = await createAcademicDatabase();
  try {
    await migrateClassrooms(f);
    await f.db.exec(v3);
    const teacher = identities.a.id;
    const me = identities.b.id;
    const classroom = randomUUID();
    await f.call('classroom_create_admin', [teacher, classroom, 'Biologia 3A', '', 'Prof. Ana']);
    const code = 'CONVITE-TURMA-3A';
    await f.call('classroom_create_invite_admin', [teacher, classroom, randomUUID(), randomUUID(), hash(code), 7, 20]);
    await f.call('classroom_join_admin', [me, hash(code), 'Eu']);
    // Seven classmates, each sharing one deck.
    const names = ['Ana', 'Bruno', 'Caio', 'Duda', 'Eva', 'Fábio', 'Gabi'];
    const decks = {
      Ana: [['O que é ATP?', 'Moeda de energia'], ['Onde ocorre a fotossíntese?', 'No cloroplasto']],
      Bruno: [['o que é ATP', 'moeda de energia.'], ['O que é NADPH?', 'Transportador de elétrons']],
      Caio: [['O que é a glicólise?', 'Quebra da glicose']],
      Duda: [['Onde ocorre a fotossíntese?', 'Nas folhas'], ['O que é o ciclo de Calvin?', 'Fixação do carbono']],
      Eva: [['Pergunta da Eva', 'x']],
      'Fábio': [['Pergunta do Fábio', 'y']],
      Gabi: [['Pergunta da Gabi', 'z']],
    };
    const people = {};
    for (const name of names) {
      const id = randomUUID();
      people[name] = id;
      await f.db.query('insert into auth.users(id) values($1)', [id]);
      await f.call('classroom_join_admin', [id, hash(code), name]);
      const setId = randomUUID();
      await f.call('study_create_flashcard_set_admin', [id, setId, JSON.stringify({ name: `Baralho de ${name}`, cards: decks[name].map(([front, back]) => ({ front, back })) })]);
      await f.call('classroom_share_item_admin', [id, classroom, randomUUID(), 'flashcard_set', setId]);
      // Each classmate already reviewed their own first card: that history must never travel.
      const first = (await f.db.query('select id from public.study_flashcards where set_id=$1 order by created_at limit 1', [setId])).rows[0].id;
      await f.call('study_review_flashcard_admin', [id, first, 2, randomUUID()]);
    }
    const before = {
      cards: (await f.db.query('select * from public.study_flashcards order by id')).rows,
      reviews: (await f.db.query('select * from public.study_flashcard_reviews order by id')).rows,
      sets: (await f.db.query('select * from public.study_flashcard_sets order by id')).rows,
    };
    const call = (name, params) => f.call(name, Object.values(params));
    const service = buildFlashcardsV3Service({
      store: { createDeck: (userId, id, body) => f.call('study_create_flashcard_deck_admin', [userId, id, JSON.stringify(body)]) },
      classroomReader: (userId, classroomId, sharedId) => readSharedClassroomSet(userId, classroomId, sharedId, { call, enabled: true }),
    });
    const shared = await f.call('classroom_list_shared_flashcard_sets_admin', [me, classroom]);
    assert.equal(shared.length, 7, 'the student sees the 7 shared decks');
    const chosen = shared.filter((item) => ['Ana', 'Bruno', 'Caio', 'Duda'].includes(item.author.displayName));
    const sources = chosen.map((item) => ({ classroomId: classroom, sharedId: item.sharedId }));
    const preview = await service.mergePreview(me, { sources });
    assert.equal(preview.total, 7);
    assert.equal(preview.duplicates, 1, 'Ana and Bruno wrote the same ATP card');
    assert.equal(preview.conflicts.length, 1);
    assert.deepEqual(preview.conflicts[0].options.map((o) => o.label).sort(), ['Ana', 'Duda']);
    const pickDuda = preview.conflicts[0].options.find((o) => o.label === 'Duda').cardId;
    const deckId = randomUUID();
    const created = await service.merge(me, {
      id: deckId,
      name: 'Meu baralho da turma',
      sources,
      decisions: { [preview.conflicts[0].key]: `keep:${pickDuda}` },
      templateBase: 'polaroid',
    });
    assert.equal(created.added, 5);
    assert.equal(created.template_base, 'polaroid', 'ONE look for the whole merged deck');
    const mine = (await f.db.query('select * from public.study_flashcards where set_id=$1 order by front_text', [deckId])).rows;
    assert(mine.every((card) => card.user_id === me && card.origin_kind === 'classroom'));
    const labels = mine.map((card) => card.origin_label);
    // The repeated ATP card is kept once, from Ana or Bruno (identical content).
    assert.equal(mine.filter((c) => /atp/i.test(c.front_text)).length, 1);
    assert(['Ana', 'Bruno'].includes(mine.find((c) => /atp/i.test(c.front_text)).origin_label));
    assert.deepEqual(labels.filter((l) => !['Ana', 'Bruno'].includes(l)).sort(), ['Caio', 'Duda', 'Duda']);
    assert(mine.every((card) => Object.values(people).includes(card.origin_user_id)), 'authorship kept');
    assert.equal(mine.find((c) => c.front_text === 'Onde ocorre a fotossíntese?').back_text, 'Nas folhas');
    assert(mine.every((card) => card.repetitions === 0 && card.last_reviewed_at === null), 'a fresh personal schedule');
    const myReviews = (await f.db.query('select count(*)::int as n from public.study_flashcard_reviews where user_id=$1', [me])).rows[0].n;
    assert.equal(myReviews, 0, 'no review history is copied');
    // Sources, their cards and the classmates' histories are exactly as before.
    const after = {
      cards: (await f.db.query('select * from public.study_flashcards where set_id is distinct from $1 order by id', [deckId])).rows,
      reviews: (await f.db.query('select * from public.study_flashcard_reviews order by id')).rows,
      sets: (await f.db.query('select * from public.study_flashcard_sets where id <> $1 order by id', [deckId])).rows,
    };
    assert.deepEqual(after, before);
    // Changing the look of the merged deck changes only the set row.
    const cardsBefore = (await f.db.query('select * from public.study_flashcards where set_id=$1 order by id', [deckId])).rows;
    await f.call('study_set_flashcard_set_template_admin', [me, deckId, null, 'notebook']);
    assert.deepEqual((await f.db.query('select * from public.study_flashcards where set_id=$1 order by id', [deckId])).rows, cardsBefore);
    // Someone outside the class cannot read a shared deck.
    await assert.rejects(service.mergePreview(identities.e.id, { sources }), (e) => e.status === 404);
  } finally {
    await f.db.close();
  }
});
