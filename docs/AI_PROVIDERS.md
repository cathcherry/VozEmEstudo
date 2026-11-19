# Provedores de IA

Os serviços (resumo, questões, avisos, flashcards, transcrição) não importam fornecedores. Eles
pedem ao registro `backend/src/ai/provider-registry.js` um provedor por tarefa; formatos de API,
autenticação, erros e parsing ficam nos adaptadores em `backend/src/integrations/`.

| Contrato                                                   | Adaptadores                                                 | Arquivo              |
| ---------------------------------------------------------- | ----------------------------------------------------------- | -------------------- |
| TranscriptionProvider (`ai/contracts/transcription.js`)    | `huggingface` (legado, síncrono), `assemblyai` (assíncrono) | `integrations/asr/*` |
| TextGenerationProvider (`ai/contracts/text-generation.js`) | `groq`, `assemblyai-gateway`                                | `integrations/llm/*` |
| VisualAnalysisProvider (`ai/contracts/visual-analysis.js`) | nenhum (desativado)                                         | —                    |

## Configuração (`backend/.env`)

Valores vazios mantêm o comportamento anterior (Hugging Face + Groq).

| Variável                                           | Uso                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASR_PROVIDER`                                     | `huggingface` (padrão) ou `assemblyai`                                                                                                                                                                                                         |
| `ASR_MODEL`                                        | padrão `assemblyai-stt-3-7` com AssemblyAI                                                                                                                                                                                                     |
| `ASR_FALLBACK_PROVIDER`                            | vazio = sem fallback. Se definido, é usado só após falha definitiva do principal e registrado em evento da tarefa e log `ASR_FALLBACK_USED`                                                                                                    |
| `ASR_LANGUAGE`                                     | código fixo (padrão `pt`)                                                                                                                                                                                                                      |
| `ASR_LANGUAGE_DETECTION`, `ASR_EXPECTED_LANGUAGES` | detecção automática (não é enviada junto com idioma fixo)                                                                                                                                                                                      |
| `ASR_SELECTABLE_LANGUAGES`                         | idiomas oferecidos no campo "Idioma da gravação" (padrão `pt,en,es,zh`; só provedores que aceitam idioma). A escolha do envio vira `language_code` fixo ou `language_detection` ("Detectar automaticamente") no snapshot do job. Nunca traduz. |
| `ASR_SPEAKER_LABELS`                               | rótulos de falante                                                                                                                                                                                                                             |
| `ASR_POLL_INTERVAL_MS`, `ASR_MAX_WAIT_MS`          | intervalo de consulta (15 s) e prazo total (3 h)                                                                                                                                                                                               |
| `LLM_PROVIDER`, `LLM_MODEL`                        | padrão para todas as tarefas de texto                                                                                                                                                                                                          |
| `LLM_<TAREFA>_PROVIDER`, `LLM_<TAREFA>_MODEL`      | `SUMMARY`, `QUESTIONS`, `WARNINGS`, `FLASHCARDS`, `CLEANUP`                                                                                                                                                                                    |
| `ASSEMBLYAI_LLM_JSON_MODE`                         | `json_object` (padrão) ou `none`; a saída é sempre validada localmente                                                                                                                                                                         |
| `ASSEMBLYAI_API_KEY`, `GROQ_API_KEY`               | credenciais, apenas no servidor                                                                                                                                                                                                                |
| `WORKER_STALE_LEASE_SECONDS`                       | `0` desligado; `>= 60` recupera tarefas de workers interrompidos                                                                                                                                                                               |
| `VISION_PROVIDER`                                  | `disabled`                                                                                                                                                                                                                                     |

`npm --prefix backend run check` (diagnóstico) lista credenciais ausentes por nome.

Provedor e modelo são gravados em `ai_job_executions` ao enfileirar a tarefa; mudanças posteriores
no `.env` não afetam tarefas já criadas. O modelo efetivamente informado pelo provedor é salvo em
`actual_model` (transcrição) e em `summary_versions.model` / `question_batches.model`.

## Transcrição assíncrona (AssemblyAI)

1. O worker prepara o WAV com o pipeline FFmpeg existente e envia (`/v2/upload`).
2. Registra a intenção (`submitting`) antes de `POST /v2/transcript` e salva o `id` externo.
3. Libera o worker: a tarefa volta a `AGUARDANDO_REPETICAO` sem erro e sem consumir tentativas.
4. Cada consulta é curta; ao concluir, palavras e segmentos são normalizados e gravados pela RPC
   idempotente `create_initial_transcription_with_alignment_admin`.
5. A retenção de mídia só é aplicada depois da transcrição durável (inalterado).

Envio ambíguo (conexão perdida após o envio): a próxima execução procura nas transcrições recentes
o mesmo `upload_url` antes de reenviar; no máximo 3 envios. Isso reduz, mas não garante, cobrança
única. Cancelamento remoto não é usado: tarefas canceladas simplesmente deixam de ser consultadas.

Segmentação: as palavras são canônicas. Os segmentos exibidos (≈3–12 s) são derivados delas, com
cortes em pontuação, pausas e troca de falante; enunciados longos do provedor ficam em
`transcription_word_alignments.utterances`.

## Pendente de verificação antes de ativar

O ambiente de desenvolvimento não acessou a documentação oficial. Antes de `ASR_PROVIDER=assemblyai`
em produção, confira em https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model:

- o identificador `assemblyai-stt-3-7` em `speech_models` e o campo de modelo usado na resposta
  (lido de `speech_model_used`, depois `speech_model`);
- `language_code: "pt"`, `language_detection` e `language_detection_options.expected_languages`;
- se a listagem `GET /v2/transcript` devolve `audio_url` (usado para recuperar envios ambíguos).
  No LLM Gateway, confira os modelos disponíveis e o suporte a `response_format`; o
  Gateway não tem modelo padrão (`LLM_<TAREFA>_MODEL` obrigatório).
  No LLM Gateway, confira os modelos disponíveis e o suporte a `response_format`; o Gateway não
  tem modelo padrão (`LLM_<TAREFA>_MODEL` obrigatório).
  Faça um teste com uma gravação curta e confira tempos de palavras no player.

## Migration (não aplicada)

`database/migrations/20261119030000_ai_executions.sql` — aditiva e transacional:
`ai_job_executions`, `transcription_word_alignments`, a RPC de gravação com alinhamento e a
sobrecarga `claim_next_processing_job(text, integer)`. Nenhuma tabela ou função existente muda.

1. Backup/inventário (`database/checks/staging-backup-inventory.sql`).
2. Aplicar a migration uma vez no SQL Editor do Supabase (staging antes de produção).
3. Conferir: `select count(*) from public.ai_job_executions;` e RLS ativa nas duas tabelas.
4. Só então definir `ASR_PROVIDER=assemblyai` e, se desejado, `WORKER_STALE_LEASE_SECONDS=1800`
   (maior que a transcrição síncrona mais longa).

Sem a migration, o modo legado continua funcionando; provedores assíncronos falham com
`SCHEMA_UPGRADE_REQUIRED`. Materiais antigos não são retranscritos e seguem sem alinhamento de palavras.
