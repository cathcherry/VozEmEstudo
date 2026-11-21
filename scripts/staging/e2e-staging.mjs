#!/usr/bin/env node
// Voz em Estudo 3.4 — end-to-end check against a REAL staging API + Supabase (synthetic data only).
//
//   E2E_ACCOUNTS_FILE=/caminho/accounts.json E2E_BASE_URL=http://localhost:3401 \
//   NODE_USE_ENV_PROXY=1 node scripts/staging/e2e-staging.mjs
//
// Optional: E2E_BUDGET_BASE_URL (a second API on the same database started with a tiny
// AI_DAILY_GENERATION_LIMIT, to observe GENERATION_BUDGET_EXCEEDED), E2E_RESULTS_FILE (JSON
// results), E2E_ONLY (comma-separated step numbers, e.g. "1,2,3": later steps need earlier ones).
//
// The accounts file holds {teacher, s1..s7, outsider: {email, password}}. Nothing secret is read
// from this file or printed: the Supabase URL and the PUBLISHABLE key come from GET /api/config,
// tokens stay in memory, and the output only has step names, HTTP statuses and record counts.
// Every step prints PASS / FAIL / SKIP; the process exits 1 if any step failed.
import { randomUUID, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { legacyApkg } from '../../backend/tests/fixtures/apkg.fixture.js';

const PRODUCTION_REFS = ['fxsuagrcfargpejglwtl'];
const BASE = (process.env.E2E_BASE_URL || 'http://localhost:3400').replace(/\/$/, '');
const BUDGET_BASE = (process.env.E2E_BUDGET_BASE_URL || '').replace(/\/$/, '');
const ACCOUNTS_FILE = process.env.E2E_ACCOUNTS_FILE;
const ONLY = new Set(
  String(process.env.E2E_ONLY || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);
const ROLES = ['teacher', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'outsider'];
const STUDENTS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- results
const results = [];
let current = '0';
function record(status, name, { http = '', note = '', kind = 'real' } = {}) {
  results.push({ step: current, name, status, http: http === '' ? '' : String(http), note, kind });
  const tag = kind === 'simulated' ? ' [simulado]' : '';
  console.log(`${status.padEnd(4)} [${current}] ${name}${http !== '' ? ` (HTTP ${http})` : ''}${tag}${note ? ` — ${note}` : ''}`);
}
const pass = (name, opts) => record('PASS', name, opts);
const skip = (name, opts) => record('SKIP', name, opts);
/** Records PASS when `ok` holds, FAIL otherwise (with a short, secret-free hint). */
function check(name, ok, opts = {}) {
  record(ok ? 'PASS' : 'FAIL', name, opts);
  return Boolean(ok);
}
const brief = (data) => {
  if (data?.error?.code) return data.error.code;
  try {
    return JSON.stringify(data).slice(0, 160);
  } catch {
    return String(data).slice(0, 160);
  }
};
/** Expect one HTTP status (or one of several) and, optionally, an error code. */
function expect(name, res, statuses, { code, kind, note } = {}) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  const ok = list.includes(res.status) && (!code || res.data?.error?.code === code);
  return check(name, ok, { http: res.status, kind, note: ok ? note || (code ? code : '') : `esperado ${list.join('/')}${code ? ` ${code}` : ''}, veio ${brief(res.data)}` });
}

// ---------------------------------------------------------------- HTTP
async function send(base, route, { token, method = 'GET', body, raw, contentType, headers = {}, timeout = 30000 } = {}) {
  const url = route.startsWith('http') ? route : `${base}${route}`;
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': contentType || 'application/octet-stream' } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    data = null;
  }
  return { status: response.status, data, bytes: buffer.length, type: response.headers.get('content-type') || '', headers: response.headers };
}
const users = {};
const as = (role) => (route, options = {}) => send(BASE, route, { ...options, token: users[role].token });

async function waitJob(role, jobId, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await as(role)(`/api/jobs/${jobId}`);
    if (last.status !== 200) return { ok: false, status: last.status, job: last.data };
    if (last.data.status === 'CONCLUIDA') return { ok: true, status: 200, job: last.data };
    if (last.data.status === 'FALHOU') return { ok: false, status: 200, job: last.data };
    await sleep(1000);
  }
  return { ok: false, status: 'timeout', job: last?.data };
}

// ---------------------------------------------------------------- fixtures
/** A short synthetic tone (mono 16 kHz PCM WAV). No voice, no personal data. */
function toneWav(seconds = 4, frequency = 440) {
  const rate = 16000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 8000), 44 + i * 2);
  return buffer;
}
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const inviteCode = () =>
  Array.from({ length: 12 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)])
    .join('')
    .replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');

// ---------------------------------------------------------------- shared state
const state = { lessons: {}, privacy: [] };
/** Registers a private resource: later, other accounts must not read it (step 11). */
const privateItem = (owner, label, route) => state.privacy.push({ owner, label, route });

async function setup() {
  if (!ACCOUNTS_FILE) throw new Error('Defina E2E_ACCOUNTS_FILE (arquivo de contas sintéticas).');
  const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
  current = '0';
  const config = await send(BASE, '/api/config');
  if (!expect('API responde /api/config', config, 200)) throw new Error('API indisponível');
  const host = new URL(config.data.supabaseUrl).hostname;
  if (PRODUCTION_REFS.some((ref) => host.startsWith(`${ref}.`))) throw new Error('Recusado: a API aponta para PRODUÇÃO.');
  state.supabaseUrl = config.data.supabaseUrl;
  state.publishableKey = config.data.supabasePublishableKey;
  state.permissionVersion = config.data.permissionDeclaration?.version;
  state.flags = config.data.featureFlags || {};
  pass(`projeto Supabase de staging (${host.split('.')[0]}), flags: ${Object.entries(state.flags).filter(([, v]) => v).length} ligadas`);
  for (const role of ROLES) {
    const account = accounts[role];
    if (!account?.email || !account?.password) throw new Error(`Conta ${role} ausente no arquivo.`);
    if (!/@example\.test$/i.test(account.email)) throw new Error(`Conta ${role} não é sintética (@example.test).`);
    const login = await send(state.supabaseUrl, '/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: account.email, password: account.password },
      headers: { apikey: state.publishableKey },
    });
    if (login.status !== 200 || !login.data?.access_token) {
      check(`login ${role}`, false, { http: login.status });
      throw new Error('login falhou');
    }
    users[role] = { id: login.data.user.id, token: login.data.access_token };
  }
  pass(`login real (Supabase Auth) de ${ROLES.length} contas sintéticas`, { http: 200 });
  const me = await as('teacher')('/api/materials');
  if (!expect('API aceita o token do usuário (GET /api/materials)', me, 200)) throw new Error('A API não valida tokens de usuário neste ambiente');
  const anonymous = await send(BASE, '/api/materials');
  expect('sem token → 401', anonymous, 401);
}

// ---------------------------------------------------------------- 1. lessons
async function uploadAndCreate(role, title, { subject = 'Biologia (sintético)', create = true } = {}) {
  const api = as(role);
  const wav = toneWav(4, 330 + Object.keys(state.lessons).length * 40);
  const id = randomUUID();
  const storagePath = `temp/${users[role].id}/${id}/aula-sintetica.wav`;
  const upload = await send(state.supabaseUrl, `/storage/v1/object/audios/${storagePath}`, {
    token: users[role].token,
    method: 'POST',
    raw: wav,
    contentType: 'audio/wav',
    headers: { apikey: state.publishableKey, 'x-upsert': 'false' },
  });
  const body = { id, title, subject, originalFilename: 'aula-sintetica.wav', mimeType: 'audio/wav', extension: 'wav', sizeBytes: wav.length, durationMs: 4000, questionCount: 3, retainAudio: false, storagePath };
  if (!create) return { id, upload, body };
  const full = { ...body, permissionAccepted: true, permissionVersion: state.permissionVersion };
  // The browser retries with the same id: both answers must be the same lesson (no duplicate).
  const [created, retry] = await Promise.all([api('/api/materials', { method: 'POST', body: full }), api('/api/materials', { method: 'POST', body: full })]);
  return { id, upload, created, retry, body };
}
async function processLesson(role, id) {
  const job = await as(role)(`/api/materials/${id}/process`, { method: 'POST', body: {} });
  return job;
}
async function confirmLesson(role, id) {
  const api = as(role);
  const material = await api(`/api/materials/${id}`);
  const revisionId = material.data?.review?.sourceRevisionId;
  const confirm = await api(`/api/materials/${id}/transcription/confirm`, { method: 'POST', body: { sourceRevisionId: revisionId } });
  return { material, revisionId, confirm };
}

async function step1() {
  current = '1';
  const plan = [
    ['teacher', 'A', 'Aula A — fotossíntese (sintética)', true],
    ['teacher', 'B', 'Aula B — respiração celular (sintética)', true],
    ['teacher', 'C', 'Aula C — mitose (sintética)', true],
    ['s1', 'S1', 'Envio s1 — gravação sintética', false],
    ['s2', 'S2', 'Envio s2 — gravação sintética', false],
  ];
  // Permission declaration: refused without it and with an outdated version.
  const probe = await uploadAndCreate('teacher', 'Sem declaração', { create: false });
  const noPermission = await as('teacher')('/api/materials', { method: 'POST', body: probe.body });
  expect('criar aula sem aceitar a declaração de permissão → 422', noPermission, 422, { code: 'PERMISSION_REQUIRED' });
  const outdated = await as('teacher')('/api/materials', { method: 'POST', body: { ...probe.body, permissionAccepted: true, permissionVersion: 'old-version' } });
  expect('declaração desatualizada → 409', outdated, 409, { code: 'PERMISSION_RECONFIRMATION_REQUIRED' });
  const foreign = await as('s3')('/api/materials', { method: 'POST', body: { ...probe.body, permissionAccepted: true, permissionVersion: state.permissionVersion } });
  expect('outra conta não registra áudio no prefixo do professor → 403', foreign, [403, 404]);

  for (const [role, key, title, processNow] of plan) {
    const { id, upload, created, retry } = await uploadAndCreate(role, title);
    check(`${role}: upload do WAV sintético (4 s) no Storage, bucket audios`, upload.status === 200, { http: upload.status, note: 'ver nota sobre o proxy no relatório' });
    check(`${role}: POST /api/materials (aula ${key}), repetição simultânea devolve a mesma aula`, created.status === 201 && retry.status === 201 && created.data?.id === id && retry.data?.id === id, { http: `${created.status}/${retry.status}` });
    state.lessons[key] = { id, owner: role, title };
    privateItem(role, `aula ${key}`, `/api/materials/${id}`);
    if (!processNow) continue;
    const job = await processLesson(role, id);
    expect(`${role}: POST /process da aula ${key} (fila do worker)`, job, 202);
    state.lessons[key].jobId = job.data?.jobId;
  }
  for (const key of ['A', 'B', 'C']) {
    const lesson = state.lessons[key];
    const done = await waitJob(lesson.owner, lesson.jobId);
    check(`worker transcreveu a aula ${key} (ASR simulado)`, done.ok, { http: done.status, kind: 'simulated', note: done.ok ? '' : brief(done.job) });
    const before = await as(lesson.owner)(`/api/materials/${lesson.id}`);
    check(`aula ${key} aguarda conferência (awaiting_review) e não tem gerações`, before.data?.review?.state === 'awaiting_review' && before.data?.summaries?.length === 0, { http: before.status });
    lesson.segments = before.data?.transcription?.transcription_segments || [];
    if (key === 'A') {
      const early = await as('teacher')(`/api/materials/${lesson.id}/summaries`, { method: 'POST', body: { sourceRevisionId: before.data.review.sourceRevisionId, idempotencyKey: randomUUID() } });
      // With generation reuse on, the database answers GENERATION_SOURCE_FORBIDDEN (same 409 and message).
      check('gerar antes de confirmar a transcrição → 409', early.status === 409 && ['TRANSCRIPTION_CONFIRMATION_REQUIRED', 'GENERATION_SOURCE_FORBIDDEN'].includes(early.data?.error?.code), { http: early.status, note: early.data?.error?.code });
    }
    const [first, second] = await Promise.all([confirmLesson(lesson.owner, lesson.id), confirmLesson(lesson.owner, lesson.id)]);
    lesson.revisionId = first.revisionId;
    check(
      `confirmação da revisão da aula ${key} (2 cliques simultâneos → 1 confirmação)`,
      first.confirm.status === 200 && second.confirm.status === 200 && first.confirm.data?.state === 'ready_to_generate' && first.confirm.data?.confirmation?.id === second.confirm.data?.confirmation?.id,
      { http: `${first.confirm.status}/${second.confirm.status}` },
    );
  }
}

// ---------------------------------------------------------------- 2. notebook
const paragraph = (id, text) => ({ id, type: 'paragraph', text });
const doc = (...blocks) => ({ type: 'doc', schemaVersion: 1, blocks });
async function step2() {
  current = '2';
  const lesson = state.lessons.A;
  const api = as('teacher');
  const route = `/api/notebooks/${lesson.id}`;
  const empty = await api(route);
  check('caderno começa vazio (notebook null)', empty.status === 200 && empty.data?.notebook === null, { http: empty.status });
  let blocks = [{ id: 'h1', type: 'heading', level: 2, text: 'Fotossíntese' }, paragraph('p1', 'Primeira linha.')];
  const firstId = randomUUID();
  const first = await api(route, { method: 'PUT', body: { version: 0, requestId: firstId, title: 'Caderno A', doc: doc(...blocks) } });
  check('primeiro salvamento cria a versão 1', first.status === 200 && first.data?.notebook?.version === 1, { http: first.status });
  const replay = await api(route, { method: 'PUT', body: { version: 0, requestId: firstId, title: 'Caderno A', doc: doc(...blocks) } });
  check('repetir o mesmo requestId devolve o estado salvo (replayed)', replay.status === 200 && replay.data?.replayed === true && replay.data?.notebook?.version === 1, { http: replay.status });
  let version = 1;
  // Autosave-like: several small successive saves, each on top of the previous version.
  for (let i = 2; i <= 5; i += 1) {
    blocks = [...blocks, paragraph(`p${i}`, `Linha ${i} digitada (autosave).`)];
    const saved = await api(route, { method: 'PUT', body: { version, requestId: randomUUID(), title: 'Caderno A', doc: doc(...blocks) } });
    if (saved.status !== 200) {
      expect(`autosave ${i}`, saved, 200);
      return;
    }
    version = saved.data.notebook.version;
  }
  check('4 salvamentos sucessivos (autosave) → versão 5', version === 5, { http: 200 });
  // Two tabs save at the same version at the same time.
  const tabA = [...blocks, paragraph('ta', 'Texto da aba A.')];
  const tabB = [...blocks, paragraph('tb', 'Texto da aba B.')];
  const [a, b] = await Promise.all([
    api(route, { method: 'PUT', body: { version, requestId: randomUUID(), title: 'Caderno A', doc: doc(...tabA) } }),
    api(route, { method: 'PUT', body: { version, requestId: randomUUID(), title: 'Caderno A', doc: doc(...tabB) } }),
  ]);
  const statuses = [a.status, b.status].sort();
  const loser = a.status === 409 ? a : b;
  check(
    'dois salvamentos simultâneos na mesma versão → exatamente 1 conflito',
    statuses[0] === 200 && statuses[1] === 409 && loser.data?.error?.code === 'LEARNING_VERSION_CONFLICT',
    { http: `${a.status}/${b.status}`, note: loser.data?.error?.code || '' },
  );
  const winnerBlocks = a.status === 200 ? tabA : tabB;
  const loserBlock = a.status === 200 ? paragraph('tb', 'Texto da aba B.') : paragraph('ta', 'Texto da aba A.');
  const after = await api(route);
  check('o vencedor ficou salvo inteiro (versão 6)', after.data?.notebook?.version === 6 && canonical(after.data.notebook.doc.blocks) === canonical(winnerBlocks), { http: after.status });
  // The losing tab reloads and re-applies its text: nothing is lost.
  const merged = await api(route, { method: 'PUT', body: { version: 6, requestId: randomUUID(), title: 'Caderno A', doc: doc(...winnerBlocks, loserBlock) } });
  const ids = merged.data?.notebook?.doc?.blocks?.map((block) => block.id) || [];
  check('a aba perdedora reaplica o texto na versão atual: nada se perde', merged.status === 200 && ids.includes('ta') && ids.includes('tb') && ids.length === 8, { http: merged.status });
  state.notebookVersion = merged.data?.notebook?.version;
  state.notebookBlocks = merged.data?.notebook?.doc?.blocks;
  const html = await api(route, { method: 'PUT', body: { version: state.notebookVersion, requestId: randomUUID(), title: 'x', doc: doc(paragraph('x', '<script>alert(1)</script>')) } });
  expect('HTML no caderno é recusado', html, 400, { code: 'NOTEBOOK_INVALID' });
  privateItem('teacher', 'caderno da aula A', route);
}

// ---------------------------------------------------------------- 3. highlights
async function step3() {
  current = '3';
  const lesson = state.lessons.A;
  const api = as('teacher');
  const segments = [...(lesson.segments || [])].sort((x, y) => x.position - y.position);
  const first = segments[0];
  check('transcrição tem trechos (segments) para ancorar destaques', segments.length > 0, { kind: 'simulated', note: `${segments.length} trecho(s)` });
  if (!first) return;
  const text0 = first.current_text;
  const annotationId = randomUUID();
  let body;
  if (segments.length >= 2) {
    const last = segments[1];
    const endOffset = Math.min(8, last.current_text.length);
    body = { sourceRevisionId: lesson.revisionId, segmentPosition: first.position, startOffset: 5, endSegmentPosition: last.position, endOffset, quote: `${text0.slice(5)}\n${last.current_text.slice(0, endOffset)}`, noteText: 'Destaque em dois trechos', color: 'green' };
  } else {
    skip('destaque em VÁRIOS trechos com dados reais', { kind: 'simulated', note: 'o ASR simulado gera 1 trecho por aula; o caminho de vários trechos é coberto abaixo pela recusa e pelos testes PGlite' });
    const crossing = await api('/api/annotations', {
      method: 'PUT',
      body: { id: randomUUID(), materialId: lesson.id, version: 0, requestId: randomUUID(), body: { sourceRevisionId: lesson.revisionId, segmentPosition: 0, startOffset: 0, endSegmentPosition: 1, endOffset: 3, quote: `${text0}\nabc`, noteText: '', color: 'blue' } },
    });
    expect('âncora que cruza para um trecho inexistente é conferida no banco → 409', crossing, 409, { code: 'LEARNING_ANCHOR_CONFLICT' });
    const wrongQuote = await api('/api/annotations', {
      method: 'PUT',
      body: { id: randomUUID(), materialId: lesson.id, version: 0, requestId: randomUUID(), body: { sourceRevisionId: lesson.revisionId, segmentPosition: 0, startOffset: 0, endOffset: 5, quote: 'XXXXX', noteText: '', color: 'blue' } },
    });
    expect('citação que não bate com a revisão → 409', wrongQuote, 409, { code: 'LEARNING_ANCHOR_CONFLICT' });
    body = { sourceRevisionId: lesson.revisionId, segmentPosition: first.position, startOffset: 0, endOffset: Math.min(20, text0.length), quote: text0.slice(0, Math.min(20, text0.length)), noteText: 'Destaque sintético', color: 'yellow' };
  }
  const saved = await api('/api/annotations', { method: 'PUT', body: { id: annotationId, materialId: lesson.id, version: 0, requestId: randomUUID(), body } });
  expect('salvar destaque ancorado na revisão confirmada', saved, 200);
  const list = await api(`/api/annotations?materialId=${lesson.id}`);
  const rows = list.data?.notes || list.data?.annotations || list.data || [];
  const found = Array.isArray(rows) ? rows.find((row) => row.id === annotationId) : null;
  check(
    'destaque recuperado com âncora (início, fim, citação, revisão)',
    Boolean(found) && found.quote === body.quote && found.segment_position === body.segmentPosition && (found.end_segment_position ?? found.segment_position) === (body.endSegmentPosition ?? body.segmentPosition),
    { http: list.status, note: found ? `trechos ${found.segment_position}–${found.end_segment_position ?? found.segment_position}` : brief(list.data) },
  );
  // The notebook cites the highlight (revision-aware reference).
  const nb = await api(`/api/notebooks/${lesson.id}`, {
    method: 'PUT',
    body: { version: state.notebookVersion, requestId: randomUUID(), title: 'Caderno A', doc: doc(...state.notebookBlocks, { id: 'ref1', type: 'annotation_ref', annotationId, sourceRevisionId: lesson.revisionId }) },
  });
  const ref = nb.data?.references?.find((r) => r.id === annotationId);
  check('caderno cita o destaque (annotation_ref) e devolve a referência', nb.status === 200 && Boolean(ref), { http: nb.status });
  state.annotationId = annotationId;
  privateItem('teacher', 'destaques da aula A', `/api/annotations?materialId=${lesson.id}`);
}

// ---------------------------------------------------------------- 4. classroom
async function step4() {
  current = '4';
  const teacher = as('teacher');
  const classId = randomUUID();
  const created = await teacher('/api/classrooms', { method: 'POST', body: { id: classId, name: `Turma E2E ${RUN}`, description: 'Turma sintética de validação', displayName: 'Profa. Sintética' } });
  expect('professor cria a turma', created, 201);
  state.classId = classId;
  const code = inviteCode();
  const invite = await teacher(`/api/classrooms/${classId}/invites`, { method: 'POST', body: { id: randomUUID(), requestId: randomUUID(), code, days: 7, maxUses: 10 } });
  expect('professor cria convite (código gerado no cliente, só o hash é guardado)', invite, 201);
  const invites = await teacher(`/api/classrooms/${classId}/invites`);
  check('a lista de convites nunca devolve o código', invites.status === 200 && !JSON.stringify(invites.data).includes(code.replace(/-/g, '')), { http: invites.status });
  const wrong = await as('outsider')('/api/classrooms/join', { method: 'POST', body: { code: inviteCode() } });
  expect('código errado → 404 CLASSROOM_INVITE_INVALID', wrong, 404, { code: 'CLASSROOM_INVITE_INVALID' });
  const joins = await Promise.all(STUDENTS.map((role, i) => as(role)('/api/classrooms/join', { method: 'POST', body: { code: code.toLowerCase(), displayName: `Aluno ${i + 1}` } })));
  check('s1..s7 entram pelo convite (simultâneo)', joins.every((j) => j.status === 200), { http: joins.map((j) => j.status).join(',') });
  const again = await as('s1')('/api/classrooms/join', { method: 'POST', body: { code } });
  check('entrar de novo não gasta uso', again.status === 200 && (again.data?.alreadyMember === true || again.data?.already_member === true), { http: again.status, note: brief(again.data) });
  const members = await teacher(`/api/classrooms/${classId}/members`);
  check('turma tem 8 membros (professor + 7 alunos)', members.status === 200 && members.data?.length === 8, { http: members.status, note: `${members.data?.length}` });
  const studentRoles = members.data?.filter((m) => m.role === 'student').length;
  check('os 7 entram como aluno', studentRoles === 7);
  const outsiderGet = await as('outsider')(`/api/classrooms/${classId}`);
  expect('outsider não lê a turma → 404', outsiderGet, 404, { code: 'CLASSROOM_NOT_FOUND' });
  const outsiderMembers = await as('outsider')(`/api/classrooms/${classId}/members`);
  expect('outsider não lê membros → 404', outsiderMembers, 404);
  const outsiderList = await as('outsider')('/api/classrooms');
  check('a turma não aparece na lista do outsider', outsiderList.status === 200 && !JSON.stringify(outsiderList.data).includes(classId), { http: outsiderList.status });
  // Role permissions.
  const s1 = as('s1');
  expect('aluno não cria convite → 403', await s1(`/api/classrooms/${classId}/invites`, { method: 'POST', body: { id: randomUUID(), requestId: randomUUID(), code: inviteCode(), days: 1, maxUses: 1 } }), 403, { code: 'CLASSROOM_FORBIDDEN' });
  expect('aluno não renomeia/arquiva a turma → 403', await s1(`/api/classrooms/${classId}`, { method: 'PATCH', body: { name: 'Hack' } }), 403);
  expect('aluno não muda papéis → 403', await s1(`/api/classrooms/${classId}/members/${users.s2.id}`, { method: 'PATCH', body: { role: 'assistant' } }), 403);
  expect('aluno não remove colega → 403', await s1(`/api/classrooms/${classId}/members/${users.s2.id}`, { method: 'DELETE' }), 403);
  expect('aluno não adiciona link de apoio → 403', await s1(`/api/classrooms/${classId}/resources`, { method: 'POST', body: { id: randomUUID(), title: 'x', url: 'https://example.test/x' } }), 403);
  // Teacher publishes lesson A; a student cannot publish (not even their own material).
  const lessonId = randomUUID();
  const publish = await teacher(`/api/classrooms/${classId}/lessons`, { method: 'POST', body: { id: lessonId, materialId: state.lessons.A.id, revisionId: state.lessons.A.revisionId, title: 'Aula A publicada' } });
  expect('professor publica a aula A (revisão confirmada fixada)', publish, 201);
  state.classLessonId = lessonId;
  expect('aluno não publica aula → 403', await s1(`/api/classrooms/${classId}/lessons`, { method: 'POST', body: { id: randomUUID(), materialId: state.lessons.S1.id, revisionId: randomUUID() } }), 403);
  const read = await as('s4')(`/api/classrooms/${classId}/lessons/${lessonId}`);
  check('aluno lê a aula publicada (transcrição da revisão fixada)', read.status === 200 && Boolean(read.data?.transcript?.fullText ?? read.data?.transcript), { http: read.status, kind: 'simulated' });
  const leaks = JSON.stringify(read.data || {});
  check('aula publicada não expõe anotações, caderno, áudio ou progresso do dono', !leaks.includes(state.annotationId || 'none') && !/signedAudioUrl|storage_path|notebook|study_progress/i.test(leaks));
  expect('outsider não lê a aula publicada → 404', await as('outsider')(`/api/classrooms/${classId}/lessons/${lessonId}`), 404);
}

// ---------------------------------------------------------------- 5. submissions
async function transition(role, submissionId, to, extra = {}) {
  return as(role)(`/api/classrooms/${state.classId}/submissions/${submissionId}/transitions`, { method: 'POST', body: { to, requestId: randomUUID(), ...extra } });
}
async function step5() {
  current = '5';
  const classId = state.classId;
  const s1 = as('s1');
  const submissionId = randomUUID();
  const submit = await s1(`/api/classrooms/${classId}/submissions`, { method: 'POST', body: { id: submissionId, materialId: state.lessons.S1.id, note: 'Minha gravação sintética' } });
  check('aluno s1 envia a gravação → submitted', submit.status === 201 && (submit.data?.status ?? 'submitted') === 'submitted', { http: submit.status, note: submit.data?.status || brief(submit.data) });
  const dup = await s1(`/api/classrooms/${classId}/submissions`, { method: 'POST', body: { id: randomUUID(), materialId: state.lessons.S1.id } });
  expect('mesma gravação de novo → 409', dup, 409, { code: 'CLASSROOM_ALREADY_SUBMITTED' });
  expect('aluno não aprova o próprio envio → 403', await transition('s1', submissionId, 'approved_for_processing'), 403);
  expect('s3 não vê o envio de s1 → 404', await as('s3')(`/api/classrooms/${classId}/submissions/${submissionId}`), 404);
  const s3list = await as('s3')(`/api/classrooms/${classId}/submissions`);
  check('lista de envios do s3 não mostra o de s1', s3list.status === 200 && !JSON.stringify(s3list.data).includes(submissionId), { http: s3list.status });
  const queue = await as('teacher')(`/api/classrooms/${classId}/submissions`);
  check('professor vê o envio na fila', queue.status === 200 && JSON.stringify(queue.data).includes(submissionId), { http: queue.status });
  const early = await as('teacher')(`/api/classrooms/${classId}/submissions/${submissionId}`);
  check('antes de processing o professor não lê a transcrição do aluno', early.status === 200 && !early.data?.review, { http: early.status });
  expect('professor aprova para processamento (com recado)', await transition('teacher', submissionId, 'approved_for_processing', { note: 'Pode processar.' }), 200);
  expect('marcar processing sem ter processado → 409', await transition('s1', submissionId, 'processing'), 409, { code: 'CLASSROOM_PROCESSING_REQUIRED' });
  const job = await processLesson('s1', state.lessons.S1.id);
  expect('aluno inicia o processamento da própria gravação', job, 202);
  const marked = await transition('s1', submissionId, 'processing');
  expect('aluno marca processing', marked, 200);
  const done = await waitJob('s1', job.data?.jobId);
  check('worker transcreveu a gravação do aluno (ASR simulado)', done.ok, { http: done.status, kind: 'simulated' });
  const material = await s1(`/api/materials/${state.lessons.S1.id}`);
  const revisionId = material.data?.review?.sourceRevisionId;
  expect('professor não confirma antes do aluno → 409', await transition('teacher', submissionId, 'transcription_confirmed', { revisionId }), 409, { code: 'CLASSROOM_STUDENT_CONFIRMATION_REQUIRED' });
  const confirm = await s1(`/api/materials/${state.lessons.S1.id}/transcription/confirm`, { method: 'POST', body: { sourceRevisionId: revisionId } });
  expect('aluno confere e confirma a transcrição', confirm, 200);
  state.lessons.S1.revisionId = revisionId;
  const teacherView = await as('teacher')(`/api/classrooms/${classId}/submissions/${submissionId}`);
  check('professor lê a revisão do envio (studentConfirmed)', teacherView.status === 200 && teacherView.data?.review?.revisionId === revisionId && teacherView.data?.review?.studentConfirmed === true, { http: teacherView.status, kind: 'simulated' });
  expect('professor confirma a transcrição', await transition('teacher', submissionId, 'transcription_confirmed', { revisionId }), 200);
  const published = await transition('teacher', submissionId, 'published', { note: 'Publicado para a turma.' });
  expect('professor publica o envio', published, 200);
  const status = await s1(`/api/classrooms/${classId}/submissions/${submissionId}`);
  const events = status.data?.events || [];
  check('aluno vê status published e o histórico (5 etapas)', status.data?.status === 'published' && events.length >= 5, { http: status.status, note: `${status.data?.status}, ${events.length} eventos` });
  const lessons = await as('s5')(`/api/classrooms/${classId}/lessons`);
  check('a aula do aluno aparece para a turma', lessons.status === 200 && lessons.data?.some((l) => l.source === 'submission' || l.author?.userId === users.s1.id), { http: lessons.status });
  // Rejection with feedback.
  const rejectId = randomUUID();
  expect('aluno s2 envia gravação', await as('s2')(`/api/classrooms/${classId}/submissions`, { method: 'POST', body: { id: rejectId, materialId: state.lessons.S2.id } }), 201);
  const reject = await transition('teacher', rejectId, 'rejected', { note: 'Áudio sem conteúdo da disciplina.' });
  expect('professor recusa com motivo', reject, 200);
  const seen = await as('s2')(`/api/classrooms/${classId}/submissions/${rejectId}`);
  const feedback = JSON.stringify(seen.data || {});
  check('aluno s2 vê status rejected e o motivo', seen.data?.status === 'rejected' && feedback.includes('Áudio sem conteúdo da disciplina.'), { http: seen.status });
  expect('envio recusado é final → 409', await transition('teacher', rejectId, 'approved_for_processing'), 409, { code: 'CLASSROOM_ILLEGAL_TRANSITION' });
  privateItem('s2', 'material do envio recusado', `/api/materials/${state.lessons.S2.id}`);
}

// ---------------------------------------------------------------- 7. flashcards (decks used by 6)
const basic = (front, back) => ({ noteType: 'basic', fields: { front, back } });
function deckFor(role) {
  const common = [basic('O que é ATP?', 'Moeda de energia da célula.'), basic('Onde ocorre a fotossíntese?', 'Nos cloroplastos.')];
  const own = [basic(`Pergunta exclusiva de ${role}?`, `Resposta de ${role}.`), basic(`Conceito ${role}-2?`, `Definição ${role}-2.`)];
  // s2..s5 disagree on one answer: a conflict the merge must surface.
  const conflict = { s2: 'Glicose e O2.', s3: 'Glicose e oxigênio.', s4: 'Glicose e O2.', s5: 'Açúcar.' }[role];
  return conflict ? [...common, basic('Produtos da fotossíntese?', conflict), ...own] : [...common, ...own];
}
async function step7a() {
  current = '7';
  state.decks = {};
  for (const role of STUDENTS) {
    const id = randomUUID();
    const created = await as(role)('/api/flashcards/decks', { method: 'POST', body: { id, name: `Baralho ${role} ${RUN}`, origin: 'manual', cards: deckFor(role) } });
    if (!expect(`${role} cria baralho próprio (${deckFor(role).length} notas)`, created, 201)) continue;
    state.decks[role] = { setId: id };
    privateItem(role, `baralho de ${role}`, `/api/flashcards/sets/${id}`);
  }
  // Review history on s2's original deck, to prove it is untouched later.
  const s2set = await as('s2')(`/api/flashcards/sets/${state.decks.s2?.setId}`);
  const card = s2set.data?.cards?.[0];
  if (card) {
    const review = await as('s2')(`/api/flashcards/${card.id}/reviews`, { method: 'POST', body: { rating: 2, requestId: randomUUID() } });
    expect('s2 revisa um cartão (histórico de revisão real)', review, [200, 201]);
    state.s2Card = card.id;
  }
  for (const role of ['s2', 's3', 's4', 's5']) {
    const set = await as(role)(`/api/flashcards/sets/${state.decks[role]?.setId}`);
    const history = state.s2Card && role === 's2' ? await as('s2')(`/api/flashcards/${state.s2Card}/reviews`) : null;
    state.decks[role].snapshot = canonical(normaliseSet(set.data));
    state.decks[role].history = history ? JSON.stringify(history.data) : null;
  }
  // Each student shares the deck with the class: students go to the review queue.
  for (const role of STUDENTS) {
    const sharedId = randomUUID();
    const share = await as(role)(`/api/classrooms/${state.classId}/flashcard-sets`, { method: 'POST', body: { id: sharedId, setId: state.decks[role]?.setId } });
    const status = share.data?.status;
    check(`${role} oferece o baralho à turma → pendente`, share.status === 201 && status === 'pending', { http: share.status, note: status || brief(share.data) });
    state.decks[role].contributionId = share.data?.id || sharedId;
  }
  const s3before = await as('s3')(`/api/classrooms/${state.classId}/flashcard-sets`);
  check('pendentes não aparecem para os colegas', s3before.status === 200 && !(s3before.data || []).some((s) => s.setId && s.setId === state.decks.s2.setId), { http: s3before.status });
  const queue = await as('teacher')(`/api/classrooms/${state.classId}/contributions`);
  check('professor vê os 7 baralhos na fila de revisão', queue.status === 200 && STUDENTS.every((role) => queue.data?.some((c) => c.id === state.decks[role].contributionId)), { http: queue.status, note: `${queue.data?.length ?? 0} na fila` });
  const preview = await as('teacher')(`/api/classrooms/${state.classId}/contributions/${state.decks.s2.contributionId}`);
  check('professor vê prévia só leitura do baralho', preview.status === 200 && Array.isArray(preview.data?.preview?.cards), { http: preview.status });
  expect('aluno não revisa contribuição → 403', await as('s1')(`/api/classrooms/${state.classId}/contributions/${state.decks.s2.contributionId}/review`, { method: 'POST', body: { decision: 'approved', requestId: randomUUID() } }), 403);
  for (const role of ['s1', 's2', 's3', 's4', 's5', 's7']) {
    const review = await as('teacher')(`/api/classrooms/${state.classId}/contributions/${state.decks[role].contributionId}/review`, { method: 'POST', body: { decision: 'approved', requestId: randomUUID(), feedback: 'Ótimo baralho.' } });
    if (review.status !== 200) expect(`aprovar baralho de ${role}`, review, 200);
  }
  pass('professor aprova 6 baralhos');
  const rejected = await as('teacher')(`/api/classrooms/${state.classId}/contributions/${state.decks.s6.contributionId}/review`, { method: 'POST', body: { decision: 'rejected', requestId: randomUUID(), feedback: 'Revise as respostas antes de compartilhar.' } });
  expect('professor recusa o baralho de s6 com motivo', rejected, 200);
  const mine = await as('s6')(`/api/classrooms/${state.classId}/contributions`);
  const own = mine.data?.find((c) => c.id === state.decks.s6.contributionId);
  check('s6 vê status recusado e o motivo', own?.status === 'rejected' && own?.feedback === 'Revise as respostas antes de compartilhar.', { http: mine.status, note: own?.status });
  const sets = await as('s1')(`/api/classrooms/${state.classId}/flashcard-sets`);
  for (const role of STUDENTS) state.decks[role].sharedId = sets.data?.find((s) => s.setId === state.decks[role].setId || s.author?.userId === users[role].id)?.sharedId;
  check('turma vê 6 baralhos aprovados e não o recusado', sets.status === 200 && ['s2', 's3', 's4', 's5'].every((r) => state.decks[r].sharedId) && !state.decks.s6.sharedId, { http: sets.status, note: `${sets.data?.length} visíveis` });
  const sharedCard = await as('s1')(`/api/classrooms/${state.classId}/flashcard-sets/${state.decks.s2.sharedId}`);
  const keys = new Set((sharedCard.data?.cards || []).flatMap((c) => Object.keys(c)));
  const forbidden = ['due_at', 'interval_days', 'repetitions', 'ease_factor', 'reviews', 'last_reviewed_at', 'evidence', 'source_segment_ids'];
  check('baralho compartilhado não expõe histórico/agenda de revisão do autor', sharedCard.status === 200 && keys.size > 0 && forbidden.every((k) => !keys.has(k)), { http: sharedCard.status, note: [...keys].join(',') });
  expect('outsider não lê baralho compartilhado → 404', await as('outsider')(`/api/classrooms/${state.classId}/flashcard-sets/${state.decks.s2.sharedId}`), 404);
}
/** JSON with sorted keys: jsonb does not keep key order, so compare canonical text. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
const CONTENT = ['id', 'front_text', 'back_text', 'note_type', 'note_fields', 'origin_kind', 'origin_label', 'origin_user_id', 'source_revision_id', 'source_segments', 'evidence', 'status'];
const SCHEDULE = ['due_at', 'interval_days', 'repetitions', 'ease_factor', 'last_reviewed_at'];
const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row?.[key] ?? null]));
/** Content, authorship and review state of a set (the media URL is re-signed on every read). */
function normaliseSet(set, keys = [...CONTENT, ...SCHEDULE]) {
  if (!set) return null;
  const cards = (set.cards || [])
    .map((card) => ({ ...pick(card, keys), media: (card.media || []).map((m) => m.name) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { id: set.id, name: set.name, owner: set.user_id, status: set.status, cards };
}
async function step7b() {
  current = '7';
  const sources = ['s2', 's3', 's4', 's5'].map((role) => ({ classroomId: state.classId, sharedId: state.decks[role].sharedId }));
  const preview = await as('s1')('/api/flashcards/merge/preview', { method: 'POST', body: { sources } });
  const p = preview.data || {};
  check('s1: prévia da junção de 4 baralhos de colegas (duplicatas e conflitos)', preview.status === 200 && p.duplicates > 0 && p.conflicts?.length >= 1, { http: preview.status, note: `total ${p.total}, duplicatas ${p.duplicates}, resultado ${p.resulting}, conflitos ${p.conflicts?.length}` });
  expect('outsider não faz prévia com fontes da turma → 404', await as('outsider')('/api/flashcards/merge/preview', { method: 'POST', body: { sources } }), [403, 404]);
  const decisions = {};
  for (const conflict of p.conflicts || []) decisions[conflict.key] = `keep:${conflict.options[0].cardId}`;
  const templateId = randomUUID();
  const template = await as('s1')(`/api/flashcards/templates/${templateId}`, { method: 'PUT', body: { version: 0, requestId: randomUUID(), body: { name: 'Caderno verde', base: 'notebook', tokens: { accent: '#2f7d4f', paper: '#fbfaf3', font: 'serif', pattern: 'lines', radius: 12 } } } });
  expect('s1 cria um modelo visual', template, [200, 201]);
  const mergedId = randomUUID();
  const merge = await as('s1')('/api/flashcards/merge', { method: 'POST', body: { id: mergedId, name: `Junção s2–s5 ${RUN}`, sources, decisions } });
  expect('s1 junta os 4 baralhos num baralho pessoal novo', merge, 201);
  const merged = await as('s1')(`/api/flashcards/sets/${mergedId}`);
  const mergedCards = merged.data?.cards || [];
  check('baralho resultante tem o número previsto de cartões', merged.status === 200 && mergedCards.length === p.resulting, { http: merged.status, note: `${mergedCards.length}/${p.resulting}` });
  const chosen = (p.conflicts || [])[0];
  if (chosen) {
    const kept = mergedCards.filter((c) => c.front_text === chosen.front);
    check('decisão do conflito respeitada (1 cartão, verso escolhido)', kept.length === 1 && kept[0].back_text === chosen.options[0].back, { note: `${kept.length} cartão, verso de ${chosen.options[0].label}` });
    const authors = new Set(mergedCards.map((c) => c.origin_user_id));
    check('cada cartão juntado guarda a autoria do colega (origin_user_id)', ['s2', 's3', 's4', 's5'].every((r) => authors.has(users[r].id)) && !authors.has(users.s1.id));
  }
  // s1 studies one merged card first, so the template change has a real history to keep.
  if (mergedCards[0]) {
    const review = await as('s1')(`/api/flashcards/${mergedCards[0].id}/reviews`, { method: 'POST', body: { rating: 3, requestId: randomUUID() } });
    expect('s1 revisa um cartão do baralho juntado', review, [200, 201]);
  }
  const reviewed = await as('s1')(`/api/flashcards/sets/${mergedId}`);
  const before = canonical(normaliseSet(reviewed.data));
  const historyBefore = mergedCards[0] ? await as('s1')(`/api/flashcards/${mergedCards[0].id}/reviews`) : null;
  check('histórico do cartão juntado tem 1 revisão antes do modelo', (historyBefore?.data?.length ?? historyBefore?.data?.reviews?.length) === 1, { http: historyBefore?.status });
  const apply = await as('s1')(`/api/flashcards/sets/${mergedId}/template`, { method: 'PUT', body: { templateId } });
  expect('aplica UM modelo visual ao baralho inteiro', apply, 200);
  const afterSet = await as('s1')(`/api/flashcards/sets/${mergedId}`);
  const after = canonical(normaliseSet(afterSet.data));
  check('modelo aplicado ao conjunto inteiro (template_id do conjunto)', afterSet.data?.template_id === templateId, { http: afterSet.status });
  check('trocar o modelo não mudou conteúdo, fontes nem agenda dos cartões', before === after && mergedCards.length > 0, { note: `${mergedCards.length} cartões comparados` });
  const historyAfter = mergedCards[0] ? await as('s1')(`/api/flashcards/${mergedCards[0].id}/reviews`) : null;
  check('trocar o modelo não mudou o histórico de revisão', JSON.stringify(historyBefore?.data) === JSON.stringify(historyAfter?.data));
  const origin = afterSet.data?.config?.origin || {};
  check('origem da junção registra as 4 fontes', origin.kind === 'merge' && ['s2', 's3', 's4', 's5'].every((r) => origin.sources?.some((s) => s.setId === state.decks[r].setId)));
  for (const role of ['s2', 's3', 's4', 's5']) {
    const set = await as(role)(`/api/flashcards/sets/${state.decks[role].setId}`);
    const same = canonical(normaliseSet(set.data)) === state.decks[role].snapshot && (set.data?.cards?.length || 0) > 0;
    const history = role === 's2' && state.s2Card ? JSON.stringify((await as('s2')(`/api/flashcards/${state.s2Card}/reviews`)).data) : null;
    check(`original de ${role} intacto (conteúdo, autoria${role === 's2' ? ', histórico' : ''})`, set.status === 200 && same && history === state.decks[role].history, { http: set.status });
  }
  const s2sees = await as('s2')(`/api/flashcards/sets/${mergedId}`);
  expect('o baralho juntado é pessoal: s2 não o lê → 404', s2sees, 404);
  privateItem('s1', 'baralho juntado', `/api/flashcards/sets/${mergedId}`);
  state.mergedId = mergedId;
}

// ---------------------------------------------------------------- 6. resources & revocation
async function step6() {
  current = '6';
  const classId = state.classId;
  const resourceId = randomUUID();
  const add = await as('teacher')(`/api/classrooms/${classId}/resources`, { method: 'POST', body: { id: resourceId, title: 'Leitura de apoio (sintética)', url: 'https://example.test/leitura', description: 'Link fictício' } });
  expect('professor adiciona link de apoio', add, 201);
  const http = await as('teacher')(`/api/classrooms/${classId}/resources`, { method: 'POST', body: { id: randomUUID(), title: 'inseguro', url: 'http://example.test/x' } });
  expect('link sem https é recusado', http, 400);
  const seen = await as('s3')(`/api/classrooms/${classId}/resources`);
  check('membro vê o link', seen.status === 200 && seen.data?.some((r) => r.id === resourceId), { http: seen.status });
  expect('outsider não vê links → 404', await as('outsider')(`/api/classrooms/${classId}/resources`), 404);
  expect('professor remove o link', await as('teacher')(`/api/classrooms/${classId}/resources/${resourceId}`, { method: 'DELETE' }), 200);
  const gone = await as('s3')(`/api/classrooms/${classId}/resources`);
  check('link some para os membros', gone.status === 200 && !gone.data?.some((r) => r.id === resourceId), { http: gone.status });
  // Revoking an approved contribution (s7's deck): gone at once for members.
  const contributionId = state.decks.s7.contributionId;
  const sharedId = state.decks.s7.sharedId;
  const before = await as('s4')(`/api/classrooms/${classId}/flashcard-sets/${sharedId}`);
  expect('antes da revogação s4 lê o baralho de s7', before, 200);
  const revoke = await as('s7')(`/api/classrooms/${classId}/contributions/${contributionId}`, { method: 'DELETE' });
  expect('s7 para de compartilhar (revoga) o baralho aprovado', revoke, 200);
  const after = await as('s4')(`/api/classrooms/${classId}/flashcard-sets/${sharedId}`);
  expect('depois da revogação s4 recebe 404', after, 404);
  const list = await as('s4')(`/api/classrooms/${classId}/flashcard-sets`);
  check('o baralho revogado sai da lista da turma', list.status === 200 && !list.data?.some((s) => s.sharedId === sharedId), { http: list.status });
  const own = await as('s7')(`/api/flashcards/sets/${state.decks.s7.setId}`);
  expect('o original de s7 continua com o dono', own, 200);
  expect('outsider nunca lê o baralho de s7', await as('outsider')(`/api/classrooms/${classId}/flashcard-sets/${sharedId}`), 404);
}

// ---------------------------------------------------------------- 8. apkg
async function step8() {
  current = '8';
  const pkg = legacyApkg();
  const preview = await as('s3')('/api/flashcards/import/apkg?mode=preview', { method: 'POST', raw: pkg });
  // The preview answers 201 like create (contract fixed in backend/tests/flashcards-v3-http.test.js).
  const before = await as('s3')('/api/flashcards/sets');
  check('prévia do .apkg (3 notas, 1 imagem)', [200, 201].includes(preview.status) && preview.data?.notes === 3 && preview.data?.images === 1, { http: preview.status, note: `notas ${preview.data?.notes}, imagens ${preview.data?.images}` });
  const afterPreview = await as('s3')('/api/flashcards/sets');
  check('a prévia não cria nada', canonical(before.data) === canonical(afterPreview.data), { http: afterPreview.status });
  const id = randomUUID();
  const create = await as('s3')(`/api/flashcards/import/apkg?mode=create&id=${id}&name=${encodeURIComponent(`Anki sintético ${RUN}`)}&templateBase=classic`, { method: 'POST', raw: pkg });
  expect('importa o .apkg com imagem', create, 201);
  const set = await as('s3')(`/api/flashcards/sets/${id}`);
  const media = (set.data?.cards || []).flatMap((c) => c.media || []);
  check('cartão importado tem a imagem com URL assinada', set.status === 200 && media.length >= 1 && Boolean(media[0]?.url), { http: set.status, note: `${media.length} mídia(s)` });
  const html = JSON.stringify(set.data?.cards?.map((c) => [c.front, c.back]) || []);
  check('marcação HTML do Anki não é guardada como HTML', !/<b>|<img|<br/i.test(html));
  if (media[0]?.url) {
    const image = await send('', media[0].url);
    check('a imagem baixa pela URL assinada (PNG)', image.status === 200 && image.bytes > 0, { http: image.status, note: image.type });
  }
  const bad = await as('s3')(`/api/flashcards/import/apkg?mode=create&id=${randomUUID()}`, { method: 'POST', raw: Buffer.from('não é um zip') });
  expect('arquivo inválido é recusado sem criar nada', bad, [400, 415, 422]);
  privateItem('s3', 'baralho importado do .apkg', `/api/flashcards/sets/${id}`);
}

// ---------------------------------------------------------------- 9. multi-lesson
async function step9() {
  current = '9';
  const teacher = as('teacher');
  const subject = await teacher('/api/catalog/subjects', { method: 'POST', body: { name: `Biologia E2E ${RUN}` } });
  expect('cria disciplina', subject, 201);
  const subjectId = subject.data?.id;
  const u1 = await teacher(`/api/catalog/subjects/${subjectId}/units`, { method: 'POST', body: { title: 'Unidade 1 — energia' } });
  const u2 = await teacher(`/api/catalog/subjects/${subjectId}/units`, { method: 'POST', body: { title: 'Unidade 2 — divisão' } });
  check('cria 2 unidades', u1.status === 201 && u2.status === 201, { http: `${u1.status}/${u2.status}` });
  for (const [key, unit] of [['A', u1], ['B', u1], ['C', u2]]) {
    const assign = await teacher(`/api/catalog/materials/${state.lessons[key].id}`, { method: 'PATCH', body: { subjectId, unitId: unit.data?.id } });
    if (assign.status !== 200) expect(`vincula aula ${key}`, assign, 200);
  }
  pass('aulas A, B (unidade 1) e C (unidade 2) vinculadas');
  const lessonIds = ['A', 'B', 'C'].map((k) => state.lessons[k].id);
  const byLessons = await teacher('/api/multi-lesson/preview', { method: 'POST', body: { selection: { kind: 'lessons', ids: [...lessonIds, state.lessons.S1.id] } } });
  check('prévia por aulas: 3 incluídas; aula de outra conta fica em missing', byLessons.status === 200 && byLessons.data?.included?.length === 3 && byLessons.data?.missing >= 1, { http: byLessons.status, note: `incluídas ${byLessons.data?.included?.length}, missing ${byLessons.data?.missing}` });
  const selection = { kind: 'units', ids: [u1.data?.id, u2.data?.id] };
  const byUnits = await teacher('/api/multi-lesson/preview', { method: 'POST', body: { selection } });
  check('prévia por várias unidades: 3 aulas confirmadas', byUnits.status === 200 && byUnits.data?.included?.length === 3, { http: byUnits.status });
  const foreign = await as('s1')('/api/multi-lesson/preview', { method: 'POST', body: { selection: { kind: 'lessons', ids: lessonIds } } });
  check('outra conta pede as aulas do professor: 0 incluídas (nada revelado)', foreign.status === 200 && foreign.data?.included?.length === 0, { http: foreign.status });
  const id = randomUUID();
  const requestId = randomUUID();
  const body = { id, requestId, title: `Integrado E2E ${RUN}`, selection, outputs: ['summary', 'questions', 'flashcards'], settings: { questionCount: 4, flashcardCount: 5, focus: 'conceitos' }, expectedRevisionIds: byUnits.data?.included?.map((i) => i.revisionId) };
  const create = await teacher('/api/multi-lesson', { method: 'POST', body });
  check('gera material integrado (202)', create.status === 202 && ['start', 'reuse', 'join'].includes(create.data?.generation?.decision), { http: create.status, note: create.data?.generation?.decision });
  const again = await teacher('/api/multi-lesson', { method: 'POST', body });
  check('repetir o mesmo requestId devolve o mesmo material', again.status === 202 && (again.data?.multiLesson?.id ?? again.data?.id) === (create.data?.multiLesson?.id ?? id), { http: again.status });
  const mlId = create.data?.multiLesson?.id || id;
  let ml;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    ml = await teacher(`/api/multi-lesson/${mlId}`);
    if (['ready', 'failed'].includes(ml.data?.status)) break;
    await sleep(1500);
  }
  const result = ml?.data?.result || {};
  check('worker conclui o material integrado (IA simulada)', ml?.data?.status === 'ready', { http: ml?.status, kind: 'simulated', note: ml?.data?.status });
  check('resultado tem resumo, questões e flashcards com citações das aulas', Boolean(result.summary) && result.questions?.length > 0 && result.flashcards?.length > 0, { kind: 'simulated', note: `${result.questions?.length} questões, ${result.flashcards?.length} cartões, ${ml?.data?.sources?.length} fontes` });
  state.multiLessonId = mlId;
  privateItem('teacher', 'material integrado', `/api/multi-lesson/${mlId}`);
  if (ml?.data?.status !== 'ready') return;
  // Export questions → answerable list; answer one via the quiz flow.
  const list = await teacher(`/api/multi-lesson/${mlId}/question-list`, { method: 'POST', body: { requestId: randomUUID(), title: 'Lista integrada' } });
  check('salva as questões como lista respondível', list.status === 200 && Boolean(list.data?.batchId), { http: list.status });
  const { materialId, batchId } = list.data || {};
  const quiz = await teacher('/api/quiz-sessions', { method: 'POST', body: { materialId, batchId, feedbackMode: 'immediate' } });
  check('inicia o questionário da lista', [200, 201].includes(quiz.status), { http: quiz.status });
  const sessionId = quiz.data?.id || quiz.data?.session?.id;
  const session = sessionId ? await teacher(`/api/quiz-sessions/${sessionId}`) : null;
  const question = (session?.data?.questions || [])[0];
  if (sessionId && question) {
    const answer = await teacher(`/api/quiz-sessions/${sessionId}/answers`, { method: 'POST', body: { questionId: question.id, selectedIndex: 0 } });
    check('responde uma questão (correção imediata)', answer.status === 200 && typeof answer.data?.correct === 'boolean' && answer.data?.recorded === true, { http: answer.status, note: brief(answer.data).slice(0, 60) });
  } else check('questionário traz questões', false, { note: brief(quiz.data) });
  // Export flashcards → personal deck; a second click returns the same deck.
  const deck1 = await teacher(`/api/multi-lesson/${mlId}/flashcard-set`, { method: 'POST', body: { requestId: randomUUID(), name: 'Cartões integrados' } });
  const deck2 = await teacher(`/api/multi-lesson/${mlId}/flashcard-set`, { method: 'POST', body: { requestId: randomUUID(), name: 'Cartões integrados' } });
  check('salva os flashcards como baralho pessoal', deck1.status === 200 && Boolean(deck1.data?.setId), { http: deck1.status });
  check('segundo clique devolve o MESMO baralho (idempotente)', deck2.status === 200 && deck2.data?.setId === deck1.data?.setId, { http: deck2.status, note: deck2.data?.replayed ? 'replayed' : '' });
  const exportsList = await teacher(`/api/multi-lesson/${mlId}/exports`);
  check('exports lista 1 lista e 1 baralho', exportsList.status === 200 && exportsList.data?.length === 2, { http: exportsList.status });
  privateItem('teacher', 'baralho exportado do integrado', `/api/flashcards/sets/${deck1.data?.setId}`);
  // Share the integrated material with the class (teacher → approved at once), then revoke.
  const contribution = await teacher(`/api/classrooms/${state.classId}/contributions`, { method: 'POST', body: { id: randomUUID(), kind: 'integrated_material', itemId: mlId } });
  check('professor compartilha o integrado com a turma (aprovado na hora)', contribution.status === 201 && contribution.data?.status === 'approved', { http: contribution.status, note: contribution.data?.status });
  const shared = await as('s5')(`/api/classrooms/${state.classId}/integrated-materials`);
  const cid = shared.data?.find((m) => m.title === body.title)?.id || contribution.data?.id;
  const read = await as('s5')(`/api/classrooms/${state.classId}/integrated-materials/${cid}`);
  const text = JSON.stringify(read.data || {});
  check('aluno lê só o conteúdo gerado (sem ids de aula/revisão, startMs, settings)', read.status === 200 && !text.includes(state.lessons.A.id) && !text.includes(state.lessons.A.revisionId) && !/startMs|settings|"report"|conceitos/.test(text), { http: read.status, kind: 'simulated' });
  expect('outsider não lê o integrado da turma → 404', await as('outsider')(`/api/classrooms/${state.classId}/integrated-materials/${cid}`), 404);
  expect('aluno não lê o registro privado /api/multi-lesson/:id → 404', await as('s5')(`/api/multi-lesson/${mlId}`), 404);
  expect('professor para de compartilhar o integrado', await teacher(`/api/classrooms/${state.classId}/contributions/${contribution.data?.id}`, { method: 'DELETE' }), 200);
  expect('depois de revogado o aluno recebe 404', await as('s5')(`/api/classrooms/${state.classId}/integrated-materials/${cid}`), 404);
}

// ---------------------------------------------------------------- 10. generation reuse
async function step10() {
  current = '10';
  const lesson = state.lessons.B;
  const teacher = as('teacher');
  const body = () => ({ sourceRevisionId: lesson.revisionId, idempotencyKey: randomUUID(), options: { format: 'topics', length: 'short' } });
  const answers = await Promise.all(Array.from({ length: 5 }, () => teacher(`/api/materials/${lesson.id}/summaries`, { method: 'POST', body: body() })));
  const jobs = new Set(answers.map((a) => a.data?.jobId));
  const decisions = answers.map((a) => a.data?.generation?.decision);
  check('5 pedidos equivalentes simultâneos → 1 job', answers.every((a) => a.status === 202) && jobs.size === 1, { http: answers.map((a) => a.status).join(','), note: `decisões: ${decisions.join(',')}` });
  check('exatamente 1 start; os outros entram no mesmo (join)', decisions.filter((d) => d === 'start').length === 1 && decisions.filter((d) => d === 'join').length === 4);
  const done = await waitJob('teacher', [...jobs][0]);
  check('worker conclui o resumo (IA simulada)', done.ok, { http: done.status, kind: 'simulated' });
  const reuse = await teacher(`/api/materials/${lesson.id}/summaries`, { method: 'POST', body: { ...body(), reuse: true } });
  check('pedido com reuse:true reaproveita o resultado pronto (sem job novo)', reuse.status === 202 && reuse.data?.generation?.decision === 'reuse' && reuse.data?.jobId === [...jobs][0], { http: reuse.status, note: reuse.data?.generation?.decision });
  const summaries = await teacher(`/api/materials/${lesson.id}/summaries`);
  check('existe 1 resumo (não 5)', summaries.status === 200 && summaries.data?.length === 1, { http: summaries.status, note: `${summaries.data?.length}` });
  const outsider = await as('outsider')(`/api/materials/${lesson.id}/summaries`, { method: 'POST', body: { ...body(), reuse: true } });
  expect('outsider não reaproveita a geração do professor → 404', outsider, [403, 404]);
  if (!BUDGET_BASE) {
    skip('orçamento diário esgotado → 429', { note: 'defina E2E_BUDGET_BASE_URL (API com AI_DAILY_GENERATION_LIMIT baixo) para observar' });
    return;
  }
  const budget = (route, options) => send(BUDGET_BASE, route, { ...options, token: users.teacher.token });
  const fresh = await budget(`/api/materials/${lesson.id}/summaries`, { method: 'POST', body: { ...body(), options: { format: 'definitions', length: 'detailed' } } });
  expect('orçamento esgotado: geração NOVA → 429', fresh, 429, { code: 'GENERATION_BUDGET_EXCEEDED' });
  const free = await budget(`/api/materials/${lesson.id}/summaries`, { method: 'POST', body: { ...body(), reuse: true } });
  check('orçamento esgotado: reutilizar continua grátis (202 reuse)', free.status === 202 && free.data?.generation?.decision === 'reuse', { http: free.status });
}

// ---------------------------------------------------------------- 11. privacy
async function step11() {
  current = '11';
  let denied = 0;
  const failures = [];
  for (const item of state.privacy) {
    for (const role of ['outsider', item.owner === 's4' ? 's5' : 's4', item.owner === 'teacher' ? 's1' : 'teacher']) {
      if (role === item.owner) continue;
      const res = await as(role)(item.route);
      const empty = res.status === 200 && (Array.isArray(res.data) ? res.data.length === 0 : (res.data?.notes || res.data?.annotations || []).length === 0 && !res.data?.id);
      if ([403, 404].includes(res.status) || (item.route.includes('?') && empty)) denied += 1;
      else failures.push(`${role}→${item.label}:${res.status}`);
    }
  }
  check(`${state.privacy.length} recursos privados × outras contas → 403/404 ou vazio`, failures.length === 0, { note: failures.length ? failures.slice(0, 6).join('; ') : `${denied} leituras negadas` });
  // Lists of other accounts never show these ids.
  const ids = state.privacy.map((item) => item.route.match(/[0-9a-f-]{36}/)?.[0]).filter(Boolean);
  const lists = ['/api/materials', '/api/flashcards/sets', '/api/multi-lesson', '/api/annotations', '/api/flashcards?filter=all'];
  const leaks = [];
  for (const role of ['outsider', 's6']) {
    for (const route of lists) {
      const res = await as(role)(route);
      const text = JSON.stringify(res.data || '');
      for (const item of state.privacy) {
        const id = item.route.match(/[0-9a-f-]{36}/)?.[0];
        if (id && item.owner !== role && text.includes(id)) leaks.push(`${role} ${route} ${item.label}`);
      }
    }
  }
  check(`listas do outsider e de s6 não mostram nenhum dos ${ids.length} ids`, leaks.length === 0, { note: leaks.slice(0, 4).join('; ') });
  // Classroom never shows personal notes, histories or unpublished materials.
  const classTexts = [];
  for (const route of ['', '/lessons', '/members', '/submissions', '/flashcard-sets', '/contributions', '/integrated-materials', '/resources']) {
    const res = await as('teacher')(`/api/classrooms/${state.classId}${route}`);
    classTexts.push(JSON.stringify(res.data || ''));
  }
  const all = classTexts.join('\n');
  const leaksClass = [
    ['anotação', state.annotationId],
    ['caderno (texto)', 'Texto da aba A.'],
    ['material não publicado (aula B)', state.lessons.B?.id],
    ['material não publicado (aula C)', state.lessons.C?.id],
    ['baralho juntado (pessoal)', state.mergedId],
  ].filter(([, value]) => value && all.includes(value));
  check('a turma (visão do professor) não mostra anotações, caderno, materiais não publicados nem baralhos pessoais', leaksClass.length === 0, { note: leaksClass.map(([label]) => label).join(', ') });
  const teacherOnStudent = await as('teacher')(`/api/notebooks/${state.lessons.S1.id}`);
  expect('professor não lê o caderno da aula do aluno → 404', teacherOnStudent, [403, 404]);
  const teacherMaterial = await as('teacher')(`/api/materials/${state.lessons.S1.id}`);
  expect('professor não abre o material do aluno direto (/api/materials) → 404', teacherMaterial, [403, 404]);
  const history = await as('teacher')(`/api/flashcards/${state.s2Card}/reviews`);
  expect('professor não lê o histórico de revisão de s2 → 404', history, [403, 404]);
}

// ---------------------------------------------------------------- main
const steps = [
  ['1', step1],
  ['2', step2],
  ['3', step3],
  ['4', step4],
  ['5', step5],
  ['7', step7a],
  ['7', step7b],
  ['6', step6],
  ['8', step8],
  ['9', step9],
  ['10', step10],
  ['11', step11],
];
async function main() {
  console.log(`Voz em Estudo 3.4 — E2E de staging em ${BASE} (rodada ${RUN})`);
  await setup();
  for (const [number, fn] of steps) {
    if (ONLY.size && !ONLY.has(number)) continue;
    current = number;
    try {
      await fn();
    } catch (error) {
      check(`passo ${number} terminou com exceção`, false, { note: String(error?.message || error).slice(0, 200) });
    }
  }
}
try {
  await main();
} catch (error) {
  check('preparação', false, { note: String(error?.message || error).slice(0, 200) });
}
const totals = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
console.log(`\nResumo: ${totals.PASS || 0} PASS, ${totals.FAIL || 0} FAIL, ${totals.SKIP || 0} SKIP`);
if (process.env.E2E_RESULTS_FILE) writeFileSync(process.env.E2E_RESULTS_FILE, JSON.stringify({ run: RUN, base: BASE, results }, null, 2));
process.exit(totals.FAIL ? 1 : 0);
