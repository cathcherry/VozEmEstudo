import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  buildFlashcardGenerationServiceV2,
  mockFlashcardCompletionV2,
} from '../src/services/flashcard-generation.service.js';
import { buildFlashcardMessagesV2 } from '../src/prompts/flashcards.v2.js';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { migrateStudyAuthoring } from './fixtures/authoring-db.fixture.js';
import { identities, resourceIds } from './fixtures/ownership.fixture.js';
import { revisionIds } from './fixtures/academic-db.fixture.js';

const materialId = '11111111-1111-4111-8111-111111111111';
const sourceRevisionId = '22222222-2222-4222-8222-222222222222';
const TEXT =
  'A mitose produz duas células idênticas. A meiose reduz o número de cromossomos pela metade. O DNA se duplica antes da divisão celular.';
const segments = TEXT.split(/(?<=\.) /).map((text, position) => ({
  position,
  startMs: position * 4000,
  endMs: position * 4000 + 3900,
  text,
}));
function service(responses, { existing = [] } = {}) {
  const calls = [];
  const generate = buildFlashcardGenerationServiceV2({
    getOwnedMaterial: async (user) => {
      if (user !== 'owner')
        throw Object.assign(new Error('Material não encontrado.'), { status: 404 });
    },
    getReviewState: async () => ({
      state: 'ready_to_generate',
      sourceRevisionId,
      confirmation: { sourceRevisionId },
    }),
    getVersion: async () => ({ full_text: TEXT, revision: 2, segments_snapshot: segments }),
    existingFronts: async () => existing,
    model: 'fake',
    complete: async (args) => {
      calls.push(args);
      return responses[calls.length - 1];
    },
  });
  return { generate, calls };
}
const body = (overrides = {}) => ({
  materialId,
  sourceRevisionId,
  count: 3,
  config: {
    difficulties: ['basic', 'advanced'],
    focus: ['definitions', 'processes'],
    style: 'term_definition',
  },
  ...overrides,
});
const card = (front, back, evidence, extra = {}) => ({ front, back, evidence, ...extra });

test('v2 preview keeps grounded, distinct cards with source segments and never pads', async () => {
  const { generate, calls } = service([
    {
      cards: [
        card('Mitose', 'Produz duas células idênticas.', 'A mitose produz duas células idênticas', {
          difficulty: 'basic',
          focus: 'definitions',
        }),
        card('mitose', 'Gera células iguais.', 'A mitose produz duas células idênticas'), // exact duplicate front
        card('Fotossíntese', 'Produz glicose.', 'A fotossíntese ocorre nos cloroplastos'), // not in source
        card(
          'Duplicação do DNA',
          'Acontece antes da divisão.',
          'O DNA se duplica antes da divisão celular',
          { difficulty: 'expert' },
        ),
      ],
    },
    {
      cards: [
        card(
          'Meiose',
          'Reduz os cromossomos pela metade.',
          'A meiose reduz o número de cromossomos pela metade',
        ),
      ],
    },
  ]);
  const result = await generate('owner', body());
  assert.equal(calls.length, 2, 'one bounded top-up after discarding cards');
  assert.deepEqual(
    result.cards.map((c) => c.front),
    ['Mitose', 'Duplicação do DNA', 'Meiose'],
  );
  assert.deepEqual(result.rejected, { exact: 1, unsupported: 1 });
  assert.equal(
    result.cards[1].difficulty,
    'basic',
    'unknown difficulty falls back to a selected one',
  );
  assert.equal(result.cards[0].style, 'term_definition');
  assert.deepEqual(result.cards[2].sourceSegments, [{ position: 1, startMs: 4000, endMs: 7900 }]);
  assert.equal(result.shortfall, null);
  // The top-up call already avoids accepted fronts.
  assert.deepEqual(JSON.parse(calls[1].messages[1].content).avoid, ['Mitose', 'Duplicação do DNA']);
});

test('v2 preview: existing cards and avoid list block repeats; thin content yields fewer cards', async () => {
  const { generate, calls } = service(
    [
      {
        cards: [
          card('Mitose', 'Duas células idênticas.', 'A mitose produz duas células idênticas'),
        ],
      },
    ],
    { existing: ['Mitose'] },
  );
  const result = await generate('owner', body({ count: 5, avoid: ['Meiose'] }));
  assert.equal(result.cards.length, 0);
  assert.deepEqual(result.rejected, { previous_exact: 1 });
  assert.equal(calls.length, 1, 'no top-up when the model offered fewer cards than requested');
  assert.match(result.shortfall, /Somente estes cartões/);
  assert.deepEqual(JSON.parse(calls[0].messages[1].content).avoid, ['Meiose', 'Mitose']);
});

test('v2 preview validates ownership, limits and output shape', async () => {
  const { generate } = service([{ nope: true }]);
  await assert.rejects(generate('other', body()), /Material não encontrado/);
  for (const bad of [
    { count: 0 },
    { count: 51 },
    { config: { style: 'cloze' } },
    { config: { focus: [] } },
    { extra: 1 },
  ])
    await assert.rejects(generate('owner', body(bad)));
  await assert.rejects(
    generate('owner', body()),
    (error) => error.code === 'LLM_INVALID_OUTPUT' && error.status === 502,
  );
  const prompt = buildFlashcardMessagesV2('T', {
    count: 4,
    config: { style: 'concise_explanation', focus: ['cause_effect'], difficulties: ['advanced'] },
    avoid: [],
  })[0].content;
  assert.match(prompt, /explicação concisa/);
  assert.match(prompt, /não invente fatos, exemplos ou datas para alcançar a quantidade/);
  assert.match(prompt, /Retorne de 0 a 4 cartões/);
  const mock = await mockFlashcardCompletionV2({
    messages: buildFlashcardMessagesV2(TEXT, { count: 2, config: body().config, avoid: [] }),
  });
  assert.equal(mock.cards.length, 2);
});

test('flashcard sets over HTTP: preview, save, edit, review history, delete and account isolation', async (t) => {
  const fixture = createSupabaseHttpFixture(),
    nativeFetch = globalThis.fetch;
  Object.assign(process.env, {
    SUPABASE_URL: fixture.origin,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_sets_fixture',
    SUPABASE_SECRET_KEY: 'sets-fixture-server-key',
    FEATURE_FLASHCARDS: 'true',
    FEATURE_FLASHCARD_SETS: 'true',
    MOCK_EXTERNAL_SERVICES: 'true',
  });
  const { db } = await fixture.getDatabase();
  await migrateStudyAuthoring(db, { flashcards: true });
  for (const name of ['study_flashcards', 'study_flashcard_sets', 'study_flashcard_reviews'])
    fixture.state.tables[name] = [];
  // The fixture mirrors PGlite after RPCs; mirror once so the first read sees the confirmed revision.
  for (const name of Object.keys(fixture.state.tables))
    fixture.state.tables[name] = (await db.query('select * from public.' + name)).rows;
  globalThis.fetch = fixture.fetch;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload, user = 'a') => {
    const res = await fetch(origin + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: `Bearer ${identities[user].token}` } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const previewBody = {
      materialId: resourceIds.materialA,
      sourceRevisionId: revisionIds.a,
      count: 2,
      config: { difficulties: ['basic'], focus: ['facts'], style: 'question_answer' },
    };
    let preview;
    await t.test('preview requires ownership and a confirmed revision', async () => {
      assert.equal(
        (await request('/api/flashcards/preview', 'POST', previewBody, 'b')).status,
        404,
      );
      assert.equal(
        (await request('/api/flashcards/preview', 'POST', previewBody, null)).status,
        401,
      );
      preview = await request('/api/flashcards/preview', 'POST', previewBody);
      assert.equal(preview.status, 200);
      assert(preview.body.cards.length >= 1 && preview.body.cards.length <= 2);
      assert.equal(preview.body.promptVersion, 'flashcards-v2');
      assert.deepEqual(preview.body.cards[0].sourceSegments, [
        { position: 0, startMs: 0, endMs: 3000 },
      ]);
    });
    const setId = randomUUID();
    await t.test('named set is saved with its source and listed per lesson', async () => {
      const save = {
        id: setId,
        name: 'Energia — fatos',
        materialId: resourceIds.materialA,
        sourceRevisionId: revisionIds.a,
        config: previewBody.config,
        cards: preview.body.cards.map((c) => ({ ...c, back: c.back + ' (editado)' })),
      };
      assert.equal(
        (
          await request(
            '/api/flashcards/sets',
            'POST',
            { ...save, id: randomUUID(), materialId: resourceIds.materialA },
            'b',
          )
        ).status,
        404,
      );
      const created = await request('/api/flashcards/sets', 'POST', save);
      assert.equal(created.status, 201);
      assert.equal(created.body.added, preview.body.cards.length);
      const listed = await request('/api/flashcards/sets?materialId=' + resourceIds.materialA);
      assert.equal(listed.body.length, 1);
      assert.equal(listed.body[0].card_count, preview.body.cards.length);
      assert.equal((await request('/api/flashcards/sets', 'GET', null, 'b')).body.length, 0);
      const full = await request('/api/flashcards/sets/' + setId);
      assert.equal(full.body.cards[0].source_revision_id, revisionIds.a);
      assert.match(full.body.cards[0].back_text, /\(editado\)$/);
      assert(full.body.cards[0].evidence);
      assert.equal((await request('/api/flashcards/sets/' + setId, 'GET', null, 'b')).status, 404);
    });
    await t.test('manual and additional cards, editing, review history and deletes', async () => {
      const manual = { cards: [{ front: 'Pergunta manual?', back: 'Resposta manual.' }] };
      assert.equal(
        (await request(`/api/flashcards/sets/${setId}/cards`, 'POST', manual, 'b')).status,
        404,
      );
      assert.equal(
        (await request(`/api/flashcards/sets/${setId}/cards`, 'POST', manual)).body.added,
        1,
      );
      assert.equal(
        (await request(`/api/flashcards/sets/${setId}/cards`, 'POST', manual)).body.added,
        0,
        'duplicate front skipped',
      );
      const cards = (await request('/api/flashcards/sets/' + setId)).body.cards;
      const target = cards.find((c) => c.front_text === 'Pergunta manual?');
      assert.equal(
        (await request('/api/flashcards/' + target.id, 'PATCH', { back: 'Resposta corrigida.' }))
          .body.back_text,
        'Resposta corrigida.',
      );
      const reviewed = await request(`/api/flashcards/${target.id}/reviews`, 'POST', {
        rating: 2,
        requestId: randomUUID(),
      });
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.body.intervalDays, 1);
      assert.equal((await request(`/api/flashcards/${target.id}/reviews`)).body.length, 1);
      assert.equal(
        (await request(`/api/flashcards/${target.id}/reviews`, 'GET', null, 'b')).status,
        404,
      );
      const renamed = await request('/api/flashcards/sets/' + setId, 'PATCH', {
        name: 'Energia — revisão',
        archived: true,
      });
      assert.equal(renamed.body.name, 'Energia — revisão');
      assert.equal(renamed.body.status, 'archived');
      assert.equal(
        (await request('/api/flashcards/sets/' + setId, 'PATCH', { name: 'X' }, 'b')).status,
        404,
      );
      assert.equal(
        (await request('/api/flashcards/' + target.id, 'DELETE', null, 'b')).status,
        404,
      );
      assert.equal((await request('/api/flashcards/' + target.id, 'DELETE')).status, 200);
      assert.equal(
        (await request('/api/flashcards/sets/' + setId, 'DELETE', null, 'b')).status,
        404,
      );
      const removed = await request('/api/flashcards/sets/' + setId, 'DELETE');
      assert.equal(removed.status, 200);
      assert.equal((await request('/api/flashcards/sets/' + setId)).status, 404);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
    globalThis.fetch = nativeFetch;
  }
});
