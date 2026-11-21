import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSupabaseHttpFixture } from './fixtures/supabase-http.fixture.js';
import { identities } from './fixtures/ownership.fixture.js';
import { addLesson, addSubject, migrateMultiLesson } from './fixtures/multi-lesson-db.fixture.js';

// Service + worker against the real SQL (PGlite behind the Supabase HTTP fixture) with a FAKE text
// provider: no request leaves the process, every provider call is counted.
Object.assign(process.env, {
  SUPABASE_URL: 'http://supabase.e00.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_multi_lesson_fixture',
  SUPABASE_SECRET_KEY: 'multi-lesson-fixture-server-key',
  FEATURE_MULTI_LESSON: 'true',
  FEATURE_CATALOG_UNITS: 'true',
  MOCK_EXTERNAL_SERVICES: 'false',
  AI_DAILY_GENERATION_LIMIT: '20',
  JOB_RETRY_DELAY_1_MS: '1000',
  JOB_RETRY_DELAY_2_MS: '1000',
});
const { AppError } = await import('../src/domain/errors.js');
const { createProviderRegistry, setAiRegistry } = await import('../src/ai/provider-registry.js');
const { createAiConfig } = await import('../src/ai/provider-config.js');
const { buildMultiLessonService } = await import('../src/services/multi-lesson.service.js');
const { runNextMultiLessonJob, resetMultiLessonRunner } = await import('../src/jobs/multi-lesson-runner.js');

const a = { id: identities.a.id };
const LESSONS = {
  'Ondas 1': [
    'A onda mecânica transporta energia sem transportar matéria de um lugar para outro.',
    'O comprimento de onda é a distância entre duas cristas consecutivas da onda.',
  ],
  'Ondas 2': [
    'A frequência indica quantas oscilações completas acontecem a cada segundo no meio.',
    'Quando a frequência aumenta e a velocidade se mantém, o comprimento de onda diminui.',
  ],
};

/** A provider that behaves like a model: valid maps (plus one invented concept) and a synthesis. */
function fakeProvider() {
  const state = { calls: [], fail: null, badSynthesis: 0 };
  const segmentsOf = (content) =>
    [...String(content).matchAll(/^\[(\d+)\] (.+)$/gm)].map((m) => ({ position: Number(m[1]), text: m[2] }));
  const provider = {
    name: 'groq',
    async completeText() {
      throw new Error('not used');
    },
    async completeJson({ messages, model }) {
      const system = messages[0].content;
      const kind = system.includes('VÁRIAS') ? (messages.length > 2 ? 'repair' : 'synthesis') : 'map';
      state.calls.push(kind);
      if (state.fail) throw state.fail;
      if (kind === 'map') {
        const segments = segmentsOf(messages[1].content);
        return {
          model,
          data: {
            concepts: [
              ...segments.map((segment) => ({
                name: segment.text.split(' ').slice(1, 4).join(' '),
                definition: segment.text,
                evidence: [{ position: segment.position, quote: segment.text.slice(0, 60) }],
              })),
              // Invented: its quote is not in the lesson, so the server drops it.
              { name: 'Buraco negro', definition: 'Inventado.', evidence: [{ position: 0, quote: 'buracos negros evaporam lentamente por radiação de Hawking quântica' }] },
            ],
            relations: [],
          },
        };
      }
      if (kind === 'synthesis' && state.badSynthesis > 0) {
        state.badSynthesis -= 1;
        return { model, data: { summary: 'texto solto' } };
      }
      const lessons = JSON.parse(messages[1].content);
      const cite = (lesson, i = 0) => {
        const e = lesson.map.concepts[i].evidence[0];
        return { lesson: lesson.lesson, position: e.position, quote: e.quote };
      };
      return {
        model,
        data: {
          summary: {
            sections: [
              { heading: 'Energia e ondas', text: 'As duas aulas se completam.', citations: [cite(lessons[0]), cite(lessons[1], 1)] },
              { heading: 'Sem apoio', text: 'Seção sem citação válida.', citations: [{ lesson: 'A9', position: 0, quote: 'nada disso foi dito' }] },
            ],
          },
          questions: [
            { statement: 'O que a onda mecânica transporta?', options: ['Energia', 'Matéria', 'Carga', 'Massa'], correctIndex: 0, explanation: 'Aula 1.', citations: [cite(lessons[0])] },
            { statement: 'Questão inventada sem trecho?', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: '', citations: [{ lesson: 'A1', position: 0, quote: 'texto que não existe em nenhuma das aulas citadas' }] },
          ],
        },
      };
    },
  };
  return { provider, state };
}

async function setup({ cache = true } = {}) {
  const f = createSupabaseHttpFixture();
  const database = await f.getDatabase();
  await migrateMultiLesson(database, { cache });
  const subject = await addSubject(database, identities.a, 'Física Ondulatória', ['Ondas']);
  const lessons = [];
  for (const [title, segments] of Object.entries(LESSONS))
    lessons.push(await addLesson(database, identities.a, { title, segments, subjectId: subject.subjectId, unitId: subject.unitIds[0] }));
  const fake = fakeProvider();
  setAiRegistry(
    createProviderRegistry({
      config: createAiConfig({ GROQ_API_KEY: 'fixture', LLM_SUMMARY_MODEL: 'fixture-model' }),
      factories: { text: { groq: () => fake.provider }, transcription: {} },
      mock: false,
    }),
  );
  globalThis.fetch = f.fetch;
  resetMultiLessonRunner();
  const service = buildMultiLessonService();
  const request = (extra = {}) =>
    service.create(a, {
      id: randomUUID(),
      requestId: randomUUID(),
      title: 'Unidade Ondas',
      selection: { kind: 'unit', ids: [subject.unitIds[0]] },
      outputs: ['summary', 'questions'],
      settings: { questionCount: 4 },
      ...extra,
    });
  const run = () => runNextMultiLessonJob('worker-test');
  return { f, database, db: database.db, subject, lessons, fake, service, request, run };
}

test('worker: bounded calls, unsupported items dropped and reported, cache hit skips the map call, success completes the key', async () => {
  const native = globalThis.fetch;
  const t = await setup();
  try {
    const created = await t.request();
    assert.equal(created.generation.decision, 'start');
    assert.equal(created.multiLesson.status, 'queued');
    assert.equal(await t.run(), true);
    assert.deepEqual(t.fake.state.calls, ['map', 'map', 'synthesis'], 'one map per revision + one synthesis');
    const ready = await t.service.get(a, created.multiLesson.id);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.model, 'fixture-model');
    const { result } = ready;
    assert.equal(result.summary.sections.length, 1, 'the uncited section was dropped');
    assert.equal(result.questions.length, 1, 'the unsupported question was dropped');
    assert.equal(result.report.droppedSections, 1);
    assert.equal(result.report.droppedQuestions, 1);
    assert(result.report.droppedCitations >= 2);
    assert.equal(result.report.droppedMapItems, 2, 'the invented concept of each map was dropped');
    // Each citation points to a specific lesson, revision and segment of the frozen snapshot.
    const [first, second] = result.summary.sections[0].citations;
    assert.equal(first.materialId, t.lessons[0].id);
    assert.equal(first.revisionId, t.lessons[0].revisionId);
    assert.equal(first.position, 0);
    assert.equal(second.materialId, t.lessons[1].id);
    assert.equal(second.position, 1);
    assert.match(LESSONS['Ondas 2'][1], new RegExp(second.quote.slice(0, 20)));
    const gen = (await t.db.query('select status, result from public.ai_generations where id=$1', [created.generation.id])).rows[0];
    assert.deepEqual(gen, { status: 'ready', result: { multiLessonId: created.multiLesson.id } });
    const maps = (await t.db.query('select count(*)::int as n from public.knowledge_maps')).rows[0].n;
    assert.equal(maps, 2);

    // A different request over the same revisions reuses both cached maps: synthesis only.
    t.fake.state.calls.length = 0;
    const other = await t.request({ outputs: ['summary'] });
    assert.equal(other.generation.decision, 'start', 'different content, different key');
    await t.run();
    assert.deepEqual(t.fake.state.calls, ['synthesis']);
    const cached = await t.service.get(a, other.multiLesson.id);
    assert.equal(cached.result.report.cacheHits, 2);
    assert.equal(cached.result.report.mapCalls, 0);

    // A malformed synthesis gets exactly one repair call.
    t.fake.state.calls.length = 0;
    t.fake.state.badSynthesis = 1;
    const repaired = await t.request({ outputs: ['questions'] });
    await t.run();
    assert.deepEqual(t.fake.state.calls, ['synthesis', 'repair']);
    const fixed = await t.service.get(a, repaired.multiLesson.id);
    assert.equal(fixed.status, 'ready');
    assert.equal(fixed.result.report.repaired, true);
    // Nothing left to do.
    assert.equal(await t.run(), false);
  } finally {
    globalThis.fetch = native;
    await t.f.close();
  }
});

test('worker: retryable provider failure retries with backoff, final failure frees the key; works without the cache table', async () => {
  const native = globalThis.fetch;
  const t = await setup({ cache: false });
  try {
    const created = await t.request();
    t.fake.state.fail = new AppError('LLM_TEMPORARY_ERROR', 'Indisponível.', 502, { retryable: true });
    await t.run();
    let job = (await t.db.query('select status, attempt_count, next_attempt_at from public.multi_lesson_jobs')).rows[0];
    assert.equal(job.status, 'retry');
    assert(new Date(job.next_attempt_at) > new Date(), 'backoff in the future');
    assert.equal(await t.run(), false, 'not due yet');
    await t.db.query("update public.multi_lesson_jobs set next_attempt_at = now() - interval '1 second'");
    await t.run();
    job = (await t.db.query('select status, attempt_count, error_code from public.multi_lesson_jobs')).rows[0];
    assert.deepEqual(job, { status: 'failed', attempt_count: 2, error_code: 'LLM_TEMPORARY_ERROR' });
    const failed = await t.service.get(a, created.multiLesson.id);
    assert.equal(failed.status, 'failed');
    const gen = (await t.db.query('select status from public.ai_generations where id=$1', [created.generation.id])).rows[0];
    assert.equal(gen.status, 'failed', 'key released');
    // Cost stayed bounded: one map call per attempt before failing (it failed on the first call).
    assert.deepEqual(t.fake.state.calls, ['map', 'map']);

    // The next equivalent request starts again and, without the cache table, still works.
    t.fake.state.fail = null;
    t.fake.state.calls.length = 0;
    const again = await t.request();
    assert.equal(again.generation.decision, 'start');
    await t.run();
    assert.deepEqual(t.fake.state.calls, ['map', 'map', 'synthesis']);
    assert.equal((await t.service.get(a, again.multiLesson.id)).status, 'ready');
    // A non-retryable failure is final at once.
    t.fake.state.fail = new AppError('LLM_FAILED', 'Recusado.', 502);
    const third = await t.request({ outputs: ['questions'] });
    await t.run();
    assert.equal((await t.service.get(a, third.multiLesson.id)).status, 'failed');
  } finally {
    globalThis.fetch = native;
    await t.f.close();
  }
});
