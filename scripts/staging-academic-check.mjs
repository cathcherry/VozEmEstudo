import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  syntheticWave,
  validateStagingSettings,
  validateStagingConfig,
} from './staging-settings.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runStagingChecks(source = process.env, request = fetch) {
  // Validate before any login, network request or file write.
  const settings = validateStagingSettings(source);
  let fixtureExists = true;
  try {
    await access(settings.fixtureFile);
  } catch (error) {
    assert.equal(error.code, 'ENOENT');
    fixtureExists = false;
  }
  assert.equal(fixtureExists, false, 'Use a new private handoff filename before creating fixtures');
  const results = [];
  const record = (check) => results.push({ check, passed: true });
  async function send(base, route, { token, method = 'GET', body, headers = {} } = {}) {
    const url = new URL(route, base);
    assert.equal(url.origin, new URL(base).origin);
    const response = await request(url, {
      method,
      headers: {
        ...(base === settings.supabaseUrl ? { apikey: settings.publicKey } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: response.status, data };
  }
  const api = (route, options) => send(settings.apiUrl, route, options);
  const supabase = (route, options) => send(settings.supabaseUrl, route, options);
  async function waitJob(account, jobId) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const probe = await api(`/api/jobs/${jobId}`, { token: account.token });
      assert.equal(probe.status, 200);
      if (probe.data.status === 'CONCLUIDA') return;
      assert.notEqual(probe.data.status, 'FALHOU');
      await delay(500);
    }
    assert.fail('Mock worker did not finish the synthetic job');
  }
  const config = await api('/api/config');
  assert.equal(config.status, 200);
  validateStagingConfig(settings, config.data);
  record('approved-staging-config-and-flags-off');
  const accounts = [];
  for (const account of settings.accounts) {
    const login = await supabase('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: account.email, password: account.password },
    });
    assert.equal(login.status, 200);
    assert(login.data.access_token && login.data.user?.id);
    const user = await supabase('/auth/v1/user', { token: login.data.access_token });
    assert.equal(user.status, 200);
    assert.equal(user.data.id, login.data.user.id);
    accounts.push({ label: account.label, id: user.data.id, token: login.data.access_token });
  }
  assert.notEqual(accounts[0].id, accounts[1].id);
  record('two-distinct-real-auth-sessions');
  for (const token of [undefined, 'invalid-e02-fixture-token']) {
    const denied = await api('/api/materials', { token });
    assert.equal(denied.status, 401);
    assert(denied.data.requestId && denied.data.error?.code);
  }
  record('missing-and-invalid-bearer-rejected');
  const wave = syntheticWave();
  const fixtures = [];
  for (const account of accounts) {
    const materialId = randomUUID();
    const storagePath = `temp/${account.id}/${materialId}/e02-fixture.wav`;
    const body = {
      id: materialId,
      title: `E02 staging / ${account.label}`,
      subject: 'Disciplina fictícia',
      originalFilename: 'e02-fixture.wav',
      mimeType: 'audio/wav',
      extension: 'wav',
      sizeBytes: wave.length,
      durationMs: 1000,
      questionCount: 3,
      retainAudio: account.label === 'A',
      storagePath,
      permissionVersion: config.data.permissionDeclaration.version,
    };
    const bypass = await api('/api/materials', { token: account.token, method: 'POST', body });
    assert.equal(bypass.status, 422);
    assert.equal(bypass.data.error.code, 'PERMISSION_REQUIRED');
    const outdated = await api('/api/materials', {
      token: account.token,
      method: 'POST',
      body: { ...body, permissionAccepted: true, permissionVersion: 'outdated-test' },
    });
    assert.equal(outdated.status, 409);
    assert.equal(outdated.data.error.code, 'PERMISSION_RECONFIRMATION_REQUIRED');
    const upload = await supabase(`/storage/v1/object/audios/${storagePath}`, {
      token: account.token,
      method: 'POST',
      body: wave,
      headers: { 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
    });
    assert.equal(upload.status, 200);
    const creates = await Promise.all(
      [1, 2].map(() =>
        api('/api/materials', {
          token: account.token,
          method: 'POST',
          body: { ...body, permissionAccepted: true },
        }),
      ),
    );
    assert(creates.every((result) => result.status === 201 && result.data.id === materialId));
    const job = await api(`/api/materials/${materialId}/process`, {
      token: account.token,
      method: 'POST',
      body: {},
    });
    assert.equal(job.status, 202);
    await waitJob(account, job.data.jobId);
    const material = await api(`/api/materials/${materialId}`, { token: account.token });
    assert.equal(material.status, 200);
    assert.equal(material.data.review.state, 'awaiting_review');
    assert.equal(material.data.summaries.length, 0);
    assert.equal(material.data.questionBatches.length, 0);
    const sourceRevisionId = material.data.review.sourceRevisionId;
    const unconfirmed = await api(`/api/materials/${materialId}/summaries`, {
      token: account.token,
      method: 'POST',
      body: { sourceRevisionId, idempotencyKey: randomUUID() },
    });
    assert.equal(unconfirmed.status, 409);
    assert.equal(unconfirmed.data.error.code, 'TRANSCRIPTION_CONFIRMATION_REQUIRED');
    const confirmations = await Promise.all(
      [1, 2].map(() =>
        api(`/api/materials/${materialId}/transcription/confirm`, {
          token: account.token,
          method: 'POST',
          body: { sourceRevisionId },
        }),
      ),
    );
    assert(confirmations.every((result) => result.status === 200));
    assert(confirmations[0].data.confirmation?.id);
    assert.equal(confirmations[0].data.state, 'ready_to_generate');
    assert.equal(confirmations[0].data.confirmation.id, confirmations[1].data.confirmation.id);
    const warnings = await api(`/api/materials/${materialId}/transcription/warnings`, {
      token: account.token,
      method: 'POST',
      body: { sourceRevisionId, idempotencyKey: randomUUID() },
    });
    assert.equal(warnings.status, 200);
    assert.equal(warnings.data.length, 3);
    assert(warnings.data.every((warning) => warning.sourceRevisionId === sourceRevisionId));
    const questionJob = await api(`/api/materials/${materialId}/question-batches`, {
      token: account.token,
      method: 'POST',
      body: { count: 3, sourceRevisionId, idempotencyKey: randomUUID() },
    });
    assert.equal(questionJob.status, 202);
    await waitJob(account, questionJob.data.jobId);
    const batches = await api(`/api/materials/${materialId}/question-batches`, {
      token: account.token,
    });
    assert.equal(batches.status, 200);
    assert.equal(batches.data[0].questions.length, 3);
    assert(
      batches.data[0].questions.every(
        (question) =>
          !Object.hasOwn(question, 'correct_index') && !Object.hasOwn(question, 'explanation'),
      ),
    );
    const questionId = batches.data[0].questions[0].id;
    if (account.label === 'B') {
      assert.equal(material.data.signedAudioUrl, null);
      assert(material.data.transcription.current_text);
      const removed = await supabase(`/storage/v1/object/authenticated/audios/${storagePath}`, {
        token: account.token,
      });
      assert(removed.status >= 400 && removed.status < 500);
    }
    fixtures.push({
      ...account,
      materialId,
      jobId: job.data.jobId,
      sourceRevisionId,
      questionId,
      material: material.data,
    });
  }
  record('permission-version-and-create-idempotency');
  record('asr-awaits-review-without-automatic-generation');
  record('confirmation-warning-traceability-and-retention-off-cleanup');
  for (const owner of fixtures) {
    const other = fixtures.find((fixture) => fixture.id !== owner.id);
    const root = `/api/materials/${owner.materialId}`;
    for (const [route, method, body] of [
      [root, 'GET'],
      [root, 'PATCH', { title: 'E02 staging / cross-account probe' }],
      [root, 'DELETE'],
      [root + '/transcription/review', 'GET'],
      [root + '/transcription/versions', 'GET'],
      [
        root + '/permission',
        'POST',
        { permissionAccepted: true, permissionVersion: config.data.permissionDeclaration.version },
      ],
      [root + '/transcription/confirm', 'POST', { sourceRevisionId: owner.sourceRevisionId }],
      [root + '/transcription/warnings', 'POST', { sourceRevisionId: owner.sourceRevisionId }],
      [root + '/summaries', 'POST', { sourceRevisionId: owner.sourceRevisionId }],
      [root + '/question-batches', 'POST', { count: 3, sourceRevisionId: owner.sourceRevisionId }],
      [`/api/jobs/${owner.jobId}`, 'GET'],
      [`/api/jobs/${owner.jobId}/events`, 'GET'],
      [`/api/questions/${owner.questionId}/answer`, 'POST', { selectedIndex: 0 }],
    ]) {
      const response = await api(route, { token: other.token, method, body });
      assert.equal(response.status, 404);
      assert(response.data.requestId && response.data.error?.code === 'NOT_FOUND');
    }
    for (const table of [
      'material_permissions',
      'transcription_confirmations',
      'content_warnings',
    ]) {
      const select = `select=id&material_id=eq.${owner.materialId}`;
      const own = await supabase(`/rest/v1/${table}?${select}`, { token: owner.token });
      // A 403 on the own row is not counted as a passing RLS test.
      assert.equal(own.status, 200);
      assert(own.data.length > 0);
      const foreign = await supabase(`/rest/v1/${table}?${select}`, { token: other.token });
      assert.equal(foreign.status, 200);
      assert.equal(foreign.data.length, 0);
      const anonymous = await supabase(`/rest/v1/${table}?${select}`);
      assert(anonymous.status >= 400 && anonymous.status < 500);
    }
    const rpcDenied = await supabase('/rest/v1/rpc/confirm_transcription_admin', {
      token: other.token,
      method: 'POST',
      body: {
        p_user_id: owner.id,
        p_material_id: owner.materialId,
        p_source_version_id: owner.sourceRevisionId,
        p_permission_version: config.data.permissionDeclaration.version,
      },
    });
    assert([401, 403, 404].includes(rpcDenied.status));
  }
  record('both-directions-api-ownership-and-real-rls');
  record('anonymous-reads-and-server-rpc-denied');
  const a = fixtures[0],
    b = fixtures[1];
  const objectPath = a.material.audio.storage_path;
  assert(objectPath.startsWith(`retained/${a.id}/${a.materialId}/`));
  const signRoute = `/storage/v1/object/sign/audios/${objectPath}`;
  const foreignSign = await supabase(signRoute, {
    token: b.token,
    method: 'POST',
    body: { expiresIn: 10 },
  });
  assert(foreignSign.status >= 400 && foreignSign.status < 500);
  const direct = await supabase(`/storage/v1/object/public/audios/${objectPath}`);
  assert(direct.status >= 400 && direct.status < 500);
  const sign = async () => {
    const response = await supabase(signRoute, {
      token: a.token,
      method: 'POST',
      body: { expiresIn: 10 },
    });
    assert.equal(response.status, 200);
    const url = new URL('/storage/v1' + response.data.signedURL, settings.supabaseUrl);
    assert.equal(url.origin, settings.supabaseUrl);
    url.searchParams.set('cacheNonce', randomUUID());
    return url;
  };
  const live = await request(await sign(), {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  assert.equal(live.status, 200);
  await live.body?.cancel();
  const coldUrl = await sign();
  await delay(12000);
  const expired = await request(coldUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  assert(expired.status >= 400 && expired.status < 500);
  const expiredBody = await expired.json();
  assert(
    /expired|InvalidJWT/i.test(
      `${expiredBody.error || ''} ${expiredBody.message || ''} ${expiredBody.code || ''}`,
    ),
  );
  record('private-storage-foreign-signature-and-cold-url-expiration');
  const key = randomUUID();
  const queued = await Promise.all(
    [1, 2].map(() =>
      api(`/api/materials/${a.materialId}/summaries`, {
        token: a.token,
        method: 'POST',
        body: { sourceRevisionId: a.sourceRevisionId, idempotencyKey: key },
      }),
    ),
  );
  assert(queued.every((result) => result.status === 202));
  assert.equal(queued[0].data.jobId, queued[1].data.jobId);
  await waitJob(a, queued[0].data.jobId);
  record('parallel-http-enqueue-same-key');
  const manifest = {
    projectRef: settings.projectRef,
    syntheticOnly: true,
    createdAt: new Date().toISOString(),
    permissionVersion: config.data.permissionDeclaration.version,
    fixtures: fixtures.map(({ label, id, materialId, sourceRevisionId }) => ({
      label,
      userId: id,
      materialId,
      sourceRevisionId,
    })),
    results,
  };
  // No passwords, JWTs, URLs or source text in the handoff file.
  await writeFile(settings.fixtureFile, JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    executed: true,
    passed: true,
    checks: results,
    fixtureAccounts: 2,
    remoteWrites: true,
    providers: 'mock; Auth/PostgREST/Storage real',
    nativeConcurrency: 'separate gated script',
    pending: [
      'worker races and injected failures',
      'all legacy RLS/grants',
      '600-second player renewal',
      'restore',
      'manual accessibility',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runStagingChecks()));
  } catch {
    console.error(
      'Staging suite blocked or failed. No credentials, URLs, source text or response bodies were logged. Synthetic fixtures may remain; inspect them before another run.',
    );
    process.exitCode = 1;
  }
}
