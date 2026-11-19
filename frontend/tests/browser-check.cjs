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
      if (!r.failure()?.errorText.includes('ERR_ABORTED'))
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
        featureFlags: { mp4_retention: mp4Retention },
        recordingLanguages: { options: ['auto', 'pt', 'en', 'es', 'zh'], default: 'pt' },
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
      m.summaries.unshift({
        ...m.summaries[0],
        version: m.summaries[0].version + 1,
        is_current: true,
      });
      return reply({ jobId: 'job-1' });
    }
    if (p.endsWith('/question-batches')) {
      generationCount++;
      const m = materials.find((item) => item.id === p.split('/')[3]),
        count = request.postDataJSON().count;
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
  await context.route(base + '/api/jobs/**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/events')
        ? []
        : new URL(route.request().url()).pathname.endsWith('/job-failed')
          ? { status: 'FALHOU', error_message: 'Falha simulada na geração.' }
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
    const contentLeft = await page
      .locator('main')
      .evaluate((n) => Math.round(n.getBoundingClientRect().left));
    // Focus mode keeps a way back to the navigation: a temporary overlay, not a layout change.
    await page.getByRole('button', { name: 'Expandir barra lateral', exact: true }).click();
    assert.equal(await page.locator('.side-navigation').isVisible(), true);
    assert.equal(
      await page.locator('main').evaluate((n) => Math.round(n.getBoundingClientRect().left)),
      contentLeft,
    );
    assert(
      await page
        .locator('.side-navigation nav a')
        .first()
        .evaluate((n) => document.activeElement === n),
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.side-navigation').isVisible(), false);
    assert(
      await page.locator('[data-menu-toggle]').evaluate((n) => document.activeElement === n),
      'Escape returns focus to the menu button',
    );
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
    assert.equal(await page.locator('#focus-dock a').count(), 4);
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
    assert.equal(requests[0].extension, 'wav');
    assert.equal(requests[0].mimeType, 'audio/wav');
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
    await page.locator('#library-search').fill('inexistente');
    await page.getByText('Nenhuma aula encontrada.', { exact: true }).waitFor();
    await page.locator('#library-search').fill('carro');
    await page
      .locator('.library-subject-folder > summary')
      .filter({ hasText: 'Tecnologia' })
      .click();
    const row = page.locator('[data-material-id="aula-real"]');
    await row.locator('.row-menu > summary').click();
    await row.getByRole('button', { name: 'Editar', exact: true }).click();
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
    await page.locator('[data-open-export]').click();
    const exportPromise = page.waitForEvent('download');
    await page
      .locator('[data-material-tools]')
      .getByRole('button', { name: 'Baixar Markdown' })
      .click();
    assert((await exportPromise).suggestedFilename().endsWith('.md'));
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
        .getByRole('link', { name: 'Revisar Carros elétricos — energia', exact: true })
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
    record('Fim do áudio oferece Revisar sem confundir reprodução com revisão concluída');
    await page.goto(base + '/material.html?id=aula-real');
    await page.locator('[data-complete-review]').waitFor();
    await page.getByRole('button', { name: 'Marcar revisão concluída', exact: true }).click();
    assert.equal(await page.locator('[data-complete-review]').getAttribute('aria-pressed'), 'true');
    await page.goto(base + '/painel.html');
    await page.waitForFunction(
      () => document.querySelector('[data-dashboard-data]').getAttribute('aria-busy') === 'false',
    );
    assert.match(await page.locator('[data-overview]').textContent(), /1 revisão concluída/);
    assert(await page.getByText('energia', { exact: true }).first().isVisible());
    assert.equal(await page.locator('[data-continue-list] .dashboard-lesson-card').count(), 1);
    assert.equal(
      await page.locator('[data-recent-list] [data-material-id="aula-real"]').count(),
      0,
    );
    assert(
      await page
        .getByRole('link', { name: 'Revisar Carros elétricos — energia', exact: true })
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
    assert((await page.locator('.account-link img').getAttribute('src')).includes('reading.png'));
    await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
    const profileDialog = page.getByRole('dialog', { name: 'Personalizar perfil' });
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
        const words = [...nav.querySelectorAll('nav a > span')].flatMap((label) => {
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
    assert.equal(requests.at(-1).extension, 'wav');
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
    jobPending = false;
    await page.waitForURL('**/material.html?**');
    record('Espera separada mostra etapa e tempo decorrido e abre material ao concluir');
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
