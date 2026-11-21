# Configuração

Todas as variáveis de ambiente e flags do backend. Os valores ficam em `backend/.env`, que **nunca**
vai para o GitHub; `backend/.env.example` é o modelo. Atualizado em 20/11/2026.

As variáveis são lidas **ao iniciar** o servidor e o worker: depois de mudar o `.env`, feche e abra
o `INICIAR.cmd` de novo.

## Servidor

| Variável                      | Padrão                  | Uso                                                |
| ----------------------------- | ----------------------- | -------------------------------------------------- |
| `NODE_ENV`                    | `development`           |                                                    |
| `PORT`                        | `3000`                  | Porta da API e das páginas                         |
| `APP_ORIGIN`                  | `http://localhost:3000` | Origem permitida no CORS                           |
| `SERVE_FRONTEND`              | `true`                  | O backend também entrega as páginas do `frontend/` |
| `FFMPEG_PATH`, `FFPROBE_PATH` | binários do `npm ci`    | Só se quiser usar outro FFmpeg                     |

## Supabase (obrigatórias)

| Variável                   | Padrão          | Uso                                                                                            |
| -------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`             | —               | URL do projeto                                                                                 |
| `SUPABASE_PUBLISHABLE_KEY` | —               | Chave publicável: vai para o navegador e valida tokens                                         |
| `SUPABASE_SECRET_KEY`      | —               | **Secreta**, só no servidor; nunca publicar                                                    |
| `SUPABASE_AUDIO_BUCKET`    | `audios`        | Bucket dos áudios enviados                                                                     |
| `SUPABASE_AUTH_VERIFY`     | `server`        | Como o token do usuário é conferido: `server` (pergunta ao Supabase Auth a cada pedido) ou `jwks` (confere a assinatura pela JWKS pública do projeto; ver abaixo) |
| `OAUTH_PROVIDERS`          | `google,github` | Botões de login social exibidos (ver [CONFIGURAR_LOGIN_SOCIAL.md](CONFIGURAR_LOGIN_SOCIAL.md)) |

Se uma chave secreta for colocada por engano em `SUPABASE_PUBLISHABLE_KEY`, o servidor se recusa a entregá-la ao navegador.

`SUPABASE_AUTH_VERIFY=jwks` serve para ambientes em que o Supabase Auth não enxerga o token do usuário
(por exemplo, atrás de um proxy que injeta a chave do servidor em todo pedido ao Supabase — o caso do
teste de staging descrito em [STAGING_E2E.md](STAGING_E2E.md)). Com ele, tokens assinados com chave
assimétrica (ES256/RS256) são conferidos localmente pela JWKS pública; uma sessão encerrada continua
valendo até o `exp` do token (1 h por padrão). O padrão `server` não muda nada.

## Inteligência artificial

Resumo; detalhes, custos e como trocar de provedor em [AI_PROVIDERS.md](AI_PROVIDERS.md).

| Variável                                                                                                      | Padrão                                              | Uso                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ASR_PROVIDER`                                                                                                | `huggingface`                                       | Transcrição: `huggingface` (Whisper via Space, síncrono) ou `assemblyai` (assíncrono, tempos por palavra, idiomas) |
| `ASR_MODEL`                                                                                                   | depende do provedor                                 | AssemblyAI: `assemblyai-stt-3-7`                                                                                   |
| `ASR_FALLBACK_PROVIDER`                                                                                       | vazio                                               | Provedor reserva, só para erros definitivos; nunca automático sem configurar                                       |
| `ASR_LANGUAGE`                                                                                                | `pt`                                                | Idioma padrão                                                                                                      |
| `ASR_LANGUAGE_DETECTION`, `ASR_EXPECTED_LANGUAGES`, `ASR_SELECTABLE_LANGUAGES`                                | `false`, vazio, os 32 idiomas do AssemblyAI-STT-3.7 | Detecção e idiomas oferecidos no envio (AssemblyAI)                                                                |
| `ASR_SPEAKER_LABELS`                                                                                          | `false`                                             | Separar falantes                                                                                                   |
| `ASR_POLL_INTERVAL_MS`, `ASR_MAX_WAIT_MS`                                                                     | `15000`, 3 h                                        | Consulta e limite da transcrição assíncrona                                                                        |
| `ASSEMBLYAI_API_KEY`                                                                                          | —                                                   | Secreta                                                                                                            |
| `HF_TOKEN`, `HF_ASR_SPACE_ID`, `HF_ASR_API_NAME`, `HF_ASR_*`                                                  | `openai/whisper`, `/predict`…                       | Space do Hugging Face (ver `asr-space/`)                                                                           |
| `LLM_PROVIDER`                                                                                                | `groq`                                              | Texto: `groq` ou `assemblyai-gateway`                                                                              |
| `LLM_MODEL`                                                                                                   | `GROQ_MODEL`                                        | Modelo padrão                                                                                                      |
| `LLM_SUMMARY_MODEL`, `LLM_QUESTIONS_MODEL`, `LLM_WARNINGS_MODEL`, `LLM_FLASHCARDS_MODEL`, `LLM_CLEANUP_MODEL` | `LLM_MODEL`                                         | Modelo por tarefa (e `LLM_<TAREFA>_PROVIDER`)                                                                      |
| `GROQ_API_KEY`, `GROQ_MODEL`                                                                                  | —, `openai/gpt-oss-120b`                            | Groq                                                                                                               |
| `LLM_REASONING_EFFORT`                                                                                        | `low`                                               | Raciocínio dos modelos gpt-oss (low, medium, high); conta no limite de tokens                                      |
| `ASSEMBLYAI_LLM_GATEWAY_URL`, `ASSEMBLYAI_LLM_JSON_MODE`                                                      | padrão do provedor                                  | Gateway de texto da AssemblyAI                                                                                     |
| `MOCK_EXTERNAL_SERVICES`                                                                                      | `false`                                             | `true` = nada sai do servidor; transcrições e textos de demonstração (testes e apresentação)                       |
| `MAX_QUESTION_LIST_COUNT`                                                                                     | `40`                                                | Máximo de questões por lista com `study_authoring` (1–100)                                                         |

O provedor e o modelo usados ficam gravados em cada tarefa: mudar o `.env` não altera tarefas já
na fila.

## Worker

| Variável                                       | Padrão           | Uso                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_ID`                                    | `worker-<pid>`   | Identificação nos registros                                                                                                                                                                                                                                                |
| `WORKER_POLL_MS`                               | `2000`           | Intervalo de busca de tarefas                                                                                                                                                                                                                                              |
| `WORKER_CONCURRENCY`                           | `1`              | Tarefas ao mesmo tempo                                                                                                                                                                                                                                                     |
| `WORKER_STALE_LEASE_SECONDS`                   | `600`            | Retoma uma tarefa cujo worker parou no meio (janela em segundos; mínimo 60; `0` desliga). Enquanto roda, a tarefa renova a reserva a cada minuto. **Se o seu `.env` tem `0` (modelo antigo), troque por `600`.** Sem a migration de IA, o worker usa sozinho o modo antigo |
| `JOB_MAX_ATTEMPTS`                             | `3`              | Tentativas por tarefa                                                                                                                                                                                                                                                      |
| `JOB_RETRY_DELAY_1_MS`, `JOB_RETRY_DELAY_2_MS` | `15000`, `60000` | Espera entre tentativas                                                                                                                                                                                                                                                    |

## Flags de recurso

Cada flag é `FEATURE_<NOME>=true` (qualquer outro valor = desligada; padrão desligada). O frontend
recebe o estado pelas `featureFlags` de `/api/config`.

| Flag                      | Liga                                                              | Precisa no banco                              | Pode ligar em produção hoje? |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------- | ---------------------------- |
| `FEATURE_CATALOG_UNITS`   | Pastas de disciplinas/unidades, Editar/Remover disciplina         | E03                                           | Sim                          |
| `FEATURE_MP4_RETENTION`   | Guardar o MP4 original e assistir com legendas                    | E07 (tabela + políticas de vídeo)             | Sim                          |
| `FEATURE_STUDY_AUTHORING` | Listas e resumos nomeados, quantidade personalizada, renomear     | `study_authoring`                             | Sim                          |
| `FEATURE_SHARING`         | Compartilhar listas (com `study_authoring`) e cópias de materiais | listas: `study_authoring`; materiais: E18/E19 | Só listas                    |
| `FEATURE_PLANNING`        | Meu planejamento                                                  | E05                                           | Não                          |
| `FEATURE_QUIZ_V2`         | Tentativas de questões                                            | E10                                           | Não                          |
| `FEATURE_QUIZ_REVIEW`     | Diagnóstico e refazer erradas                                     | E12                                           | Não                          |
| `FEATURE_FLASHCARDS`      | Flashcards e revisão espaçada                                     | E13                                           | Não                          |
| `FEATURE_FLASHCARD_SETS`  | Conjuntos, "Criar flashcards" no resumo, CSV                      | E13 + `flashcard_sets`                        | Não                          |
| `FEATURE_STUDY_TRACKING`  | Tempo e progresso de estudo sincronizados                         | E08/E09                                       | Não                          |
| `FEATURE_ANNOTATIONS`     | Destaques e anotações                                             | E14/E15                                       | Não                          |
| `FEATURE_NOTEBOOKS`       | Caderno da aula; destaques em vários trechos (exige ANNOTATIONS)  | E14 + `20261121130000_notes_3_0.sql`          | Não                          |
| `FEATURE_CALENDAR`        | Calendário de estudos e .ics                                      | E18/E19                                       | Não                          |
| `FEATURE_CLASSROOMS`      | Turmas privadas (página Turmas, `/api/classrooms`)                | `flashcard_sets` + `classrooms`; exige `FEATURE_FLASHCARD_SETS` | Não                          |
| `FEATURE_MULTI_LESSON`    | Material integrado de várias aulas, de uma unidade ou disciplina (exige CATALOG_UNITS) | `generation_reuse` + `20261121170000_multi_lesson.sql` (cache opcional `20261121171000_knowledge_map_cache.sql`) | Não |
| `FEATURE_SOCIAL_BASIC`    | (sem uso no código)                                               | —                                             | —                            |

Ao iniciar pelo `INICIAR.cmd`, uma flag ligada sem a migration (ou combinação inválida) **bloqueia a
inicialização** com a lista do que falta. Se o servidor for iniciado de outro jeito, ligar uma flag sem a migration não quebra o restante do app: as rotas daquele recurso respondem
`SCHEMA_UPGRADE_REQUIRED` e só aquela parte da interface mostra um erro.

## Supabase Dashboard (fora do código)

- **Authentication › Sign In / Providers › Email**: senha com mínimo de 8 caracteres e
  minúsculas, maiúsculas, dígitos e símbolos (configurado em 20/11/2026). A proteção contra senhas
  vazadas do Supabase exige plano Pro; o app faz uma verificação equivalente no navegador.
- **URL Configuration**: incluir `…/auth-callback.html` e `…/recuperar-senha.html` nas URLs de
  redirecionamento permitidas.
- **Login social**: [CONFIGURAR_LOGIN_SOCIAL.md](CONFIGURAR_LOGIN_SOCIAL.md).

Matriz completa de cada flag e roteiro de ativação: [ATIVACAO_RECURSOS.md](ATIVACAO_RECURSOS.md).

## Personalização e idioma

Não há variáveis novas. O layout do Início, as seções do perfil, o idioma da interface e o
espaçamento dos cartões ficam em `profile_state` (chaves `dashboard-layout`, `profile-layout` e
`preferences`), no formato de chave já exigido pela migration `profile_state_hardening`. Os blocos
"Seus dados" do perfil usam as flags `planning` e `study_tracking`; desligadas, o bloco avisa.

Para rodar os testes de navegador fora do CI com um Chromium já instalado:
`BROWSER_EXECUTABLE=/caminho/do/chrome npm run test:browser`.
