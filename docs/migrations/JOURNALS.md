# Migration Diário de estudo — `20261124100000_journals.sql`

Marco D do ciclo 3.6: o **Diário de estudo** (`diario.html`), um diário pessoal feito de páginas de
scrapbook. **Candidata, não aplicada em nenhum ambiente por este repositório. Somente staging até
ser validada.** Ela **não** entra no pacote `database/release/3.4/` e o script
`scripts/release/enable-3-4-features.mjs` não liga `FEATURE_JOURNAL` (fica `false`).

## Dependências e ordem

1. Base (`001_initial.sql`): `materials` e `auth.users`.
2. Opcional: `20261123090000_discoveries.sql` (3.5). Com ela, uma página pode ligar descobertas e
   usar **selos que a conta já encontrou** no Gabinete. Sem ela, ligar uma descoberta responde
   `409 JOURNAL_LINK_INVALID` e um selo `409 JOURNAL_DECORATION_LOCKED`; o resto funciona.
3. Aplicar depois de `20261123090000_discoveries.sql` quando as duas forem para o mesmo ambiente.

O guard aborta com `JOURNALS_ABORT` se faltar pré-requisito ou se já tiver sido aplicada. Tudo
roda numa transação (`begin`/`commit`), com `lock_timeout` de 5 s.

O **caderno da aula** (Notes 3.0) **não** usa estas tabelas: a capa e o papel de cada caderno ficam
nas preferências sincronizadas da conta (`profile_state`, chave `notebook-looks`, por id da aula),
porque o validador do caderno (`notebook.validator.js`, `.strict()`) e a função
`study_save_notebook_admin` só aceitam `title` e `doc`. Nenhum dado de caderno existente muda.

## O que cria (só acréscimos)

| Tabela | Papel |
| --- | --- |
| `journals` | Um diário: `title` (1–80), `cover` (id de arte `cover.*`), `paper` (papel das páginas novas), `version`, `last_request_id`, `last_body_hash`, `deleted_at`. Até **24** por conta. |
| `journal_pages` | Uma página: `template` (`ruled`, `collage`, `concept`, `timeline`, `free`; não muda depois de criada), `paper`, `title` (≤ 120), `content` (objeto de texto simples, ≤ 24 000 bytes), `decorations` (≤ 24), `links` (≤ 6), `position`, `version`, `deleted_at`. Até **120** por diário. FK `(journal_id, user_id)` → `journals(id, user_id)`: uma página nunca pertence a outra conta. |

Funções `*_admin` (todas `security invoker`, `search_path=''`, executáveis só pelo `service_role`,
todas recebem `p_user_id`): `journal_list_admin`, `journal_get_admin`, `journal_link_options_admin`,
`journal_save_admin`, `journal_page_save_admin`. Auxiliares: `journal_row`, `journal_page_row`,
`journal_link_target`, `journal_check_decorations`, `journal_check_links`, `journal_check_content`.

## Regras

- **Decorações**: `[{id, art, x, y, rotation, scale}]`, exatamente essas chaves; `id`
  `^[A-Za-z0-9_-]{1,40}$` e único na página; `art` na lista permitida
  `^(sticker|tape|stamp|frame|divider|label)\.[a-z0-9]+(-[a-z0-9]+)*$`; `x` e `y` de 0 a 100 (% da
  página), `rotation` de −180 a 180, `scale` de 0,4 a 2,5; números arredondados ao gravar. Selos
  (`stamp.*`) só se a conta tiver o desbloqueio em `collection_unlocks`.
- **Ligações**: `[{kind: 'lesson' | 'discovery', id}]`, distintas, sempre da própria conta. Só a
  referência é guardada; o título é lido ao vivo (`linkTargets` em `journal_get_admin`).
- **Conteúdo**: objeto; nenhum texto com abertura de tag HTML; ids de arte da colagem conferidos.
  **Citação**: se `content.quote.text` não estiver vazio, `content.quote.source` precisa ser uma das
  ligações da página (`JOURNAL_QUOTE_SOURCE_REQUIRED`). O diário nunca copia a transcrição sem a
  fonte.
- **Concorrência e repetição**: `version` otimista por diário e por página
  (`JOURNAL_VERSION_CONFLICT`); `requestId` + hash do corpo: repetir o mesmo pedido devolve o estado
  salvo (`replayed: true`), o mesmo id com outro corpo é `JOURNAL_REQUEST_CONFLICT`. Escritas do
  mesmo diário são serializadas (`for update`), e a criação de diários por conta por
  `pg_advisory_xact_lock`.
- **Exclusão**: `deleted: true` marca `deleted_at`; a linha deixa de aparecer e não pode mais ser
  editada.

## Segurança e privacidade

RLS ligada nas 2 tabelas; `revoke all` de `public, anon, authenticated`; grants só ao
`service_role`. Outra conta recebe `JOURNAL_NOT_FOUND` (inclusive para um id que já existe em outra
conta). Excluir a conta apaga tudo (`on delete cascade`); excluir uma aula não apaga a página, só a
ligação deixa de ter título ("Aula indisponível").

## Implantação (staging)

1. Backup restaurável conferido.
2. `database/checks/journals-preflight.sql` (somente leitura).
3. Aplicar a migration em sessão autorizada.
4. `database/checks/journals-postflight.sql`: objetos presentes, RLS, nada exposto ao navegador,
   funções `security invoker` com `search_path`, contagens iguais.
5. `FEATURE_JOURNAL=true` (o readiness confere `journals` e `journal_pages`).
6. Validação manual com contas reais (pendente).

Com a flag ligada e a migration ausente, `/api/journals` responde `503 JOURNAL_SCHEMA_REQUIRED`;
o resto do app continua.

## Rollback

`database/rollback/journals-rollback.md`: desligar a flag (não destrutivo); só depois de exportar,
remover os objetos novos. O bloco SQL é executado no teste da migration.

## Testes

- `backend/tests/journals-migration.test.js` (PGlite, SQL real): guard e aditividade, criação e
  edição com versões e repetição por `requestId`, limites, decorações (lista permitida, faixas,
  selos só desbloqueados), ligações e citação com fonte, privacidade entre contas e papéis do
  navegador, preflight/postflight e rollback.
- `backend/tests/journals-http.test.js`: a fatia completa pela API, com validação e isolamento.
- `scripts/tests/all-migrations-pglite.test.mjs` aplica todas as migrations juntas.
