# API HTTP

Referência das rotas do backend Express (`backend/src/app.js` e `backend/src/routes/*.js`).
Atualizado em 20/11/2026.

## Convenções

- **Base**: o mesmo servidor que serve o frontend (padrão `http://localhost:3000`).
- **Autenticação**: rotas marcadas com 🔒 exigem `Authorization: Bearer <access token do Supabase>`.
  O token é validado pelo Supabase Auth a cada chamada.
- **Dono**: toda rota autenticada só enxerga dados da própria conta. O servidor usa a chave secreta
  do Supabase e confere a posse explicitamente (filtro por `user_id` ou dentro das RPCs `*_admin`).
- **Flags**: as flags são lidas ao iniciar o servidor. Uma rota de flag desligada não é montada e
  responde `404`.
- **Corpo**: JSON até 2 MB; rotas de mídia aceitam binário (`application/octet-stream`) até 100 MB.
- **Erros**: `{"error": {"code", "message", "details?"}, "requestId"}`.

| Código                    | Status | Quando                                                              |
| ------------------------- | ------ | ------------------------------------------------------------------- |
| `INVALID_JSON`            | 400    | Corpo JSON inválido                                                 |
| `VALIDATION_ERROR`        | 400    | Dados fora do formato (detalhes do zod em `details`)                |
| `AUTH_REQUIRED`           | 401    | Sem token ou token inválido                                         |
| `NOT_FOUND`               | 404    | Rota inexistente, recurso de outra conta ou flag desligada          |
| `MEDIA_TOO_LARGE`         | 413    | Corpo ou mídia acima do limite                                      |
| `SCHEMA_UPGRADE_REQUIRED` | 503    | A flag está ligada, mas a migration correspondente não foi aplicada |
| `INTERNAL_ERROR`          | 500    | Erro inesperado (mensagem genérica; detalhes só no log)             |

Toda resposta traz `x-request-id` (reaproveitado do pedido, se enviado), útil para achar o erro no log.

---

## Públicas

| Método | Rota                        | Flag                          | Descrição                                                                                                                                                                                                                                                                         |
| ------ | --------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`               | —                             | `{ok:true, service:"audioestudo-api"}`                                                                                                                                                                                                                                            |
| GET    | `/api/config`               | —                             | Configuração pública: URL e chave publicável do Supabase, bucket de áudio, quantidades de questões, `maxQuestionListCount` (com `study_authoring`), limites de mídia, provedores OAuth, `featureFlags`, declaração de permissão, nomes dos provedores de IA e idiomas de gravação |
| POST   | `/api/shared-material`      | `sharing`                     | `{token}` (64 hex) → cópia de leitura de um material. `404 SHARE_UNAVAILABLE` se expirado/revogado                                                                                                                                                                                |
| POST   | `/api/shared-question-list` | `sharing` + `study_authoring` | `{token}` → folha de questões **sem respostas**                                                                                                                                                                                                                                   |

As rotas de compartilhamento respondem com `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
e `X-Robots-Tag: noindex`.

## Mídia 🔒

Corpo binário do arquivo original; `?extension=` informa o tipo (mp4, mov, webm, mp3, wav, m4a, aac,
ogg, flac).

| Método | Rota                                                | Descrição                                                                                                                                                                                     |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/media/inspect?extension=`                     | `{durationMs, hasVideo, hasAudio, peaks[180], maxTranscriptionSeconds}`                                                                                                                       |
| POST   | `/api/media/convert?extension=&start=&end=&output=` | Recorta e converte. `output`: `speech` (MP3 mono 22,05 kHz 64 kbps, usado no envio), `wav` (16 kHz PCM), `mp3` (128 kbps, download), `mp4` (vídeo, download). Cabeçalho `X-Media-Duration-Ms` |

Limites: 100 MB e 2 h de entrada; `speech`/`wav` até ~54 min (`TRIM_REQUIRED`); 2 conversões ao
mesmo tempo (`429 MEDIA_BUSY`). Outros erros: `INVALID_MEDIA_TYPE`, `NO_AUDIO`, `INVALID_TRIM`,
`MEDIA_TIMEOUT`, `MEDIA_TOOL_MISSING`, `INVALID_MEDIA`.

## Materiais 🔒 — `/api/materials`

| Método | Rota              | Flag            | Descrição                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`               | —               | Lista as aulas da conta                                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/`               | —               | Cria a aula depois do upload: `{id, title, subject?, originalFilename, mimeType, extension (mp3/wav/m4a/mp4), sizeBytes, durationMs?, questionCount (3/5/10/20), retainAudio, storagePath, permissionAccepted:true, permissionVersion}`. `storagePath` deve começar com `temp/{userId}/{id}/`. Erros: `PERMISSION_REQUIRED` 422, `PERMISSION_RECONFIRMATION_REQUIRED` 409, `IDEMPOTENCY_CONFLICT` 409 |
| GET    | `/:id`            | —               | Aula completa: transcrição, revisão, avisos, resumos e listas (com `stale`), URL assinada do áudio guardado e vídeo (`mp4_retention`)                                                                                                                                                                                                                                                                 |
| PATCH  | `/:id`            | —               | `{title?, subject?}`                                                                                                                                                                                                                                                                                                                                                                                  |
| DELETE | `/:id`            | —               | Apaga aula, áudio e vídeo. `204`                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/:id/process`    | —               | `{recordingLanguage?}` → enfileira o processamento inicial. `202 {jobId}`                                                                                                                                                                                                                                                                                                                             |
| GET    | `/:id/playback`   | —               | URLs assinadas (10 min) de áudio e vídeo                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/:id/captions`   | —               | Trechos e, se houver, tempos por palavra                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/:id/video`      | `mp4_retention` | Vincula o MP4 original já enviado a `original/{uid}/{id}/source.mp4`: `{originalName, storagePath, sizeBytes, durationMs, clipStartMs, clipEndMs}`. `201`                                                                                                                                                                                                                                             |
| DELETE | `/:id/video`      | `mp4_retention` | Remove o vídeo. `204`                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/:id/permission` | —               | `{permissionAccepted:true, permissionVersion}`                                                                                                                                                                                                                                                                                                                                                        |

### Transcrição e revisão

| Método | Rota                                            | Descrição                                                                                          |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/:id/transcription`                            | Transcrição atual                                                                                  |
| PATCH  | `/:id/transcription`                            | `{expectedRevision, segments}` → nova versão. `409 REVISION_CONFLICT` se outra edição chegou antes |
| GET    | `/:id/transcription/versions`                   | Histórico de versões                                                                               |
| POST   | `/:id/transcription/versions/:revision/restore` | Restaura como nova versão                                                                          |
| GET    | `/:id/transcription/review`                     | Estado da conferência                                                                              |
| POST   | `/:id/transcription/confirm`                    | `{sourceRevisionId}` → confirma a versão que alimenta as gerações                                  |
| POST   | `/:id/transcription/warnings`                   | `{sourceRevisionId, idempotencyKey?}` → refaz os três avisos                                       |

### Resumos

| Método | Rota                        | Flag              | Descrição                                                                                                                  |
| ------ | --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/:id/summaries`            | —                 | Versões do resumo                                                                                                          |
| POST   | `/:id/summaries`            | —                 | `{sourceRevisionId, idempotencyKey?, options?}` → `202`. `options`: `format`, `length`, `focus[]`, `readingLevel`, `label` |
| PATCH  | `/:id/summaries/:summaryId` | `study_authoring` | `{label}` (até 120 ou `null`)                                                                                              |

### Listas de questões

| Método     | Rota                                             | Flag                          | Descrição                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET        | `/:id/question-batches`                          | —                             | Listas da aula                                                                                                                                                                                                                                                     |
| POST       | `/:id/question-batches`                          | —                             | `{count, sourceRevisionId, idempotencyKey?, config?}` → `202`. Sem `study_authoring`, `count` ∈ {3,5,10,20}; com a flag, 1..`MAX_QUESTION_LIST_COUNT` e `config` (título, dificuldades, habilidades, foco temático, distribuição, política de repetição, feedback) |
| GET        | `/:id/question-batches/:batchId/answer-key`      | —                             | Gabarito (só o dono). `409 ANSWERS_NOT_RELEASED` com tentativa de feedback adiado aberta (`quiz_v2`)                                                                                                                                                               |
| PATCH      | `/:id/question-batches/:batchId`                 | `study_authoring`             | `{title}` (1–160)                                                                                                                                                                                                                                                  |
| GET / POST | `/:id/question-batches/:batchId/shares`          | `study_authoring` + `sharing` | Lista ou cria link: `{id, requestId, token (64 hex), days: 1\|7\|30}`. Só o SHA-256 do token é guardado                                                                                                                                                            |
| DELETE     | `/:id/question-batches/:batchId/shares/:shareId` | idem                          | Revoga                                                                                                                                                                                                                                                             |

Erros comuns das gerações: `TRANSCRIPTION_CONFIRMATION_REQUIRED` 409, `SOURCE_REVISION_REQUIRED`
409, `SOURCE_REVISION_MISMATCH` 409.

## Tarefas 🔒 — `/api/jobs`

| Método | Rota             | Descrição                                           |
| ------ | ---------------- | --------------------------------------------------- |
| GET    | `/:jobId`        | Estado da tarefa (o frontend consulta a cada 2,5 s) |
| GET    | `/:jobId/events` | Eventos em ordem                                    |

Status: `PENDENTE`, `EM_EXECUCAO`, `AGUARDANDO_REPETICAO`, `CONCLUIDA`, `FALHOU`, `CANCELADA`.

## Busca 🔒 — `/api/search`

`GET ?q=` (2–100 caracteres) `&scope=all|lessons|questions|transcripts`. Sem diferenciar acentos;
procura títulos, enunciados e trechos da transcrição da própria conta (nunca gabaritos). Até 50 aulas,
50 questões, 60 trechos (5 por aula).

## Questões avulsas 🔒 — `/api/questions`

`POST /:questionId/answer` `{selectedIndex}` → `{correct, correctIndex, explanation}`. Com `quiz_v2`
ligado responde `409 QUIZ_SESSION_REQUIRED` (usar tentativas).

## Recursos com flag

| Prefixo              | Flag             | Rotas principais                                                                                                                                                                                                                                                         |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/catalog`       | `catalog_units`  | `GET /`, `GET /resources`, `POST /subjects {name}`, `PATCH /subjects/:id {name}`, `DELETE /subjects/:id` (aulas vão para "Sem disciplina"; unidades removidas), `POST /subjects/:id/units {title, description?}`, `PATCH /materials/:id {subjectId\|null, unitId\|null}` |
| `/api/planning`      | `planning`       | `GET /`, objetivos (`POST/PATCH /goals`), subobjetivos, tarefas, `PUT /goals/:id/tasks/order`, `PATCH /tasks/:id/completion`                                                                                                                                             |
| `/api/quiz-sessions` | `quiz_v2`        | `GET /`, `POST / {materialId, batchId, feedbackMode}`, `GET /:id`, `GET /:id/diagnostic`, `POST /:id/answers`, `POST /:id/finish`; com `quiz_review`: `POST /:id/review`                                                                                                 |
| `/api/flashcards`    | `flashcards`     | `GET /?filter=due\|all`, `POST /`, `POST /preview` (IA; nunca salva), `PATCH /:id`, `GET /:id/reviews`, `POST /:id/reviews {rating 0–3, requestId}`; com `flashcard_sets`: `/sets`, `/sets/:id`, `POST /sets/:id/cards`, `DELETE /:id`                                   |
| `/api/study`         | `study_tracking` | `GET /progress`, `PUT /progress/:materialId`, `GET /overview`, `PUT /settings`, `POST /sessions`, `POST /sessions/:id/tick`                                                                                                                                              |
| `/api/annotations`   | `annotations`    | `GET /?materialId&q`, `PUT /` (criar, editar, arquivar com controle de versão)                                                                                                                                                                                           |
| `/api/calendar`      | `calendar`       | `GET /?from&to` (janela até 62 dias), `PUT /`                                                                                                                                                                                                                            |
| `/api/sharing`       | `sharing`        | `GET /:materialId`, `POST /:materialId {token, sourceRevisionId, includeTranscript, includeSummary, days}`, `DELETE /:materialId/:shareId`                                                                                                                               |

`/api/flashcards/preview`: com `flashcard_sets` e `config` usa o gerador v2 (1–50 cartões, estilos,
dificuldades, foco, lista de evitar); senão o v1 (5/10/20). Uma geração por pessoa por vez
(`429 GENERATION_BUSY`); fonte acima de 80 mil caracteres → `422 SOURCE_TOO_LARGE`.

## Arquivos estáticos

Com `SERVE_FRONTEND=true` (padrão), o mesmo servidor entrega `frontend/pages`, `/css`, `/js` e
`/assets`; `/` redireciona para `/index.html`.

## Envio de mídia: o que passa pelo backend e o que vai direto ao Storage

1. **Backend**: o arquivo original vai para `POST /api/media/inspect` e `POST /api/media/convert`
   (corpo binário, até 100 MB). O FFmpeg trabalha numa pasta temporária, apagada ao final; nada é
   guardado. A resposta de `convert?output=speech` é o trecho em MP3.
2. **Direto ao Storage**: o navegador envia esse MP3 ao Supabase Storage pelo protocolo TUS
   (`/storage/v1/upload/resumable`, blocos de 6 MB, `x-upsert: false`) em
   `temp/{userId}/{materialId}/…`. As políticas do bucket `audios` só permitem gravar no próprio
   prefixo. Se a conexão cair, o envio consulta quanto o servidor já recebeu e continua dali.
3. **Backend**: `POST /api/materials` registra a aula (o `id` é gerado no navegador e reaproveitado
   em novas tentativas; se a aula já existir com os mesmos dados, ela é devolvida em vez de
   duplicada) e `POST /:id/process` enfileira a transcrição (uma tarefa ativa por aula).
4. O MP4 original, quando guardado, segue o mesmo caminho direto (bucket `study-videos`,
   `original/{userId}/{materialId}/source.mp4`) e depois é vinculado por `POST /:id/video`.
5. Depois da transcrição, o worker apaga o áudio ou o move para `retained/…`, conforme a escolha.
