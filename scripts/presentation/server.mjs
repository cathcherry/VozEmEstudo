import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PERMISSION_DECLARATION } from '../../backend/src/config/permission-declaration.js';
import {
  createState,
  createExample,
  addRevision,
  addSummary,
  addQuestions,
  now,
  tone,
} from './data.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(directory, '../../frontend');
const maximumBytes = 100 * 1024 * 1024;
const counts = [3, 5, 10, 20];
const extensions = ['mp4', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mov'];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function fail(message, status = 400, code = 'PRESENTATION_ERROR') {
  throw Object.assign(new Error(message), { status, code });
}
async function readBody(request, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) fail('Arquivo muito grande para a apresentação.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function permission(body) {
  if (body.permissionAccepted !== true || body.permissionVersion !== PERMISSION_DECLARATION.version)
    fail('Leia e confirme a declaração de permissão vigente.', 422, 'PERMISSION_REQUIRED');
}
function publicMaterial(material) {
  const result = { ...material };
  delete result.versions;
  return result;
}
export function createPresentationServer({ liveAI = false, providers = null } = {}) {
  if (liveAI && (!providers || !['transcribe', 'summarize', 'questions'].every((key) => typeof providers[key] === 'function')))
    throw new Error('O modo de IA real exige provedores configurados.');
  const state = createState();
  // A sessão real começa vazia: resultados fictícios nunca aparecem como resultados de IA.
  if (liveAI) state.materials = [];
  const fixtureAudio = tone();
  let mediaService;
  function job(material, key) {
    const jobId = randomUUID();
    state.jobs.set(jobId, {
      id: jobId,
      material_id: material.id,
      status: 'CONCLUIDA',
      current_stage: 'FINALIZACAO',
    });
    if (key) state.attempts.set(key, { jobId });
    return { jobId };
  }
  function liveJob(material, stage, work, key) {
    const jobId = randomUUID();
    const task = {
      id: jobId,
      material_id: material.id,
      status: 'EM_EXECUCAO',
      current_stage: stage,
      events: [{ created_at: now(), message: stage === 'TRANSCRICAO' ? 'Enviando áudio ao Whisper no Hugging Face.' : 'Enviando a transcrição à Groq.' }],
    };
    state.jobs.set(jobId, task);
    if (key) state.attempts.set(key, { jobId });
    // Trabalho assíncrono, mas executado nesta sessão local (sem worker/Supabase).
    Promise.resolve().then(() => work(task)).then(() => {
      task.status = 'CONCLUIDA';
      task.current_stage = 'FINALIZACAO';
      task.events.push({ created_at: now(), message: 'Processamento real concluído.' });
    }).catch((error) => {
      task.status = 'FALHOU';
      task.error_message = error?.message || 'Erro ao chamar o provedor de IA.';
      task.events.push({ created_at: now(), message: 'Falha: ' + task.error_message });
      if (key) state.attempts.delete(key);
      console.error(`[Voz em Estudo / IA real] ${stage}: ${task.error_message}`);
    });
    return { jobId };
  }
  return http.createServer(async (request, response) => {
    const json = (data, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(data));
    };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // No external providers, frames, fonts, analytics, or remote API connections in this runtime.
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const host = request.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host))
        fail('A apresentação aceita somente acesso local.', 403);
      if (request.headers.origin && request.headers.origin !== 'http://' + host)
        fail('Origem não permitida.', 403);
      const url = new URL(request.url, 'http://' + host),
        pathname = decodeURIComponent(url.pathname);
      const method = request.method;
      if (pathname === '/api/config')
        return json({
          presentationMode: true,
          liveAi: liveAI,
          audioBucket: 'local-presentation',
          oauthProviders: [],
          featureFlags: {},
          allowedQuestionCounts: counts,
          maxAudioBytes: maximumBytes,
          mediaExtensions: extensions,
          maxTranscriptionSeconds: 3276,
          permissionDeclaration: PERMISSION_DECLARATION,
          processingDisclosure: {
            recognitionProvider: liveAI ? 'Hugging Face · Whisper (real)' : 'Exemplo local (sem ASR)',
            textProvider: liveAI ? 'Groq (IA real)' : 'Exemplo local (sem IA)',
            audioOnly: true,
          },
        });
      if (pathname === '/api/health')
        return json({ ok: true, service: liveAI ? 'live-ai-local' : 'presentation-local', liveAi: liveAI, remoteConnected: false });
      if (
        (pathname.startsWith('/api/') || pathname === '/presentation/upload') &&
        request.headers.authorization !== 'Bearer presentation-local'
      )
        fail('Entre na demonstração local.', 401);
      if (pathname === '/presentation/upload') {
        const key = url.searchParams.get('path');
        if (!key?.startsWith('temp/presentation-local-user/') || key.length > 400)
          fail('Caminho local inválido.');
        if (method === 'DELETE') {
          state.uploads.delete(key);
          return json({});
        }
        if (method !== 'POST') fail('Método não disponível.', 405);
        const bytes = await readBody(request, maximumBytes);
        const total = [...state.uploads.values()].reduce((sum, item) => sum + item.bytes.length, 0);
        if (total + bytes.length > maximumBytes * 2)
          fail('Limite de 200 MB por sessão. Reinicie a apresentação para liberar os envios.', 413);
        state.uploads.set(key, {
          bytes,
          mimeType: request.headers['content-type'] || 'application/octet-stream',
        });
        return json({});
      }
      if (pathname === '/presentation/tone.wav' || pathname.startsWith('/presentation/audio/')) {
        const material = state.materials.find((item) => item.id === pathname.split('/').pop());
        const audio = pathname.endsWith('tone.wav')
          ? { bytes: fixtureAudio, mimeType: 'audio/wav' }
          : state.uploads.get(material?.storagePath);
        if (!audio) fail('Áudio indisponível nesta sessão.', 404);
        let start = 0,
          end = audio.bytes.length - 1,
          status = 200;
        if (request.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
          if (!match) fail('Intervalo inválido.', 416);
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
          if (start > end) fail('Intervalo inválido.', 416);
          status = 206;
          response.setHeader('Content-Range', `bytes ${start}-${end}/${audio.bytes.length}`);
        }
        response.writeHead(status, {
          'Content-Type': audio.mimeType,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        return response.end(audio.bytes.subarray(start, end + 1));
      }
      if (pathname.startsWith('/api/media/') && method === 'POST') {
        if (!mediaService) {
          try {
            mediaService = await import('../../backend/src/services/media.service.js');
          } catch {
            fail(
              'Para enviar e recortar arquivos, execute npm ci --prefix backend na pasta AudioEstudo e reinicie. As aulas de exemplo já podem ser utilizadas.',
              503,
            );
          }
        }
        const bytes = await readBody(request, maximumBytes),
          extension = url.searchParams.get('extension');
        if (pathname.endsWith('/inspect'))
          return json(await mediaService.inspectMedia(bytes, extension));
        if (pathname.endsWith('/convert')) {
          const result = await mediaService.convertMedia(bytes, extension, {
            start: url.searchParams.get('start'),
            end: url.searchParams.get('end'),
            output: url.searchParams.get('output') || 'wav',
          });
          response.writeHead(200, {
            'Content-Type': result.mimeType,
            'X-Media-Duration-Ms': String(result.durationMs),
          });
          return response.end(result.buffer);
        }
        fail('Operação de mídia não encontrada.', 404);
      }
      if (pathname.startsWith('/api/')) {
        let body = {};
        if (['POST', 'PATCH'].includes(method)) {
          const bytes = await readBody(request);
          try {
            body = bytes.length ? JSON.parse(bytes.toString()) : {};
          } catch {
            fail('JSON inválido.');
          }
        }
        const parts = pathname.split('/').filter(Boolean),
          resource = parts[1],
          id = parts[2],
          action = parts.slice(3).join('/');
        if (resource === 'jobs') {
          const result = state.jobs.get(id);
          if (!result) fail('Tarefa não encontrada.', 404);
          return json(
            action === 'events'
              ? result.events || [{ created_at: now(), message: 'Simulação local concluída; nenhum provedor foi chamado.' }]
              : { ...result, events: undefined },
          );
        }
        if (resource === 'questions' && method === 'POST' && action === 'answer') {
          const question = state.materials
            .flatMap((m) => m.questionBatches.flatMap((batch) => batch.questions))
            .find((item) => item.id === id);
          if (!question) fail('Questão não encontrada.', 404);
          if (
            !Number.isInteger(body.selectedIndex) ||
            body.selectedIndex < 0 ||
            body.selectedIndex >= question.options.length
          )
            fail('Escolha uma alternativa.');
          const correctIndex = liveAI ? question.correctIndex : 0;
          return json({
            correct: body.selectedIndex === correctIndex,
            correctIndex,
            explanation: liveAI ? question.explanation : 'Questão fixa para demonstrar a interface; não foi gerada por IA.',
          });
        }
        if (resource !== 'materials') fail('Rota não encontrada.', 404);
        if (!id && method === 'GET') return json(state.materials.map(publicMaterial));
        if (!id && method === 'POST') {
          permission(body);
          if (!body.id || !body.title?.trim() || !counts.includes(body.questionCount))
            fail('Revise título e quantidade de questões.');
          const existing = state.materials.find((item) => item.id === body.id);
          if (existing) return json(publicMaterial(existing));
          if (!state.uploads.has(body.storagePath)) fail('Envie o arquivo local primeiro.');
          const material = createExample({
            id: body.id,
            title: body.title,
            subject: body.subject,
            text: liveAI ? 'Transcrição pendente.' : 'Transcrição de demonstração: este texto é um exemplo fixo e não corresponde ao áudio enviado. Edite e confirme para percorrer o fluxo da interface.',
            ready: false,
          });
          material.transcription = null;
          material.versions = [];
          material.review = { state: 'pending', permissionRequired: false };
          material.status = 'RECEBIDO';
          material.storagePath = body.storagePath;
          material.initial_question_count = body.questionCount;
          material.audio = {
            duration_ms: body.durationMs,
            extension: body.extension,
            retain_original: body.retainAudio,
          };
          material.signedAudioUrl = body.retainAudio ? '/presentation/audio/' + material.id : null;
          state.materials.unshift(material);
          return json(publicMaterial(material), 201);
        }
        const material = state.materials.find((item) => item.id === id);
        if (!material) fail('Material não encontrado.', 404);
        if (!action && method === 'GET') return json(publicMaterial(material));
        if (!action && method === 'DELETE') {
          state.materials = state.materials.filter((item) => item.id !== id);
          state.uploads.delete(material.storagePath);
          return json({});
        }
        if (!action && method === 'PATCH') {
          if (typeof body.title !== 'string' || !body.title.trim()) fail('Informe o título.');
          material.title = body.title.trim();
          material.subject = String(body.subject || '');
          return json(publicMaterial(material));
        }
        if (action === 'process' && method === 'POST') {
          if (liveAI) {
            if (material.transcription) fail('Este áudio já foi transcrito.', 409);
            const audio = state.uploads.get(material.storagePath);
            if (!audio) fail('Áudio não encontrado. Envie novamente.', 404);
            if ([...state.jobs.values()].some((item) => item.material_id === id && item.current_stage === 'TRANSCRICAO' && item.status === 'EM_EXECUCAO'))
              fail('A transcrição já está em andamento.', 409);
            material.status = 'PROCESSANDO';
            return json(liveJob(material, 'TRANSCRICAO', async () => {
              const result = await providers.transcribe(audio.bytes, { durationMs: material.audio.duration_ms });
              if (!result?.text?.trim()) throw new Error('O Whisper não retornou palavras reconhecidas. Confira o áudio e o endpoint HF.');
              const segments = (result.segments?.length ? result.segments : [
                { position: 0, startMs: 0, endMs: material.audio.duration_ms, text: result.text },
              ]).map((segment, index) => ({
                id: randomUUID(),
                position: index,
                start_ms: Math.max(0, Math.round(Number(segment.startMs) || 0)),
                end_ms: Math.max(0, Math.round(Number(segment.endMs) || material.audio.duration_ms)),
                current_text: String(segment.text || '').trim(),
              })).filter((segment) => segment.current_text);
              if (!segments.length) throw new Error('O Whisper devolveu segmentos vazios.');
              addRevision(material, segments, 'asr');
              material.status = 'PARCIAL';
              if (!material.audio.retain_original) state.uploads.delete(material.storagePath);
            }));
          }
          if (!material.transcription)
            addRevision(
              material,
              [
                {
                  id: randomUUID(),
                  position: 0,
                  start_ms: 0,
                  end_ms: material.audio.duration_ms,
                  current_text:
                    'Texto fictício de demonstração, sem relação com a gravação enviada. Confira e confirme esta revisão para experimentar a interface.',
                },
              ],
              'asr',
            );
          material.status = 'PARCIAL';
          if (!material.audio.retain_original) state.uploads.delete(material.storagePath);
          return json(job(material));
        }
        if (action === 'permission' && method === 'POST') {
          permission(body);
          return json(material.review);
        }
        if (action === 'transcription/versions' && method === 'GET') return json(material.versions);
        if (action === 'transcription/review' && method === 'GET') return json(material.review);
        if (action === 'transcription' && method === 'PATCH') {
          if (body.expectedRevision !== material.review.revision)
            fail('A revisão mudou. Recarregue antes de salvar.', 409);
          const segments = structuredClone(material.transcription.transcription_segments);
          for (const edit of body.segments || []) {
            const segment = segments.find((item) => item.id === edit.id);
            if (!segment || !edit.text?.trim()) fail('Trecho inválido.');
            segment.current_text = edit.text.trim();
          }
          addRevision(material, segments);
          return json({ revision: material.review.revision });
        }
        if (/^transcription\/versions\/\d+\/restore$/.test(action) && method === 'POST') {
          const version = material.versions.find((item) => item.revision === Number(parts[5]));
          if (!version) fail('Revisão não encontrada.', 404);
          addRevision(
            material,
            version.segments_snapshot.map((s) => ({
              id: s.id,
              position: s.position,
              current_text: s.text,
              start_ms: s.startMs,
              end_ms: s.endMs,
            })),
            'restore',
          );
          return json({ revision: material.review.revision });
        }
        if (action === 'transcription/confirm' && method === 'POST') {
          if (body.sourceRevisionId !== material.review.sourceRevisionId)
            fail('A revisão mudou. Recarregue.', 409);
          material.review.state = 'ready_to_generate';
          material.review.confirmation ||= { id: randomUUID(), confirmedAt: now() };
          return json(material.review);
        }
        if (action === 'transcription/warnings' && method === 'POST') {
          if (liveAI) fail('A análise de alertas ainda não está ativa no modo de IA real.', 501);
          if (body.sourceRevisionId !== material.review.sourceRevisionId)
            fail('A revisão mudou. Recarregue.', 409);
          material.warnings = ['educational', 'topic_alignment', 'factual_suspicion'].map(
            (type) => ({
              type,
              state: 'insufficient',
              sourceRevisionId: material.review.sourceRevisionId,
              explanation: 'Análise não executada no modo apresentação.',
              guidance: 'Este exemplo demonstra o painel; não avalia o conteúdo.',
              model: 'exemplo local',
              promptVersion: 'demo',
              createdAt: now(),
              segmentRefs: [],
            }),
          );
          return json(material.warnings);
        }
        if (['summaries', 'question-batches'].includes(action) && method === 'POST') {
          if (
            material.review.state !== 'ready_to_generate' ||
            body.sourceRevisionId !== material.review.sourceRevisionId
          )
            fail(
              'Confirme a revisão atual antes de gerar.',
              409,
              'TRANSCRIPTION_CONFIRMATION_REQUIRED',
            );
          if (!body.idempotencyKey) fail('Identificador da operação ausente.');
          const key = [id, action, body.sourceRevisionId, body.count, body.idempotencyKey].join(
            ':',
          );
          if (state.attempts.has(key)) return json(state.attempts.get(key));
          if (liveAI) {
            if (action === 'question-batches' && !counts.includes(body.count)) fail('Quantidade inválida.');
            const version = material.versions.find((item) => item.id === body.sourceRevisionId);
            if (!version) fail('Revisão de origem não encontrada.', 404);
            const snapshot = version.segments_snapshot.map((s) => s.text).join(' ').trim();
            if (!snapshot) fail('Transcrição vazia.', 422);
            return json(liveJob(material, action === 'summaries' ? 'RESUMO' : 'QUESTOES', async () => {
              if (action === 'summaries') {
                const text = await providers.summarize(snapshot);
                if (!text?.trim()) throw new Error('A Groq devolveu um resumo vazio.');
                for (const summary of material.summaries) summary.is_current = false;
                material.summaries.unshift({
                  id: randomUUID(), is_current: true, version: material.summaries.length + 1,
                  source_transcription_revision: version.revision,
                  source_transcription_version_id: version.id, text: text.trim(),
                  stale: material.review.sourceRevisionId !== version.id,
                });
              } else {
                const questions = await providers.questions(snapshot, body.count);
                if (!Array.isArray(questions) || questions.length !== body.count || questions.some((q) =>
                  !q.statement || !Array.isArray(q.options) || q.options.length !== 4 || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3))
                  throw new Error('A Groq devolveu questões em formato inválido.');
                material.questionBatches.unshift({
                  id: randomUUID(), generated_count: body.count,
                  source_transcription_revision: version.revision,
                  source_transcription_version_id: version.id,
                  stale: material.review.sourceRevisionId !== version.id,
                  questions: questions.map((q) => ({
                    id: randomUUID(), statement: q.statement, options: q.options,
                    correctIndex: q.correctIndex, explanation: q.explanation || '',
                  })),
                });
              }
              material.status = 'PRONTO';
            }, key));
          }
          if (action === 'summaries') addSummary(material);
          else {
            if (!counts.includes(body.count)) fail('Quantidade inválida.');
            addQuestions(material, body.count);
          }
          material.status = 'PRONTO';
          return json(job(material, key));
        }
        fail('Operação não disponível na apresentação.', 404);
      }
      if (!['GET', 'HEAD'].includes(method)) fail('Método não disponível.', 405);
      const overrides = {
        '/js/api/supabase-browser.js': 'browser.js',
        '/presentation/banner.js': 'banner.js',
        '/presentation/banner.css': 'banner.css',
      };
      let filename;
      if (overrides[pathname]) filename = path.join(directory, overrides[pathname]);
      else if (pathname === '/favicon.ico')
        filename = path.join(frontend, 'assets/brand/favicon.png');
      else {
        const relative =
          pathname === '/'
            ? 'pages/painel.html'
            : /^\/(js|css|assets)\//.test(pathname)
              ? pathname.slice(1)
              : 'pages/' + pathname.slice(1);
        filename = path.resolve(frontend, relative);
        if (!filename.startsWith(frontend + path.sep)) fail('Caminho não permitido.', 403);
      }
      let content;
      try {
        content = await readFile(filename);
      } catch {
        fail('Página não encontrada.', 404);
      }
      if (filename.endsWith('.html'))
        content = Buffer.from(
          content
            .toString()
            .replace(
              '</head>',
              '<link rel="stylesheet" href="/presentation/banner.css"><script type="module" src="/presentation/banner.js"></script></head>',
            ),
        );
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream',
      });
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!response.headersSent)
        json(
          {
            error: {
              code: error.code || 'PRESENTATION_ERROR',
              message: error.status ? error.message : 'Falha local. Reinicie a apresentação.',
            },
            requestId: randomUUID(),
          },
          error.status || 500,
        );
      else response.end();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PRESENTATION_PORT || 3000);
  const server = createPresentationServer();
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? 'Porta ocupada. Feche a outra apresentação ou use PRESENTATION_PORT=3001.'
        : 'Não foi possível iniciar a apresentação local.',
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(
      `\nVoz em Estudo — apresentação local\nAbra http://127.0.0.1:${port}\nSem Supabase ou IA. Ctrl+C encerra e reinicia os dados fictícios.\n`,
    ),
  );
}
