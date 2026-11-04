# Biblioteca 2.0 — implementação na branch de integração

**Branch:** `feat/etapa-2-biblioteca-2-0`  
**Referência inicial:** `c1a7f62490b66168269d0e1168909b565209058a` (`main`, 04/11/2026)  
**Estado:** preparação de E03/E04; nenhum SQL aplicado e nenhuma alteração da `main`.

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
- [ ] Validar e promover o SQL para migration numerada, com testes sintéticos, grants/RLS e procedimentos de backup/reversão.
- [ ] Implementar API autenticada para disciplinas/unidades e associação de materiais, com Zod, normalização e ownership.
- [ ] Garantir compatibilidade de `materials.subject` textual com os novos `subject_id`/`unit_id`, incluindo materiais criados após a migration.
- [ ] Migrar tags do `localStorage` apenas com consentimento e merge idempotente, sem converter visitas em horas de estudo.
- [ ] Testar duas contas A/B e preservação de IDs, transcrições, resumos e lotes.

## E04 — duas visões da biblioteca

- [ ] Preservar a página existente como fallback da flag desativada.
- [ ] Criar navegação “Por aula/unidade” e “Por tipo de recurso” sem copiar transcrições, resumos nem questões.
- [ ] Adicionar filtros e ações agregadas com IDs originais, estados vazios e carregamento acessível.
- [ ] Validar responsividade e teclado com testes automatizados; revisão visual humana apenas no aceite integrado.

## Gates que não vamos simular como aprovados

**G2a (E03):** migration aplicada em ambiente autorizado, backfill conferido com contagens e IDs anteriores, propriedade/RLS comprovada, API sem acesso cruzado.  
**G2b (E04):** interface nova funcionando no banco real, recursos da mesma aula acessíveis nas duas visões, sem duplicação e sem regressão dos fluxos existentes.

O arquivo SQL é um **desenho inicial**, não a migration final. A aplicação remota e a ativação da flag são pontos de parada com aprovação humana.

## Política de lotes

Continuar implementando novos módulos independentes na branch enquanto CI/fixtures passarem. **Parar** apenas quando a funcionalidade seguinte depender de comportamento remoto não verificado, migration executada, chaves reais, ou decisão que possa modificar/remover dados. Não misturar tudo em um commit enorme. Atualizar este documento com commit/testes de cada fatia.
