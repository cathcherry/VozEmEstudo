import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generationKey,
  generationIdentity,
  createSingleFlight,
} from '../src/domain/generation-key.js';

const base = {
  scope: 'classroom:c1',
  sources: ['rev-b', 'rev-a'],
  kind: 'questions',
  settings: {
    count: 5,
    skills: ['application', 'analysis'],
    difficulties: ['intermediate', 'advanced'],
  },
  promptVersion: 'questions-v2.2',
};

test('equivalent requests share a key; order of sources and set-like settings does not matter', () => {
  const same = {
    ...base,
    sources: ['rev-a', 'rev-b'],
    settings: {
      difficulties: ['advanced', 'intermediate'],
      skills: ['analysis', 'application'],
      count: 5,
    },
  };
  assert.equal(generationKey(base), generationKey(same));
});

test('appearance, interface and request data never change the key', () => {
  const styled = {
    ...base,
    settings: {
      ...base.settings,
      cardTemplate: 'polaroid',
      theme: 'matcha',
      language: 'en',
      requestId: 'r1',
    },
  };
  assert.equal(generationKey(base), generationKey(styled));
  assert.deepEqual(Object.keys(generationIdentity(styled).settings).sort(), [
    'count',
    'difficulties',
    'skills',
  ]);
});

test('content settings, sources, scope, kind and prompt version do change it', () => {
  const key = generationKey(base);
  for (const changed of [
    { ...base, settings: { ...base.settings, count: 6 } },
    { ...base, settings: { ...base.settings, topicFocus: 'solos' } },
    { ...base, sources: ['rev-a', 'rev-c'] },
    { ...base, scope: 'user:u1' },
    { ...base, kind: 'flashcards' },
    { ...base, promptVersion: 'questions-v2.3' },
  ])
    assert.notEqual(generationKey(changed), key);
  assert.throws(() => generationKey({ ...base, sources: [] }), TypeError);
  assert.throws(() => generationKey({ ...base, kind: 'poems' }), TypeError);
});

test('single flight: simultaneous equivalent requests run one task', async () => {
  const run = createSingleFlight();
  let calls = 0;
  const task = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { jobId: 'j1' };
  };
  const [a, b] = await Promise.all([run('k', task), run('k', task)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  await run('k', task);
  assert.equal(calls, 2, 'a later request runs again (the persistent reuse rule decides that)');
});
