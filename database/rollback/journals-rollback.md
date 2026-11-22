# Rollback — Diário de estudo (`20261124100000_journals.sql`)

Rollback **não destrutivo primeiro**. Reverter o schema **não restaura dados**: diários, páginas,
decorações e ligações só existem nas estruturas novas.

## 1. Desligar a funcionalidade (sempre o primeiro passo)

1. `FEATURE_JOURNAL=false` no backend e reiniciar.
2. Resultado: `/api/journals` deixa de existir (404). `diario.html` explica que o recurso não está
   ativo e o caderno da aula deixa de mostrar o link “Meu diário de estudo”. O caderno da aula
   (Notes 3.0) continua igual: a capa e o papel dele ficam nas preferências da conta
   (`profile_state`, chave `notebook-looks`), não nestas tabelas.
3. Nada é apagado. As tabelas ficam paradas e podem ser religadas depois, com tudo o que a pessoa
   já tinha.

Isto basta para quase todo incidente. Só siga adiante se for preciso remover o schema.

## 2. Exportar antes de remover qualquer objeto

Em sessão autorizada, com backup restaurável conferido. São textos pessoais de estudo: guarde os
arquivos com o mesmo cuidado.

```sql
copy (select * from public.journals) to stdout with csv header;
copy (select * from public.journal_pages) to stdout with csv header;
```

## 3. Remover os objetos novos (destrutivo — somente após o passo 2)

```sql
begin;
set local lock_timeout = '5s';
drop function if exists public.journal_page_save_admin(uuid, uuid, uuid, integer, uuid, jsonb);
drop function if exists public.journal_save_admin(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.journal_link_options_admin(uuid);
drop function if exists public.journal_get_admin(uuid, uuid);
drop function if exists public.journal_list_admin(uuid);
drop function if exists public.journal_check_content(jsonb, jsonb);
drop function if exists public.journal_check_links(uuid, jsonb);
drop function if exists public.journal_check_decorations(uuid, jsonb);
drop function if exists public.journal_link_target(uuid, text, uuid);
drop function if exists public.journal_page_row(public.journal_pages);
drop function if exists public.journal_row(public.journals);
drop table if exists public.journal_pages;
drop table if exists public.journals;
commit;
```

Observações:

- Nenhum objeto existente foi alterado pela migration; remover os novos não afeta aulas,
  transcrições, anotações, cadernos da aula, descobertas ou o Gabinete.
- Reaplicar depois de um rollback: o guard aborta se `journals` ou `journal_pages` existirem.
  Remova tudo (após exportar) antes de reaplicar.
- Conferir com `database/checks/journals-preflight.sql` (deve voltar ao estado “não aplicado”).
- O bloco SQL acima é executado no teste `backend/tests/journals-migration.test.js`.
