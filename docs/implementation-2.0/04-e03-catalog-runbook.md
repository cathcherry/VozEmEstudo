# E03 — aplicar catálogo persistente com segurança (sem Docker)

**Estado em 04/11/2026:** scripts versionados na branch `feat/etapa-2-biblioteca-2-0`. **NÃO EXECUTADOS** no Supabase. O PR #2 continua em rascunho; a `main` continua aprovada e separada. Este documento não representa aprovação do gate G2a.

## Arquivos e ordem

1. `database/checks/e03-preflight.sql` — inventário **somente leitura**, antes da aplicação.
2. `database/migrations/20261104190000_catalog_units.sql` — migration aditiva, transacional e **de execução única**; exige autorização e backup.
3. `database/checks/e03-postflight.sql` — checagens **somente leitura** logo após a aplicação.

O rascunho antigo `database/proposals/e03-catalog-schema-draft.sql` foi substituído por este plano. **Não executar dois arquivos de criação de tabelas.**

## 1. Condições para aplicar

- Confirmar no Supabase Dashboard que se trata do **projeto correto**, não de outra conta ou instalação. Conferir nome, referência e status **sem compartilhar URLs privadas ou chaves**.
- Confirmar que E02 está no banco (tabela `public.material_permissions`), mesmo que o histórico de migrations esteja desatualizado.
- Ter **backup utilizável e plano de restauração** verificados para este ambiente. A disponibilidade de backups depende do projeto/plano do Supabase; não presumir que existe. Um `SELECT` ou o histórico de migrations não constitui backup.
- Evitar novas gravações/processamentos durante a aplicação e as duas contagens. Escolher janela curta de manutenção; a migration adquire lock sobre `materials`.
- Confirmar na saída do preflight: `has_materials=true`, `has_e02_permissions=true`, `has_updated_at_function=true`, `e03_subjects_already_exists=false`, `e03_units_already_exists=false`; `subject_id` e `unit_id` **ausentes**; o trigger `materials_set_updated_at` existe e está `active=true`; `overlong_labels=0`. Se qualquer uma falhar, **parar** e adaptar o plano. Não apagar/truncar disciplinas antigas para forçar a migration.

## 2. Aplicação pelo navegador (somente após aceite)

1. Abrir o projeto correto em **Supabase → SQL Editor**.
2. Executar todo o `e03-preflight.sql` e registrar **somente totais e indicadores**, nunca dados pessoais. Se alguma verificação falhar, interromper.
3. Conferir backup e janela de manutenção. Com autorização explícita, colar e executar o arquivo completo `20261104190000_catalog_units.sql` **uma única vez**.
4. A transação `BEGIN ... COMMIT` garante que falhas interrompam a operação e desfaçam suas mudanças no banco. `lock_timeout` impede espera indefinida; nunca repetir automaticamente após erro.
5. Executar imediatamente `e03-postflight.sql`. Conferir contagens **idênticas** para materiais, arquivos de áudio, transcrições, revisões, resumos, lotes, questões e jobs. A migration pode adicionar disciplinas e IDs, mas não remove materiais antigos, não altera `materials.subject` nem seus `updated_at` históricos (trigger desativado somente na atualização de backfill dentro da transação, depois reativado).
6. Resultado esperado pós-execução: `unlinked_existing_labeled_materials=0`, `material_subject_owner_mismatch=0`, `material_unit_scope_mismatch=0`, `noncanonical_subjects=0`, `noncanonical_units=0`, trigger `enabled=true`, RLS habilitada em ambas as novas tabelas; `anon_*_read` e `authenticated_*_read` falsos; `service_*_crud` verdadeiros. Se algum resultado for diferente, manter a flag desligada e investigar.

**Importante:** rodar o arquivo no SQL Editor **não o registra automaticamente** como migration aplicada no histórico administrado pelo Supabase CLI. Registrar manualmente a data, o ambiente, o hash/revisão do SQL, as contagens e a pessoa que autorizou a execução, em registro privado. Não executar `db push` ou reaplicar a base para “sincronizar” sem reconciliação da história.

## 3. Validação funcional futura (separada da instalação)

O banco atualizado **não ativa** a interface sozinho. O backend só monta `/api/catalog` com `FEATURE_CATALOG_UNITS=true`, que permanece **false** por padrão. A ativação exige ambiente compatível, versão aprovada da API e teste integrado com contas sintéticas A/B.

Critérios: A cria disciplina e unidade; A associa material próprio; B **não** consegue ler/alterar disciplinas/unidades/materiais de A por API; consultas diretas feitas como papel de cliente não expõem as novas tabelas; IDs de materiais antigos e derivados permanecem iguais; biblioteca alterna entre “Por aula/unidade” e “Por tipo de recurso”; falha no catálogo volta para a visão antiga. Isso deve ser verificado depois, quando a responsável puder testar. **CI sintético não equivale a teste do Supabase real.**

## 4. Recuperação sem apagar dados

- **Erro durante a migration:** a transação do arquivo reverte todas as instruções; não há necessidade de um `DROP` corretivo. Investigar o erro, conferir o schema e backup e só então planejar outra tentativa.
- **Erro depois da migration aplicada:** manter `FEATURE_CATALOG_UNITS=false` e a versão anterior da aplicação. O catálogo fica inativo; as colunas/tabelas adicionais podem permanecer sem comprometer o modelo legado. Consultar logs, contagens e SQL pós-execução. **Não executar `DROP TABLE`, `DROP COLUMN` ou apagar dados como “rollback rápido”**.
- Se for necessária reversão física de schema, planejar uma migration de compensação separada com inventário das novas associações e revisão do backup; somente após aceite explícito. Não considerar a desativação da flag como restauração de banco.

## 5. Limites atuais

O backfill associa apenas **materiais já existentes na data da migration**. Materiais criados posteriormente com texto livre continuam podendo existir sem `subject_id`, até vinculação explícita na nova Biblioteca. O catálogo atual não oferece exclusão/renomeação de disciplinas ou unidades; isso impede apagar acidentalmente vínculos. O arquivo não migra tags locais nem gera dados de progresso. As verificações remotas e o teste A/B continuam pendentes.
