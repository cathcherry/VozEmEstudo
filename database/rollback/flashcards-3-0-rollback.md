# Reversão — Flashcards 3.0 (`20261121150000_flashcards_3_0.sql`)

Reverter o esquema **não** recupera dados. Os passos abaixo vão do menos destrutivo ao mais destrutivo; pare no primeiro que resolver o problema.

## 1. Desligar a funcionalidade (sem perda de dados)

- `FEATURE_FLASHCARDS_V3=false` e reiniciar a API.
- As rotas 3.0 deixam de existir, e o painel volta ao comportamento 3.2.
- Os cartões continuam a ser revisados normalmente: `front_text` e `back_text` são o texto de estudo e não dependem das colunas novas.

## 2. Exportar antes de qualquer remoção

```sql
-- Rodar no SQL Editor e guardar os resultados (CSV) fora do banco.
select * from public.study_card_templates;
select id, user_id, set_id, note_type, note_fields, content_hash, origin_kind, origin_card_id,
       origin_set_id, origin_user_id, origin_label, media
from public.study_flashcards
where note_type <> 'basic' or origin_kind is not null or jsonb_array_length(media) > 0;
select id, template_id, template_base from public.study_flashcard_sets
where template_id is not null or template_base is not null;
```

Baixe também os objetos do bucket `flashcard-media` (Storage › flashcard-media › download).

## 3. Remover os objetos (destrutivo, só com backup verificado e autorização explícita)

```sql
begin;
drop function public.study_set_flashcard_set_template_admin(uuid, uuid, uuid, text);
drop function public.study_save_card_template_admin(uuid, uuid, integer, uuid, jsonb);
drop function public.study_create_flashcard_deck_admin(uuid, uuid, jsonb);
drop function public.study_add_flashcard_notes_admin(uuid, uuid, jsonb);
alter table public.study_flashcard_sets drop constraint study_flashcard_sets_template_owner_fk,
  drop column template_id, drop column template_base;
drop table public.study_card_templates;
drop index public.study_flashcards_owner_hash_idx;
alter table public.study_flashcards drop column media, drop column origin_label,
  drop column origin_user_id, drop column origin_set_id, drop column origin_card_id,
  drop column origin_kind, drop column content_hash, drop column note_fields, drop column note_type;
-- O bucket só pode ser removido vazio. Esvaziar pelo painel depois de baixar os objetos.
-- delete from storage.buckets where id = 'flashcard-media';
commit;
```

Mesmo depois disso, os conjuntos criados por mesclas e importações continuam existindo como conjuntos comuns: são dados do aluno e não são apagados.
