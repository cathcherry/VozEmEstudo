# Biblioteca 2.0 — implementação na branch de integração

**Branch:** `feat/etapa-2-biblioteca-2-0`  
**Referência inicial:** `c1a7f62490b66168269d0e1168909b565209058a` (`main`, 04/11/2026)  
**Estado:** fatias E03/E04 implementadas na branch com flag OFF; migration E03 candidata e verificações SQL versionadas, **sem execução remota nem aprovação de gate**; a `main` segue intacta.

## Regra de trabalho sem computador local

1. Alterações são salvas em **commits pequenos** nesta branch; a `main` permanece a versão aprovada.
2. Um pull request **Draft** agrupa o trabalho. Nunca interpretar “push na branch” como publicação ou deploy.
3. GitHub Actions verifica sintaxe, segurança e regressões automatizáveis. Falhas são corrigidas na branch, sem Docker local.
4. Recursos novos ficam inativos por padrão via `FEATURE_CATALOG_UNITS=false` até a aplicação controlada da migration e avaliação no sistema real.
5. **Não aplicar migrations no Supabase atual só porque o SQL está no GitHub**. Banco remoto não participa das branches: uma alteração feita pelo SQL Editor afeta a instância imediatamente.
6. Quando a responsável estiver disponível, conferir backup e schema/migrations efetivamente presentes, aplicar SQL aprovado pela ordem, habilitar flag em ambiente apropriado e executar um **teste integrado** dos fluxos principais.
7. Somente após aprovação explícita e CI verde, incorporar o pull request à `main`. Se o trabalho crescer, criar PRs menores para esta branch de integração, nunca diretamente para a `main` sem aceite.

## E03 — catálogo persistente (ordem de implementação)

- [ ] Confirmar schema de produção/staging e ledger de migrations; não reaplicar `001_initial.sql` nem E02.
- [x] Rascunhar esquema aditivo em `database/proposals/e03-catalog-schema-draft.sql` (**não executar**).
- [x] Preparar migration numerada e transacional (`20261104190000_catalog_units.sql`), com checagens de privilégios/RLS, backfill por conta, guarda contra reaplicação e preservação de `updated_at`; criar `e03-preflight.sql`, `e03-postflight.sql`, runbook e testes estáticos. **Ainda não aprovada nem aplicada no Supabase**: falta validar o schema remoto/backup e o gate com duas contas.
- [x] Implementar primeira fatia da API autenticada: listar catálogo, criar disciplina/unidade e vincular/desvincular uma aula, com Zod, normalização e filtros de ownership. Rotas protegidas por `FEATURE_CATALOG_UNITS`, que continua OFF.
- [x] Manter `materials.subject` e os novos IDs coerentes quando a aula é vinculada pela API do catálogo; alterações livres do rótulo legado limpam os IDs na mesma operação, sob a flag. Novos uploads ainda dependem da etapa de associação explícita ou sincronização planejada.
- [ ] Migrar tags do `localStorage` apenas com consentimento e merge idempotente, sem converter visitas em horas de estudo.
- [ ] Testar duas contas A/B e preservação de IDs, transcrições, resumos e lotes.

## E04 — duas visões da biblioteca

- [x] Preservar a página existente como fallback da flag desativada; formulários novos ficam ocultos quando OFF.
- [x] Implementar a navegação por aula/unidade e por tipo de recurso, sem duplicar conteúdos: a segunda visão lista apenas referências a áudios preservados, transcrições, resumos atuais e lotes de questões existentes, usando seus IDs originais. Requer validação integrada antes de aceite.
- [x] Reutilizar busca, filtros existentes, estados vazios e links com IDs originais nas duas visões. Ações agregadas adicionais e refinamentos de navegação ficam para iteração posterior.
- [ ] Concluir validação de responsividade, teclado e navegação com a flag ligada no banco real; testes estáticos e automáticos sem integração remota serão executados no CI, mas não substituem o aceite humano.

## Incremento E03 — implementação guardada por feature flag

Arquivos novos: `backend/src/{routes,controllers,services,repositories,validators}/catalog.*.js`, `frontend/js/api/catalog.api.js`, `frontend/js/pages/catalog-panel.js`, `frontend/css/catalog.css`, testes de catálogo e interface. Integração: `backend/src/app.js` monta o novo router somente com a flag ativa; `GET /api/materials` só requisita `subject_id`/`unit_id` quando o schema estiver habilitado. A edição de disciplina em texto livre desassocia IDs em uma atualização atômica, evitando vínculo contraditório. A UI adiciona criar disciplina/unidade, vincular aula e agrupar por unidade.

**Não pronto para ativar:** o SQL executável foi preparado em `database/migrations/20261104190000_catalog_units.sql` e o plano de aplicação em `docs/implementation-2.0/04-e03-catalog-runbook.md`; o rascunho em `database/proposals/` está obsoleto. Os testes estáticos não substituem a execução controlada e a verificação remota. A flag deve permanecer OFF. A interface não recebeu validação visual real. Novos uploads com texto livre não são vinculados automaticamente a um ID; a associação pode ser feita na biblioteca após a ativação.

## Incremento E04 — recursos sem replicação

A consulta autenticada `GET /api/catalog/resources` percorre somente os materiais da conta, em páginas, e devolve **quatro booleanos por material** (`audio`, `transcription`, `summary`, `questions`). Ela não inclui texto de transcrições/resumos, gabaritos, nem caminhos de áudio. A versão “Por tipo de recurso” apresenta apenas itens existentes, agrupados por tipo, referenciando a aula original com âncoras `#transcricao`, `#resumo` e `#questoes`. Os filtros de busca, disciplina, tags, estado e atividade continuam valendo nas duas visões. A seleção é realizada com botões de opção acessíveis e fica oculta quando a flag está OFF. Em falha de consulta, a interface volta para “Por aula/unidade”.

Limites: o conteúdo não é duplicado, mas um mesmo título pode aparecer em categorias diferentes como **referências ao mesmo material**, por exemplo, uma entrada em “Transcrições” e outra em “Resumos”. A API oferece disponibilidade, não pré-visualização do conteúdo nem garantia de que o áudio remoto ainda esteja acessível. E04 depende da migration E03 e da flag para teste integrado; banco remoto **não foi alterado**.

## Gates que não vamos simular como aprovados

**G2a (E03):** migration aplicada em ambiente autorizado, backfill conferido com contagens e IDs anteriores, propriedade/RLS comprovada, API sem acesso cruzado.  
**G2b (E04):** interface nova funcionando no banco real, recursos da mesma aula acessíveis nas duas visões, sem duplicação e sem regressão dos fluxos existentes.

Há uma **migration candidata, versionada e não executada**. Seu uso está bloqueado até confirmar o schema remoto, backup e os resultados do preflight. A execução remota e a ativação da flag continuam pontos de parada com aprovação humana.

## Política de lotes

Continuar implementando novos módulos independentes na branch enquanto CI/fixtures passarem. **Parar** apenas quando a funcionalidade seguinte depender de comportamento remoto não verificado, migration executada, chaves reais, ou decisão que possa modificar/remover dados. Não misturar tudo em um commit enorme. Atualizar este documento com commit/testes de cada fatia.
