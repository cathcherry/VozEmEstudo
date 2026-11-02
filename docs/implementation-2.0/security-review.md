# E00 — segredos, permissões e riscos concretos

Revisão em 09/10/2026. Consultas remotas somente de leitura. Sem rotação, revogação, alteração de Auth/RLS/grants ou aplicação de migration. Não foram encontrados arquivos `.env` reais no checkout ou no pacote aprovado atual.

## Segredos e distribuição

| Nome a conferir pelo responsável | Risco/resultado |
|---|---|
| `SUPABASE_SECRET_KEY` | Credencial administrativa; somente servidor. Template presente; valor real não encontrado no pacote atual. Conferir possível exposição histórica e rotacionar apenas com autorização |
| `GROQ_API_KEY` | Uso/custo da geração textual; mesma conferência histórica, sem rotação confirmada |
| `HF_TOKEN` | Acesso ao Space e recursos associados; escopo mínimo, conferência histórica pendente |
| `SUPABASE_PUBLISHABLE_KEY` | Publicável por intenção; confirmar que não recebeu chave administrativa por engano. O código não valida o tipo antes de publicá-la em `/api/config` |
| `SUPABASE_URL`, `HF_ASR_SPACE_ID` | Identificadores de serviço, não segredos de autenticação; nenhuma credencial deve ser embutida neles |

O manual registra `.env` no ZIP histórico. Isso é evidência documental de exposição potencial, não confirmação de chave ativa nem de uso indevido. A auditoria foi aplicada ao pacote vigente; não declarar o arquivo histórico limpo ou a rotação concluída.

`.gitignore` não remove arquivos já publicados ou já versionados. O checkout não tem histórico Git a varrer. Foram reforçadas exclusões e acrescentados `.dockerignore` e `scripts/distribution-audit.py`. O empacotador mantém a pasta raiz do projeto, exclui `.env` reais, dependências, chaves privadas, dumps/backups, caches e fixtures temporárias, sem ler os arquivos excluídos. Audita o ZIP antes de substituir o destino e falha sem substituir o pacote anterior se detectar problema.

A auditoria rejeita caminhos inseguros, symlinks, membros duplicados e tamanhos excessivos; procura padrões reconhecidos de chaves de fornecedores, private keys, URI de banco com senha, JWT administrativo e sessão de usuário. A saída contém **somente caminho e categoria**, sem linha, trecho, valor ou token detectado. Testes usam padrões sintéticos montados em memória. É uma defesa de distribuição baseada em regras, não prova universal de ausência de segredos ou dados pessoais; arquivos autorizados ainda exigem revisão.

## Fronteira de autenticação e ownership

`backend/src/middleware/auth.middleware.js` exige Bearer e verifica o usuário com `auth.getUser(token)` em `integrations/supabase/auth-client.js`. Não usa `user_metadata` como autorização. `admin-client.js` mantém a credencial privilegiada no processo servidor, com persistência/renovação de sessão desativadas. A API administrativa contorna RLS, portanto depende das verificações abaixo.

| Recurso/operação | Controle existente | Contrato testado |
|---|---|---|
| Listar material | `material.repository.js:listMaterials`, filtro `user_id` | A e B recebem apenas o próprio material |
| Ler/alterar/excluir material | `getOwnedMaterial`/`updateOwnedMaterial`, filtros `id` + `user_id`; exclusão verifica antes de Storage | UUID alheio e inexistente: 404 `NOT_FOUND`, com `requestId` |
| Enfileirar processamento/resumo/questões | `material.service.js:enqueue*`, verifica material antes de criar job | A→B e B→A: 404, sem efeitos no banco simulado |
| Transcrição/versões/restore | Controllers verificam material; RPC de edição restringe segmento à transcrição do material | Acesso HTTP alheio: 404; integridade/concorrência da RPC real inspecionada, não executada |
| Gabarito/resposta por `question_id` | `question.repository.js:getQuestionForAnswer`, questão→lote→material com filtro de proprietário | UUID alheio/inexistente: 404; resposta própria válida |
| Job/eventos por `job_id` | `job.repository.js:getOwnedJob`, join com `materials.user_id`; eventos verificam job primeiro | UUID alheio/inexistente: 404; próprio: 200 |
| Registrar upload por caminho | `material.service.js:assertStorageOwnership`, validator canônico e prefixo `temp/{userId}/{materialId}/` | Prefixo de B/escapes/traversal: 403 `FORBIDDEN`, sem inserts; identidade enviada no body não substitui usuário autenticado |
| Assinar/baixar/finalizar/excluir mídia | Material verificado; `assertSafeStoragePath` antes de operações administrativas, inclusive registros antigos | Caminho normal assinado com TTL 600; path inseguro 403 sem contato Storage; operações antigas bloqueadas antes de alterações |
| Worker/RPCs internas | Origem confiável: fila do banco, admin servidor; três RPCs somente `service_role` | Privilégios efetivos consultados; worker remoto não iniciado |

Fixture: `backend/tests/fixtures/ownership.fixture.js`, UUIDs e tokens sintéticos. `ownership.test.js` executa a API Express, services e repositories reais; simula o transporte HTTP do Supabase. O simulador aplica os filtros recebidos e não fornece automaticamente isolamento: se um filtro de ownership desaparecer, a linha alheia fica disponível e a asserção falha. Não simula a execução SQL/RLS ou a criptografia de URLs assinadas.

As verificações por UUID passaram; a extensão do teste de Storage identificou um bypass local de prefixo com `../`: cadastro aceito e SDK administrativo solicitando assinatura de caminho da outra conta. A correção pontual B2 está em [storage-path-fix.md](storage-path-fix.md): validator compartilhado e guards em três arquivos de execução, com teste anterior de falha e suíte final 42/42. Não houve tentativa de obter mídia real de terceiro, alteração remota ou deploy. Testes remotos A/B, RLS real, URLs expiradas e restore seguem bloqueados até existir staging autorizado. Uma URL assinada é um bearer temporário; não colocá-la em logs, capturas ou relatórios.

## RLS, grants e gabarito efetivos

As dez tabelas públicas têm RLS e políticas por proprietário, direta ou através de material. A consulta `has_table_privilege` confirmou: anon/authenticated têm **zero** permissões efetivas de SELECT/INSERT/UPDATE/DELETE nessas tabelas; `service_role` tem as dez. Portanto, não foi comprovada exposição de `questions.correct_index` pela Data API pública no ambiente atual. A listagem Express projeta apenas `id`, `position`, `statement`, `options`, `created_at` e o teste comprova ausência de gabarito/explicação.

O endpoint legado `/api/questions/:questionId/answer` devolve `correctIndex` e explicação após uma resposta própria; é feedback imediato, sem sessão persistida ou modo diferido. Não tratar isso como implementação do gabarito protegido de E10. As políticas de questions autorizam a linha inteira do dono: ampliar futuramente SELECT para authenticated sem rever colunas/DTOs pode abrir o gabarito direto.

Anon/authenticated possuem REFERENCES/TRIGGER/TRUNCATE nas dez tabelas. TRUNCATE não é limitado por RLS, segundo a [documentação PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-rowsecurity.html). Não há endpoint de TRUNCATE na API auditada e não houve tentativa destrutiva. A permissão excedente merece revisão explícita de segurança, incluindo origem/default privileges e reversão. Nenhum grant foi alterado. Evidências: `evidence/remote-metadata.json` e `evidence/effective-access.json`.

## Achados e destino proposto

Prioridade indica triagem, não autorização de mudança. Responsável pendente: mantenedor do projeto/ambiente; confirmar pessoa e prazo no aceite.

| ID/prioridade | Evidência e consequência concreta | Encaminhamento |
|---|---|---|
| R01/P0 | Exposição potencial no ZIP histórico descrita pelo manual; conteúdo/validade não confirmado. Pacote atual limpo nas regras executadas | Responsável verifica histórico e confirma necessidade de rotação. Sem confirmação, permanece pendente |
| R02/P0 | `env.js` não distingue chave publicável de administrativa; `/api/config` publica o campo publicável | Conferência operacional obrigatória; propor validação em E01 com aprovação de segurança |
| R03/P0 | Privilégio efetivo TRUNCATE para anon/authenticated em dez tabelas; RLS não o cobre | Proposta de menor privilégio/default grants e rollback, aprovação humana; não executar em E00 |
| R04/P1 | Advisor: `set_updated_at()` sem search path fixado; função invoker de trigger | Revisão pontual autorizada; não presumir exploração a partir do aviso |
| R05/P1 | Advisor: `rls_auto_enable()` SECURITY DEFINER executável por anon/authenticated | Retorna `event_trigger`, não uma RPC comum. Verificar origem/necessidade e privilégios; nenhum exploit HTTP foi demonstrado |
| R06/P1 | Advisor: proteção contra senhas vazadas desativada | Responsável avalia ajuste de Auth/plano e impacto; mudança sensível não executada |
| R07/P1 | `summary.repository.js:createSummaryVersion`: lê última versão, desmarca atuais e insere em requisições independentes; erros intermediários não tratados | Gerações concorrentes/falha de insert podem colidir ou deixar sem atual. Exige transação/lock e migration futura, não refatoração cosmética |
| R08/P1 | `question.repository.js:createQuestionBatch`: lote e questões em inserts separados | Falha pode deixar lote vazio; transação futura e teste DB |
| R09/P1 | `processing.service.js:runSummary/runQuestions` lê revisão no início da execução, e enqueue não fixa snapshot da solicitação | Derivado pode usar revisão diferente da intenção original; contrato/versionamento E02 |
| R10/P1 | `runInitial` gera resumo/questões sem confirmação humana; claim usa SKIP LOCKED por job, sem exclusão por material ou recuperação de jobs interrompidos | E02 trata consentimento/estado; projeto deve definir idempotência, serialização e recuperação em ambiente controlado |
| R11/P1 | Upload converte para WAV; `retain_original` retém esse derivado, não MP4. `deleteOwnedMaterial` usa bucket literal `audios` e ignora erro de remoção. Finalização move/remove objeto e atualiza linha em etapas | Retenção MP4 pertence a E07; políticas de conservação/limpeza, reconciliação e retries precisam preservar mídia. Sem remoções reais nesta entrega |
| R12/P1 | `app.js` desativa CSP; custos de IA não têm rate limit/orçamento por conta. Conversor já possui limite de dois processos e timeout | Proposta compatível em etapa de segurança/qualidade, sem ligar CSP às cegas ou chamar APIs pagas |
| R13/P2 | `study-store.js` é armazenamento local por conta, com limite de intervalos; visitas/cobertura não medem tempo ativo | Não utilizar como verdade social/heatmap. Persistência/migração idempotente E08/E09 |
| R14/P2 | URLs de player têm TTL de 600 segundos, menor que uma aula longa possível; não há teste remoto de seek/expiração | Testar renovação/disponibilidade e cache em staging; mock de TTL não prova criptografia/expiração |
| R15/P2 | ASR Python sem dependências fixadas; conexão Gradio memoriza promise; não houve teste real dos endpoints | Conferir Space/API/quotas e conexão após falha em staging, sem enviar gravações reais nesta auditoria |
| R16/P0 | `startsWith` de storagePath permitia dot segments/escapes; SDK normalizava URL para caminho de terceiro. Reproduzido localmente, sem remoto | **Corrigido localmente em B2** antes de cadastro/assinatura/download/finalização/exclusão; registros inseguros permanecem bloqueados e precisam de revisão autorizada. Deploy/integração real pendentes |

A corrida de revisão de **transcrição** não foi confundida com a de resumo: edição e restauração usam `FOR UPDATE` na transcrição; edição verifica `p_expected_revision`; ambas inserem nova revisão na mesma função. A implementação SQL efetiva foi inspecionada e tem esses controles. Isso ainda precisa de teste de concorrência no banco de staging.

## Referências e limites

Advisor consultado em 09/10/2026: [search path mutável](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [EXECUTE anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [EXECUTE authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). São quatro avisos, sendo dois sobre a mesma função.

[Changelog Supabase](https://supabase.com/changelog) consultado antes de propor procedimentos: revisar patches de PostgreSQL com o fornecedor; não atualizar banco/extensões automaticamente. `npm audit` e varredura de histórico Git não foram executados, respectivamente por restrição de rede e ausência de Git. Metadados de segurança não substituem pentest, restore verificado ou aprovação de produção.
