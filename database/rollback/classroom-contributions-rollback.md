# Rollback — Contribuições nas turmas (`20261122090000_classroom_contributions.sql`)

Rollback **não destrutivo** primeiro. Remover o esquema é o último recurso e **nunca devolve
dados**: o que foi apagado só volta de um backup.

## 1. Esconder tudo sem apagar (primeiro passo)

Não há flag própria: o sub-recurso segue `FEATURE_CLASSROOMS`. Para esconder o que foi oferecido
pelas turmas sem desligar as turmas:

```sql
begin;
-- Pendentes saem da fila; aprovados deixam de aparecer (o gatilho de shared_items não reverte nada).
update public.classroom_contributions
  set status = case when status = 'pending' then 'withdrawn' else 'revoked' end,
      ended_at = now()
  where status in ('pending', 'approved');
-- Os conjuntos aprovados por esta via também deixam de aparecer pelas rotas antigas.
update public.classroom_shared_items s set revoked_at = coalesce(s.revoked_at, now())
  from public.classroom_contributions c
  where c.shared_item_id = s.id and s.revoked_at is null;
commit;
```

Os conjuntos de flashcards e os materiais integrados **dos donos não são tocados**: a tabela só
guarda referências a eles.

Para desligar todas as turmas, siga `database/rollback/classrooms-rollback.md` (passo 1).

## 2. Exportar antes de qualquer remoção

Com backup recente e autorização explícita, exportar a tabela (por exemplo
`pg_dump --data-only --table=public.classroom_contributions`) e guardar em local protegido. Ela
contém recados dos alunos e dos professores: tratar como dado pessoal.

## 3. Remover o esquema (último recurso)

Somente com o passo 1 feito, backup e exportação conferidos, e aprovação explícita. A migration
não alterou nenhum objeto existente; os dois gatilhos em tabelas antigas são novos e saem com
`drop trigger`.

```sql
begin;
drop trigger classroom_members_end_contributions on public.classroom_members;
drop trigger classroom_shared_items_follow_contributions on public.classroom_shared_items;
drop table public.classroom_contributions cascade;
drop function public.classroom_contribute_admin(uuid, uuid, uuid, text, uuid, text),
  public.classroom_review_contribution_admin(uuid, uuid, uuid, text, uuid, text),
  public.classroom_end_contribution_admin(uuid, uuid, uuid),
  public.classroom_list_contributions_admin(uuid, uuid),
  public.classroom_get_contribution_admin(uuid, uuid, uuid),
  public.classroom_list_integrated_materials_admin(uuid, uuid),
  public.classroom_get_integrated_material_admin(uuid, uuid, uuid),
  public.classroom_integrated_content(jsonb),
  public.classroom_integrated_citations(jsonb),
  public.classroom_integrated_sources(jsonb),
  public.classroom_contributions_end_membership(),
  public.classroom_contributions_follow_shared_item(),
  public.classroom_contributions_guard();
commit;
```

(`classroom_contribution_row` depende do tipo da tabela e sai com o `drop table … cascade`.)

Depois rodar `database/checks/classroom-contributions-preflight.sql`: `already_applied` deve
voltar a `false` e as contagens de `classroom_shared_items`, `multi_lesson_materials` e
`classroom_members` devem ser as mesmas do preflight original (os conjuntos aprovados por esta via
continuam em `classroom_shared_items`, revogados no passo 1). A API volta sozinha ao
compartilhamento direto de conjuntos e as rotas novas respondem `503
CLASSROOM_CONTRIBUTIONS_SCHEMA_REQUIRED`.
