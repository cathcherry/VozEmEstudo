# Backup lógico manual do staging — plano Free

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


Atualizado em 10/10/2026. **Procedimento preparado; backup e restore ainda não executados. G0a/G0b/G1 não aprovados e E03 não iniciada.** Esta preparação autoriza somente leitura de `cissxpmmjnnpewreuxeo`. Os comandos de instalação, inicialização local e restauração abaixo são referências para execução acompanhada posterior. Nenhuma migration, permissão ou configuração remota foi alterada.

## Próxima ação pessoal — somente esta agora

No seu computador, abra o terminal — PowerShell, se usar Windows — e execute:

```sh
docker version
```

Informe apenas se apareceram as seções **Client e Server**, se o comando não foi reconhecido ou se apareceu erro de conexão. Não envie capturas de configurações, senhas ou chaves. Essa verificação não modifica o banco. Depois orientaremos uma única próxima ação conforme o resultado e o sistema operacional.

## 1. Estado real e fonte utilizada

Fonte: `AudioEstudo_VozEmEstudo.zip`, revisão 16, SHA-256 `7406e810b06bf3e722cbf1d648c14b8518446e677e670c6d8bb5e2a32306a572`, 368 arquivos. Sem Git/HEAD: ambos os comandos de identificação Git retornaram 128. O pacote contém as mudanças E00/E01/E02; não foi retomado o ZIP histórico de 07/10. A inspeção atual usa somente o projeto de staging.

| Verificação de leitura           | Resultado em 10/10/2026                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Identidade                       | `voz-em-estudo-staging`, ref exato `cissxpmmjnnpewreuxeo`, `ACTIVE_HEALTHY`        |
| API / host direto                | `https://cissxpmmjnnpewreuxeo.supabase.co` / `db.cissxpmmjnnpewreuxeo.supabase.co` |
| PostgreSQL                       | 17.11; metadados da plataforma 17.11.0.003                                         |
| Tabelas da aplicação em `public` | 0; existe a função da plataforma `rls_auto_enable()`                               |
| Auth                             | 2 usuários, 2 identidades; 0 sessões e 0 refresh tokens                            |
| Storage                          | 0 buckets, 0 objetos, 0 policies; nenhum byte a copiar neste snapshot              |
| Histórico da aplicação           | Schema `supabase_migrations` e ledger ausentes                                     |
| Vault                            | Extensão instalada; 0 registros em `vault.secrets`                                 |
| Plano                            | Free e sem backups automáticos, conforme verificação pessoal da usuária            |
| Ferramentas deste executor       | Sem `psql`, `pg_dump`, `pg_dumpall`, `pg_restore`, Docker, Podman e CLI Supabase   |

O inventário executável [staging-backup-inventory.sql](../../database/checks/staging-backup-inventory.sql) contém apenas SELECT. Foi executado com sucesso no staging: 344 colunas, 36 relações, 24 funções, 24 entradas de default privileges e 7 event triggers inventariados, sem linhas de contas ou conteúdo de mídia. A conexão do conector não é imposta como read-only pelo servidor (`transaction_read_only=off`); somente consultas SELECT foram enviadas. Não declarar uma conta de leitura restrita que não existe. A rota de exportação PostgreSQL abaixo acrescenta proteção de leitura por sessão.

As migrations `001_initial.sql` e `20261009101846_academic_review.sql` continuam intactas e **não aplicadas no staging**. O backup do estado vazio não instala o produto nem valida concorrência E02. Após futura instalação/fixtures autorizadas será necessário novo snapshot e outro ensaio com materiais, revisões, jobs, avisos e mídia.

## 2. Como faremos o backup

Usaremos a CLI oficial do Supabase para os arquivos portáveis de roles, schema e dados. Acrescentaremos um arquivo PostgreSQL de recuperação, o inventário de segurança e o DDL gerenciado para conferir o que a filtragem da CLI omitiu. O arquivo de recuperação é uma referência completa dos schemas selecionados, não uma ordem para substituir tabelas internas do Supabase.

Todos os arquivos reais devem ficar em pasta privada **fora do projeto**, em disco/pasta cifrada, com acesso restrito e cópia independente cifrada. Não anexar dump de Auth ao chat, ZIP do projeto, PR, documentação ou capturas. Hashes de senha, tokens e metadados de Auth são sensíveis mesmo para contas fictícias. Registrar somente contagens, checksums de arquivos, versões, horários e resultados no relatório compartilhável.

| Arquivo privado / componente                    | Cobertura e conferência                                                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles.sql`                                     | Roles portáveis pela CLI; revisar atributos e memberships antes do restore                                                                                                  |
| `schema.sql`                                    | Schema de aplicação, enums, índices, constraints, triggers e RPCs conforme exportação; conferir ACLs/default privileges, sem pressupor que a CLI reproduza todos            |
| `data.sql`                                      | Dados, sequências e registros Auth suportados pela CLI; conferir explicitamente usuários e identidades, tabelas relacionadas e contagens                                    |
| `recovery-selected.dump`                        | DDL, owners, ACLs e dados de `public`, `auth`, `storage`, `extensions`, `vault` e ledger quando existir, em um snapshot PostgreSQL consistente; sem `--no-acl`/`--no-owner` |
| `roles-unfiltered.sql`                          | Roles/memberships como referência, **sem senhas de roles**; não importar roles reservadas às cegas                                                                          |
| `managed-schemas.sql`                           | DDL original de Auth/Storage/extensões/Vault; referência para customizações, não importação integral sobre serviços gerenciados                                             |
| `inventory-before.json`, `inventory-after.json` | Colunas, owners, RLS, ACLs, default privileges por owner, funções/event triggers/extensões e contagens; comparação com a restauração                                        |
| `history_schema.sql`, `history_data.sql`        | Ledger real, somente quando existir. Agora registrar `migration_history: absent`; não criar nem reparar histórico para completar o backup                                   |
| `storage/` e manifest                           | Bytes de cada objeto e paths/bucket/propriedade/metadata/tamanho/SHA-256. Agora manifest vazio documentado; não alegar teste de recuperação de mídia                        |
| `configuration.md` privado                      | Site URL e redirects, nomes de variáveis, versões e configurações necessárias; valores secretos somente no cofre pessoal                                                    |
| `manifest.json` e checksums                     | Ref exato, UTC, ferramenta/imagens/digests, schema coverage, contagens, início/fim, exceções e SHA-256 de cada arquivo                                                      |

Conservar o código e as migrations aprovadas separadamente do dump. `001_initial.sql` não é backup e não deve ser reescrita nem executada sobre schema restaurado. Registros internos `auth.schema_migrations`/`storage.migrations` descrevem versões dos serviços; não os confundir com o ledger da aplicação nem sobrescrever os ledgers de serviços locais mais novos.

Antes da exportação, combinar uma janela sem uploads, edições, logins ou workers de teste. Isso evita divergência entre exports separados e Storage. Cada `pg_dump` tem snapshot próprio; três dumps independentes não compartilham automaticamente a mesma fotografia. Se não for possível interromper atividades, parar e preparar snapshot compartilhado/estratégia de consistência; não afirmar consistência por comparar somente tamanhos.

Não criar usuário de backup, alterar grants, desligar RLS ou resetar senha remota nesta fase. Se a credencial existente não puder ler toda a cobertura necessária, registrar o bloqueio. Um dump filtrado por RLS não equivale a backup completo.

## 3. Ferramentas: instalação futura e alternativas seguras

A preferência é Docker no computador pessoal: a CLI executa `pg_dump` em container e o cliente `psql` pode ser usado no container PostgreSQL local. Não é preciso instalar um servidor PostgreSQL do sistema nem alterar dependências do Voz em Estudo.

Para uso pessoal/educacional, Docker Desktop tem modalidade gratuita. Instalar apenas pelo [site oficial](https://docs.docker.com/desktop/setup/install/); no Linux, Docker Engine é alternativa. Usar containers Linux. Não executar instaladores de terceiros ou `curl | sh`. A instalação não foi executada nem solicitada como ação pessoal neste fechamento.

Com Docker funcional, preparar uma pasta de ferramentas separada do projeto. Referência Bash para Linux/macOS/WSL; no PowerShell adaptaremos depois de saber o sistema, sem pedir que a usuária traduza comandos:

```sh
mkdir voz-backup-tools
cd voz-backup-tools
npm init -y
npm install --save-dev --save-exact supabase@2.120.0
npx --no-install supabase --version
npx --no-install supabase --help
npx --no-install supabase db --help
npx --no-install supabase db dump --help
npx --no-install supabase init --help
npx --no-install supabase start --help
```

Versão 2.120.0 e integridade do pacote foram confirmadas por consulta de metadados npm, sem instalação. Preservar o lockfile dessa pasta e usar `npm ci` para repetições. Node 24.19/npm 11.9 são a referência já testada do projeto. Não usar instalação global de Supabase por npm. **Os comandos CLI não foram executados aqui**; após instalar, conferir cada flag no `--help`. Se a versão instalada divergir, parar e revisar antes da conexão.

Para clientes nativos, utilizar PostgreSQL **17** de origem oficial. Ubuntu 24.04 pode oferecer 16 por padrão, insuficiente para dump de servidor 17; verificar repositório oficial PostgreSQL antes de instalar `postgresql-client-17`. Windows/macOS: [downloads oficiais](https://www.postgresql.org/download/). A alternativa de container evita essa instalação:

```sh
docker run --rm --entrypoint pg_dump postgres:17 --version
docker run --rm --entrypoint psql postgres:17 --version
docker run --rm --entrypoint pg_restore postgres:17 --version
docker image inspect postgres:17 --format '{{index .RepoDigests 0}}'
```

Esses comandos baixam uma imagem se ausente e estão preparados, não executados. Registrar o digest obtido e reutilizá-lo no ensaio. A CLI pode usar outra imagem Supabase PostgreSQL; verificar também sua major e versões dos serviços. Não confiar no rótulo `latest` ou em texto antigo que cita PostgreSQL 15 como padrão. O changelog recente mudou o padrão self-hosted para 17; o destino deve demonstrar major 17 e compatibilidade real de Auth/Storage.

## 4. Conexão privada e comandos de leitura/exportação

Quando chegar essa etapa, abrir **o staging** no Dashboard, conferir o ref e clicar **Connect → Session pooler**, porta **5432**. Não usar transaction pooler 6543. O hostname exato deve vir do painel; região do projeto não autoriza adivinhar o hostname do pooler. Usar a senha já guardada no gerenciador pessoal. **Não clicar Reset database password** nem publicar a connection string. A senha do banco é diferente da chave da API e das senhas de A/B.

Preparar privadamente `E00_PRIVATE_DIR` e `E00_BACKUP_DIR`, ambos absolutos, externos ao checkout, com acesso restrito. Para clientes PostgreSQL, criar o serviço `voz-staging-backup` em `staging.pg_service.conf`, com host obtido do painel, port 5432, dbname postgres, user **postgres.cissxpmmjnnpewreuxeo**, TLS e application_name identificável. Guardar senha em `staging.pgpass`, arquivo restrito (0600 em Unix), não no serviço nem nos argumentos. Formato do passfile conforme [documentação libpq](https://www.postgresql.org/docs/17/libpq-pgpass.html), escapando `:` e `\` quando necessário. No Windows restringir ACL ao usuário e usar o formato/caminho compatível com o cliente escolhido.

Se usar conexão direta, exigir host `db.cissxpmmjnnpewreuxeo.supabase.co` e o usuário indicado no Connect. No pooler compartilhado, host sozinho não identifica o projeto: o sufixo **cissxpmmjnnpewreuxeo** do usuário é obrigatório. Usar TLS (`sslmode=require` no mínimo); preferir `verify-full` com CA correta configurada. Não desabilitar TLS ou validação para contornar erro de conexão.

Referência Bash do cliente em container: conferir os paths antes de executar. O diretório privado é montado somente para leitura. A variável `PGOPTIONS` limita as transações **dessa conexão**, sem ALTER no remoto:

```sh
e00_pg() {
  local executable="$1"
  shift
  docker run --rm --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$E00_PRIVATE_DIR,target=/run/private,readonly" \
    --mount "type=bind,source=$E00_BACKUP_DIR,target=/backup" \
    --env PGSERVICEFILE=/run/private/staging.pg_service.conf \
    --env PGPASSFILE=/run/private/staging.pgpass \
    --env 'PGOPTIONS=-c default_transaction_read_only=on' \
    --entrypoint "$executable" postgres:17 "$@"
}

e00_pg psql --no-psqlrc --no-password --dbname='service=voz-staging-backup' \
  --set=ON_ERROR_STOP=1 --command="select current_setting('server_version'), current_setting('transaction_read_only');"
```

Esperado: PostgreSQL 17 e `transaction_read_only=on`. Parar se credencial, host/user/ref, TLS ou cobertura divergirem. Copiar o SQL de inventário para a pasta privada e executar antes/depois da exportação:

```sh
e00_pg psql --no-psqlrc --no-password --dbname='service=voz-staging-backup' \
  --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --file=/run/private/staging-backup-inventory.sql > "$E00_BACKUP_DIR/inventory-before.json"

e00_pg pg_dump --no-password --dbname='service=voz-staging-backup' \
  --format=custom --schema=public --schema=auth --schema=storage \
  --schema=extensions --schema=vault --file=/backup/recovery-selected.dump

e00_pg pg_dumpall --no-password --database='service=voz-staging-backup' \
  --roles-only --no-role-passwords --file=/backup/roles-unfiltered.sql

e00_pg pg_dump --no-password --dbname='service=voz-staging-backup' \
  --schema-only --schema=auth --schema=storage --schema=extensions --schema=vault \
  --file=/backup/managed-schemas.sql

e00_pg pg_restore --list /backup/recovery-selected.dump > "$E00_BACKUP_DIR/archive-contents.txt"
```

Se o ledger passar a existir, acrescentar `--schema=supabase_migrations` ao arquivo de recuperação e os dois exports de histórico abaixo. Outros schemas próprios descobertos no inventário também precisam de cobertura explícita. O nome `recovery-selected` descreve a cobertura; não alegar backup físico completo do cluster. Views, funções e extension definitions não garantem por si só todos os dados externos de uma extensão.

Para o trio portável oficial, configurar `E00_SOURCE_URL` **sem senha**, com user/ref/host/5432 conferidos e TLS. A senha deve ser fornecida privadamente por prompt oculto/cofre em `SUPABASE_DB_PASSWORD`, removida da sessão ao terminar; nunca usar `--password VALOR`, URL com senha, histórico de terminal ou modo debug. O uso de senha por ambiente deve ser confirmado com a CLI instalada para o caminho `--db-url`; se essa combinação não for aceita, parar para adaptar a autenticação, sem inserir a senha no argumento.

```sh
npx --no-install supabase db dump --db-url "$E00_SOURCE_URL" \
  --role-only --file "$E00_BACKUP_DIR/roles.sql"
npx --no-install supabase db dump --db-url "$E00_SOURCE_URL" \
  --file "$E00_BACKUP_DIR/schema.sql"
npx --no-install supabase db dump --db-url "$E00_SOURCE_URL" \
  --data-only --use-copy --file "$E00_BACKUP_DIR/data.sql"
```

Neste estágio não foram encontrados dados em Storage. Os filtros oficiais de tabelas vetoriais só podem ser acrescentados após confirmar que elas estão vazias ou preparar backup independente; nunca excluir dados existentes para fazer o dump passar. O default schema dump da CLI exclui Auth/Storage/extensões gerenciadas; conferir os blocos de dados Auth, políticas/customizações e a cobertura do arquivo PostgreSQL complementar antes de assinar o manifest.

Somente se `supabase_migrations` existir:

```sh
npx --no-install supabase db dump --db-url "$E00_SOURCE_URL" \
  --schema supabase_migrations --file "$E00_BACKUP_DIR/history_schema.sql"
npx --no-install supabase db dump --db-url "$E00_SOURCE_URL" \
  --schema supabase_migrations --data-only --use-copy \
  --file "$E00_BACKUP_DIR/history_data.sql"
```

Não usar `supabase link`, `db pull`, `db push`, `migration repair`, `db reset --linked` nem `--db-url` em comando de restauração. Eles não são necessários para esta leitura e alguns podem escrever histórico/roles ou apagar dados. Encerrar com inventário posterior, contagens exatas por tabela coberta, códigos de saída e checksums. Falha de permissão/arquivo incompleto bloqueia o aceite; não acrescentar GRANT para contorná-la.

## 5. Auth, configurações e Storage

Conferir no dump usuários/identidades: UUIDs, vínculo por `user_id`, password hash, confirmação de email, metadata e timestamps. Conservar dados de tabelas relacionadas presentes: MFA, SSO/OAuth, sessões/refresh tokens e demais referências que contenham registros. Não selecionar só `auth.users` e abandonar FKs. Inspecionar tudo privadamente; relatório público contém apenas igualdade/contagens. No estado atual são duas identidades de email, sem sessões/refresh tokens; no destino usaremos novo login de A/B e tokens locais.

JWTs/keys emitidos pelo staging não devem ser reutilizados como configuração do destino local. Dump não recompõe Google/GitHub, SMTP, redirects, settings do projeto ou todos os segredos externos. Para este ensaio: email/senha fictícios, Site URL `http://localhost:3000`, redirect `http://localhost:3000/auth-callback.html`, sem OAuth/SMTP remoto/IA. Não alterar staging para isso. Vault vazio dispensa transferência de conteúdo agora; se aparecerem dados cifrados, bloquear o restore correspondente até um plano privado de chaves de recuperação, sem extrair chaves no chat.

Quando existirem arquivos, preparar uma lista privada completa por bucket/path via SQL ou API paginada e download autenticado **somente do staging**. Para cada objeto guardar bytes, tamanho real, SHA-256, owner/owner_id, MIME/cache/metadata, bucket e path. Ler/download não exige criar URL pública nem copiar a chave administrativa para o código. Se necessária, a chave do staging fica no cofre/variável privada e o script impõe URL/ref fixos; essa preparação não solicita essa chave.

Na recuperação, preservar bytes e propriedade é obrigatório. Um upload como administrador pode mudar `owner_id`, UUID/version e timestamps: não considerar equivalente sem reconciliar metadata **somente no destino local autorizado** e testar RLS A/B. Não restaurar `storage.objects` e declarar sucesso sem os blobs, nem subir blobs por cima de metadados já copiados sem plano para conflitos. O procedimento de cópia e reconciliação depende do Storage local escolhido e deverá ser fechado antes do primeiro snapshot com mídia; hoje essa etapa é N/A por contagem zero, não um teste aprovado de Storage. Comparar também referências `audio_files.storage_path` após a aplicação existir. URLs assinadas antigas não são backups.

## 6. Como testaremos a restauração sem outro projeto pago

Criar, depois da autorização de execução local, uma **pasta nova** `voz-e02-restore`, sem migrations/seed do produto e sem link remoto. Usar Supabase local via CLI/Docker. Não copiar `.env` do staging. Preparar `supabase init`, `supabase/config.toml` com `project_id = "voz-e02-restore"`, `db.major_version = 17`, seed desativado e Auth/Storage locais. Confirmar essas chaves no `--help`/referência da versão instalada antes de `supabase start`. Não executar `db reset` para iniciar o ensaio.

A máquina precisa suportar os serviços locais; a documentação recomenda cerca de 7 GB de RAM para a stack completa. Se houver limitação, reduzir somente serviços opcionais com flags verificadas, mantendo PostgreSQL/Auth/Storage para os respectivos testes. Usar firewall/portas restritas à máquina; conferir bindings do Docker, sem túnel público ou port forwarding. Containers e imagens ocupam disco/RAM local, mas não criam projeto, branch ou cobrança adicional no Supabase. Docker Desktop é gratuito para o uso pessoal/educacional informado.

Primeiro registrar versões/digests e comparar o inventário de colunas locais com o staging. O mesmo major PostgreSQL **não garante** compatibilidade de Auth/Storage. Há colunas recentes como `auth.sessions.refresh_token_hmac_key`, `auth.sessions.oauth_client_id` e `storage.buckets.versioning_status`. Parar diante de tabela/coluna/extensão ausente; ajustar a versão **local**, mantendo o backup original intacto. Não cortar blocos COPY ou dados para obter saída verde.

A importação só acontece depois de revisar roles, owners, event triggers, customizações gerenciadas e ACLs/default privileges. O target pode herdar grants mais amplos que a origem: reproduzir as permissões originais no ambiente local e comparar acesso efetivo por role/coluna. Separar a correção E02-009 do restore fiel. Não executar GRANT/ALTER no staging nesta preparação.

Preparar um `restore-bundle.sql` privado e revisado, com esta ordem: ajustes **locais** de defaults/roles necessários; schema de aplicação; customizações Auth/Storage identificadas; dados com `SET LOCAL session_replication_role = replica`; histórico real da aplicação quando presente; retorno a `origin`; ACLs/owners finais conforme inventário. Isso desativa triggers durante importação, portanto validar FKs/invariantes depois; sucesso do psql sozinho não prova integridade. O bundle não instala 001/E02 e não contém conexão remota. Nunca sobrescrever tabelas/ledgers internos locais com o DDL gerenciado completo.

Modelo de importação **somente local**, ainda não executado; o container deve ser criado pela stack com o project_id acima e conferido por `docker inspect` antes. A conexão via socket dentro do container impede usar um hostname remoto como destino:

```sh
docker inspect supabase_db_voz-e02-restore --format '{{.Name}} {{.Config.Image}}'
docker exec supabase_db_voz-e02-restore psql --no-psqlrc \
  --username postgres --dbname postgres \
  --set=ON_ERROR_STOP=1 --command="select current_setting('server_version');"

docker exec -i supabase_db_voz-e02-restore psql --no-psqlrc \
  --username postgres --dbname postgres \
  --set=ON_ERROR_STOP=1 --single-transaction --file=- \
  < "$E00_BACKUP_DIR/restore-bundle.sql"
```

Verificar autenticação local privadamente se a imagem exigir senha; não reutilizar senha do staging. Falha interrompe e reverte essa transação local. Não apagar backup nem tentar de novo sobre estado parcial sem investigar. O arquivo `recovery-selected.dump` serve para inspeção/recuperação dirigida com lista de objetos revisada, sem restore bruto de schemas gerenciados, `--clean` ou destino cloud.

### Critérios observáveis do ensaio

| Prova              | Critério para aprovar                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cobertura/arquivos | Todos os exports previstos terminam com código 0; checksums conferem depois de copiar/decifrar; omissões explicitadas e aceitas                                       |
| Dados              | Contagens exatas por tabela e IDs/FKs preservados; usuários = 2 e identidades = 2 neste snapshot; comparar UUIDs/hashes de senha/metadata privadamente, sem os exibir |
| Segurança          | Owners/memberships/grants por tabela e coluna/defaults/RLS/policies/RPCs equivalentes para o domínio restaurado; nenhuma ampliação silenciosa                         |
| Auth               | Login local das duas contas originais com senhas fictícias conhecidas, mesmo UUID e JWT local; sem recriar usuários para mascarar falha de restore                    |
| Histórico          | Ausência do ledger preservada agora; quando existir, versões/SQL/checksums conservados e nenhum histórico inventado                                                   |
| Storage            | Agora buckets/objetos = 0 documentados; quando houver mídia, bytes e hashes/propriedade iguais, download próprio, negação cruzada e TTL testados                      |
| Aplicação E02      | Neste snapshot vazio, N/A. Depois de instalar/semear com autorização, repetir backup/restore e provas de revisões, snapshots, avisos, jobs, lotes e acesso A/B        |
| Recuperação        | Registrar início/fim UTC, duração real, perda admissível/último snapshot (RPO), tempo de recuperação (RTO), operador e aceite; não prometer zero perda/PITR           |

Somente após comparações pré-login guardar o resultado: o login modifica sessões/timestamps **no alvo local** e essas diferenças devem ser justificadas. Não iniciar agora os runners `staging-academic-check.mjs`/`staging-concurrency.py`: eles criam registros e exigem futura autorização específica. Não confundir ensaio local com teste real de Auth/RLS/Storage no staging.

Conservar o ambiente descartável até revisar evidências. Depois, remoção limitada aos containers/volumes de `voz-e02-restore`, mediante decisão de encerramento; não usar `docker system prune`, não remover backups e não fazer reset remoto. Reversão cloud continua sem autorização.

## 7. E02-009 e gates

O defeito E02-009 não é resolvido por backup. O default ACL de tabelas criadas por `postgres` neste staging concede a `authenticated` `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), sem SELECT. Policies E02 consultam `materials` e, se a base for instalada com esses defaults, reproduzem 42501 até para o proprietário. Defaults de `supabase_admin` diferem; preservar creator/owner é parte do ensaio.

A proposta existente `e02-policy-parent-select.sql` concede SELECT da tabela inteira e foi testada apenas em fixture local. Avaliar, antes da autorização, uma migration aditiva mais restrita com SELECT nas colunas `id` e `user_id`, se suficiente para as policies e o contrato atual. Essa alternativa ainda não foi implementada/testada e **não está autorizada**. Não conceder acesso a `questions`, gabaritos ou `anon` por inferência. Após futura correção aprovada: A lê suas três tabelas E02, B não lê as de A, API mantém negação cruzada e testes conferem grants de coluna. O restore deve reproduzir primeiro os ACLs originais; E02-009 só pode ser exercitado quando base/E02 forem instaladas em alvo autorizado. Testar a correção é uma etapa separada.

| Ação                                                               | Situação/autorização                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Inspeção de projeto, catálogos e contagens                         | Executada somente no staging informado, sem DDL/DML                                                       |
| Preparar docs/SQL/comandos, conferir fonte e ferramentas           | Executado localmente; produto/migrations intactos                                                         |
| Instalar Docker/CLI/clientes no computador                         | Não executado; próxima orientação depende de `docker version`                                             |
| Exportar backup real                                               | Leitura permitida no staging, mas falta conexão privada/ferramentas/destino protegido; não executado      |
| Criar stack e restaurar localmente                                 | Procedimento preparado; escrita limitada ao alvo descartável, a acompanhar depois da confirmação do plano |
| Instalar base/E02, corrigir ACLs, fixtures/concorrência no staging | Sem autorização; não executado                                                                            |
| Produção, upgrade, publicação, E03                                 | Fora do escopo e não executados                                                                           |

Para G0a, esta entrega resolve a escolha de **procedimento manual no Free**, não a prova de backup/restore nem as decisões anteriores de segurança. G0b conserva pendências de CI/ferramentas/desvios documentados. G1 continua bloqueado por migration/rollout/grants autorizados, concorrência nativa, RLS/Auth/Storage A/B reais, restauração com fixtures E02 e demais critérios de [gates-readiness.md](gates-readiness.md). Não marcar gates concluídos a partir desta preparação.

## Referências oficiais verificadas

- [Supabase — backup/restore via CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
- [Supabase — recuperação em instância própria e limites de Auth](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
- [CLI — instalação](https://supabase.com/docs/guides/local-development/cli/getting-started), [configuração](https://supabase.com/docs/guides/local-development/cli/config) e [db dump](https://supabase.com/docs/reference/cli/supabase-db-dump).
- [PostgreSQL 17 — pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [serviço libpq](https://www.postgresql.org/docs/17/libpq-pgservice.html), [passfile](https://www.postgresql.org/docs/17/libpq-pgpass.html).
- [Docker — instalação Windows e condições gratuitas](https://docs.docker.com/desktop/setup/install/windows-install/).
- [Supabase — mudança do padrão self-hosted para PG17](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change) e [PG17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

Os procedimentos anteriores E00/E02 ficam preservados como histórico. Para este staging Free, este documento complementa e atualiza os exemplos antigos; estes não autorizam consultar/exportar produção ou restaurar schemas internos às cegas.
