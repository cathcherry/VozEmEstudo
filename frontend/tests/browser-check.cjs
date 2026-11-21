// Browser + real FFmpeg integration. Supabase and study-generation APIs are simulated.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'),
  backend = path.resolve(root, '../backend');
const express = require(path.join(backend, 'node_modules/express'));
const summaryCalls = [];
const listCalls = [];
const authoringFlags = {};
const listShares = new Map();
const flashcardSets = [];
const flashcardPreviews = [];
const searchCalls = [];
const reports = [],
  errors = [],
  requests = [],
  authCalls = [],
  profileCalls = [],
  accessibility = [];
const user = {
  id: 'test-user',
  email: 'teste@example.test',
  created_at: '2026-09-01T12:00:00Z',
  app_metadata: { providers: ['email', 'google'] },
  user_metadata: { display_name: 'Catharine Teste' },
};
const fixture = (id, title, status = 'PRONTO') => ({
  id,
  title,
  status,
  subject: 'Tecnologia',
  review: {
    state: 'ready_to_generate',
    sourceRevisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    revision: 1,
    permissionRequired: false,
  },
  warnings: [],
  created_at: new Date().toISOString(),
  audio_files: [{ duration_ms: 3000, extension: 'wav' }],
  audio: { duration_ms: 3000, extension: 'wav' },
  transcription: {
    current_revision: 1,
    id: 'fixture-transcription',
    transcription_segments: [
      {
        id: 'seg-1',
        position: 0,
        start_ms: 0,
        end_ms: 1500,
        current_text: 'Um carro elétrico usa energia armazenada em baterias.',
      },
    ],
  },
  summaries: [
    {
      is_current: true,
      version: 1,
      source_transcription_revision: 1,
      text: 'A energia fica nas baterias.',
    },
  ],
  questionBatches: [
    {
      id: 'batch-1',
      generated_count: 1,
      source_transcription_revision: 1,
      questions: [
        {
          id: 'q1',
          statement: 'Onde a energia é armazenada?',
          options: ['Nas baterias', 'Nos pneus', 'No escapamento'],
        },
      ],
    },
  ],
});
const materials = [
  fixture('aula-real', 'Como funciona um carro elétrico'),
  fixture('aula-pendente', 'Aula em processamento', 'PROCESSANDO'),
];
let mode = 'success',
  processFail = false,
  createCount = 0,
  uploadCount = 0,
  generationCount = 0,
  questionFail = false,
  jobPending = false;
const sdk = `export function createClient(url,key,options){window.__authOptions=options;let user=${JSON.stringify(user)};user.user_metadata={...user.user_metadata,...JSON.parse(localStorage.getItem('test-profile')||'{}')};return {auth:{
getSession:async()=>({data:{session:localStorage.getItem('test-logged-out')?null:{user,access_token:'mock-token'}},error:null}),
getUser:async()=>({data:{user},error:null}),
signInWithPassword:async()=>{localStorage.removeItem('test-logged-out');return {data:{session:{user}},error:null}},
signUp:async()=>({data:{session:null},error:null}),
signInWithOAuth:async(body)=>{await fetch('/__auth-call',{method:'POST',body:JSON.stringify(body)});return localStorage.getItem('test-oauth-failure')?{data:null,error:{message:'Provider not enabled'}}:{data:{url:'https://provider.example.test'},error:null}},
exchangeCodeForSession:async(code)=>{await fetch('/__auth-call',{method:'POST',body:JSON.stringify({code})});if(code==='bad')return {error:{message:'Código expirado.'}};localStorage.removeItem('test-logged-out');return {data:{session:{user}},error:null}},
signOut:async()=>{localStorage.setItem('test-logged-out','1');return {error:null}},updateUser:async(body)=>{await fetch('/__profile-call',{method:'POST',body:JSON.stringify(body)});user={...user,user_metadata:{...user.user_metadata,...body.data}};localStorage.setItem('test-profile',JSON.stringify(user.user_metadata));return {data:{user},error:null}}
},storage:{from:()=>({upload:async()=>{await fetch('/__upload',{method:'POST'});return {error:null}},remove:async()=>({error:null})})}}}`;
function record(name) {
  reports.push({ test: name, passed: true });
  console.log('PASS', name);
}
async function screenshot(page, output, filename) {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.overflowAnchor = 'none';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, filename), fullPage: true });
}
async function main() {
  const { PERMISSION_DECLARATION } = await import(
    pathToFileURL(path.join(backend, 'src/config/permission-declaration.js')).href
  );
  let permissionDeclaration = PERMISSION_DECLARATION;
  let mp4Retention = true;
  const processCalls = [];
  const output = path.join(root, 'tests/artifacts');
  fs.mkdirSync(output, { recursive: true });
  const ffmpegStatic = require(path.join(backend, 'node_modules/ffmpeg-static'));
  const ffmpeg =
    process.env.FFMPEG_PATH ||
    (ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg');
  const wav = path.join(output, 'fixture.wav'),
    mp4 = path.join(output, 'fixture.mp4');
  for (const args of [
    ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', wav],
    [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x100:d=3',
      '-i',
      wav,
      '-shortest',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-c:a',
      'aac',
      mp4,
    ],
  ]) {
    const run = spawnSync(ffmpeg, ['-loglevel', 'error', '-y', ...args]);
    assert.equal(run.status, 0, run.stderr?.toString());
  }
  assert(fs.statSync(mp4).size > 1000, 'FFmpeg precisa gerar o arquivo MP4 completo.');
  const wavInput = { name: 'fixture.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(wav) },
    mp4Input = { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(mp4) };
  assert(
    mp4Input.buffer.includes(Buffer.from('moov')),
    'MP4 precisa conter metadados completos antes do navegador.',
  );
  const { mediaRouter } = await import(
    pathToFileURL(path.join(backend, 'src/routes/media.routes.js')).href
  );
  const app = express();
  app.use(
    '/api/media',
    (req, res, next) =>
      req.headers.authorization === 'Bearer mock-token'
        ? next()
        : res.status(401).json({ error: { message: 'Sessão inválida.' } }),
    mediaRouter,
  );
  app.get('/__fixture.mp4', (_req, res) => res.sendFile(mp4));
  app.get('/__fixture.wav', (_req, res) => res.sendFile(wav));
  app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(root, 'assets/brand/favicon.png')));
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.use('/js', express.static(path.join(root, 'js')));
  app.use('/css', express.static(path.join(root, 'css')));
  app.use(express.static(path.join(root, 'pages')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  materials[0].signedAudioUrl = base + '/__fixture.wav';
  const executable = process.env.BROWSER_EXECUTABLE || chromium.executablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: executable,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push({ page: p.url(), error: e.stack || e.message }));
    p.on('requestfailed', (r) => {
      const text = r.failure()?.errorText || '';
      // The mock TUS endpoint drops each upload's first chunk on purpose (resume scenario).
      const intendedDrop =
        r.url().startsWith('https://mock.supabase.co/storage/v1/upload/resumable/') &&
        text.includes('ERR_CONNECTION_RESET');
      if (!text.includes('ERR_ABORTED') && !intendedDrop)
        errors.push(r.url() + ' ' + r.failure()?.errorText);
    });
  });
  await context.addInitScript(() => {
    window.__paints = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__paints.push({
          name: e.name,
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(document.body).backgroundColor,
        });
    }).observe({ type: 'paint', buffered: true });
  });
  await context.route(base + '/js/vendor/supabase.min.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: sdk }),
  );
  await context.route(base + '/api/config', (route) =>
    route.fulfill({
      json: {
        supabaseUrl: 'https://mock.supabase.co',
        supabasePublishableKey: 'mock-publishable-key',
        audioBucket: 'audios',
        featureFlags: { mp4_retention: mp4Retention, ...authoringFlags },
        maxQuestionListCount: 30,
        recordingLanguages: {
          options: ['auto', 'pt', 'en', 'en_uk', 'es', 'zh', 'yue', 'af', 'nn'],
          default: 'pt',
        },
        processingDisclosure: {
          recognitionProvider: 'Provedor ASR de teste',
          textProvider: 'Provedor de texto de teste',
          audioOnly: true,
        },
        oauthProviders: ['google', 'github'],
        permissionDeclaration,
      },
    }),
  );
  await context.route(base + '/__auth-call', (route) => {
    authCalls.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await context.route(base + '/__profile-call', (route) => {
    profileCalls.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await context.route(base + '/__upload', (route) => {
    uploadCount++;
    return route.fulfill({ json: { ok: true } });
  });
  // Minimal TUS endpoint (Supabase resumable uploads). The first chunk of each upload is
  // dropped once, so every scenario also proves the upload resumes instead of failing.
  const tusUploads = new Map();
  await context.route('https://mock.supabase.co/storage/v1/upload/resumable**', async (route) => {
    const request = route.request(),
      headers = request.headers(),
      cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, PATCH, HEAD, OPTIONS',
        'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length',
      };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    assert.equal(headers['tus-resumable'], '1.0.0');
    if (request.method() === 'POST') {
      assert.match(headers.authorization, /^Bearer mock-token$/);
      uploadCount++;
      const id = String(uploadCount);
      tusUploads.set(id, { offset: 0, dropped: false });
      return route.fulfill({
        status: 201,
        headers: { ...cors, Location: `https://mock.supabase.co/storage/v1/upload/resumable/${id}` },
      });
    }
    const upload = tusUploads.get(new URL(request.url()).pathname.split('/').pop());
    if (!upload) return route.fulfill({ status: 404, headers: cors });
    if (request.method() === 'HEAD')
      return route.fulfill({ status: 200, headers: { ...cors, 'Upload-Offset': String(upload.offset) } });
    if (!upload.dropped) {
      upload.dropped = true;
      return route.abort('connectionreset');
    }
    assert.equal(Number(headers['upload-offset']), upload.offset);
    upload.offset += (request.postDataBuffer() || Buffer.alloc(0)).length;
    return route.fulfill({ status: 204, headers: { ...cors, 'Upload-Offset': String(upload.offset) } });
  });
  await context.route(base + '/api/materials**', async (route) => {
    const request = route.request(),
      p = new URL(request.url()).pathname,
      reply = (data, status = 200) => route.fulfill({ status, json: data });
    if (p === '/api/materials' && request.method() === 'GET') {
      await new Promise((r) => setTimeout(r, 200));
      return mode === 'error'
        ? reply({ error: { message: 'Falha simulada.' } }, 503)
        : reply(mode === 'empty' ? [] : materials);
    }
    if (p === '/api/materials' && request.method() === 'POST') {
      createCount++;
      const data = request.postDataJSON();
      requests.push(data);
      const material = fixture(data.id, data.title);
      if (data.extension === 'mp4') {
        material.audio = {
          extension: 'mp4',
          duration_ms: data.durationMs,
          retain_original: data.retainAudio,
        };
        material.signedAudioUrl = base + '/__fixture.mp4';
      }
      materials.unshift(material);
      return reply(material, 201);
    }
    if (p.endsWith('/process')) {
      processCalls.push(request.postDataJSON() || {});
      if (processFail) {
        processFail = false;
        return reply({ error: { message: 'Worker indisponível.' } }, 503);
      }
      return reply({ jobId: 'job-1' });
    }
    if (p.endsWith('/video') && request.method() === 'POST') {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const data = request.postDataJSON();
      m.video = {
        durationMs: data.durationMs,
        clipStartMs: data.clipStartMs,
        clipEndMs: data.clipEndMs,
      };
      m.signedVideoUrl = base + '/__fixture.mp4';
      return reply(m.video);
    }
    if (p.endsWith('/captions')) {
      // Mirrors the server rule: real word timings only while the current text is the ASR text.
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const segment = m.transcription.transcription_segments[0];
      const asr = 'Um carro elétrico usa energia armazenada em baterias.';
      const tokens = asr.split(' ');
      return reply({
        revision: m.transcription.current_revision,
        granularity: segment.current_text === asr ? 'word' : 'segment',
        words:
          segment.current_text === asr
            ? tokens.map((text, i) => ({
                text,
                startMs: Math.round((i * 1500) / tokens.length),
                endMs: Math.round(((i + 1) * 1500) / tokens.length),
                speaker: null,
                segment: 0,
              }))
            : [],
      });
    }
    if (p.endsWith('/playback')) {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      return reply({
        video: m.video,
        signedVideoUrl: m.signedVideoUrl,
        signedAudioUrl: m.signedAudioUrl,
      });
    }
    if (p.endsWith('/summaries')) {
      summaryCalls.push(request.postDataJSON());
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const body = request.postDataJSON();
      for (const summary of m.summaries) summary.is_current = false;
      m.summaries.unshift({
        ...m.summaries[0],
        id: 'summary-' + (m.summaries[0].version + 1),
        version: m.summaries[0].version + 1,
        is_current: true,
        label: body.options?.label || null,
        options: body.options || {},
      });
      return reply({ jobId: 'job-1' });
    }
    if (/\/question-batches\/[^/]+\/shares/.test(p)) {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const batch = m.questionBatches.find((item) => item.id === p.split('/')[5]);
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        listShares.set(body.id, {
          ...body,
          batchId: batch.id,
          snapshot: {
            kind: 'question_list',
            title: batch.title,
            materialTitle: m.title,
            subject: m.subject,
            revision: 1,
            questions: batch.questions.map((q, i) => ({ number: i + 1, statement: q.statement, options: q.options })),
          },
        });
        return reply({ id: body.id, expiresAt: new Date(Date.now() + body.days * 86400000).toISOString() });
      }
      if (request.method() === 'DELETE') {
        listShares.get(p.split('/').pop()).revoked = true;
        return reply({ id: p.split('/').pop() });
      }
      return reply({
        shares: [...listShares.values()]
          .filter((item) => item.batchId === batch.id)
          .map((item) => ({
            id: item.id,
            expires_at: new Date(Date.now() + item.days * 86400000).toISOString(),
            revoked_at: item.revoked ? new Date().toISOString() : null,
          })),
      });
    }
    if (p.endsWith('/answer-key')) {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const batch = m.questionBatches.find((item) => item.id === p.split('/')[5]);
      return reply({
        id: batch.id,
        title: batch.title,
        questions: batch.questions.map((q, i) => ({
          ...q,
          correctIndex: 1,
          explanation: `Explicação da aula ${i + 1}.`,
        })),
      });
    }
    if (/\/question-batches\/[^/]+$/.test(p) && request.method() === 'PATCH') {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const batch = m.questionBatches.find((item) => item.id === p.split('/').pop());
      listCalls.push({ rename: request.postDataJSON() });
      batch.title = request.postDataJSON().title;
      return reply(batch);
    }
    if (p.endsWith('/question-batches')) {
      generationCount++;
      const m = materials.find((item) => item.id === p.split('/')[3]),
        body = request.postDataJSON(),
        count = body.count;
      listCalls.push(body);
      if (!questionFail && body.config) {
        // Mirrors the server: a thin lesson yields fewer distinct questions than requested.
        const generated = Math.max(1, count - 2);
        m.questionBatches.unshift({
          id: 'list-' + generationCount,
          title: body.config.title || null,
          config: body.config,
          requested_count: count,
          generated_count: generated,
          coverage: { shortfall: 'insufficient_content' },
          source_transcription_revision: m.transcription.current_revision,
          created_at: new Date().toISOString(),
          questions: Array.from({ length: generated }, (_, i) => ({
            id: `list-${generationCount}-q${i}`,
            statement: `Questão planejada ${i + 1} sobre energia?`,
            options: ['A', 'B', 'C', 'D'],
          })),
        });
        return reply({ jobId: 'job-1' });
      }
      if (!questionFail)
        m.questionBatches.unshift({
          ...m.questionBatches[0],
          id: 'generated-' + generationCount,
          generated_count: count,
        });
      return reply({ jobId: questionFail ? 'job-failed' : 'job-1' });
    }
    if (request.method() === 'PATCH' && !p.endsWith('/transcription')) {
      const m = materials.find((item) => item.id === p.split('/').pop());
      Object.assign(m, request.postDataJSON());
      return reply(m);
    }
    if (p.endsWith('/transcription/review'))
      return reply(materials.find((m) => m.id === p.split('/')[3]).review);
    if (p.endsWith('/transcription/confirm')) {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      m.review = {
        ...m.review,
        state: 'ready_to_generate',
        confirmation: { id: 'fixture-confirmation', confirmedAt: new Date().toISOString() },
      };
      return reply(m.review);
    }
    if (p.endsWith('/transcription/versions') && request.method() === 'GET') {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      const baseVersion = {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        revision: 1,
        origin: 'ASR',
        created_at: new Date().toISOString(),
        full_text: 'Um carro elétrico usa energia armazenada em baterias.',
        segments_snapshot: [
          {
            id: 'seg-1',
            position: 0,
            startMs: 0,
            endMs: 1500,
            text: 'Um carro elétrico usa energia armazenada em baterias.',
          },
        ],
      };
      return reply(
        m.transcription.current_revision === 1
          ? [baseVersion]
          : [
              {
                ...baseVersion,
                id: m.review.sourceRevisionId,
                revision: m.transcription.current_revision,
                origin: 'EDICAO_USUARIO',
              },
              baseVersion,
            ],
      );
    }
    if (p.endsWith('/restore')) {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      m.transcription.current_revision += 1;
      m.transcription.transcription_segments[0].current_text =
        'Um carro elétrico usa energia armazenada em baterias.';
      m.review = {
        ...m.review,
        state: 'awaiting_review',
        revision: m.transcription.current_revision,
        sourceRevisionId:
          'eeeeeeee-eeee-4eee-8eee-eeeeeeee' +
          String(m.transcription.current_revision).padStart(4, '0'),
        confirmation: null,
      };
      return reply({ revision: m.transcription.current_revision });
    }
    if (p.endsWith('/transcription')) {
      const m = materials.find((item) => item.id === p.split('/')[3]);
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        for (const segment of body.segments)
          m.transcription.transcription_segments.find(
            (item) => item.id === segment.id,
          ).current_text = segment.text;
        m.transcription.current_revision += 1;
        m.review = {
          ...m.review,
          state: 'awaiting_review',
          revision: m.transcription.current_revision,
          sourceRevisionId:
            'eeeeeeee-eeee-4eee-8eee-eeeeeeee' +
            String(m.transcription.current_revision).padStart(4, '0'),
          confirmation: null,
        };
      }
      return reply({ revision: m.transcription.current_revision });
    }
    const found = materials.find((m) => m.id === p.split('/').pop());
    return found
      ? reply(found)
      : reply({ error: { code: 'NOT_FOUND', message: 'Material não encontrado.' } }, 404);
  });
  await context.route(base + '/api/flashcards?**', (route) =>
    route.fulfill({ json: { cards: [], total: 0, limit: 100, offset: 0 } }),
  );
  await context.route(base + '/api/flashcards/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname;
    if (p.endsWith('/preview')) {
      const body = request.postDataJSON();
      flashcardPreviews.push(body);
      const cards =
        body.count === 1
          ? [{ front: 'Cartão substituto', back: 'Verso substituto.', evidence: 'Um carro elétrico usa energia armazenada em baterias.' }]
          : [1, 2, 3].slice(0, body.count).map((i) => ({
              front: `Cartão ${i}`,
              back: `Verso ${i}.`,
              evidence: 'Um carro elétrico usa energia armazenada em baterias.',
              sourceSegments: [{ position: 0, startMs: 0, endMs: 1500 }],
              difficulty: 'basic',
              focus: 'concepts',
              style: body.config.style,
            }));
      return route.fulfill({
        json: { cards, requested: body.count, revision: 2, shortfall: cards.length < body.count ? 'Somente estes cartões distintos têm apoio na transcrição.' : null },
      });
    }
    if (p === '/api/flashcards/sets' && request.method() === 'POST') {
      const body = request.postDataJSON();
      const set = {
        id: body.id,
        name: body.name,
        material_id: body.materialId,
        source_revision_id: body.sourceRevisionId,
        status: 'active',
        card_count: body.cards.length,
        due_count: body.cards.length,
        body,
        cards: body.cards.map((c, i) => ({ id: `${body.id}-${i}`, front_text: c.front, back_text: c.back, difficulty: c.difficulty, focus: c.focus, card_style: c.style, evidence: c.evidence })),
      };
      flashcardSets.push(set);
      return route.fulfill({ status: 201, json: { ...set, added: body.cards.length } });
    }
    if (p === '/api/flashcards/sets') return route.fulfill({ json: flashcardSets });
    if (p.startsWith('/api/flashcards/sets/'))
      return route.fulfill({ json: flashcardSets.find((set) => set.id === p.split('/').pop()) });
    return route.fulfill({ json: { cards: [], total: 0, limit: 100, offset: 0 } });
  });
  await context.route(base + '/api/search?**', (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q'),
      scope = url.searchParams.get('scope');
    searchCalls.push({ q, scope });
    const hit = {
      materialId: 'aula-real',
      lessonTitle: 'Carros elétricos — energia',
      subject: 'Física',
      total: 1,
      hits: [{ position: 0, startMs: 0, endMs: 1500, snippet: 'Um carro elétrico usa energia armazenada em baterias.' }],
    };
    const empty = { query: q, lessons: [], questions: [], transcripts: [] };
    if (q === 'energia')
      return route.fulfill({
        json: {
          ...empty,
          lessons: [{ materialId: 'aula-real', title: 'Carros elétricos — energia', subject: 'Física' }],
          questions: [{ questionId: 'q1', batchId: 'batch-1', materialId: 'aula-real', lessonTitle: 'Carros elétricos — energia', number: 1, statement: 'Onde a energia é armazenada?' }],
          transcripts: [hit],
        },
      });
    if (q === 'baterias') return route.fulfill({ json: { ...empty, transcripts: scope === 'all' || scope === 'transcripts' ? [hit] : [] } });
    return route.fulfill({ json: empty });
  });
  // Material-level shares are outside this scenario: an empty list keeps that panel quiet.
  await context.route(base + '/api/sharing/**', (route) =>
    route.fulfill({ json: { shares: [], total: 0, offset: 0, limit: 50 } }),
  );
  await context.route(base + '/api/shared-question-list', (route) => {
    const { token } = route.request().postDataJSON();
    const share = [...listShares.values()].find((item) => item.token === token && !item.revoked);
    return share
      ? route.fulfill({ json: share.snapshot })
      : route.fulfill({ status: 404, json: { error: { message: 'Link indisponível.' } } });
  });
  await context.route(base + '/api/jobs/**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/events')
        ? []
        : new URL(route.request().url()).pathname.endsWith('/job-failed')
          ? { status: 'FALHOU', error_message: 'Falha simulada na geração.' }
          : jobPending === 'polling'
            ? {
                status: 'AGUARDANDO_REPETICAO',
                error_code: null,
                current_stage: 'TRANSCRICAO',
                created_at: new Date(Date.now() - 125000).toISOString(),
              }
            : jobPending === 'retry'
              ? {
                  status: 'AGUARDANDO_REPETICAO',
                  error_code: 'ASR_PROVIDER_UNAVAILABLE',
                  attempt_count: 1,
                  max_attempts: 3,
                  created_at: new Date(Date.now() - 125000).toISOString(),
                }
              : jobPending
                ? {
                    status: 'EM_EXECUCAO',
                    current_stage: 'TRANSCRICAO',
                    created_at: new Date(Date.now() - 125000).toISOString(),
                  }
                : { status: 'CONCLUIDA' },
    }),
  );
  await context.route(base + '/api/questions/**', (route) =>
    route.fulfill({
      json: { correct: true, correctIndex: 0, explanation: 'A energia fica nas baterias.' },
    }),
  );
  const page = await context.newPage();
  try {
    await page.goto(base + '/index.html');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await screenshot(page, output, 'landing-desktop.png');
    assert.equal(await page.locator('#recursos .ve-features > article').count(), 3);
    assert.equal(await page.locator('#sobre .ve-team').count(), 1);
    record('Landing com recursos, jornada, personalização, equipe e FAQ');
    await page.evaluate(() => localStorage.setItem('audioestudo-theme', 'night'));
    await page.goto(base + '/painel.html');
    await page.waitForFunction(
      () => document.querySelector('[data-dashboard-data]')?.getAttribute('aria-busy') === 'false',
    );
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
    assert((await page.evaluate(() => window.__paints)).every((p) => p.theme === 'night'));
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      'rgb(14, 27, 42)',
    );
    await screenshot(page, output, 'dashboard-night.png');
    record('Tema noturno aplicado antes da primeira pintura');
    await page.evaluate(() => localStorage.setItem('audioestudo-theme', 'paper'));
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('[data-dashboard-data]')?.getAttribute('aria-busy') === 'false',
    );
    assert.match(await page.locator('[data-overview]').textContent(), /2 aulas no acervo/);
    assert.equal(await page.locator('main .theme-option').count(), 0);
    assert.equal(await page.locator('.insights-rail').count(), 0);
    assert.equal(await page.locator('[data-recent-list] .dashboard-lesson-card').count(), 2);
    await screenshot(page, output, 'dashboard-desktop.png');
    record('Painel como biblioteca, com dados reais e sem controles de tema no conteúdo');
    await page.getByRole('button', { name: 'Recolher barra lateral', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'true');
    assert.equal(
      await page
        .locator('.side-navigation')
        .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
      76,
    );
    await page.getByRole('button', { name: 'Expandir barra lateral', exact: true }).click();
    await page.getByRole('button', { name: 'Modo foco', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'true');
    assert.equal(await page.locator('.focus-secondary').first().isVisible(), false);
    assert.equal(await page.locator('.side-navigation').isVisible(), false);
    assert.equal(await page.locator('.app-toast:visible').count(), 0, 'Quick toggle is silent');
    // In focus mode the bottom dock is the only navigation: no sidebar and no menu button.
    assert.equal(await page.locator('[data-menu-toggle]').isVisible(), false);
    assert.equal(await page.locator('html').getAttribute('data-nav-dock'), 'true');
    const focusDockTrigger = page.getByRole('button', {
      name: 'Mostrar navegação do modo foco',
      exact: true,
    });
    assert.equal(await focusDockTrigger.isVisible(), true);
    const handle = await focusDockTrigger.boundingBox();
    assert(
      handle.width <= 140 && handle.height <= 28,
      'Dock handle must not cover the page bottom',
    );
    await focusDockTrigger.focus();
    assert.equal(await page.locator('#focus-dock').getAttribute('data-open'), 'true');
    // Revisar and Planejar exist in the dock but stay hidden while their features are off.
    assert.equal(await page.locator('#focus-dock a:visible').count(), 4);
    assert.equal(await page.locator('#focus-dock a').count(), 6);
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('[data-dashboard-data]').getAttribute('aria-busy') === 'false',
    );
    assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'true');
    assert.equal(
      await page
        .getByRole('button', { name: 'Mostrar navegação do modo foco', exact: true })
        .isVisible(),
      true,
    );
    await page.getByRole('button', { name: 'Sair do modo foco', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'false');
    await page.getByRole('button', { name: 'Modo foco', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'true');
    await screenshot(page, output, 'dashboard-focus.png');
    await page.getByRole('button', { name: 'Sair do modo foco', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-sidebar-collapsed'), 'false');
    record('Sidebar recolhível; foco usa navegação inferior e restaura preferência ao sair');
    await page.keyboard.press('Shift+Slash');
    const shortcuts = page.getByRole('dialog', { name: 'Atalhos de teclado' });
    await shortcuts.waitFor();
    assert.match(await shortcuts.textContent(), /Alt \+ F.*modo foco/);
    await page.keyboard.press('Escape');
    await shortcuts.waitFor({ state: 'hidden' });
    record('Atalhos de teclado em "?", fecha com Esc');
    await page.goto(base + '/nova-transcricao.html');
    await page.locator('[data-dropzone]').waitFor();
    assert.equal(await page.locator('[data-upload-editor]').isVisible(), false);
    assert.equal(await page.getByText('Nenhum arquivo selecionado', { exact: false }).count(), 0);
    await screenshot(page, output, 'upload-empty-desktop.png');
    await page.locator('#audio-file').setInputFiles({
      name: 'anotacoes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('texto'),
    });
    assert.equal(await page.locator('[data-dropzone]').getAttribute('data-state'), 'error');
    assert.match(await page.locator('.app-toast').textContent(), /Use MP4, MP3/);
    assert.equal(await page.locator('[data-wizard-next]').isDisabled(), true);
    record('Área de envio única, com estado de erro para formato inválido');
    await page.locator('#audio-file').setInputFiles(mp4Input);
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
    assert.equal(await page.locator('[data-dropzone]').isVisible(), false);
    assert.match(
      await page.locator('[data-file-details]').textContent(),
      /^MP4 · [\d,]+ KB · 00:03$/,
    );
    await page.locator('[data-trim-start]').fill('0.8');
    await page.locator('[data-trim-end]').fill('1.55');
    await page.getByRole('button', { name: 'Ouvir trecho', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('video').paused &&
        document.querySelector('video').currentTime >= 1.5,
      null,
      { timeout: 6000 },
    );
    record('MP4 com prévia e reprodução limitada ao recorte');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar trecho', exact: true }).click();
    const download = await downloadPromise;
    assert(download.suggestedFilename().endsWith('.mp4'));
    await download.saveAs(path.join(output, 'clip.mp4'));
    record('Download real do recorte MP4');
    assert.equal(await page.locator('[data-trim-duration]').textContent(), '00:00 → 00:01 · 00:00');
    await screenshot(page, output, 'player-desktop.png');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    assert.equal(
      await page.locator('[aria-current="step"]').getAttribute('data-workflow-step'),
      '2',
    );
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    assert.equal(await page.locator('[data-trim-start-range]').inputValue(), '0.8');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.locator('#class-title').fill('Aula de teste recortada');
    assert.equal(await page.locator('#keep-original-video').isEnabled(), true);
    assert.equal(await page.locator('#keep-original-video').isChecked(), false);
    assert.match(
      await page.locator('[data-provider-disclosure]').textContent(),
      /Provedor ASR de teste.*Provedor de texto de teste/,
    );
    await screenshot(page, output, 'identification-desktop.png');
    record('Áudio e vídeo têm escolhas separadas, opt-in; aviso de provedores vem da configuração');
    await page.locator('#keep-original-audio').check();
    await page.locator('#upload-tags').fill('solos');
    await page.locator('#upload-tags').press('Enter');
    await page.locator('#upload-tags').fill('preparação,');
    assert.equal(await page.locator('.tag-chip').count(), 2);
    assert.equal(await page.locator('[data-dropzone]').isVisible(), false);
    assert.equal(await page.locator('#permission-declaration').isChecked(), false);
    await page.getByRole('button', { name: 'Revisar envio', exact: true }).click();
    assert.equal(await page.locator('[data-upload-review]').isVisible(), false);
    await page.locator('#permission-declaration').check();
    await page.getByRole('button', { name: 'Revisar envio', exact: true }).click();
    assert.equal(await page.locator('[data-upload-choice-list]').locator('dt').count(), 9);
    assert.match(await page.locator('[data-upload-choice-list]').textContent(), /IdiomaPortuguês/);
    // Spoken language of the recording: separate from the interface language, default from server.
    await page.getByRole('button', { name: 'Editar', exact: true }).last().click();
    assert.equal(await page.getByLabel('Idioma da gravação').inputValue(), 'pt');
    // Automatic and Portuguese first, then every language by its Portuguese name.
    assert.deepEqual(
      await page.locator('#recording-language option').allTextContents(),
      [
        'Detectar automaticamente',
        'Português',
        'Africâner',
        'Chinês (cantonês)',
        'Chinês (mandarim)',
        'Espanhol',
        'Inglês',
        'Inglês (Reino Unido)',
        'Norueguês (nynorsk)',
      ],
    );
    await page.getByLabel('Idioma da gravação').selectOption('es');
    await page.getByRole('button', { name: 'Revisar envio', exact: true }).click();
    assert.equal(await page.locator('[data-upload-choice-list]').locator('dt').count(), 9);
    assert.match(await page.locator('[data-upload-choice-list]').textContent(), /IdiomaEspanhol/);
    await screenshot(page, output, 'upload-review-desktop.png');
    assert(
      (await page.locator('[data-upload-choice-list]').textContent()).includes('00:00 → 00:01'),
    );
    record('Permissão não pré-marcada e escolhas revisadas antes do envio');
    permissionDeclaration = {
      version: 'permission-test-updated',
      text: PERMISSION_DECLARATION.text + ' Texto atualizado na fixture.',
    };
    await page.getByRole('button', { name: 'Enviar e transcrever', exact: true }).click();
    await page
      .getByText('A declaração mudou. Leia e confirme novamente antes de enviar.', { exact: true })
      .waitFor();
    assert.equal(await page.locator('#permission-declaration').isChecked(), false);
    assert.equal(uploadCount, 0);
    assert.equal(createCount, 0);
    assert(
      (await page.locator('[data-permission-label]').textContent()).includes(
        'Texto atualizado na fixture',
      ),
    );
    await page.locator('#permission-declaration').check();
    await page.getByRole('button', { name: 'Revisar envio', exact: true }).click();
    record('Mudança da declaração exige nova leitura/confirmação antes de enviar bytes');
    processFail = true;
    await page.locator('[data-upload-review] [type="submit"]').evaluate((button) => {
      button.click();
      button.click();
    });
    await page.getByRole('button', { name: 'Tentar processamento', exact: true }).waitFor();
    assert.equal(requests[0].permissionAccepted, true);
    assert.deepEqual(processCalls.at(-1), { recordingLanguage: 'es' });
    assert.equal(requests[0].permissionVersion, permissionDeclaration.version);
    assert.equal(requests[0].durationMs, 750);
    // The excerpt goes up as compact mono MP3, not uncompressed WAV.
    assert.equal(requests[0].extension, 'mp3');
    assert.equal(requests[0].mimeType, 'audio/mpeg');
    assert.match(requests[0].storagePath, /-trecho\.mp3$/);
    assert.equal(uploadCount, 1);
    assert.equal(createCount, 1);
    await page.getByRole('button', { name: 'Tentar processamento', exact: true }).click();
    await page.waitForURL('**/material.html?**');
    assert.equal(uploadCount, 1);
    assert.equal(createCount, 1);
    assert.deepEqual(processCalls.slice(-2), [
      { recordingLanguage: 'es' },
      { recordingLanguage: 'es' },
    ]);
    record(
      'Só o áudio do recorte é enviado; retry não repete upload nem perde o idioma da gravação',
    );
    await page.goto(base + '/historico.html');
    await page.locator('[data-library-data][aria-busy="false"]').waitFor();
    await page.locator('#library-search').press('Shift+Slash');
    assert.equal(
      await page.locator('.shortcuts-dialog[open]').count(),
      0,
      '"?" while typing is text',
    );
    await page.locator('#library-search').fill('inexistente');
    await page.getByText('Nenhuma aula encontrada.', { exact: true }).waitFor();
    await page.locator('#library-search').fill('carro');
    await page
      .locator('.library-subject-folder > summary')
      .filter({ hasText: 'Tecnologia' })
      .click();
    const row = page.locator('[data-material-id="aula-real"]');
    await row.locator('.row-menu > summary').click();
    // Open, correct the transcript and organize metadata are distinct actions.
    assert.equal(await row.getByRole('button', { name: 'Editar', exact: true }).count(), 0);
    assert.equal(
      await row.getByRole('link', { name: 'Editar transcrição', exact: true }).getAttribute('href'),
      './material.html?id=aula-real&edit=transcricao#transcricao',
    );
    assert.equal(
      await row.getByRole('link', { name: 'Abrir aula', exact: true }).getAttribute('href'),
      './material.html?id=aula-real',
    );
    await row.getByRole('button', { name: 'Editar informações', exact: true }).click();
    await page.locator('#metadata-dialog[open]').waitFor();
    {
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const organizeViolations = await page.evaluate(async () =>
        (await axe.run(document.querySelector('#metadata-dialog'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map((v) => v.id),
      );
      assert.deepEqual(organizeViolations, [], 'organize dialog accessibility');
    }
    assert(
      (await page.locator('#metadata-dialog').evaluate((d) => d.getBoundingClientRect().width)) <= 420,
      'organize dialog is compact',
    );
    await page.locator('#metadata-name').fill('Carros elétricos — energia');
    await page.locator('#metadata-subject').fill('Física');
    await page.locator('#metadata-tags').fill('energia, revisão, energia');
    await page.getByRole('button', { name: 'Salvar organização', exact: true }).click();
    await page.locator('#metadata-dialog').waitFor({ state: 'hidden' });
    await page.goBack();
    await page.locator('#library-search').fill('revisão');
    await page
      .locator('[data-library-count]')
      .filter({ hasText: '1 aula' })
      .waitFor({ state: 'attached' });
    assert.equal(await page.locator('.library-material').count(), 1);
    assert.equal(materials.find((m) => m.id === 'aula-real').subject, 'Física');
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    await page.locator('#library-tag').selectOption('revisão');
    assert.equal(await page.locator('.library-material').count(), 1);
    await page.locator('#library-subject').selectOption('Física');
    assert(
      await page
        .locator('.library-subject-folder > summary strong')
        .filter({ hasText: 'Física' })
        .isVisible(),
    );
    await page.reload();
    await page.locator('[data-library-data][aria-busy="false"]').waitFor();
    await page.locator('#library-search').fill('revisão');
    assert.equal(await page.locator('.library-material').count(), 1);
    await page.locator('.library-subject-folder > summary').filter({ hasText: 'Física' }).click();
    await screenshot(page, output, 'library-desktop.png');
    record('Busca por tags, filtros por disciplina e edição de título; tags persistem por conta');
    await page.locator('[data-material-id="aula-real"] .row-menu > summary').click();
    await page
      .getByRole('link', {
        name: 'Gerar novas questões para Carros elétricos — energia',
        exact: true,
      })
      .click();
    await page.locator('[data-questions-dialog][open]').waitFor();
    assert.equal(
      await page.locator('#more-question-count').evaluate((n) => document.activeElement === n),
      true,
    );
    await page.locator('#more-question-count').selectOption('10');
    await page.locator('[data-more-questions-form] [type=submit]').click();
    await page.waitForFunction(() => document.querySelectorAll('.question-batch-row').length === 2);
    assert.equal(generationCount, 1);
    assert.equal(await page.locator('[data-summary-section]').isVisible(), false);
    assert.equal(await page.locator('[data-transcription-section]').isVisible(), false);
    record('Abas reais e geração por diálogo preservam conjuntos anteriores');
    questionFail = true;
    await page.locator('[data-open-questions]').click();
    await page.locator('[data-more-questions-form] [type=submit]').click();
    await page.getByText('Falha simulada na geração.', { exact: true }).waitFor();
    assert.equal(await page.locator('.question-batch-row').count(), 2);
    assert(await page.locator('[data-open-questions]').isEnabled());
    questionFail = false;
    const academicMaterial = materials.find((item) => item.id === 'aula-real');
    academicMaterial.review.state = 'awaiting_review';
    academicMaterial.initial_question_count = 3;
    await page.goto(base + '/material.html?id=aula-real');
    await page.locator('[data-review-welcome]').waitFor();
    assert.equal(await page.locator('[data-transcription-section]').isVisible(), false);
    assert.equal(await page.locator('[data-regenerate-summary]').isDisabled(), true);
    assert.equal(await page.locator('#more-question-count').inputValue(), '3');
    await screenshot(page, output, 'confirmation-awaiting-desktop.png');
    await page.locator('[data-check-transcription]').click();
    await page.locator('.transcription-segment textarea').fill('Texto de revisão corrigida.');
    await page.locator('[data-confirm-transcription]').click();
    await page.locator('[data-summary-section]').waitFor();
    assert.equal(academicMaterial.transcription.current_revision, 2);
    assert.equal(academicMaterial.review.state, 'ready_to_generate');
    assert.equal(await page.locator('[data-transcription-section]').isVisible(), false);
    record('Uma ação salva alterações, confirma a transcrição e abre a aba Resumo');
    await page.getByRole('tab', { name: 'Transcrição', exact: true }).click();
    // Reading mode after confirmation: plain text, no editor, explicit entry into editing.
    assert.equal(
      await page.locator('[data-transcription-section]').getAttribute('data-mode'),
      'reading',
    );
    assert.equal(await page.locator('.transcription-segment textarea').first().isVisible(), false);
    assert.equal(await page.locator('.confirmation-footer').isVisible(), false);
    await page.getByRole('button', { name: 'Editar transcrição', exact: true }).click();
    assert.equal(await page.locator('.transcription-segment textarea').first().isVisible(), true);
    await page.locator('.transcription-segment textarea').first().fill('Rascunho temporário.');
    assert.match(await page.locator('[data-edit-status]').textContent(), /1 trecho alterado/);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(
      await page.locator('[data-transcription-section]').getAttribute('data-mode'),
      'reading',
    );
    assert.match(
      await page.locator('.segment-text').first().textContent(),
      /Texto de revisão corrigida/,
    );
    record('Transcrição separa leitura e edição; cancelar descarta o rascunho');
    await page.getByRole('button', { name: 'Versões', exact: true }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('.version-row')
      .filter({ hasText: 'Revisão 1' })
      .getByRole('button', { name: 'Restaurar' })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector('.transcription-segment textarea')
        ?.value.includes('Um carro elétrico'),
    );
    assert.equal(academicMaterial.transcription.current_revision, 3);
    assert.equal(academicMaterial.review.state, 'awaiting_review');
    record('Histórico discreto restaura conteúdo sem confirmar automaticamente');
    academicMaterial.warnings = [
      {
        id: 'warning-fixture',
        sourceRevisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        type: 'factual_suspicion',
        state: 'insufficient',
        explanation: 'Contexto de demonstração.',
        guidance: 'Confira a frase e seu contexto.',
        segmentRefs: [
          { position: 0, startMs: 0, endMs: 1500, quote: 'energia armazenada em baterias' },
        ],
        model: 'fixture',
        promptVersion: 'warnings-test',
        createdAt: new Date().toISOString(),
        stale: true,
      },
    ];
    await page.reload();
    await page.locator('[data-check-transcription]').click();
    await page.locator('[data-open-warnings]').click();
    await page.getByRole('button', { name: 'Conferir trecho ·', exact: false }).click();
    await page.locator('[data-warning-preview]').waitFor();
    assert(
      (await page.locator('[data-warning-preview-title]').textContent()).includes('Revisão 1'),
    );
    assert(
      (await page.locator('[data-warning-preview-text]').textContent()).includes(
        'energia armazenada em baterias',
      ),
    );
    await screenshot(page, output, 'warnings-desktop.png');
    await page.locator('[data-warning-panel] .dialog-close').click();
    await page.locator('[data-confirm-transcription]').click();
    await page.locator('[data-summary-section]').waitFor();
    academicMaterial.summaries[0].text =
      '**Conceito** importante.\n\n- Primeiro ponto\n- Segundo ponto';
    await page.reload();
    await page.getByRole('tab', { name: 'Resumo', exact: true }).click();
    await page.locator('[data-summary-text] strong').waitFor();
    await screenshot(page, output, 'material-summary-redesign.png');
    assert.equal(await page.locator('[data-summary-text] strong').textContent(), 'Conceito');
    assert.equal(await page.locator('[data-summary-text] li').count(), 2);
    assert(await page.getByRole('button', { name: 'Ouvir resumo', exact: true }).isVisible());
    assert(await page.getByRole('button', { name: 'Parar', exact: true }).isHidden());
    await page.locator('[data-regenerate-summary]').click();
    await page.locator('[data-summary-form] [name=format]').selectOption('bullets');
    await page.locator('[data-summary-form] [name=length]').selectOption('brief');
    await page.locator('[data-summary-form] [type=submit]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-regenerate-summary]').disabled === false,
    );
    assert.deepEqual(summaryCalls.at(-1).options, { format: 'topics', length: 'short' });
    assert.equal(summaryCalls.at(-1).format, undefined);
    await page.locator('[data-regenerate-summary]').click();
    await page.locator('[data-summary-form] [name=readingLevel]').selectOption('simple');
    await page.locator('[data-summary-form] [type=submit]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-regenerate-summary]').disabled === false,
    );
    assert.equal(summaryCalls.at(-1).options.readingLevel, 'simple');
    assert.equal(await page.locator('[data-regenerate-summary]').textContent(), 'Gerar novo resumo');
    await page.locator('[data-regenerate-summary]').click();
    // Advanced settings stay collapsed; names need the authoring migration flag.
    assert.equal(await page.locator('[data-summary-advanced]').evaluate((n) => n.open), false);
    assert(await page.locator('[data-summary-form] [name=label]').isHidden());
    await page.locator('[data-summary-advanced] > summary').click();
    await page.locator('[data-summary-form] [name=format]').selectOption('chronological');
    await page.locator('[data-summary-form] [value=dates]').check();
    await page.locator('[data-summary-form] [value=exam]').check();
    await page.locator('[data-summary-form] [type=submit]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-regenerate-summary]').disabled === false,
    );
    assert.equal(summaryCalls.at(-1).options.format, 'chronological');
    assert.deepEqual(summaryCalls.at(-1).options.focus, ['dates', 'exam']);
    assert.equal(summaryCalls.at(-1).options.label, undefined);
    assert.match(await page.locator('[data-summary-meta]').textContent(), /Cronológico/);
    // Older versions stay available in the version menu.
    await page.locator('[data-summary-history] > summary').click();
    assert(
      (await page.locator('[data-summary-version-list] button').count()) >= 3,
      'older summary versions stay listed',
    );
    await page.locator('[data-summary-history] > summary').click();
    await page.locator('[data-open-export]').click();
    // One compact dialog: content, format and a single primary action.
    assert.equal(await page.locator('[data-export-dialog] .primary-action').count(), 1);
    await page.locator('[data-export-form] [name=format][value=md]').check();
    const exportPromise = page.waitForEvent('download');
    await page.locator('[data-export-form] [type=submit]').click();
    const exported = await exportPromise;
    assert(exported.suggestedFilename().endsWith('.md'));
    const exportedText = fs.readFileSync(await exported.path(), 'utf8');
    assert.match(exportedText, /^# .+\n\n\*.+\*\n\n## Transcrição/);
    assert.match(exportedText, /\*\*\[00:00–00:01\]\*\*/);
    assert.match(exportedText, /## Resumo/);
    await page
      .locator('[data-export-dialog]')
      .getByRole('button', { name: 'Fechar', exact: true })
      .click();
    await page.locator('[data-export-dialog]').waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Transcrição', exact: true }).click();
    record('Markdown formatado, personalização contextual, exportação oculta e avisos em diálogo');
    await page
      .locator('[data-audio-player]')
      .getByRole('button', { name: 'Reproduzir', exact: true })
      .click();
    await page.waitForTimeout(1200);
    await page
      .locator('[data-audio-player]')
      .getByRole('button', { name: 'Pausar', exact: true })
      .click();
    const coverage = await page.evaluate(async () => {
      const s = await import('/js/utils/study-store.js');
      return s.listeningPercent('aula-real');
    });
    assert(coverage > 20 && coverage < 70);
    await page.evaluate(() => {
      const a = document.querySelector('[data-audio-player] audio');
      a.currentTime = 2.4;
    });
    await page.waitForTimeout(200);
    const afterSeek = await page.evaluate(async () => {
      const s = await import('/js/utils/study-store.js');
      return s.listeningPercent('aula-real');
    });
    assert.equal(afterSeek, coverage);
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('[data-audio-player] audio')?.currentTime > 2.2,
    );
    assert.equal(await page.locator('[data-audio-player] audio').evaluate((a) => a.paused), true);
    // Captions inside the audio player: word highlight from real timings, persisted preference.
    const player = page.locator('[data-audio-player]');
    await player.getByRole('button', { name: /^Legendas/ }).click();
    await player.getByRole('radio', { name: 'Palavra a palavra' }).check();
    const seekAudio = (t) =>
      page.locator('[data-audio-player] audio').evaluate((a, time) => {
        a.currentTime = time;
        a.dispatchEvent(new Event('timeupdate'));
      }, t);
    await seekAudio(0.5);
    await page.locator('.caption-band .caption-word.is-spoken').waitFor();
    assert.equal(await page.locator('.caption-band .is-spoken').textContent(), 'elétrico');
    assert.equal(await page.locator('.caption-band .caption-word').count(), 8);
    await page.keyboard.press('Escape');
    await screenshot(page, output, 'material-captions-audio.png');
    await page.reload();
    await page.locator('.caption-toggle[aria-pressed="true"]').waitFor();
    await seekAudio(1.2);
    await page.locator('.caption-band .is-spoken').waitFor();
    assert.equal(await page.locator('.caption-band .is-spoken').textContent(), 'em');
    await page.locator('.caption-toggle').click();
    await player.getByRole('radio', { name: 'Desligadas' }).check();
    assert.equal(await page.locator('.caption-band').isVisible(), false);
    record('Legendas no player: destaque por palavra com tempos reais; preferência persiste');
    await page.goto(base + '/painel.html');
    await page.locator('[data-continue-list] .dashboard-lesson-card').first().waitFor();
    const storedState = await page.evaluate(async () => {
      const store = await import('/js/utils/study-store.js');
      const old = store.studyFor('aula-real');
      store.updateStudy('aula-real', {
        position: 3,
        duration: 3,
        playedAt: Date.now(),
        completed: false,
      });
      return old;
    });
    await page.reload();
    await page.locator('[data-continue-list] .dashboard-lesson-card').first().waitFor();
    assert(
      await page
        .getByRole('link', { name: 'Rever Carros elétricos — energia', exact: true })
        .first()
        .isVisible(),
    );
    assert.equal(
      await page
        .locator('[data-continue-list]')
        .getByText(/Retomar em/)
        .count(),
      0,
    );
    assert.match(await page.locator('[data-continue-list]').textContent(), /No fim do áudio/);
    assert.equal(
      await page.evaluate(
        async () => (await import('/js/utils/study-store.js')).studyFor('aula-real').completed,
      ),
      false,
    );
    await page.evaluate(
      async (old) => (await import('/js/utils/study-store.js')).updateStudy('aula-real', old),
      storedState,
    );
    record('Fim do áudio oferece Rever sem confundir reprodução com aula estudada');
    await page.goto(base + '/material.html?id=aula-real');
    await page.locator('[data-complete-review]').waitFor();
    await page.getByRole('button', { name: 'Marcar aula como estudada', exact: true }).click();
    assert.equal(await page.locator('[data-complete-review]').getAttribute('aria-pressed'), 'true');
    await page.goto(base + '/painel.html');
    await page.waitForFunction(
      () => document.querySelector('[data-dashboard-data]').getAttribute('aria-busy') === 'false',
    );
    assert.match(await page.locator('[data-overview]').textContent(), /1 aula estudada/);
    assert(await page.getByText('energia', { exact: true }).first().isVisible());
    assert.equal(await page.locator('[data-continue-list] .dashboard-lesson-card').count(), 1);
    assert.equal(
      await page.locator('[data-recent-list] [data-material-id="aula-real"]').count(),
      0,
    );
    assert(
      await page
        .getByRole('link', { name: 'Rever Carros elétricos — energia', exact: true })
        .first()
        .isVisible(),
    );
    await screenshot(page, output, 'dashboard-study.png');
    record(
      'Progresso mede reprodução real; seek não conta; retomada sem autoplay e revisão explícita',
    );
    await page.goto(base + '/responder.html?material=aula-real&batch=batch-1');
    await page.getByRole('radio', { name: /Nas baterias/ }).check();
    await page.getByRole('button', { name: 'Responder', exact: true }).click();
    await page.getByText('Resposta correta.', { exact: false }).waitFor();
    assert.equal(
      await page.evaluate(
        async () =>
          Object.keys((await import('/js/utils/study-store.js')).studyFor('aula-real').answers)
            .length,
      ),
      1,
    );
    record('Questões respondidas alimentam o histórico local do perfil');
    await page.goto(base + '/conta.html');
    const avatarButtons = page.locator('[data-earned-avatars] button');
    await avatarButtons.nth(7).waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-earned-avatars]').count(), 1);
    assert.equal(await avatarButtons.count(), 8);
    // XP and milestones are browser-derived incentives and the page says so.
    await page.getByText('ainda não são verificados pelo servidor', { exact: false }).waitFor();
    assert((await page.locator('.account-link img').getAttribute('src')).includes('reading.png'));
    await page.getByRole('button', { name: 'Editar informações', exact: true }).click();
    const profileDialog = page.getByRole('dialog', { name: 'Editar informações do perfil' });
    await profileDialog.waitFor();
    assert(
      await profileDialog
        .getByRole('button', { name: 'Nino com notebook · bloqueado', exact: true })
        .isDisabled(),
    );
    await profileDialog.getByRole('button', { name: 'Nino curioso', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.account-link img')?.getAttribute('src').includes('curious.png'),
    );
    assert.equal(profileCalls.at(-1).data.mascot_avatar, 'curious');
    await page.locator('#display-name').fill('Catharine');
    await page.locator('#institution').fill('Escola de teste');
    await page.locator('#course').fill('Desenvolvimento de Sistemas');
    await page.locator('#study-goal').fill('Revisar Física');
    await page.locator('#profile-bio').fill('Aprendo com aulas e exercícios.');
    await profileDialog.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
    await profileDialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-account-message]').textContent(), 'Perfil atualizado.');
    assert.equal(profileCalls.at(-1).data.mascot_avatar, 'curious');
    assert.equal(profileCalls.at(-1).data.institution, 'Escola de teste');
    await page.reload();
    await page.getByRole('heading', { name: 'Catharine', level: 2 }).waitFor();
    assert.equal(await page.locator('#course').inputValue(), 'Desenvolvimento de Sistemas');
    assert((await page.locator('.account-link img').getAttribute('src')).includes('curious.png'));
    await screenshot(page, output, 'profile-desktop.png');
    record('Perfil detalhado salva metadados no Supabase e oferece oito avatares com padrão Nino');
    const savedThemes = page.getByRole('dialog', { name: 'Meus temas' });
    const openSavedThemes = async () => {
      await page.getByRole('button', { name: 'Temas salvos', exact: true }).click();
      await savedThemes.waitFor();
    };
    const saveTheme = async (template, name) => {
      await openSavedThemes();
      if (template) await savedThemes.getByRole('button', { name: template, exact: true }).click();
      await page.locator('#theme-profile-name').fill(name);
      await savedThemes.getByRole('button', { name: 'Salvar tema', exact: true }).click();
      await savedThemes.waitFor({ state: 'hidden' });
    };
    await page.goto(base + '/aparencia.html');
    await saveTheme('Claro', 'Meu claro');
    await saveTheme('Escuro', 'Meu escuro');
    await page.getByRole('button', { name: 'Modo foco', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-focus-mode'), 'true');
    await saveTheme(null, 'Meu foco');
    assert.equal(await page.locator('[data-theme-profile]').count(), 3);
    assert.equal(await page.locator('html').getAttribute('data-focus-mode'), 'true');
    await openSavedThemes();
    await savedThemes.getByRole('button', { name: 'Aplicar tema Meu escuro', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-focus-mode'), 'false');
    await page.reload();
    await page.locator('[data-theme-profile]').first().waitFor({ state: 'attached' });
    assert((await page.evaluate(() => window.__paints)).every((p) => p.theme === 'custom'));
    assert.equal(
      await page
        .locator('html')
        .evaluate((n) => getComputedStyle(n).getPropertyValue('--custom-background').trim()),
      '#151a21',
    );
    const appliedProfile = await page.locator('html').getAttribute('data-profile');
    assert(appliedProfile, 'Applied saved theme is marked active');
    await page.getByRole('button', { name: 'Modo foco', exact: true }).click();
    assert.equal(
      await page.locator('html').getAttribute('data-profile'),
      appliedProfile,
      'Toggling focus mode keeps the saved theme active',
    );
    await page.getByRole('button', { name: 'Sair do modo foco', exact: true }).click();
    // Every reading choice is visible in the live preview on the same page.
    const preview = page.locator('.reading-preview-text p').first();
    const previewStyle = () =>
      preview.evaluate((p) => {
        const c = getComputedStyle(p);
        return {
          lineHeight: parseFloat(c.lineHeight) / parseFloat(c.fontSize),
          wordSpacing: c.wordSpacing,
          maxWidth: Math.round(p.parentElement.getBoundingClientRect().width),
        };
      });
    const comfortable = await previewStyle();
    await page.locator('#setting-reading-spacing').selectOption('wide');
    const wide = await previewStyle();
    assert(wide.lineHeight > comfortable.lineHeight + 0.2, 'spacing changes the preview');
    assert.notEqual(wide.wordSpacing, comfortable.wordSpacing);
    await page.locator('#setting-reading-spacing').selectOption('comfortable');
    for (const [value, family] of [
      ['opendyslexic', 'OpenDyslexic'],
      ['atkinson', 'Atkinson Hyperlegible'],
      ['lexend', 'Lexend'],
    ]) {
      await page.locator('#setting-reading-font').selectOption(value);
      assert.match(
        await preview.evaluate((p) => getComputedStyle(p).fontFamily),
        new RegExp(`^"?${family}`),
      );
      const loaded = await page.evaluate(
        (f) => document.fonts.load(`16px "${f}"`).then((list) => list.length),
        family,
      );
      assert(loaded > 0, `${family} loads from the bundled file`);
    }
    await page.locator('#setting-reading-font').selectOption('default');
    // Reading guide: a ruler following the pointer, or dimming of the lines not being read.
    await page.locator('#setting-reading-ruler').selectOption('ruler');
    const firstLine = page.locator('.reading-preview-text p').first();
    await firstLine.hover({ position: { x: 40, y: 8 } });
    await page.locator('.reading-ruler:not([hidden])').waitFor();
    const [ruler, line] = await Promise.all([
      page.locator('.reading-ruler').boundingBox(),
      firstLine.boundingBox(),
    ]);
    assert(
      ruler.y + ruler.height / 2 >= line.y && ruler.y <= line.y + line.height,
      'ruler sits on the hovered line',
    );
    await page.locator('#setting-reading-ruler').selectOption('focus');
    assert.equal(await page.locator('.reading-ruler').isHidden(), true);
    await page.locator('.reading-preview-text p').nth(1).hover();
    await page.waitForTimeout(250);
    assert(
      Number(await firstLine.evaluate((p) => getComputedStyle(p).opacity)) < 0.5,
      'other lines dim',
    );
    await page.locator('#setting-reading-ruler').selectOption('off');
    await page.locator('#setting-reading-width').selectOption('narrow');
    assert(
      (await previewStyle()).maxWidth < comfortable.maxWidth,
      'line length changes the preview',
    );
    assert.equal(await page.locator('html').getAttribute('data-reading-width'), 'narrow');
    await page.reload();
    assert.equal(await page.locator('#setting-reading-width').inputValue(), 'narrow');
    assert.equal(await page.locator('html').getAttribute('data-reading-width'), 'narrow');
    await page.locator('#setting-reading-width').selectOption('comfortable');
    record('Modo foco preserva o tema salvo; largura de leitura persiste após recarregar');
    // Bottom dock as the normal navigation: pinned, persisted; focus mode keeps it auto-hidden.
    await page.locator('#setting-navigation').selectOption('dock');
    await page.reload();
    assert.equal(await page.locator('#setting-navigation').inputValue(), 'dock');
    assert.equal(await page.locator('.side-navigation').isVisible(), false);
    assert.equal(await page.locator('[data-menu-toggle]').isVisible(), false);
    const dock = page.getByRole('navigation', { name: 'Navegação no modo foco' });
    await page.mouse.move(200, 200);
    assert.equal(await dock.getAttribute('data-open'), 'true');
    assert.equal(
      await page.getByRole('button', { name: 'Mostrar navegação do modo foco' }).isVisible(),
      false,
      'no reveal handle when the dock is pinned',
    );
    await dock.getByRole('link', { name: 'Biblioteca' }).focus();
    assert.equal(await dock.getByRole('link', { name: 'Biblioteca' }).isVisible(), true);
    await page.getByRole('button', { name: 'Modo foco', exact: true }).click();
    await page.mouse.move(200, 200);
    await page.locator('h1').first().click();
    assert.equal(await dock.getAttribute('data-open'), 'false', 'focus mode auto-hides the dock');
    await page.getByRole('button', { name: 'Sair do modo foco', exact: true }).click();
    await page.locator('#setting-navigation').selectOption('sidebar');
    assert.equal(await page.locator('.side-navigation').isVisible(), true);
    record('Barra inferior pode ser a navegação normal; no modo foco é a única e se oculta');
    await openSavedThemes();
    await savedThemes.getByRole('button', { name: 'Aplicar tema Meu claro', exact: true }).click();
    await page.goto(base + '/leitura.html');
    await page.locator('#setting-text-size').selectOption('medium');
    await page.goto(base + '/aparencia.html');
    await openSavedThemes();
    await savedThemes
      .getByRole('button', {
        name: 'Atualizar tema Meu claro com as preferências atuais',
        exact: true,
      })
      .click();
    await savedThemes.getByRole('button', { name: 'Aplicar tema Meu foco', exact: true }).click();
    // Temas salvos não fixam o modo foco: aplicar qualquer tema mantém a navegação completa.
    assert.equal(await page.locator('html').getAttribute('data-focus-mode'), 'false');
    await savedThemes.getByRole('button', { name: 'Aplicar tema Meu claro', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-text-size'), 'medium');
    assert.equal(await page.locator('html').getAttribute('data-focus-mode'), 'false');
    await savedThemes.getByRole('button', { name: 'Excluir tema Meu escuro', exact: true }).click();
    assert.equal(await page.locator('[data-theme-profile]').count(), 2);
    await page.keyboard.press('Escape');
    await savedThemes.waitFor({ state: 'hidden' });
    await page.evaluate(async () => {
      const store = await import('/js/utils/study-store.js');
      store.setStudyUser('another-user');
      if (store.studyFor('aula-real').tags.length) throw Error('Dados de outra conta');
      store.setStudyUser('test-user');
      window.VozAppearance.setUser('another-user');
      if (window.VozAppearance.loadProfiles().length) throw Error('Temas de outra conta');
      window.VozAppearance.setUser('test-user');
    });
    record(
      'Temas claro/escuro podem ser salvos, aplicados, atualizados e excluídos por conta sem fixar o modo foco',
    );
    await page.goto(base + '/leitura.html');
    await page.locator('#setting-text-size').selectOption('default');
    await page.getByRole('button', { name: 'Restaurar preferências', exact: true }).click();
    mode = 'empty';
    await page.goto(base + '/painel.html');
    await page.getByText('Sua Biblioteca está vazia.', { exact: true }).waitFor();
    await page
      .locator('[data-dashboard-data] .empty-state-card')
      .getByRole('link', { name: 'Nova transcrição', exact: true })
      .waitFor();
    assert.match(await page.locator('[data-overview]').textContent(), /^0 aulas/);
    record('Painel vazio não inventa aulas ou métricas');
    mode = 'error';
    await page.reload();
    await page.getByText('Biblioteca indisponível no momento.', { exact: true }).waitFor();
    mode = 'success';
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await page.locator('[data-recent-list] .dashboard-lesson-card').first().waitFor();
    record('Falha de carregamento oferece recuperação sem recarregar o aplicativo');
    await page.evaluate(() => localStorage.setItem('test-logged-out', '1'));
    await page.goto(base + '/login.html?next=/material.html?id=aula-real');
    await page.getByRole('button', { name: 'Continuar com Google', exact: true }).click();
    assert.equal(authCalls.at(-1).provider, 'google');
    assert.equal(authCalls.at(-1).options.redirectTo, base + '/auth-callback.html');
    assert.equal(await page.evaluate(() => window.__authOptions.auth.flowType), 'pkce');
    record('Google inicia OAuth PKCE com callback local');
    await page.goto(base + '/auth-callback.html?code=valid');
    await page.waitForURL('**/material.html?id=aula-real');
    await page.getByRole('heading', { name: 'Carros elétricos — energia', exact: true }).waitFor();
    assert.equal(authCalls.at(-1).code, 'valid');
    record('Callback troca código por sessão e recupera destino interno');
    await page.evaluate(() => {
      localStorage.setItem('test-logged-out', '1');
      localStorage.setItem('test-oauth-failure', '1');
    });
    await page.goto(base + '/login.html');
    await page.getByRole('button', { name: 'Continuar com GitHub', exact: true }).click();
    await page
      .getByText('Este provedor ainda não está disponível. Entre com e-mail e senha.', {
        exact: true,
      })
      .waitFor();
    assert(
      await page.getByRole('button', { name: 'Continuar com Google', exact: true }).isEnabled(),
    );
    record('GitHub e provedor desativado têm tratamento de erro');
    await page.goto(base + '/auth-callback.html?code=bad');
    await page.getByText('Código expirado.', { exact: true }).waitFor();
    assert(await page.locator('[data-callback-retry]').isVisible());
    record('Callback inválido oferece nova tentativa');
    await page.evaluate(() => {
      localStorage.removeItem('test-oauth-failure');
      sessionStorage.setItem('voz-auth-next', 'https://outside.example.test');
    });
    await page.goto(base + '/auth-callback.html?code=valid');
    await page.waitForURL('**/painel.html');
    await page.waitForFunction(
      () => document.querySelector('[data-dashboard-data]')?.getAttribute('aria-busy') === 'false',
    );
    record('Retorno externo é bloqueado');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of [
      'index',
      'painel',
      'nova-transcricao',
      'login',
      'aparencia',
      'conta',
      'historico',
    ]) {
      if (name === 'login') await page.evaluate(() => localStorage.setItem('test-logged-out', '1'));
      else await page.evaluate(() => localStorage.removeItem('test-logged-out'));
      await page.goto(base + '/' + name + '.html');
      await page.waitForTimeout(250);
      if (name === 'nova-transcricao') {
        await page.locator('#audio-file').setInputFiles(wavInput);
        await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `Overflow: ${name}`,
      );
      if (['index', 'painel', 'nova-transcricao', 'login'].includes(name))
        await screenshot(page, output, name + '-mobile.png');
      if (name === 'painel') {
        await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
        await page.locator('.primary-navigation').waitFor({ state: 'visible' });
        assert.equal(
          await page.locator('[data-menu-toggle]').getAttribute('aria-expanded'),
          'true',
        );
        await page.keyboard.press('Escape');
        await page.locator('.primary-navigation').waitFor({ state: 'hidden' });
        assert.equal(
          await page.locator('[data-menu-toggle]').getAttribute('aria-expanded'),
          'false',
        );
      }
    }
    record('Sete telas móveis sem overflow; navegação acessível');
    const axePath = require.resolve('axe-core/axe.min.js');
    async function audit(name) {
      await page.addScriptTag({ path: axePath });
      const results = await page.evaluate(
        async () =>
          await axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
          }),
      );
      accessibility.push({
        page: name,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
        incomplete: results.incomplete.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      });
      fs.writeFileSync(
        path.join(output, 'accessibility-results.json'),
        JSON.stringify(
          {
            engine: 'axe-core',
            scope: 'Automatic WCAG A/AA checks; not a manual screen-reader certification.',
            results: accessibility,
          },
          null,
          2,
        ),
      );
      if (results.violations.length)
        console.log('A11Y', name, JSON.stringify(accessibility.at(-1).violations));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/ajuda.html#seus-dados');
    await page.locator('.storage-notice').waitFor();
    const storageNote = (await page.getByRole('note').textContent()).replace(/\s+/g, ' ');
    assert.match(storageNote, /sincronizados com sua conta/);
    assert.match(storageNote, /Sem conexão, as mudanças ficam neste dispositivo/);
    await screenshot(page, output, 'help-storage-desktop.png');
    await audit('aviso de dados na Ajuda');
    assert.deepEqual(accessibility.at(-1).violations, [], 'Acessibilidade da Ajuda e aviso');
    record('Aviso de armazenamento tem contexto na Ajuda e link no rodapé');
    for (const name of [
      'painel',
      'historico',
      'conta',
      'aparencia',
      'leitura',
      'material',
      'responder',
      'nova-transcricao',
    ]) {
      await page.goto(
        base +
          '/' +
          name +
          '.html' +
          (name === 'material'
            ? '?id=aula-real'
            : name === 'responder'
              ? '?material=aula-real&batch=batch-1'
              : ''),
      );
      await page.waitForTimeout(400);
      if (name === 'material') await page.locator('[data-transcription-section]').waitFor();
      await audit(name + ' desktop');
    }
    assert.deepEqual(
      accessibility.flatMap((r) => r.violations),
      [],
      'Auditoria automática das nove telas',
    );
    record('Nove telas auditadas por axe-core sem violações automáticas WCAG A/AA');
    // Text contrast in every theme (light, dark and high-contrast) on the main study screens.
    const themeContrast = [];
    for (const theme of [
      'paper',
      'gabriela',
      'forest',
      'ocean',
      'wine',
      'soft',
      'night',
      'contrast-light',
      'contrast-dark',
    ]) {
      for (const target of [
        'painel.html',
        'material.html?id=aula-real',
        'material.html?id=aula-real#resumo',
        'aparencia.html',
      ]) {
        await page.evaluate((t) => {
          localStorage.setItem('audioestudo-theme', t);
          localStorage.setItem(
            'audioestudo-ui-preferences',
            JSON.stringify(window.VozAppearance.defaults),
          );
        }, theme);
        await page.goto(base + '/' + target);
        await page.waitForTimeout(350);
        // Audit the settled screen, not a card halfway through its entrance fade.
        await page.evaluate(() =>
          Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
        );
        await page.addScriptTag({ path: axePath });
        const found = await page.evaluate(async () =>
          (
            await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })
          ).violations.flatMap((v) =>
            v.nodes.map((n) => `${n.target.join(' ')} :: ${n.any[0]?.message || ''}`.slice(0, 220)),
          ),
        );
        for (const item of found) themeContrast.push(`${theme} ${target} ${item}`);
      }
    }
    fs.writeFileSync(
      path.join(output, 'theme-contrast.json'),
      JSON.stringify(themeContrast, null, 1),
    );
    await page.evaluate(() => localStorage.setItem('audioestudo-theme', 'paper'));
    assert.deepEqual(themeContrast, [], 'Text contrast passes in all nine themes');
    record('Contraste de texto aprovado nos nove temas (claros, escuros e alto contraste)');
    await page.goto(base + '/nova-transcricao.html');
    await page.locator('#audio-file').setInputFiles(wavInput);
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.locator('#class-title').fill('Aula sintética de acessibilidade');
    await page.locator('#permission-declaration').check();
    await page.getByRole('button', { name: 'Revisar envio', exact: true }).click();
    await audit('E02 upload-review');
    academicMaterial.review.state = 'awaiting_review';
    academicMaterial.review.permissionRequired = true;
    await page.goto(base + '/material.html?id=aula-real');
    await page.locator('[data-check-transcription]').click();
    await page.locator('[data-material-permission]').waitFor();
    assert.equal(await page.locator('#material-permission').isChecked(), false);
    await audit('material-permission-required');
    academicMaterial.review.permissionRequired = false;
    await page.reload();
    await page.locator('[data-check-transcription]').click();
    await page.locator('[data-open-warnings]').click();
    await page.getByRole('button', { name: 'Conferir trecho ·', exact: false }).click();
    await audit('material-warning-history');
    await page.locator('[data-warning-panel] .dialog-close').click();
    await page.locator('[data-confirm-transcription]').click();
    await page.locator('[data-summary-section]').waitFor();
    await audit('material-confirmed');
    await page.getByRole('tab', { name: 'Transcrição', exact: true }).click();
    await page.getByRole('button', { name: 'Editar transcrição', exact: true }).click();
    await page
      .locator('.transcription-segment textarea')
      .fill('Alteração local não salva da fixture.');
    assert.equal(await page.locator('[data-regenerate-summary]').isDisabled(), true);
    await audit('material-unsaved-edits');
    assert.deepEqual(
      accessibility.flatMap((result) => result.violations),
      [],
      'Novos estados do fluxo',
    );
    await page.locator('[data-confirm-transcription]').click();
    await page.locator('[data-summary-section]').waitFor();
    record('Fluxo progressivo auditado com axe: permissão, avisos, confirmação e edição');

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => {
        const prefs = {
          ...window.VozAppearance.defaults,
          textSize: 'maximum',
          readingSpacing: 'wide',
          readableFont: true,
          focusMode: true,
          reducedMotion: true,
        };
        localStorage.setItem('audioestudo-ui-preferences', JSON.stringify(prefs));
        window.VozAppearance.applyUi(prefs);
      });
      for (const name of [
        'painel',
        'historico',
        'conta',
        'aparencia',
        'leitura',
        'material',
        'nova-transcricao',
        'responder',
        'ajuda',
      ]) {
        await page.goto(
          base +
            '/' +
            name +
            '.html' +
            (name === 'material'
              ? '?id=aula-real'
              : name === 'responder'
                ? '?material=aula-real&batch=batch-1'
                : ''),
        );
        await page.waitForTimeout(300);
        if (name === 'nova-transcricao') {
          await page.locator('#audio-file').setInputFiles(wavInput);
          await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
        }
        assert.equal(
          await page.locator('html').getAttribute('data-text-size'),
          'maximum',
          `200% preference must survive loading ${name}`,
        );
        const overflow = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          offenders: [...document.querySelectorAll('body *')]
            .filter((n) => {
              const r = n.getBoundingClientRect();
              return (
                r.width > 0 &&
                r.right > innerWidth + 1 &&
                getComputedStyle(n).visibility !== 'hidden'
              );
            })
            .slice(0, 8)
            .map((n) => ({
              tag: n.tagName,
              class: n.className,
              right: Math.round(n.getBoundingClientRect().right),
            })),
        }));
        assert(
          overflow.scroll <= overflow.width,
          `Fonte 200% ${width}px ${name}: ${JSON.stringify(overflow)}`,
        );
        if (width === 320 && ['painel', 'historico', 'conta', 'material', 'ajuda'].includes(name))
          await screenshot(page, output, name + '-200-mobile.png');
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      const prefs = { ...window.VozAppearance.loadUi(), focusMode: false };
      localStorage.setItem('audioestudo-ui-preferences', JSON.stringify(prefs));
    });
    for (const name of [
      'painel',
      'historico',
      'conta',
      'aparencia',
      'leitura',
      'nova-transcricao',
      'material',
    ]) {
      await page.goto(base + '/' + name + '.html' + (name === 'material' ? '?id=aula-real' : ''));
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        '200% com sidebar completa: ' + name,
      );
      // The sidebar grows with the text and wraps only between words.
      const sidebar = await page.evaluate(() => {
        const nav = document.querySelector('.side-navigation');
        const brand = nav.querySelector('.sidebar-brand');
        // Links hidden because their feature is off are not laid out, so they cannot wrap.
        const shown = [...nav.querySelectorAll('nav a > span')].filter((label) => label.closest('a').getClientRects().length);
        const words = shown.flatMap((label) => {
          const link = label.closest('a');
          const room = link.clientWidth - 70; // icon, gap and padding
          return label.textContent
            .trim()
            .split(/\s+/)
            .map((word) => {
              const probe = document.createElement('span');
              probe.textContent = word;
              probe.style.whiteSpace = 'nowrap';
              label.append(probe);
              const fits = probe.getBoundingClientRect().width <= room;
              probe.remove();
              return { word, fits };
            });
        });
        return {
          width: Math.round(nav.getBoundingClientRect().width),
          brandClipped: brand.scrollWidth > brand.clientWidth + 1,
          broken: words.filter((w) => !w.fits).map((w) => w.word),
        };
      });
      if (name === 'painel') {
        assert.equal(sidebar.width, 320, 'sidebar widens at 200%');
        assert.equal(sidebar.brandClipped, false, 'brand fits the sidebar');
        assert.deepEqual(sidebar.broken, [], 'no navigation word is split');
      }
    }
    for (const name of ['index', 'login', 'cadastro', 'auth-callback']) {
      await page.setViewportSize({ width: 320, height: 900 });
      if (['login', 'cadastro'].includes(name))
        await page.evaluate(() => localStorage.setItem('test-logged-out', '1'));
      await page.goto(base + '/' + name + '.html');
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('body *')]
          .filter(
            (n) =>
              n.getBoundingClientRect().right > innerWidth + 1 &&
              getComputedStyle(n).visibility !== 'hidden',
          )
          .slice(0, 8)
          .map((n) => ({ tag: n.tagName, class: n.className })),
      }));
      assert(
        info.scroll <= info.width,
        '200% página pública ' + name + ': ' + JSON.stringify(info),
      );
    }
    await page.evaluate(() => localStorage.removeItem('test-logged-out'));
    record('Fonte 200% também preserva páginas públicas e sidebar completa');
    record('Nove telas refluem a 320, 390 e 1280px com fonte 200%, espaçamento amplo e foco');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/painel.html');
    await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
    assert.equal(await page.locator('main').evaluate((n) => n.inert), true);
    assert.equal(await page.locator('#navigation').getAttribute('aria-modal'), 'true');
    assert.equal(
      await page.locator('[data-sidebar-close]').evaluate((n) => document.activeElement === n),
      true,
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page.locator('#navigation').evaluate((nav) => {
        const controls = [...nav.querySelectorAll('a[href],button:not(:disabled)')].filter(
          (n) => n.getClientRects().length,
        );
        const last = controls.at(-1);
        return (
          controls.length > 1 &&
          !last.matches('[data-sidebar-close]') &&
          document.activeElement === last
        );
      }),
      true,
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await page.locator('[data-sidebar-close]').evaluate((n) => document.activeElement === n),
      true,
    );
    await audit('menu móvel aberto');
    assert.deepEqual(accessibility.at(-1).violations, [], 'Acessibilidade menu móvel');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('main').evaluate((n) => n.inert), false);
    assert.equal(
      await page.locator('[data-menu-toggle]').evaluate((n) => document.activeElement === n),
      true,
    );
    record('Menu móvel mantém foco, bloqueia fundo e fecha com Escape retornando ao botão');
    const iconHref = await page.locator('link[rel="icon"]').getAttribute('href'),
      icon = await context.request.get(base + iconHref);
    assert.equal(icon.status(), 200);
    assert.match(icon.headers()['content-type'], /image\/png/);
    assert.equal((await context.request.get(base + '/favicon.ico')).status(), 200);
    assert.equal(
      await page
        .locator('.account-link img')
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    record('Favicon PNG e avatar carregam por rotas locais');
    assert.deepEqual(errors, []);
    record('Nenhum erro JavaScript no navegador');
    const actualContext = await browser.newContext();
    try {
      await actualContext.route(base + '/api/config', (route) =>
        route.fulfill({
          json: {
            supabaseUrl: 'https://mock.supabase.co',
            supabasePublishableKey: 'mock-publishable-key',
            oauthProviders: ['google', 'github'],
            permissionDeclaration,
          },
        }),
      );
      const actualPage = await actualContext.newPage();
      actualPage.on('pageerror', (e) => errors.push(e.message));
      await actualPage.goto(base + '/login.html');
      const localSdk = await actualPage.evaluate(async () => {
        const { createClient } = await import('/js/vendor/supabase.min.js');
        const { getSupabase } = await import('/js/api/supabase-browser.js');
        const { data, error } = await (await getSupabase()).auth.getSession();
        return {
          createClient: typeof createClient,
          emptySession: data.session === null,
          error: error?.message || null,
        };
      });
      assert.deepEqual(localSdk, { createClient: 'function', emptySession: true, error: null });
      assert.deepEqual(errors, []);
      record('SDK Supabase local carrega e inicializa sessão sem CDN');
    } finally {
      await actualContext.close();
    }
    // Without the server flag the video choice stays visible but explains why it is unavailable.
    mp4Retention = false;
    await page.goto(base + '/nova-transcricao.html');
    await page.locator('#audio-file').setInputFiles(mp4Input);
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
    await page.locator('[data-wizard-next]').click();
    assert.equal(await page.locator('#keep-original-video').isVisible(), true);
    assert.equal(await page.locator('#keep-original-video').isDisabled(), true);
    assert.match(await page.locator('[data-video-retention-note]').textContent(), /não ativado/);
    mp4Retention = true;
    record(
      'Sem a flag do servidor, o vídeo não é descartado em silêncio: a opção explica a indisponibilidade',
    );
    // E07 sends WAV for ASR and retains the original MP4 separately.
    await page.goto(base + '/nova-transcricao.html');
    await page.locator('#audio-file').setInputFiles(mp4Input);
    await page.waitForFunction(() => !document.querySelector('[data-wizard-next]').disabled);
    await page.locator('[data-wizard-next]').click();
    await page.locator('#class-title').fill('Vídeo guardado para estudo');
    await page.locator('#keep-original-video').check();
    await page.locator('#keep-original-audio').check();
    await page.locator('#permission-declaration').check();
    await page.locator('[data-review-upload]').click();
    assert(
      (await page.locator('[data-upload-choice-list]').textContent()).includes(
        'MP4 original inteiro',
      ),
    );
    await page.locator('[data-transcribe]').click();
    await page.waitForURL('**/material.html?**');
    await page.locator('[data-audio-player] .video-preview:not([hidden])').waitFor();
    assert.equal(requests.at(-1).extension, 'mp3');
    assert.equal(requests.at(-1).retainAudio, true);
    assert.equal(
      await page.locator('[data-audio-player] select').count(),
      1,
      'Playback speed remains inside the player; E07 format selector is outside',
    );
    await page.locator('.caption-toggle').click();
    await page.getByRole('radio', { name: 'Palavra a palavra' }).check();
    await page.keyboard.press('Escape');
    await page.locator('[data-audio-player] video').evaluate((v) => {
      v.currentTime = v.currentTime + 0.4;
      v.dispatchEvent(new Event('timeupdate'));
    });
    await page.locator('.video-preview .caption-line .caption-word').first().waitFor();
    await page.locator('.caption-toggle').click();
    await page.getByRole('button', { name: 'Legenda: texto amarelo', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('.video-preview .caption-line').evaluate((n) => getComputedStyle(n).color),
      'rgb(255, 224, 102)',
    );
    assert.equal(
      await page.locator('.caption-band').isVisible(),
      false,
      'Video captions overlay the image',
    );
    await screenshot(page, output, 'material-video-redesign.png');
    await page.locator('.caption-toggle').click();
    await page.getByRole('radio', { name: 'Desligadas' }).check();
    record('Escolha explícita de vídeo conserva MP4 e abre o player de vídeo');
    const videoMaterial = materials[0];
    jobPending = true;
    await page.goto(base + '/processando.html?id=' + videoMaterial.id + '&job=job-1');
    await page.getByRole('heading', { name: 'Transcrevendo o áudio…', exact: true }).waitFor();
    await page.getByText('Iniciado há 2 minutos', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-open-export]').count(), 0);
    assert.equal(await page.locator('[role=tab]').count(), 0);
    await audit('tela separada de processamento');
    assert.deepEqual(accessibility.at(-1).violations, []);
    await screenshot(page, output, 'processing-redesign.png');
    // Waiting for the external transcription service is progress, not a failure.
    jobPending = 'polling';
    await page.getByText('O áudio está com o serviço de transcrição.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Aguardando nova tentativa' }).count(), 0);
    assert.equal(
      await page.locator('[data-processing-step="transcribe"]').getAttribute('aria-current'),
      'step',
    );
    // A real temporary failure says so and shows which attempt comes next.
    jobPending = 'retry';
    await page.getByRole('heading', { name: 'Aguardando nova tentativa' }).waitFor();
    await page.getByText('(tentativa 2 de 3)', { exact: false }).waitFor();
    jobPending = false;
    await page.waitForURL('**/material.html?**');
    record(
      'Espera separada mostra etapa e tempo, distingue espera do provedor de falha temporária e abre o material',
    );
    // Library "Editar transcrição" opens the Transcrição tab directly in edit mode.
    await page.goto(base + '/material.html?id=aula-real&edit=transcricao#transcricao');
    await page.locator('[data-transcription-section][data-mode="editing"]').waitFor();
    assert(await page.locator('[data-edit-bar]').isVisible());
    assert(await page.locator('.transcription-segment textarea').first().isVisible());
    await page.locator('[data-cancel-edit]').click();
    await page.locator('[data-transcription-section][data-mode="reading"]').waitFor();
    record('Biblioteca separa Abrir, Editar transcrição (modo edição direto) e Organizar compacto');
    /** axe-core on one open dialog (WCAG A/AA); any automatic violation fails the run. */
    async function auditDialog(selector, label) {
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(
        async (target) =>
          (
            await axe.run(document.querySelector(target), {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
            })
          ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
        selector,
      );
      assert.deepEqual(violations, [], `${label} has automatic accessibility violations`);
    }
    // Study authoring (FEATURE_STUDY_AUTHORING): named lists, custom counts and on-demand guidance.
    authoringFlags.study_authoring = true;
    authoringFlags.sharing = true;
    authoringFlags.flashcards = true;
    authoringFlags.flashcard_sets = true;
    await page.goto(base + '/material.html?id=aula-real#questoes');
    await page.locator('[data-questions-section]').waitFor();
    assert.equal(await page.locator('[data-open-questions]').textContent(), 'Criar lista de questões');
    // The material copy-for-reading form no longer sits in the page body: it opens from the header.
    const shareButton = page.locator('[data-material-actions]').getByRole('button', { name: 'Compartilhar', exact: true });
    await shareButton.waitFor();
    assert(await page.locator('[data-sharing-panel]').isHidden());
    await shareButton.click();
    await page.locator('[data-material-share-dialog][open]').waitFor();
    assert(await page.locator('[data-material-share-dialog]').getByRole('button', { name: 'Criar link de leitura' }).isVisible());
    await auditDialog('[data-material-share-dialog]', 'material share dialog');
    await screenshot(page, output, 'material-share-dialog.png');
    await page.keyboard.press('Escape');
    record('Compartilhar cópia da aula abre em diálogo compacto pelo cabeçalho');
    await page.locator('[data-open-questions]').click();
    await page.locator('[data-questions-dialog][open]').waitFor();
    assert.equal(await page.locator('[data-questions-advanced]').evaluate((n) => n.open), false);
    assert(await page.locator('[data-count-recommendation]').isHidden());
    await page.locator('[data-count-info]').click();
    assert.equal(await page.locator('[data-count-info]').getAttribute('aria-expanded'), 'true');
    assert.match(
      await page.locator('[data-count-recommendation]').textContent(),
      /Menos de 5 minutos: em geral 3 a 5 questões\..*São referências, não limites \(máximo 30\)/,
    );
    await page.locator('[data-more-questions-form] [name=title]').fill('Carros elétricos — Análise');
    await page.locator('#more-question-count').selectOption('custom');
    await page.locator('#custom-question-count').fill('35');
    await page.locator('[data-more-questions-form] [type=submit]').click();
    await page.getByText('Informe uma quantidade inteira de 1 a 30.', { exact: true }).waitFor();
    assert(await page.locator('[data-questions-dialog][open]').isVisible());
    await page.locator('#custom-question-count').fill('7');
    await page.locator('[data-more-questions-form] [name=difficulty][value=basic]').uncheck();
    await page.locator('[data-more-questions-form] [name=difficulty][value=intermediate]').uncheck();
    await page.locator('[data-more-questions-form] [type=submit]').click();
    await page.getByText('Escolha pelo menos uma dificuldade e uma habilidade.', { exact: true }).waitFor();
    await page.locator('[data-more-questions-form] [name=difficulty][value=advanced]').check();
    await page.locator('[data-more-questions-form] [name=difficulty][value=intermediate]').check();
    await page.locator('[data-more-questions-form] [name=skill][value=application]').check();
    await page.locator('[data-questions-advanced] > summary').click();
    await page.locator('[data-more-questions-form] [name=previousQuestions][value=prioritize_new]').check();
    await screenshot(page, output, 'question-list-dialog-desktop.png');
    await auditDialog('[data-questions-dialog]', 'question list dialog');
    await page.locator('[data-more-questions-form] [type=submit]').click();
    await page.locator('.question-batch-row h3', { hasText: 'Carros elétricos — Análise' }).waitFor();
    const listRequest = listCalls.at(-1);
    assert.equal(listRequest.count, 7);
    assert.deepEqual(listRequest.config, {
      title: 'Carros elétricos — Análise',
      difficulties: ['intermediate', 'advanced'],
      skills: ['recall', 'understanding', 'application'],
      format: 'single_choice',
      distribution: 'balanced',
      previousQuestions: 'prioritize_new',
    });
    const newRow = page.locator('.question-batch-row').first();
    assert.match(await newRow.textContent(), /5 de 7 questões pedidas/);
    assert.match(await newRow.textContent(), /a aula não sustenta mais questões distintas/);
    assert.deepEqual(await newRow.locator('.list-tags li').allTextContents(), [
      'Intermediário', 'Avançado', 'Recordação', 'Compreensão conceitual', 'Aplicação',
    ]);
    // Earlier lists stay, each with its own actions.
    assert(await page.locator('.question-batch-row').count() >= 3);
    await newRow.locator('.row-menu > summary').click();
    await newRow.getByRole('button', { name: 'Renomear', exact: true }).click();
    await page.locator('[data-rename-dialog][open]').waitFor();
    await auditDialog('[data-rename-dialog]', 'rename dialog');
    await page.locator('#rename-field').fill('Carros elétricos — Avaliação avançada');
    await page.locator('[data-rename-form] [type=submit]').click();
    await page.locator('.question-batch-row h3', { hasText: 'Carros elétricos — Avaliação avançada' }).waitFor();
    assert.deepEqual(listCalls.at(-1), { rename: { title: 'Carros elétricos — Avaliação avançada' } });
    await screenshot(page, output, 'question-lists-desktop.png');
    // List-specific export: worksheet without answers, teacher key only when chosen.
    await newRow.locator('.row-menu > summary').click();
    await newRow.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.locator('[data-export-dialog][open]').waitFor();
    assert.match(await page.locator('#export-dialog-title').textContent(), /^Exportar lista — Carros elétricos/);
    assert.equal(await page.locator('[data-export-form] [name=transcript]').isChecked(), false);
    assert.equal(await page.locator('[data-export-form] [name=list]:checked').count(), 1);
    await auditDialog('[data-export-dialog]', 'export dialog');
    await page.locator('[data-export-form] [name=format][value=md]').check();
    let listDownload = page.waitForEvent('download');
    await page.locator('[data-export-form] [type=submit]').click();
    const worksheet = fs.readFileSync(await (await listDownload).path(), 'utf8');
    assert.match(worksheet, /folha do aluno, sem respostas/);
    assert.match(worksheet, /1\. Questão planejada 1 sobre energia\?\n {3}a\) A/);
    assert.doesNotMatch(worksheet, /Resposta correta|Explicação da aula/);
    await page.locator('[data-export-form] [name=variant][value=teacher]').check();
    listDownload = page.waitForEvent('download');
    await page.locator('[data-export-form] [type=submit]').click();
    const teacherFile = await listDownload;
    assert.match(teacherFile.suggestedFilename(), /-gabarito\.md$/);
    const teacherKey = fs.readFileSync(await teacherFile.path(), 'utf8');
    assert.match(teacherKey, /\*\*Resposta correta:\*\* b\) B\n {3}\*Explicação:\* Explicação da aula 1\./);
    await page.keyboard.press('Escape');
    // Read-only worksheet link: frozen questions, no answers, revocable.
    await newRow.locator('.row-menu > summary').click();
    await newRow.getByRole('button', { name: 'Compartilhar', exact: true }).click();
    await page.locator('[data-list-share-dialog][open]').waitFor();
    await page.locator('#list-share-days').selectOption('1');
    await page.locator('[data-list-share-form] [type=submit]').click();
    await page.locator('[data-list-share-result] input').waitFor();
    const shareUrl = await page.locator('[data-list-share-result] input').inputValue();
    assert.match(shareUrl, /\/compartilhado\.html#tipo=lista&token=[0-9a-f]{64}$/);
    const shareRequest = [...listShares.values()].at(-1);
    assert.deepEqual(Object.keys(shareRequest).filter((k) => !['batchId', 'snapshot'].includes(k)).sort(), [
      'days', 'id', 'requestId', 'token',
    ]);
    assert.equal(shareRequest.days, 1);
    await page.locator('[data-list-share-list]').getByText(/^Disponível/).waitFor();
    await auditDialog('[data-list-share-dialog]', 'share dialog');
    const publicPage = await context.newPage();
    await publicPage.goto(shareUrl);
    await publicPage.locator('.shared-questions > li').first().waitFor();
    assert.equal(await publicPage.locator('[data-shared-title]').textContent(), 'Carros elétricos — Avaliação avançada');
    assert.equal(await publicPage.locator('.shared-questions > li').count(), 5);
    assert.equal(await publicPage.locator('.shared-questions > li').first().locator('.shared-options li').count(), 4);
    assert.doesNotMatch(await publicPage.locator('main').textContent(), /Resposta correta|Explicação/);
    // Revoking asks first: cancelling keeps the link, confirming revokes it.
    page.once('dialog', (dialog) => { assert.match(dialog.message(), /não pode ser desfeita/); void dialog.dismiss(); });
    await page.locator('[data-list-share-list]').getByRole('button', { name: 'Revogar', exact: true }).click();
    await page.waitForTimeout(200);
    assert(![...listShares.values()].some((item) => item.revoked), 'cancel keeps the link');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.locator('[data-list-share-list]').getByRole('button', { name: 'Revogar', exact: true }).click();
    await page.locator('[data-list-share-list]').getByText(/^Revogado/).waitFor();
    await publicPage.reload();
    await publicPage.getByText('Link indisponível, expirado ou revogado.', { exact: true }).waitFor();
    await publicPage.close();
    await page.keyboard.press('Escape');
    record('Lista compartilhada por link de leitura: cópia sem respostas, validade e revogação');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-open-questions]').click();
    await page.locator('[data-questions-dialog][open]').waitFor();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'question dialog fits a phone width',
    );
    await page.locator('[data-questions-advanced] > summary').click();
    assert(
      await page.locator('[data-questions-dialog]').evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
      'no control overflows the dialog horizontally',
    );
    await screenshot(page, output, 'question-list-dialog-mobile.png');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.setViewportSize({ width: 1280, height: 900 });
    // Flashcards 2.0 from the Resumo tab: preview, reject, regenerate one, edit, save as a named set.
    // Only the hash differs from the current URL, so reload to pick up the new feature flags.
    await page.goto(base + '/material.html?id=aula-real#resumo');
    await page.reload();
    await page.locator('[data-open-flashcards]').waitFor();
    await page.locator('[data-open-flashcards]').click();
    await page.locator('[data-flashcard-dialog][open]').waitFor();
    assert.equal(await page.locator('[data-flashcard-advanced]').evaluate((n) => n.open), false);
    await page.locator('[data-flashcard-config] [name=name]').fill('Carros elétricos — termos');
    await page.locator('#flashcard-count').selectOption('custom');
    await page.locator('#flashcard-custom-count').fill('7');
    await page.locator('#flashcard-style').selectOption('term_definition');
    await page.locator('[data-flashcard-generate]').click();
    await page.locator('.flashcard-proposal').nth(2).waitFor();
    assert.deepEqual(flashcardPreviews.at(-1).config, {
      difficulties: ['basic', 'intermediate'],
      focus: ['definitions', 'concepts'],
      style: 'term_definition',
    });
    assert.equal(flashcardPreviews.at(-1).count, 7);
    assert.match(await page.locator('[data-flashcard-message]').textContent(), /3 de 7 sugestões\. Somente estes cartões distintos/);
    const proposals = page.locator('.flashcard-proposal');
    await proposals.nth(1).getByRole('button', { name: 'Rejeitar', exact: true }).click();
    await proposals.nth(2).getByRole('button', { name: 'Gerar outro', exact: true }).click();
    await page.getByText('Sugestão substituída.', { exact: true }).waitFor();
    assert.deepEqual(flashcardPreviews.at(-1).avoid, ['Cartão 1', 'Cartão 2', 'Cartão 3']);
    assert.equal(await proposals.nth(2).locator('textarea').first().inputValue(), 'Cartão substituto');
    await proposals.nth(0).locator('textarea').nth(1).fill('Verso 1 editado.');
    assert.equal(await page.locator('[data-flashcard-save]').textContent(), 'Salvar 2 cartões');
    await screenshot(page, output, 'flashcard-preview-desktop.png');
    await page.locator('[data-flashcard-advanced] > summary').click();
    await auditDialog('[data-flashcard-dialog]', 'flashcard dialog');
    await page.locator('[data-flashcard-save]').click();
    await page.getByText(/2 cartões salvos\. Eles entram na revisão do Painel\./).waitFor();
    const savedSet = flashcardSets.at(-1).body;
    assert.equal(savedSet.name, 'Carros elétricos — termos');
    assert.equal(savedSet.materialId, 'aula-real');
    assert.deepEqual(savedSet.cards.map((c) => [c.front, c.back]), [['Cartão 1', 'Verso 1 editado.'], ['Cartão substituto', 'Verso substituto.']]);
    assert.deepEqual(savedSet.cards[0].sourceSegments, [{ position: 0, startMs: 0, endMs: 1500 }]);
    await page.keyboard.press('Escape');
    // The set is exportable as CSV from the material export dialog.
    await page.locator('[data-open-export]').click();
    await page.locator('[data-export-form] [name=flashcardSet]').first().waitFor();
    await page.locator('[data-export-form] [name=transcript]').uncheck();
    await page.locator('[data-export-form] [name=summary]').uncheck();
    assert(await page.locator('[data-export-csv]').isHidden());
    await page.locator('[data-export-form] [name=flashcardSet]').first().check();
    await page.locator('[data-export-form] [name=format][value=csv]').check();
    const csvDownload = page.waitForEvent('download');
    await page.locator('[data-export-form] [type=submit]').click();
    const csvText = fs.readFileSync(await (await csvDownload).path(), 'utf8');
    assert.match(csvText, /^\uFEFFfront,back,set,lesson,difficulty,focus,style,source_revision_id,evidence\r\n"Cartão 1","Verso 1 editado\.","Carros elétricos — termos"/);
    await page.keyboard.press('Escape');
    record('Flashcards 2.0: prévia editável, rejeitar e gerar outro cartão, conjunto nomeado e exportação CSV');
    // Read-aloud: a discreet speaker icon next to the summary title, hidden from Aparência.
    await page.getByRole('tab', { name: 'Resumo', exact: true }).click();
    const speaker = page.locator('.panel-title-row').getByRole('button', { name: 'Ouvir resumo', exact: true });
    assert(await speaker.isVisible());
    assert.equal((await speaker.textContent()).trim(), '', 'icon only; the name is in aria-label');
    assert((await speaker.boundingBox()).width <= 34);
    assert.equal(await page.locator('[data-summary-section] .panel-toolbar-actions .speak-controls').count(), 0);
    // Renaming lives inside the Versões menu now.
    await page.locator('[data-summary-history] > summary').click();
    assert(await page.locator('[data-summary-history]').getByRole('button', { name: 'Renomear esta versão' }).isVisible());
    await page.locator('[data-summary-history] > summary').click();
    await screenshot(page, output, 'summary-toolbar-desktop.png');
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-read-aloud').selectOption('off');
    await page.locator('#setting-speech-rate').selectOption('slow');
    await page.goto(base + '/material.html?id=aula-real#resumo');
    await page.locator('[data-summary-section]').waitFor();
    assert(await page.locator('.panel-title-row .speak-controls').isHidden(), 'hidden by the preference');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.speechRate), 'slow');
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-read-aloud').selectOption('icons');
    await page.locator('#setting-speech-rate').selectOption('normal');
    record('Leitura em voz alta: ícone discreto junto ao título; ocultar e velocidade em Aparência');
    // "Em todo o site": a discreet page reader in every header (Alt+L); hidden otherwise.
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-read-aloud').selectOption('everywhere');
    await page.goto(base + '/painel.html');
    const pageReader = page.locator('.page-reader').getByRole('button', { name: 'Ouvir esta página', exact: true });
    assert(await pageReader.isVisible());
    assert.equal(await pageReader.getAttribute('aria-keyshortcuts'), 'Alt+L');
    await page.goto(base + '/historico.html');
    assert(await page.locator('.page-reader').isVisible(), 'available on every app page');
    await page.goto(base + '/aparencia.html');
    await page.locator('#setting-read-aloud').selectOption('icons');
    await page.goto(base + '/painel.html');
    assert(await page.locator('.page-reader').isHidden());
    record('Leitura em voz alta em todo o site é opcional: leitor discreto no topo e Alt+L');
    // Screen-reader mode: reachable from the second Tab stop of any page.
    await page.goto(base + '/historico.html');
    await page.locator('[data-library-data][aria-busy="false"]').waitFor();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Ativar modo para leitores de tela');
    assert(await page.locator('[data-screen-reader-toggle]').isVisible(), 'visible while focused');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.screenReaderMode), 'true');
    assert.equal(await page.locator('[data-screen-reader-toggle]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-screen-reader-toggle]').textContent(), 'Desativar modo para leitores de tela');
    await page.goto(base + '/painel.html?busca=xyzinexistente');
    await page.getByText('Nada encontrado para “xyzinexistente”', { exact: true }).waitFor();
    assert(await page.locator('[data-search-results] img[data-nino]').isHidden(), 'decorative images removed');
    assert.equal(await page.locator('.global-search-results').evaluate((n) => getComputedStyle(n).boxShadow), 'none');
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const minimalViolations = await page.evaluate(async () =>
      (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => v.id),
    );
    assert.deepEqual(minimalViolations, [], 'screen-reader mode has no automatic violations');
    await screenshot(page, output, 'screen-reader-mode.png');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.screenReaderMode), 'true', 'persists');
    await page.goto(base + '/aparencia.html');
    assert(await page.locator('#setting-screen-reader').isChecked());
    await page.locator('#setting-screen-reader').uncheck();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.screenReaderMode), 'false');
    record('Modo para leitores de tela: no segundo Tab de cada página, sem decoração nem animação, axe sem violações');
    // Transcript search shows the searched words in bold, ignoring accents and case.
    await page.goto(base + '/material.html?id=aula-real#transcricao');
    await page.locator('.segment-text').first().waitFor();
    // Earlier steps edited this transcript, so take a word from the saved text itself.
    const word = (await page.locator('.segment-text').first().textContent()).match(/\p{L}{5,}/u)[0];
    const query = word.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
    await page.locator('.transcript-search input').fill(query);
    await page.locator('.segment-text mark.search-hit').first().waitFor();
    assert.equal(await page.locator('.segment-text mark.search-hit').first().textContent(), word);
    assert.equal(
      await page.locator('.segment-text mark.search-hit').evaluate((n) => getComputedStyle(n).fontWeight),
      '700',
    );
    await page.locator('.transcript-search input').fill('');
    assert.equal(await page.locator('.segment-text mark').count(), 0);
    record('Busca na transcrição destaca o termo em negrito');
    // Dashboard search: suggestions, results in tabs only when present, Nino when empty.
    await page.goto(base + '/painel.html');
    const globalSearch = page.locator('.topbar-search input[type=search]');
    await globalSearch.fill('energia');
    await page.locator('#global-search-suggestions:not([hidden])').waitFor();
    assert.equal(await globalSearch.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
      (await page.locator('#global-search-suggestions [role=option]').allTextContents()).slice(-4),
      ['“energia” em tudo', '“energia” nos títulos das aulas', '“energia” nas questões', '“energia” nas transcrições'],
    );
    // The shared helper blurs the field (which closes the list), so capture directly.
    await page.screenshot({ path: path.join(output, 'dashboard-search-suggestions.png') });
    await globalSearch.press('Enter');
    await page.locator('[data-search-results] [role=tab]').first().waitFor();
    assert.deepEqual(searchCalls.at(-1), { q: 'energia', scope: 'all' });
    assert.deepEqual(await page.locator('[data-search-results] [role=tab]').allTextContents(), [
      'Aulas (1)', 'Questões (1)', 'Transcrições (1)',
    ]);
    assert(await page.locator('[data-recent-section]').isHidden(), 'dashboard steps aside while searching');
    await page.getByRole('tab', { name: 'Questões (1)' }).click();
    assert.equal(await page.locator('#search-panel-questions mark.search-hit').textContent(), 'energia');
    await page.getByRole('tab', { name: 'Questões (1)' }).press('ArrowRight');
    assert.equal(await page.locator('#search-tab-transcripts').getAttribute('aria-selected'), 'true');
    await screenshot(page, output, 'dashboard-search-results.png');
    await globalSearch.fill('baterias');
    for (let i = 0; i < 4; i++) await globalSearch.press('ArrowDown');
    await globalSearch.press('Enter');
    await page.locator('.search-single-heading').waitFor();
    assert.deepEqual(searchCalls.at(-1), { q: 'baterias', scope: 'transcripts' });
    assert.equal(await page.locator('[data-search-results] [role=tablist]').count(), 0, 'one category: no tabs');
    assert.equal(await page.locator('.search-single-heading').textContent(), 'Transcrições (1)');
    assert.match(page.url(), /busca=baterias&em=transcripts/);
    await page.locator('.search-hit-row').first().click();
    await page.waitForURL('**/material.html?**busca=baterias**');
    await page.locator('[data-transcription-section]:not([hidden])').waitFor();
    await page.waitForFunction(() => document.querySelector('.transcript-search input')?.value === 'baterias');
    assert.equal(await page.locator('#tab-transcription').getAttribute('aria-selected'), 'true');
    await page.goto(base + '/painel.html?busca=xyzinexistente');
    await page.getByText('Nada encontrado para “xyzinexistente”', { exact: true }).waitFor();
    assert(await page.locator('[data-search-results] img[data-nino="curious"]').isVisible());
    assert.equal(await page.locator('[data-search-results] img[data-nino="curious"]').getAttribute('alt'), '');
    await screenshot(page, output, 'dashboard-search-empty.png');
    await page.getByRole('button', { name: 'Voltar ao início', exact: true }).click();
    assert(await page.locator('[data-search-results]').isHidden());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/painel.html?busca=energia');
    await page.locator('[data-search-results] [role=tab]').first().waitFor();
    assert(await page.locator('.topbar-search').isVisible(), 'search stays available on phones');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await screenshot(page, output, 'dashboard-search-mobile.png');
    await page.setViewportSize({ width: 1280, height: 900 });
    record('Busca do painel: sugestões, abas só com resultados, transcrição destacada e Nino sem resultados');
    authoringFlags.flashcards = false;
    authoringFlags.flashcard_sets = false;
    authoringFlags.study_authoring = false;
    authoringFlags.sharing = false;
    record('Listas nomeadas: quantidade personalizada limitada, recomendação sob demanda, níveis e habilidades, renomear');
    const safe = await page.evaluate(async () => {
      const { renderMarkdown } = await import('/js/utils/markdown.js');
      const target = document.createElement('div');
      renderMarkdown(target, '**Texto** <img src=x onerror=alert(1)>');
      return {
        bold: target.querySelector('strong').textContent,
        images: target.querySelectorAll('img').length,
      };
    });
    assert.deepEqual(safe, { bold: 'Texto', images: 0 });
    fs.writeFileSync(
      path.join(output, 'browser-results.json'),
      JSON.stringify(
        {
          scope: 'Chromium + FFmpeg real; Supabase/Auth e APIs de geração simulados.',
          checks: reports,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await screenshot(page, output, 'failure.png').catch(() => {});
    fs.writeFileSync(path.join(output, 'failure.html'), await page.content());
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
