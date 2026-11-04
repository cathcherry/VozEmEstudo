# Etapa 4 — E11/E12: diagnóstico e revisão dos erros

**Em desenvolvimento:** PR #2 (Draft), branch `feat/etapa-2-biblioteca-2-0`. Nenhum merge na `main`, nenhuma migration aplicada ao Supabase e nenhuma feature ativada em ambiente real.

## O que já está implementado

**E11 — Diagnóstico descritivo**

- `GET /api/quiz-sessions/:sessionId/diagnostic`, autenticado, consulta a tentativa pela conta que fez a requisição.
- Somente uma tentativa **concluída** e com gabaritos disponíveis pode produzir contagem de acertos/erros, percentual e lista de erros com alternativa selecionada, gabarito e explicação armazenada.
- A interface mostra o diagnóstico no fim da sessão e permite retomar até oito tentativas da mesma aula, dentre as 50 mais recentes retornadas pela API.
- Não inferimos temas/dificuldades cognitivas nem confiabilidade da resposta automática. O resultado mede apenas concordância com o gabarito gerado, que pode conter erros.

**E12 — Refazer somente as questões erradas**

- `FEATURE_QUIZ_REVIEW` é uma flag independente de `FEATURE_QUIZ_V2`, ambas OFF por padrão.
- Ao concluir uma lista com erros, o botão de revisão gera uma **nova tentativa** apenas com as questões erradas por meio de `POST /api/quiz-sessions/:sessionId/review`.
- IDs de questões não são aceitos do navegador. A função SQL usa respostas persistidas da tentativa concluída, restringe pela conta e pelo lote e cria registros de referência aos itens, sem copiar enunciados, gabaritos ou conteúdo.
- A revisão também pode utilizar feedback imediato ou diferido. A tela oferece o modo diferido para evitar entregar o gabarito durante a repetição.
- As funções SQL E10 são ampliadas transacionalmente para rejeitar questões fora da seleção e permitir concluir a revisão ao terminar seu subconjunto, sem exigir responder o lote inteiro.
- O código do E10 mantém funcionamento independente quando `FEATURE_QUIZ_REVIEW=false` e ainda não existe a migration E12.

## Dependências e sequência para validação futura

1. Confirmar projeto de destino, backup recuperável e esquema real. Validar e aplicar **E03**, depois **E05/E06**, depois **E10** — cada qual com seus preflight/postflight, somente mediante aprovação.
2. E11 utiliza o esquema E10; não exige uma migration nova.
3. Executar `database/checks/e12-preflight.sql` **somente leitura**. Confirmar que E10 existe e que `quiz_session_items` e RPC E12 ainda não existem; registrar contagens agregadas.
4. Com autorização explícita, aplicar **uma única vez** `database/migrations/20261104233000_quiz_review.sql` pelo Supabase SQL Editor. O arquivo é transacional, aditivo e contém `CREATE OR REPLACE` de duas RPCs E10; não reaplicar em caso de erro sem inspecionar o banco.
5. Executar `database/checks/e12-postflight.sql` e confirmar totais legados, RLS da nova tabela, ausência de grants a `anon`/`authenticated`, e RPC permitida somente a `service_role`.
6. Só depois ativar `FEATURE_QUIZ_V2=true` e `FEATURE_QUIZ_REVIEW=true` em ambiente autorizado. Testar com duas contas A/B: diagnóstico de tentativa não concluída (deve falhar), sessão 100% correta (sem revisão), múltiplos erros, respostas repetidas, retomada da revisão, duas abas, pergunta fora do subconjunto (deve falhar) e cancelamento por flag.
7. Revisar interface em celular e teclado; obter aceite humano antes de propor merge.

**Recuperação:** em erro, manter flags OFF e sistema legado ativo. Não apagar tentativas ou tabelas como rollback improvisado.

## Pendências

- Teste de execução SQL contra PostgreSQL/Supabase real, inspeção de RLS e permissões, homologação de concorrência.
- Diagnóstico pedagógico por assunto com categorias verificáveis ou recomendações inteligentes não foi implementado.
- Testes de navegador com flags ativas, revisão visual do conjunto e aceite final.

**Importante:** CI verde e testes sintéticos não significam que a migration foi executada nem que o aplicativo foi homologado.
