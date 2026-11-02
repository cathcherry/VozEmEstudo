import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeStoragePath } from '../backend/src/validators/storage-path.validator.js';

export function validateRemoteSettings(source) {
  assert.equal(
    source.E01_REMOTE_READS_APPROVED,
    'true',
    'Explicit staging read authorization is required',
  );
  const projectRef = source.E01_STAGING_PROJECT_REF;
  assert.match(projectRef || '', /^[a-z0-9]{20}$/);
  assert.notEqual(
    projectRef,
    'fxsuagrcfargpejglwtl',
    'The audited existing project is not an authorized test staging',
  );
  const apiUrl = new URL(source.E01_API_URL);
  assert.equal(apiUrl.protocol, 'https:');
  assert.equal(apiUrl.username + apiUrl.password + apiUrl.search + apiUrl.hash, '');
  const publicKey = source.E01_PUBLISHABLE_KEY || '';
  const anonymousJwt =
    publicKey.startsWith('eyJ') &&
    JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role === 'anon';
  assert(
    publicKey.startsWith('sb_publishable_') || anonymousJwt,
    'A public key is required; never use service_role',
  );
  for (const name of ['E01_USER_A_TOKEN', 'E01_USER_B_TOKEN', 'E01_MATERIAL_A_ID', 'E01_JOB_A_ID'])
    assert(source[name], `Missing ${name}`);
  assert.notEqual(source.E01_USER_A_TOKEN, source.E01_USER_B_TOKEN);
  for (const name of ['E01_MATERIAL_A_ID', 'E01_JOB_A_ID'])
    assert.match(source[name], /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  return {
    apiUrl: apiUrl.href.replace(/\/$/, ''),
    projectRef,
    supabaseUrl: `https://${projectRef}.supabase.co`,
    publicKey,
  };
}

async function run() {
  const settings = validateRemoteSettings(process.env);
  const request = (url, options = {}) =>
    fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const configResponse = await request(`${settings.apiUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.supabaseUrl.replace(/\/$/, ''), settings.supabaseUrl);
  assert.equal(config.supabasePublishableKey, settings.publicKey);
  const results = [];
  const materialRoute = `/api/materials/${process.env.E01_MATERIAL_A_ID}`;
  const jobRoute = `/api/jobs/${process.env.E01_JOB_A_ID}`;
  let material;
  for (const [route, token, expected] of [
    [materialRoute, process.env.E01_USER_A_TOKEN, 200],
    [materialRoute, process.env.E01_USER_B_TOKEN, 404],
    [jobRoute, process.env.E01_USER_B_TOKEN, 404],
  ]) {
    const response = await request(settings.apiUrl + route, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, expected);
    if (expected === 200) material = await response.json();
    results.push({
      check: route.startsWith('/api/jobs')
        ? 'foreign-job'
        : expected === 200
          ? 'owned-material'
          : 'foreign-material',
      status: response.status,
    });
  }
  assert(material.audio?.retain_original, 'Use an authorized synthetic retained audio fixture');
  const storagePath = assertSafeStoragePath(material.audio.storage_path);
  assert(storagePath.includes(`/${process.env.E01_MATERIAL_A_ID}/`));
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const signUrl = `${settings.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(config.audioBucket)}/${encodedPath}`;
  const sign = (token, expiresIn) =>
    request(signUrl, {
      method: 'POST',
      headers: {
        apikey: settings.publicKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });
  const foreign = await sign(process.env.E01_USER_B_TOKEN, 10);
  assert(foreign.status >= 400 && foreign.status < 500);
  results.push({ check: 'foreign-storage-signature', status: foreign.status });
  const live = await sign(process.env.E01_USER_A_TOKEN, 30);
  assert.equal(live.status, 200);
  const livePayload = await live.json();
  const freshUrl = (payload) => {
    const url = new URL('/storage/v1' + payload.signedURL, settings.supabaseUrl);
    assert.equal(url.origin, settings.supabaseUrl);
    url.searchParams.set('cacheNonce', crypto.randomUUID());
    return url;
  };
  const download = await request(freshUrl(livePayload), {
    headers: { Range: 'bytes=0-0' },
    cache: 'no-store',
  });
  assert([200, 206].includes(download.status));
  await download.body?.cancel();
  results.push({ check: 'owned-signed-url', status: download.status });
  // A cold URL and cacheNonce avoid treating a warmed CDN cache as TTL enforcement.
  const cold = await sign(process.env.E01_USER_A_TOKEN, 10);
  assert.equal(cold.status, 200);
  const coldPayload = await cold.json();
  await new Promise((resolve) => setTimeout(resolve, 12000));
  const expired = await request(freshUrl(coldPayload), { cache: 'no-store' });
  assert(expired.status >= 400 && expired.status < 500);
  const failure = await expired.json();
  assert(
    /expired|InvalidJWT/i.test(
      `${failure.error || ''} ${failure.message || ''} ${failure.code || ''}`,
    ),
  );
  results.push({ check: 'cold-signed-url-expiration', status: expired.status });
  console.log(
    JSON.stringify({
      executed: true,
      results,
      mutations: 0,
      scope: 'staging API ownership and direct Storage TTL; no provider generation or DB writes',
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch {
    console.error(
      'Integration check blocked or failed; verify authorized staging and fixture configuration. No URLs, credentials or response bodies were logged.',
    );
    process.exitCode = 1;
  }
}
