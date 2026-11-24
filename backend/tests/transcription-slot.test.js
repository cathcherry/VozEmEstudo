import test from 'node:test';
import assert from 'node:assert/strict';

// Global cap on simultaneous provider transcriptions (public_testing_config.global_limits
// .concurrent_transcriptions): counted from ai_job_executions in submitting/processing.
test('transcription slot honours the global concurrency cap', async () => {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://slot.fixture.invalid',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_slot',
    SUPABASE_SECRET_KEY: 'slot-fixture-server-key',
    FEATURE_PUBLIC_TESTING: 'true',
  });
  const state = { config: { enabled: true, global_limits: { concurrent_transcriptions: 2 } }, running: 0, filters: [] };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = new Headers(init.headers);
    if (url.pathname.endsWith('/public_testing_config')) {
      const wantsObject = (headers.get('accept') || '').includes('vnd.pgrst.object');
      return new Response(JSON.stringify(wantsObject ? state.config : [state.config]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/ai_job_executions')) {
      state.filters.push(url.search);
      return new Response(null, { status: 200, headers: { 'content-range': `*/${state.running}` } });
    }
    throw new Error('unexpected ' + url);
  };
  try {
    const { transcriptionSlotAvailable } = await import('../src/services/testing.service.js');
    assert.equal(await transcriptionSlotAvailable(), true);
    state.running = 1;
    assert.equal(await transcriptionSlotAvailable(), true);
    state.running = 2;
    assert.equal(await transcriptionSlotAvailable(), false, 'cap reached: wait');
    assert.match(decodeURIComponent(state.filters.at(-1)), /task=eq\.transcription/);
    assert.match(decodeURIComponent(state.filters.at(-1)), /state=in\.\(submitting,processing\)/);
    state.config = { enabled: true, global_limits: { concurrent_transcriptions: 0 } };
    state.running = 0;
    assert.equal(await transcriptionSlotAvailable(), false, '0 pauses new transcriptions');
    state.config = { enabled: true, global_limits: {} };
    assert.equal(await transcriptionSlotAvailable(), true, 'no cap configured');
    state.config = { enabled: false, global_limits: { concurrent_transcriptions: 0 } };
    assert.equal(await transcriptionSlotAvailable(), true, 'program off: no cap');
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
