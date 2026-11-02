# E02 — procedimento de migration, staging e reversão

**Preparado, sem execução remota.** Usar somente após autorização explícita do ambiente, confirmação de staging/backup/restore e aceite dos responsáveis. O projeto existente inspecionado não foi classificado como staging. E00/G0a e E01/G0b não são aprovados por inferência.

## Base e divergências

Fonte E01 vigente: revisão 12, SHA-256 `df90c25a8f672a77d8a839fcf8b2efc5fc9c696618bdf643c397816e10c75ed7`. Sem Git, usar hashes/evidências; não inventar commits. O catálogo remoto lido em 09/10/2026 possui dez tabelas legadas, RLS habilitada, PostgreSQL 17.6 e cinco funções de domínio. O histórico Supabase de migrations está vazio. Essa divergência impede `db reset`, `db push` ou reaplicar `001_initial.sql` sem reconciliação aprovada. A E02 usa os nomes/colunas reais, não o SQL ilustrativo do manual.

Migration: `database/migrations/20261009101846_academic_review.sql`, nome gerado pelo Supabase CLI 2.120.0 com `migration new academic_review`, no workspace isolado. Não renumerar a baseline nem registrar migrations históricas como executadas sem verificação. SQL aditivo, em uma transação, sem remoção de dados; altera guards de escrita. Não é reexecutável cegamente.

## Pré-execução e proteção

1. Responsável registra identidade do ambiente de destino, autorização, versões e janela. Nunca passar senha em linha de comando; usar os mecanismos privados da instalação. Relatar apenas nomes de variáveis, status e contagens.
2. Executar o [runbook E00](01-staging-backup.md): snapshot de dados/schema, policies, grants, RPCs, extensões, inventário Storage e teste de restore em destino separado. Metadados E02 não são backup.
3. Rodar `database/checks/e02-preflight.sql` em leitura no destino aprovado. Comparar constraints, funções legadas e colunas com a evidência. Confirmar ausência das novas estruturas antes da aplicação. Contagens antes/depois devem ser guardadas em artefato privado sanitizado.
4. Bloquear se houver transcrição sem snapshot da revisão atual, números de revisão duplicados, áudio duplicado por material ou job ativo não reconciliado. Não fabricar confirmação ou backfill de proveniência para reparar o histórico. Planejar o tratamento com a equipe.
5. Pausar API de escrita e workers. Guardar o release anterior e a configuração fora do pacote; não expor valores. Inventariar jobs em fila/retry/processamento: os antigos de geração não têm revisão fixada e não devem ser liberados automaticamente. Cancelamento/recriação em lote exige plano e autorização; novos jobs são criados depois da reconfirmação humana.
6. Em staging descartável, aplicar a E02 pelo fluxo de migrations aprovado; comparar contagens das dez tabelas históricas. O único backfill acadêmico é `review_state = awaiting_review` para transcrições existentes; permissões/confirmações não são inventadas e fontes antigas permanecem NULL.
7. Rodar `database/checks/e02-postflight.sql`, testes locais e os testes de duas contas/concorrência abaixo. Validar plano e compatibilidade PostgreSQL 17. Não publicar o aplicativo como parte deste procedimento.
8. Somente com provas e aceite, coordenar frontend/API/worker compatíveis com E02. Sem migration, comandos novos falham com `SCHEMA_UPGRADE_REQUIRED`; não usar flag para contornar declaração/confirmação.

## Testes em instância autorizada

Criar duas contas de teste A/B e materiais sintéticos por API, fora de produção. Não reutilizar gravações pessoais. Não colocar tokens em fixtures versionadas, screenshots ou logs. Usar IDs retornados e sessão A/B mantidos em armazenamento privado. Declaração atual vem de GET `/api/config`.

Verificar: material sem declaração 422; versão antiga 409; A lê/confirma sua revisão; B obtém 404 para permissão/review/confirm/warnings/summary/questions de A; nenhuma credencial retorna. ASR conclui sem derivados; retenção OFF limpa após snapshot, player fica indisponível e texto permanece. RLS autentica duas contas reais: SELECT das tabelas E02 só mostra a conta própria; RPCs/escritas diretas autenticadas são negados. O probe E01 de Storage/TTL continua manual/guardado e não foi executado.

Com revisão confirmada em material sintético, emitir duas requisições de geração com a mesma `idempotencyKey`: devem retornar o mesmo job. Com duas chaves diferentes, executar **dois workers/conexões reais**; versões de resumo distintas, apenas uma current, dois lotes completos e sem deadlock. Injetar falha de persistência dentro de transação de staging descartável: current anterior preservado e nenhum lote parcial. Repetir a mesma conclusão de job: deve retornar o derivado existente, sem nova inserção. Editar enquanto está na fila e enquanto o provedor aguarda; o prompt/resultado deve continuar ligado ao UUID original, a revisão nova fica não confirmada. Restaurar cria outra revisão. Usar provider mock/fake, nunca logar transcrição integral para provar a fonte.

Para contenção reproduzível, no banco de teste autorizado, abrir duas sessões psql. A sessão A usa `BEGIN`, RPC `commit_summary_admin` de um job sintético válido e segura o commit. A sessão B chama a mesma RPC para outro job do mesmo material e deve aguardar o lock. Confirmar A, então B; consultar contagem/current/links. Cada RPC é `SECURITY INVOKER` e exige role de servidor; essa role só deve existir no executor autorizado, nunca no browser. `lock_timeout`/`statement_timeout` devem limitar o ensaio. Repetir para enqueue/edits e lotes; guardar apenas resultados/contagens. Este ensaio não foi executado: PGlite serializa uma conexão, e o runtime bloqueou a inicialização de PostgreSQL nativo.

Falha/recuperação de Storage: simular move concluído + falha de update do banco; retry só reconcilia destino esperado e tamanho. Para limpeza, falhar antes de remove, retomar sem repetir ASR e verificar URL indisponível. Validar com Storage real e contador de objetos/bytes; o transporte local não prova expiração/CDN.

## Reversão e janela

Antes de qualquer escrita E02, é possível interromper o rollout e restaurar o snapshot ensaiado em destino separado, com comparação de schema, tabelas, policies, grants, jobs e objetos. API/workers ficam pausados durante a reversão. A janela acaba ao liberar novas escritas; a equipe deve defini-la e registrá-la, sem inventar prazo aprovado.

Depois de novas permissões/confirmações/derivados, um `DROP`/rollback de colunas apagaria rastreabilidade. Não há down destrutivo automático. A reversão preferida é um release compatível que mantenha os guards e leia o histórico, seguido de correção progressiva. Voltar simplesmente ao worker E01 permitiria tentativa de geração não confirmada e conflitaria com triggers: não fazê-lo.

Se a restauração de snapshot anterior for necessária após novas escritas, exportar/preservar também o delta acadêmico e Storage, testar reconciliação em cópia, quantificar perda potencial e pedir autorização específica. Não sobrescrever mídia ou registros de usuário. Restore real, delta, janela, teste multiprocessos e aplicação remota estão pendentes; G1 permanece bloqueado.
