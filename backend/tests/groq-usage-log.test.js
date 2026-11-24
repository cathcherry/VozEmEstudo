import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroqProvider } from '../src/integrations/llm/groq.client.js';

test('every real Groq call logs tokens and latency, never the prompt or the output', async () => {
  const events = [];
  const provider = createGroqProvider({
    apiKey: 'test-key',
    log: { info: (event, data) => events.push({ event, data }) },
    createClient: () => ({
      chat: {
        completions: {
          create: async () => ({
            model: 'openai/gpt-oss-120b',
            usage: { prompt_tokens: 812, completion_tokens: 240, total_tokens: 1052 },
            choices: [{ finish_reason: 'stop', message: { content: '{"questions":[]}' } }],
          }),
        },
      },
    }),
  });
  const out = await provider.completeJson({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'segredo da aula' }] });
  assert.deepEqual(out.data, { questions: [] });
  assert.equal(events.length, 1);
  const { event, data } = events[0];
  assert.equal(event, 'LLM_USAGE');
  assert.equal(data.promptTokens, 812);
  assert.equal(data.completionTokens, 240);
  assert.equal(data.totalTokens, 1052);
  assert.equal(data.finishReason, 'stop');
  assert.ok(Number.isInteger(data.latencyMs));
  assert.doesNotMatch(JSON.stringify(data), /segredo|questions/);
});

test('gpt-oss gets reasoning_effort; json_validate_failed becomes a repairable invalid output', async () => {
  const sent = [];
  const events = [];
  const failing = Object.assign(new Error('400'), { status: 400, error: { error: { code: 'json_validate_failed' } } });
  const provider = createGroqProvider({
    apiKey: 'k',
    reasoningEffort: 'low',
    log: { info: (event, data) => events.push({ event, data }) },
    createClient: () => ({ chat: { completions: { create: async (body) => { sent.push(body); throw failing; } } } }),
  });
  await assert.rejects(provider.completeJson({ model: 'openai/gpt-oss-120b', messages: [] }), (e) => e.code === 'LLM_INVALID_OUTPUT' && e.retryable === true);
  assert.equal(sent[0].reasoning_effort, 'low');
  assert.equal(events[0].event, 'LLM_CALL_FAILED');
  assert.equal(events[0].data.providerCode, 'json_validate_failed');
  await assert.rejects(provider.completeJson({ model: 'llama-x', messages: [] }));
  assert.equal(sent[1].reasoning_effort, undefined, 'non-reasoning models get no reasoning_effort');
});

test('question prompts ask for exam-style statements that never mention the transcript', async () => {
  const { buildPlannedQuestionMessages, QUESTIONS_V2_PROMPT_VERSION } = await import('../src/prompts/questions.v2.js');
  const { MULTI_LESSON_PROMPT_VERSION } = await import('../src/prompts/multi-lesson.v1.js');
  const system = buildPlannedQuestionMessages([{ position: 0, text: 'x' }], { slots: [{ id: 's1', skill: 'recall', difficulty: 'easy', concept: { label: 'fotossíntese', evidence: null } }] })[0].content;
  assert.match(system, /nunca mencione "a transcrição"/);
  assert.equal(QUESTIONS_V2_PROMPT_VERSION, 'questions-v2.5', 'a new prompt version invalidates reuse of older lists');
  assert.equal(MULTI_LESSON_PROMPT_VERSION, 'multi-lesson-v3');
});

test('explanations are asked to be direct, without citing the source in every sentence', async () => {
  const { buildPlannedQuestionMessages } = await import('../src/prompts/questions.v2.js');
  const { buildQuestionMessages } = await import('../src/prompts/questions.v1.js');
  const { buildSynthesisMessages } = await import('../src/prompts/multi-lesson.v1.js');
  const v2 = buildPlannedQuestionMessages([{ position: 0, text: 'x' }], { slots: [{ id: 's1', skill: 'recall', difficulty: 'basic', concept: { label: 'fotossíntese', evidence: null } }] })[0].content;
  const v1 = buildQuestionMessages('x', 3)[0].content;
  const multi = buildSynthesisMessages({ lessons: [], outputs: ['questions'] })[0].content;
  for (const system of [v2, v1, multi]) {
    assert.match(system, /direta e natural/);
    assert.match(system, /"a transcrição afirma"/, 'the repeated opening is named as something to avoid');
  }
  // Still grounded: the excerpt that supports the answer is still requested and shown apart.
  assert.match(v2, /Copie em evidence a frase da transcrição/);
  assert.match(v2, /explicação breve sustentada pela aula/);
  assert.match(v2, /já é mostrado ao aluno separadamente/);
  assert.match(v1, /sustentada exclusivamente pela transcrição/);
});
