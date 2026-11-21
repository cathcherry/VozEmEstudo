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
