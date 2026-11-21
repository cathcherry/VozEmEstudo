# Runbook de produção: migrations e recursos da 3.3 e 3.4

> **EXECUTADO em 21/11/2026**, com autorização explícita da responsável. As 8 migrations estão
> aplicadas em `audioestudo`. O ponto de recuperação é o schema `backup_pre_3_4_20261121`
> (20:13:54 UTC), com a restauração verificada. O registro completo está em
> `docs/OVERNIGHT_PROGRESS.md`, seção "Release 3.3/3.4 em produção". As flags vivem no
> `backend/.env` de quem roda o app (`ATIVAR_RECURSOS_3_4.cmd`), porque **não há hospedagem pública**.

### Diferenças entre o roteiro e a execução

- **Backup.** O roteiro previa `pg_dump`, mas esta sessão não tem a senha do banco de produção. O backup foi uma cópia completa dentro do banco, num schema privado, com a restauração verificada por hash de cada tabela. Para quem tiver acesso ao painel, o backup diário do Supabase continua sendo a segunda linha de defesa.
- **Aplicação.** As migrations não foram coladas no SQL Editor. Foram aplicadas por um auxiliar temporário que conferia o SHA-256 de cada arquivo contra o manifesto e foi removido no fim.
- **Fumaça.** Foi feita em SQL, numa transação desfeita, porque não há site publicado nem chave do servidor de produção nesta sessão.

## Auditoria de produção (21/11/2026, somente leitura)

Consultas de leitura no projeto `audioestudo`, sem alterar nada e sem expor credenciais:

| Verificação | Resultado |
| --- | --- |
| Estado do projeto | `ACTIVE_HEALTHY`, **Postgres 17.11**; o staging, onde as 8 migrations já rodaram, também é 17.11 |
| `production-state-3-4.sql` | as 8 migrations com `aplicada = false`; pré-requisitos das etapas 1, 2, 3 e 6 presentes. É o estado esperado: as etapas 4, 5, 7 e 8 dependem das anteriores |
| Pré-requisitos dos preflights 1 a 3 | E14 (`study_save_annotation_admin`), unicidade `(id, user_id)` em `materials`, listas nomeadas, `catalog_units` e `commit_question_list_admin` presentes; bucket `flashcard-media` ainda não existe (a migration 3 cria) |
| Volume de dados | 22 aulas, 25 revisões, 19 listas de questões, 4 contas; **0 anotações e 0 flashcards**: as duas migrations que transformam dados (1 e 3) hoje não têm nada a transformar |
| Modelo de IA em uso (pelas gerações registradas, sem ler variáveis) | **`openai/gpt-oss-120b`** em todos os resumos e questões desde novembro (16 resumos, 18 listas); `llama-3.3-70b-versatile` só em 1 resumo e 1 lista de agosto. Transcrição: `assemblyai-stt-3-7` |
| Advisors de segurança | os mesmos do staging antes da 3.3: `rls_enabled_no_policy` (intencional), `storage_owns_material` (intencional, usada pelas políticas do Storage) e proteção contra senhas vazadas desligada (recomendado ligar) |

**Consequência para a seção 4.** O `GROQ_MODEL` de produção já é `openai/gpt-oss-120b` (confirmado pelos registros). O código da 3.4 passa a mandar `reasoning_effort=low` para esse modelo (`LLM_REASONING_EFFORT`, padrão `low`), e isso muda também os resumos e as questões de uma aula, que hoje rodam sem esse parâmetro (padrão da Groq). No staging, com `low`, o resumo e as 5 questões ficaram corretos e mais rápidos (1,4–1,5 s). Para manter o comportamento atual, defina `LLM_REASONING_EFFORT=medium`. Atenção: com `medium`, o mapa multiaula pode estourar o limite de tokens.

## Pacote de release (verificável)

`database/release/3.4/manifest.json` lista as 8 migrations na ordem, com SHA-256, dependências, preflight, postflight, guia de reversão e guia da migration. Antes da janela, rode:

```bash
node scripts/release/verify-release.mjs
```

O verificador confere que:

- todos os arquivos existem;
- cada migration é exatamente a revisada (SHA-256);
- a ordem respeita as dependências;
- cada migration é transacional, tem guarda `*_ABORT` e não executa nenhum comando destrutivo;
- toda tabela criada tem RLS.

Use o SHA-256 também para conferir o texto colado no SQL Editor (`sha256sum arquivo.sql`).

## 0. O que vai mudar

| # | Migration | Cria | Flag que usa | Dados existentes |
| --- | --- | --- | --- | --- |
| 1 | `20261121130000_notes_3_0.sql` | `study_notebooks`; colunas de âncora em vários trechos em `study_annotations` | `FEATURE_NOTEBOOKS` | **Transforma:** preenche as colunas novas das anotações existentes (backfill) e não apaga nada |
| 2 | `20261121140000_classrooms.sql` | 8 tabelas `classroom_*` e funções | `FEATURE_CLASSROOMS` | nenhum |
| 3 | `20261121150000_flashcards_3_0.sql` | `study_card_templates`; colunas em `study_flashcards` e `study_flashcard_sets`; bucket privado `flashcard-media` | `FEATURE_FLASHCARDS_V3` | **Transforma:** cartões `term_definition` passam a `note_type = 'term'` |
| 4 | `20261121160000_generation_reuse.sql` | `ai_generations` | `FEATURE_GENERATION_REUSE` | nenhum |
| 5 | `20261121170000_multi_lesson.sql` | `multi_lesson_materials`, `multi_lesson_jobs` | `FEATURE_MULTI_LESSON` | nenhum |
| 6 | `20261121171000_knowledge_map_cache.sql` (opcional) | `knowledge_maps` | `FEATURE_MULTI_LESSON` | nenhum |
| 7 | `20261121180000_multi_lesson_exports.sql` | `multi_lesson_exports` | `FEATURE_MULTI_LESSON` | nenhum |
| 8 | `20261122090000_classroom_contributions.sql` | `classroom_contributions` e gatilhos | `FEATURE_CLASSROOMS` | nenhum |

Todas as migrations seguem as mesmas regras:

- são aditivas: não têm `drop`, `create or replace`, `truncate` nem `delete from`;
- rodam numa transação, com `lock_timeout` de 5 s;
- uma guarda aborta se faltar pré-requisito ou se a migration já tiver sido aplicada;
- RLS ligado e nenhum acesso do navegador;
- funções só para o servidor (`service_role`).

As duas que transformam dados (1 e 3) têm a contagem antes e depois conferida pelo preflight e pelo
postflight.

### Dependências (a ordem acima respeita todas)

| Migration | Depende de |
| --- | --- |
| 1 notes_3_0 | E14 (`20261105014000_annotations`), E02 (`20261009101846_academic_review`), `profile_state` (`database/proposals/profile-gamification.sql`, já aplicada à mão em produção) e `20261120120000_profile_state_hardening` |
| 2 classrooms | E02, E05/authoring (`20261119120000`), E13 (`20261104234500_flashcards`), `20261119121000_flashcard_sets` |
| 3 flashcards_3_0 | E13 e `20261119121000_flashcard_sets` |
| 4 generation_reuse | `001_initial`, E02 e **2 classrooms** (escopo de turma) |
| 5 multi_lesson | E02, `20261104190000_catalog_units` e **4 generation_reuse** |
| 6 knowledge_map_cache | `001_initial` (independe das outras; nada exige o cache) |
| 7 multi_lesson_exports | **5 multi_lesson**, `20261119120000_study_authoring` e **3 flashcards_3_0** |
| 8 classroom_contributions | **2 classrooms** e **5 multi_lesson** |

## 1. Antes da janela (dias antes)

1. **Autorização escrita** da responsável para esta janela.
2. **Estado do banco.** Rode `database/checks/production-state-3-4.sql` no SQL Editor de produção. A consulta só lê.
   - Esperado: todas as linhas com `aplicada = false`.
   - Se alguma já estiver aplicada, pare e investigue antes de continuar.
3. **Versão do código.** O deploy da API e do worker deve estar na `main`, com a 3.4 inteira:
   - a correção do `join`;
   - os novos probes de readiness;
   - o modelo padrão `openai/gpt-oss-120b`.
4. **Configuração de IA.** O modelo `llama-3.3-70b-versatile` **não é mais oferecido pela Groq**: ele não aparece na lista de modelos da conta, conferida em 21/11.
   - Produção já usa `openai/gpt-oss-120b`, conforme os registros (ver "Auditoria").
   - Decida `LLM_REASONING_EFFORT` antes do deploy: `low` é o padrão da 3.4; `medium` mantém o comportamento atual dos resumos e das questões.
5. **Ensaio.**
   - Rode `node scripts/release/verify-release.mjs`: deve sair com código 0.
   - Rode o roteiro inteiro no staging. O último ensaio, de 21/11, está registrado em `docs/OVERNIGHT_PROGRESS.md`.
   - Rode `scripts/staging/browser-auth-storage-check.mjs` (login normal e RLS do Storage sem chave privilegiada; `docs/STAGING_BROWSER_AUTH.md`).
   - Rode `scripts/staging/e2e-staging.mjs`. Ele se recusa a rodar contra produção.
6. **Aviso aos usuários**, se houver: a janela não exige parar o app, mas as migrations 1 e 3 travam por poucos segundos as tabelas de anotações e de flashcards.

## 2. Backup verificado (obrigatório)

Um backup só conta como verificado depois de restaurado e comparado. Reverter o esquema **não**
recupera dados (veja a seção 7).

1. **Backup do Supabase.**
   - Em Database › Backups, confirme que há um backup diário de hoje. Com PITR, anote o horário exato antes da janela.
   - O backup do Supabase **não inclui os objetos do Storage**: buckets `audios`, `profile-media` e `study-videos`. Nenhuma migration toca neles; apenas a 3 **cria** o bucket `flashcard-media`.
2. **Cópia lógica independente**, só leitura, de uma máquina confiável, com a connection string direta do projeto. A senha nunca vai para o Git nem para logs.

   ```bash
   pg_dump "$PROD_DB_URL" -Fc --no-owner -f voz-producao-$(date +%Y%m%d-%H%M).dump
   ```

3. **Verificação da cópia.**
   - Restaure num Postgres descartável: um projeto Supabase novo ou um Postgres 16 local.

     ```bash
     createdb voz_restore
     pg_restore -d voz_restore --no-owner voz-producao-AAAAMMDD-HHMM.dump
     ```

   - Rode `database/checks/backup-fingerprint.sql` em produção e na cópia, depois de um `ANALYZE` em cada. Compare linha a linha.
   - O resultado tem que ser idêntico: contagens de tabelas, funções, policies, RLS e gatilhos, linhas por tabela e hashes das anotações e dos flashcards.
   - **Procedimento ensaiado em 21/11** no Postgres 16 local, com o esquema completo da 3.4: `pg_dump -Fc` de 0,1 s; `pg_restore` sem erro; impressão digital idêntica.
   - Em restauração local, os schemas `auth` e `storage` do Supabase vêm junto no dump. Se faltarem extensões, restaure num projeto Supabase novo.
4. Guarde o arquivo fora do servidor da aplicação e anote no registro da janela o horário do backup e o resultado da comparação.

## 3. Janela: migrations, uma de cada vez

Para **cada** migration, na ordem da seção 0:

1. Rode o **preflight**, que só lê, e confira os valores esperados no comentário do arquivo e em `docs/migrations/*.md`.
2. Rode a **migration** inteira no SQL Editor. Ela tem `begin`/`commit` próprios. Se aparecer `*_ABORT`, nada foi alterado: leia a mensagem.
3. Rode o **postflight** e confira os valores. Se algum valor não bater, **pare**: não siga para a próxima. Vá para a seção 7.

| # | Preflight | Postflight | Guia |
| --- | --- | --- | --- |
| 1 | `database/checks/notes-3-0-preflight.sql` | `notes-3-0-postflight.sql` | `docs/migrations/NOTES_3_0.md` |
| 2 | `classrooms-preflight.sql` | `classrooms-postflight.sql` | `CLASSROOMS.md` |
| 3 | `flashcards-3-0-preflight.sql` | `flashcards-3-0-postflight.sql` | `FLASHCARDS_3_0.md` |
| 4 | `generation-reuse-preflight.sql` | `generation-reuse-postflight.sql` | `GENERATION_REUSE.md` |
| 5 | `multi-lesson-preflight.sql` | `multi-lesson-postflight.sql` | `MULTI_LESSON.md` |
| 6 | (o mesmo da 5: `cache_already_applied = false`) | `multi-lesson-postflight.sql` (`cache_applied = true`) | `MULTI_LESSON.md` |
| 7 | `multi-lesson-exports-preflight.sql` | `multi-lesson-exports-postflight.sql` | `MULTI_LESSON_EXPORTS.md` |
| 8 | `classroom-contributions-preflight.sql` | `classroom-contributions-postflight.sql` | `CLASSROOM_CONTRIBUTIONS.md` |

No fim, rode de novo `production-state-3-4.sql`: todas as linhas devem estar com `aplicada = true`.
Rode também os advisors de segurança do Supabase. O esperado é:

- `rls_enabled_no_policy` (INFO) nas tabelas novas: é intencional, porque só o servidor as acessa;
- **nenhum** WARN em objeto novo.

## 4. Configuração antes das flags

| Variável | Valor | Por quê |
| --- | --- | --- |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | o padrão antigo não existe mais |
| `LLM_REASONING_EFFORT` | `low` | o raciocínio do gpt-oss consome o limite de tokens; com `medium` ou `high`, o mapa multiaula estoura |
| `AI_DAILY_GENERATION_LIMIT` | `40` (ou o que a responsável decidir) | teto de gerações iniciadas por conta em 24 h |
| `SUPABASE_AUTH_VERIFY` | `server` (padrão) | `jwks` é só para ambientes com proxy que injeta a chave do servidor |
| `MOCK_EXTERNAL_SERVICES` | `false` | — |

Reinicie a API e o worker e rode `node backend/src/diagnostics/check-runtime.js` no ambiente de produção.
Ele só lê. Com as flags ainda desligadas, ele confere a base.

## 5. Ativação das flags (uma de cada vez, com teste de fumaça entre elas)

A ordem respeita as dependências que o readiness exige (`readinessFlagErrors`). A flag precisa
estar igual na API **e** no worker.

1. `FEATURE_NOTEBOOKS`, que exige `FEATURE_ANNOTATIONS`.
2. `FEATURE_FLASHCARDS_V3`, que exige `FEATURE_FLASHCARD_SETS` e `FEATURE_FLASHCARDS`.
3. `FEATURE_GENERATION_REUSE`.
4. `FEATURE_CLASSROOMS`, que exige `FEATURE_FLASHCARD_SETS`.
5. `FEATURE_MULTI_LESSON`, que exige `FEATURE_CATALOG_UNITS`.

Depois de cada uma, reinicie e rode `check-runtime.js`: todos os probes devem dar `[OK]`. Os
opcionais aparecem como `(opcional, …)`. Em seguida, faça o teste de fumaça correspondente
(seção 6) com uma conta de teste da responsável, nunca com dados de alunos.

## 6. Testes de fumaça em produção (manuais, com conta de teste)

| Flag | Teste | Esperado |
| --- | --- | --- |
| notebooks | abrir uma aula própria › caderno › escrever › recarregar | o texto persiste; abrir em duas abas e salvar nas duas → a segunda avisa de conflito sem perder texto |
| notebooks | destacar um trecho que passe de uma frase para a seguinte | o destaque reaparece ao recarregar |
| flashcards_v3 | criar um cartão tipado; mesclar dois conjuntos próprios; aplicar uma aparência | os originais ficam iguais; o conjunto novo usa a aparência |
| flashcards_v3 | importar um `.apkg` pequeno com imagem | a prévia não cria nada; a importação cria; a imagem abre |
| generation_reuse | gerar um resumo; clicar de novo com "reutilizar" | a segunda vez é imediata e sem job novo (log sem `LLM_USAGE`) |
| classrooms | criar uma turma; entrar com uma segunda conta de teste pelo convite | a segunda conta vê só a turma; uma terceira conta recebe 404 |
| classrooms | enviar uma gravação como aluno › aprovar como professor | o aluno vê o status e o recado |
| multi_lesson | gerar um material integrado de 2 aulas confirmadas; salvar como lista e como conjunto | `ready` em menos de 1 min; responder 1 questão; o segundo clique em "salvar conjunto" devolve o mesmo |

## 7. Reversão e recuperação (do menos ao mais destrutivo)

1. **Desligar a flag** e reiniciar a API e o worker. Não há perda de dados e é sempre o primeiro passo. As tabelas novas ficam e não incomodam o código antigo.
2. **Uma migration falhou no meio.** Ela roda numa transação, então nada fica pela metade: confira com `production-state-3-4.sql`.
3. **Reverter o esquema de uma migration.** Use `database/rollback/<nome>-rollback.md`:
   - exporte os dados primeiro (cada guia tem as consultas);
   - siga a ordem **inversa** à da seção 0 (8 → 1);
   - **remover as tabelas apaga o que os usuários criaram nelas**: cadernos, turmas, modelos, materiais integrados;
   - só com backup verificado e nova autorização explícita.
4. **Dados transformados pelas migrations 1 e 3.** O backfill é aditivo, porque as colunas antigas continuam valendo. Desfazer as colunas não devolve nada que tenha sido editado depois. Para voltar ao estado exato, a saída é o backup:
   - PITR para o horário anotado; ou
   - `pg_restore` da cópia da seção 2 num projeto novo, seguido de troca da `SUPABASE_URL`.
5. **Não rode** `database/rollback/20261120_feature_activation_undo.sql`. Ele é de outra janela e está fora deste roteiro.

## 8. Monitoramento depois da ativação

Os eventos estão nos logs JSON da API e do worker:

| Evento | O que observar |
| --- | --- |
| `LLM_USAGE` | tokens e latência de cada chamada paga. Custo ≈ `promptTokens × US$0,15/M + completionTokens × US$0,60/M`, preço do gpt-oss-120b na Groq em nov/2026 (conferir na página de preços). `finishReason: "length"` frequente → o limite de tokens está curto ou o raciocínio está alto |
| `LLM_CALL_FAILED` | `status` e `providerCode` do provedor: 401 é chave; 429 é cota; 400 com `json_validate_failed` é saída inválida, que o sistema repara uma vez |
| `MULTI_LESSON_FAILED` e `MULTI_LESSON_DONE` | taxa de falha e número de chamadas por material integrado |
| `JOB_STARTED` e `JOB_FAILED` | fila principal |
| `GENERATION_COMPLETE_DEFERRED` e `GENERATION_FAIL_DEFERRED` | a contabilidade da geração foi adiada e será reconciliada no próximo pedido |

Consultas de acompanhamento (somente leitura):

```sql
-- Gerações por dia e status; reuse_count mostra quanto foi economizado.
select date_trunc('day', created_at) dia, status, count(*), sum(reuse_count) reusos
from public.ai_generations group by 1, 2 order by 1 desc, 2;
-- Jobs multiaula presos (lease vencida há mais de 15 min).
select id, status, attempt_count, locked_at from public.multi_lesson_jobs
where status = 'running' and locked_at < now() - interval '15 minutes';
-- Contas perto do limite diário.
select requested_by, count(*) from public.ai_generations
where created_at > now() - interval '1 day' group by 1 having count(*) >= 30 order by 2 desc;
-- Envios de turma esperando revisão há mais de 3 dias.
select classroom_id, count(*) from public.classroom_contributions
where status = 'pending' and created_at < now() - interval '3 days' group by 1;
```

Recomendações de configuração que não dependem de migration:

- ligar a proteção contra senhas vazadas no Auth: o advisor do staging aponta que está desligada;
- revisar os advisors de desempenho depois de uma semana de uso. Algumas chaves estrangeiras novas não têm índice, o que só pesa em exclusões em cascata.
