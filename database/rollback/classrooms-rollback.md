# Rollback — Turmas privadas (`20261121140000_classrooms.sql`)

Rollback **não destrutivo** primeiro. Remover o esquema é o último recurso e **nunca devolve
dados**: o que foi apagado só volta de um backup.

## 1. Desligar o recurso (sempre o primeiro passo)

1. `FEATURE_CLASSROOMS=false` no ambiente da API e reiniciar.
2. Conferir: `GET /api/classrooms` responde **404** (rota não montada) e `/api/config` informa
   `featureFlags.classrooms = false`. A página Turmas mostra "Turmas ainda não estão ativas" e o
   item some da navegação.
3. Nada mais é alterado: turmas, membros, envios, aulas publicadas e compartilhamentos ficam
   guardados, sem acesso pelo navegador (RLS ativa, sem permissão para `anon`/`authenticated`).

Isto basta para incidentes de produto. Religar a flag devolve tudo como estava.

## 2. Ocultar conteúdo sem apagar (opcional)

Se for preciso esconder o que estava visível às turmas sem perder registros:

```sql
begin;
update public.classroom_lessons set status = 'unpublished', unpublished_at = now() where status = 'published';
update public.classroom_shared_items set revoked_at = now() where revoked_at is null;
update public.classroom_invites set revoked_at = now() where revoked_at is null;
commit;
```

Os materiais, transcrições, resumos, listas e conjuntos de flashcards **dos donos não são
tocados**: as turmas só guardam referências a eles.

## 3. Exportar antes de qualquer remoção

Com backup recente e autorização explícita, exportar as tabelas das turmas (por exemplo com
`pg_dump --data-only --table='public.classroom*'`) e guardar o arquivo em local protegido. O
conteúdo inclui nomes de exibição escolhidos pelos membros e notas de envio: tratar como dado
pessoal.

## 4. Remover o esquema (último recurso)

Somente com a flag desligada, backup e exportação conferidos, e aprovação explícita. A ordem
respeita as dependências; não há nenhum objeto anterior a recriar, porque a migration não
alterou tabelas, colunas ou funções existentes.

```sql
begin;
drop table public.classroom_resources, public.classroom_shared_items, public.classroom_submission_events cascade;
alter table public.classroom_submissions drop constraint classroom_submissions_lesson_fk;
drop table public.classroom_lessons, public.classroom_submissions, public.classroom_invites,
  public.classroom_members, public.classrooms cascade;
-- Remove as funções restantes do prefixo classroom_ (conferir a lista antes de executar):
-- select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'classroom\_%';
commit;
```

Depois rodar `database/checks/classrooms-preflight.sql`: `classrooms_already_applied` deve voltar
a `false` e as contagens de materiais, revisões, resumos e listas devem ser as mesmas do
preflight original.
