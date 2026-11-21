# Flashcards 3.0 — migration `20261121150000_flashcards_3_0.sql`

**Situação:** arquivo versionado no Git e testado em Postgres (PGlite nos testes e Postgres 16 local) e aplicado no staging Supabase. **Não foi aplicado em produção.** A seção "Onde foi aplicada", no fim, diz exatamente em quais bancos a migration rodou.

## O que cria

| Objeto | Tipo | Função |
| --- | --- | --- |
| `study_flashcards.note_type` | coluna | Tipo de nota: `basic`, `term`, `cloze`, `cause_effect`, `comparison`, `sequence`, `application` e `error_spotting`. O padrão é `basic`. |
| `study_flashcards.note_fields` | coluna jsonb | Campos estruturados do tipo, no máximo 16 KB. `front_text` e `back_text` continuam sendo o texto de estudo, renderizado pelo servidor. |
| `study_flashcards.content_hash` | coluna | SHA-256 do par pergunta+resposta normalizado, calculado pelo servidor. Serve para detectar repetidos. |
| `study_flashcards.origin_*` | colunas | Procedência de uma cópia: `merge`, `apkg`, `text_import` ou `classroom`, com o cartão, o conjunto e o autor de origem e um rótulo. Não há FK: a cópia é independente da origem. |
| `study_flashcards.media` | coluna jsonb | Imagens importadas, no máximo 10 por cartão. Ficam no bucket privado `flashcard-media`. |
| `study_card_templates` | tabela | Modelos visuais do aluno, só com tokens declarativos (sem CSS, HTML ou URLs). Têm versão, idempotência, exclusão lógica e limite de 50 por conta. RLS fica ligado e só o `service_role` tem acesso. |
| `study_flashcard_sets.template_id` e `template_base` | colunas | A aparência de **um conjunto inteiro**. A FK composta `(template_id, user_id)` só aceita um modelo do próprio dono; se o modelo for excluído, o campo vira null. |
| bucket `flashcard-media` | storage | Privado, 2 MB por arquivo, aceita PNG, JPEG, GIF e WebP. Não há políticas para o navegador: o servidor grava e assina as URLs. |
| `study_add_flashcard_notes_admin` | função | Insere notas tipadas com procedência. Informa quais pularam por repetir uma pergunta, em vez de descartá-las em silêncio. |
| `study_create_flashcard_deck_admin` | função | Cria um baralho pessoal (sem aula), com notas e aparência, numa transação. Repetir a chamada com o mesmo id devolve o mesmo baralho. |
| `study_save_card_template_admin` | função | Salva um modelo com versão e `last_request_id`. |
| `study_set_flashcard_set_template_admin` | função | Aplica **uma** aparência ao conjunto. Só a linha do conjunto muda; os cartões não. |

## Transformação de dados

Os cartões com `card_style = 'term_definition'` recebem `note_type = 'term'`. Todos os outros ficam com o padrão `basic`.

Nada mais muda: conteúdo, agenda, revisões e conjuntos ficam intactos. Os testes conferem isso, com dados criados antes da migration, em `backend/tests/flashcards-3-0-migration.test.js`.

## Dependências e ordem

1. `20261104234500_flashcards.sql` (E13), já aplicada em produção.
2. `20261119121000_flashcard_sets.sql`, já aplicada em produção.
3. **Esta migration.** Ela não depende das migrations de Anotações 3.0 nem de Turmas.

A migration de Turmas (`*_classrooms.sql`) pode ser aplicada antes ou depois desta. A leitura de conjuntos compartilhados numa turma só fica disponível com as duas aplicadas e com as flags `classrooms` e `flashcards_v3` ligadas.

## Como aplicar (quando houver autorização para produção)

1. Fazer backup e anotar o resultado de `database/checks/flashcards-3-0-preflight.sql`. O esperado: `prerequisites = true`, `already_applied = false` e `bucket_exists = false`.
2. Aplicar a migration. Ela roda numa transação e aborta com `FLASHCARDS_3_0_ABORT` se os pré-requisitos faltarem ou se já tiver sido aplicada.
3. Rodar `database/checks/flashcards-3-0-postflight.sql` e conferir:
   - as contagens iguais às do preflight;
   - `untyped_term_cards = 0`;
   - `rls_enabled = true`, `no_browser_access = true` e `private_bucket = true`.
4. Só depois disso, ligar `FEATURE_FLASHCARDS_V3=true`. Ela exige `FEATURE_FLASHCARD_SETS=true`, e o diagnóstico de prontidão confere as colunas.
5. A importação de `.apkg` precisa de Node 22.5 ou mais novo no servidor, que traz `node:sqlite`. Em versão antiga, a rota responde 400 com uma explicação.

## Reversão

Veja `database/rollback/flashcards-3-0-rollback.md`. Em resumo:

- desligar a flag basta para esconder tudo;
- remover os objetos só depois de exportar os dados;
- reverter o esquema **não** devolve dados apagados.

## Onde foi aplicada

| Banco | Situação |
| --- | --- |
| PGlite (testes automatizados) | aplicada a cada execução de `npm run check` |
| Postgres 16 local (cadeia completa de migrations) | ver `OVERNIGHT_PROGRESS.md`, seção 3.3 |
| Staging Supabase (`voz-em-estudo-staging`) | **aplicada em 21/11**, com o arquivo idêntico ao do commit `cbec226` (MD5 conferido); postflight ok |
| Produção (`audioestudo`) | **não aplicada** |
