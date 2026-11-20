# Etapa 4 de 9 — Questões 2.0 (E10, primeira fatia)

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


**Branch:** `feat/etapa-2-biblioteca-2-0` • **PR #2 em Draft**. Nenhum merge na `main`. **Nenhuma migration executada no Supabase real.** `FEATURE_QUIZ_V2=false` por padrão.

## Implementado nesta versão

- API autenticada `/api/quiz-sessions`: iniciar sessão por lote, listar últimas 50 sessões da conta, recuperar sessão e progresso, responder questão e concluir após responder todas.
- Modos de feedback: **immediate** (correção de cada questão após enviá-la) e **deferred** (sem gabarito/correção até concluir a tentativa).
- Respostas persistidas, uma alternativa por questão por sessão, com gravação idempotente da mesma seleção. Reenvio com seleção diferente é bloqueado.
- Funções SQL transacionais com bloqueio da sessão, que não permitem responder depois de concluída, responder questão de outro lote ou encerrar antes de responder todas.
- Quando a flag está ativa, o antigo endpoint de correção `/api/questions/:questionId/answer` é bloqueado, impedindo contornar o modo diferido.
- Tela `responder.html` adapta-se à flag, oferece escolha do feedback, registra progresso e exibe revisão após conclusão. A tentativa pode ser reaberta diretamente pelo link contendo `session`. Respostas de outros usuários nunca são aceitas.
- As opções e enunciados são inseridos como texto DOM, sem interpolação de HTML fornecido pelas questões.
- Testes focados de serviço, esquema, segurança e comportamento da interface; CI não substitui testes com RLS/PostgreSQL reais.

## Dependências e implantação futura

1. Confirmar backup e esquema real; validar/aplicar E03 e **depois** E05/E06 (o E10 utiliza o FK composto de `materials` introduzido na E05).
2. Conferir e executar `database/checks/e10-preflight.sql` (**somente leitura**); verificar que E10 ainda não está no destino e comparar contagens legadas.
3. Com autorização explícita, executar uma única vez `database/migrations/20261104223000_quiz_sessions.sql` no SQL Editor do Supabase. Não repetir caso haja erro sem reconciliação de schema.
4. Executar `database/checks/e10-postflight.sql`: totais legados inalterados, RLS ligada, privilégios `anon` e `authenticated` negados para as novas tabelas/RPCs, `service_role` autorizado.
5. Ativar `FEATURE_QUIZ_V2=true` em ambiente de teste apropriado **após** banco e backend compatíveis. Testar contas A/B, lote de outra conta, sessões resumidas, respostas em ordem e fora de ordem, reenvio de mesma alternativa e de outra, modo diferido sem chave até conclusão, retomada e duas abas concorrentes.
6. Somente após testes e aprovação humana, propor merge à `main`.

**Reversão:** manter a flag OFF e sistema legado ativo. Não apagar tentativas nem desmontar tabelas como rollback rápido. Os novos dados podem coexistir com legado desativado.

## Limites e próximos incrementos (E11/E12)

- Não foram implementados diagnóstico pedagógico nem revisão espaçada. Resultados são corretos apenas em relação ao gabarito gerado, não há validação didática da IA.
- A tela de material ainda não exibe histórico navegável das tentativas; há API para os últimos 50 registros, e a retomada funciona com URL de sessão.
- Sem screenshots ou teste em banco real, a etapa **não pode ser marcada como homologada**.
