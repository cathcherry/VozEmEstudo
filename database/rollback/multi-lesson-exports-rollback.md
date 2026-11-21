# Reversão — Material integrado: questões tentáveis e conjunto de flashcards (`20261121180000_multi_lesson_exports.sql`)

Esta migration não tem flag própria: ela vale enquanto `FEATURE_MULTI_LESSON=true`. Sem ela, a API
responde `503 MULTI_LESSON_EXPORTS_SCHEMA_REQUIRED` nessas rotas e a página do material integrado
simplesmente não mostra os botões "Transformar em lista de questões" e "Salvar como conjunto de
flashcards" (testado). O material integrado continua funcionando.

1. **Sem perda de dados (desligar só a exportação):** remover a permissão de execução das funções.
   A página volta a esconder os botões; listas e conjuntos já criados continuam onde estão.

```sql
begin;
revoke execute on function public.multi_lesson_export_questions_admin(uuid, uuid, uuid, text),
  public.multi_lesson_export_flashcards_admin(uuid, uuid, uuid, text),
  public.multi_lesson_exports_admin(uuid, uuid)
  from service_role;
commit;
```

   Para religar, repetir com `grant execute ... to service_role`.

2. **Exportar** antes de qualquer remoção: `select * from public.multi_lesson_exports;`.

3. **Remover** (destrutivo, só com backup e autorização). Apaga apenas o vínculo de proveniência e as
   funções. As listas de questões (`question_batches`/`questions`), as tarefas concluídas que as
   registram (`processing_jobs` com `params->>'origin' = 'multi_lesson'`), as tentativas
   (`quiz_sessions`) e os conjuntos de flashcards são dados comuns do estudante e **não** são
   apagados.

```sql
begin;
drop function public.multi_lesson_export_flashcards_admin(uuid, uuid, uuid, text);
drop function public.multi_lesson_export_questions_admin(uuid, uuid, uuid, text);
drop function public.multi_lesson_exports_admin(uuid, uuid);
drop function public.multi_lesson_export_view(public.multi_lesson_exports, boolean);
drop table public.multi_lesson_exports;
commit;
```

Nenhum dado existente foi transformado por esta migration.
