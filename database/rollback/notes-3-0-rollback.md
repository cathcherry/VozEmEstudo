# Rollback — Notes 3.0 (`20261121130000_notes_3_0.sql`)

Rollback **não destrutivo primeiro**. Reverter o schema **não restaura dados**: cadernos e o
fim de destaques em vários trechos só existem nas estruturas novas.

## 1. Desligar a funcionalidade (sempre o primeiro passo)

1. `FEATURE_NOTEBOOKS=false` no backend e reiniciar.
2. Resultado: `/api/notebooks` deixa de existir (404) e `/api/annotations` volta a usar
   `study_save_annotation_admin` (E14). Destaques antigos e novos continuam visíveis: a lista
   E14 devolve todas as colunas, e os destaques em vários trechos aparecem com a citação
   completa (o “Ir ao destaque” do modo leitura só seleciona destaques de um trecho com o
   front-end anterior).
3. Nada é apagado. As estruturas novas ficam paradas e podem ser religadas depois.

Isto basta para quase todo incidente. Só siga adiante se for preciso remover o schema.

## 2. Exportar antes de remover qualquer objeto

Em sessão autorizada, com backup restaurável conferido:

```sql
-- Cadernos (documento completo) e destaques que começam e terminam em trechos diferentes.
copy (select * from public.study_notebooks) to stdout with csv header;
copy (select * from public.study_annotations where end_segment_position > segment_position)
  to stdout with csv header;
```

Guarde os arquivos fora do banco, com o mesmo cuidado de dados pessoais (são anotações privadas).

## 3. Remover os objetos novos (destrutivo para cadernos — somente após o passo 2)

```sql
begin;
set local lock_timeout = '5s';
drop function if exists public.study_save_notebook_admin(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.study_get_notebook_admin(uuid, uuid);
drop function if exists public.study_save_annotation_range_admin(uuid, uuid, uuid, integer, uuid, jsonb);
drop table if exists public.study_notebooks;                 -- apaga os cadernos
drop trigger if exists study_annotations_fill_end_segment on public.study_annotations;
drop function if exists public.study_annotations_fill_end_segment();
-- As colunas de study_annotations podem FICAR (são aditivas e inofensivas para o E14).
-- Removê-las apaga a informação de onde terminam os destaques em vários trechos:
-- alter table public.study_annotations
--   drop constraint if exists study_annotations_anchor_range_check,
--   drop constraint if exists study_annotations_visibility_private,
--   drop constraint if exists study_annotations_anchor_version_check,
--   drop column if exists end_segment_position,
--   drop column if exists anchor_version,
--   drop column if exists visibility;
commit;
```

Observações:

- Um destaque em vários trechos continua sendo uma linha válida do E14 (início em
  `segment_position/start_offset`, citação completa em `quote`). Se as colunas forem removidas,
  `end_offset` passa a ser lido como offset no trecho inicial e o “Ir ao destaque” deixa de
  encontrá-lo — a citação e a nota continuam legíveis.
- Reaplicar a migration depois de um rollback parcial: o guard aborta se `study_notebooks` ou a
  coluna `end_segment_position` existirem. Remova ambos (após exportar) antes de reaplicar.
- Conferir com `database/checks/notes-3-0-preflight.sql` (deve voltar ao estado “não aplicado”).
