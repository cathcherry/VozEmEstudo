# E00 — runbook de staging, backup e reversão

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


**Atualização de 10/10/2026:** staging `cissxpmmjnnpewreuxeo` criado pela usuária, com duas contas fictícias; leitura autorizada. Plano Free, sem backup automático conforme painel verificado pela usuária. Para esse alvo, seguir o complemento [03-manual-staging-backup.md](03-manual-staging-backup.md): backup lógico manual, Auth/permissões/histórico/Storage e ensaio Supabase local sem upgrade. Exportação/restore ainda não executados; nenhuma escrita remota autorizada. Os números do projeto anterior abaixo são históricos, não os deste staging.

**Estado: preparado, execução remota dependente bloqueada.** Em E00 não foi criado staging, não houve dump de dados, restore, migration, rotação, limpeza de mídia ou publicação. O projeto existente conectado foi apenas consultado. Este runbook não autoriza executar as operações de escrita descritas.

## Condições antes de executar

1. Registrar aprovação humana, responsável, referência do projeto de origem e do **alvo isolado**, classificação do ambiente, janela, custo e permissões. O projeto existente `audioestudo` não foi identificado como staging.
2. Resolver D00/D02/D03/D07 em `decisions.md`: padrões/aceite, ambiente, política de backup e setup limpo. Confirmar ferramentas/versões e `--help` local; CLI PostgreSQL/Supabase e Docker não estão instalados no ambiente desta auditoria.
3. Usar credenciais pelo mecanismo protegido da instalação, sem copiar valores ao código, argumentos de shell, logs ou relatório. Guardar conexão/`.pgpass` com permissão restrita fora do projeto; interromper se houver segredo no pacote.
4. Conferir o alvo antes de cada ação de restore, seed, migration ou exclusão. Não utilizar silenciosamente projeto `--linked`, conexão salva de produção ou credencial administrativa para simular usuário final.
5. Manter API/worker desligados no alvo durante restore/seed. O worker reivindica jobs e pode acionar IA; mock de ASR/Groq não torna o banco inofensivo.

## Política proposta, ainda não aprovada

| Decisão             | Proposta operacional                                                                                   | Evidência exigida                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Responsáveis        | Um operador executa; responsável do projeto confirma alvo, escopo e recuperação                        | Nomes/contato registrados de forma privada; não inventados nesta entrega       |
| Momento             | Snapshot verificado antes de qualquer mudança de dados, grants, retenção ou release                    | Identificador, horário UTC, base do código e lista de operações                |
| Frequência/retensão | Definir conforme RPO/RTO e quota/plano; separar snapshots pré-mudança de cópias periódicas             | D03 com valores aprovados; política do provedor consultada                     |
| Guarda              | Destino restrito e cifrado fora do checkout, com cópia independente e checksums                        | Controle de acesso, disponibilidade da chave de recuperação e teste de leitura |
| RPO/RTO             | Medir no ensaio de restore; não assumir zero perda ou duração de poucos minutos                        | Resultado e janela aceitos pelo responsável                                    |
| Reversão            | Janela começa antes da mudança e permanece aberta até testes de restore/integridade/ownership passarem | Responsável decide fechamento; gatilhos abaixo                                 |

## O que precisa ser conservado

| Componente | Conteúdo                                                                                                        | Limitação importante                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Código     | Pacote aprovado/hashes, lockfiles, migrations e contratos                                                       | Snapshot de código não contém dados de contas                                                              |
| Banco      | Schema, enums, constraints, índices, triggers, RLS, grants/default privileges, funções/RPCs, dados e sequências | Um inventário de tabelas não é backup; snapshot pode conter dados privados/segredos internos de Auth/Vault |
| Papéis     | Definições/privilégios necessários, sem imprimir senhas                                                         | Papéis gerenciados do Supabase exigem tratamento compatível; não restaurar roles às cegas                  |
| Storage    | Definição dos buckets/policies, manifest de objetos e **bytes de cada objeto**                                  | Backup do banco contém metadados, não os blobs; paths restaurados podem apontar para arquivos ausentes     |
| Ambiente   | Nomes de variáveis, versão/deploy, configuração Auth/OAuth/redirects, SMTP, limites, ASR/Groq e flags           | Registrar valores secretos somente no cofre aprovado; dump não recompõe todas essas configurações          |
| Navegador  | Dados locais, mediante consentimento e exportação futura                                                        | Não estão no Supabase; não apagar localStorage para testar rollback                                        |

Não considerar `database/migrations/001_initial.sql` um backup de produção. Ele é baseline histórico e **não deve ser reescrito, reaplicado em banco existente ou usado para justificar restore destrutivo**. Migrations futuras serão aditivas e aprovadas; nenhuma será aplicada em E00.

## Inventário e snapshot de schema

Metadados já consultados estão em `evidence/remote-metadata.json` e `effective-access.json`. Para atualizar em ambiente autorizado, usar [audit-metadata.sql](audit-metadata.sql), que contém somente consultas de catálogo/agregados em transação de leitura. A saída não contém linhas de materiais, emails, tokens ou nomes de objetos.

O histórico de migrations retornou vazio. Conferir a existência de `supabase_migrations.schema_migrations` e o histórico de implantação manual com o responsável; ausência de registros não significa schema ausente. Exportar histórico existente de forma protegida, sem inserir registros para mascarar a divergência.

Exemplos de exportação com cliente PostgreSQL compatível, **não executados**, após configurar o serviço libpq `voz-audit` e um diretório protegido externo em `E00_BACKUP_DIR`:

```sh
pg_dump --version
pg_dump --schema-only --no-owner --schema=public --schema=storage --schema=auth --file="$E00_BACKUP_DIR/schema.sql" --dbname="service=voz-audit"
pg_dumpall --roles-only --no-role-passwords --file="$E00_BACKUP_DIR/roles.sql" --database="service=voz-audit"
```

O schema exportado inclui DDL/grants/RPCs desses schemas, mas não dados, objetos globais completos ou configuração externa. Não usar `--no-acl` para o snapshot de permissões. Um dump de roles sem senhas não restaura credenciais; papéis do fornecedor e owners devem ser revisados no plano de restore.

Para dados: escolher backup gerenciado disponível no projeto ou procedimento lógico suportado pelo fornecedor, registrar cobertura e consistência. Um dump PostgreSQL completo pode exigir filtros/revisão de schemas gerenciados antes de restore em outro projeto Supabase. Seguir o guia oficial de [backup e restore via CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), sem improvisar a importação de schemas internos. Não executar dump parcial por RLS sem comparar contagens: o operador de backup deve ter a cobertura aprovada.

Calcular checksum e cifrar os arquivos no destino autorizado. Relatório público guarda nomes genéricos, horários, hashes e contagens, nunca dump, conteúdo de Auth/Vault, connection string ou senha. Diretórios `backups`/`dumps` estão excluídos da distribuição; backup real deve permanecer fora do projeto mesmo assim.

## Inventário e cópia dos objetos

Executar somente após autorização para ler/copiar mídia. Guardar o manifest real em destino privado/cifrado, **não** em `docs/`, PR ou capturas. O inventário de metadados pode começar com esta consulta, cujo resultado não deve ser anexado ao pacote:

```sql
select bucket_id, name, owner_id,
       metadata->>'size' as declared_size,
       metadata->>'mimetype' as mime_type,
       created_at, updated_at
from storage.objects
order by bucket_id, name;
```

Paginar a enumeração se usar SDK/API; listar uma única página não comprova backup completo. Para cada objeto autorizado, copiar os bytes pela API Storage/S3 compatível, registrar tamanho real e SHA-256 no manifest protegido. Preservar caminhos e propriedade necessários às políticas de SELECT/DELETE, não publicar bucket, não substituir objetos em produção e não emitir URLs assinadas em logs.

Comparar objetos referenciados por `audio_files.storage_path`, objetos sem referência e referências sem objeto. Apenas registrar divergências; nenhum órfão será apagado em E00. O estado atual possui uploads temporários e retenções; se o derivado já foi removido pelo fluxo normal, restaurar apenas uma linha antiga não recria seus bytes.

Quota: confirmar limite global, uso, egress, limite por objeto, MIME types e configurações de cache no painel do alvo. O inventário observado de `audios` é privado, 100 MiB por objeto, 14 objetos/34.821.385 bytes declarados; isso não informa a quota do plano.

## Preparar staging e fixtures A/B

Depois de D02 aprovada, criar/selecionar alvo isolado com dados sintéticos. Não copiar gravações privadas nem contas reais por padrão. Configurar localmente a API para o alvo com o template existente; manter secrets fora do pacote e começar com ASR/Groq em mock. Os nomes `MOCK_EXTERNAL_SERVICES`, `SUPABASE_*`, `HF_*` e `GROQ_*` estão no baseline. Mock não simula Auth/Storage/RLS.

Criar duas contas de teste A e B pelo fluxo suportado do staging, registrar IDs reais em arquivo privado e criar um material/derivado WAV curto por conta. A fixture local usa IDs sintéticos e não é um seed executável no remoto. Reaproveitar os testes de mídia para gerar áudio não pessoal e MP4 com cor/senoide; não usar gravações de pessoas.

| Fixture/caso                                 | Resultado esperado                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| A lista acervo; B lista acervo               | Apenas seus próprios materiais                                               |
| A lê/edita/exclui material de B e vice-versa | 404 `NOT_FOUND`; nenhum efeito ou assinatura                                 |
| Material inexistente                         | Mesmo status/código 404, sem revelar propriedade                             |
| A usa `question_id` de B na resposta         | 404; gabarito de terceiro não retornado                                      |
| A lê `job_id`/eventos de B                   | 404                                                                          |
| A registra upload com prefixo de B           | 403 `FORBIDDEN`; sem criação de material                                     |
| A lê próprio material/questão/job            | 200; criação própria 201; enfileiramento próprio 202                         |
| A lista questões próprias                    | Sem `correct_index`/explicação; feedback somente na resposta imediata legada |
| SDK Auth de B tenta assinar caminho de A     | Negado pelas políticas Storage                                               |
| URL de mídia própria                         | Válida antes do TTL; nova requisição sem cache rejeitada depois do TTL       |

Para comandos de escrita (criação, patch, exclusão, seed) usar **somente staging aprovado**; preparar contagens antes/depois e guardar recibos com nomes de cenário/status, sem tokens ou URLs. A suíte local já executa esses cenários sem remoto:

```sh
cd backend
node --test tests/ownership.test.js
```

## Probe remoto de leitura e assinatura, não executado

O comando abaixo é uma referência pronta para execução **somente após autorização explícita de staging**. Guarda evita o projeto existente conhecido e confirma a URL retornada pela API, mas não substitui a classificação humana do alvo. Nomes a configurar por mecanismo privado: `E00_STAGING_READS_APPROVED`, `E00_STAGING_PROJECT_REF`, `E00_STAGING_API_URL`, `E00_STAGING_SUPABASE_URL`, `E00_STAGING_PUBLISHABLE_KEY`, `E00_USER_A_TOKEN`, `E00_USER_B_TOKEN`, `E00_USER_A_ID`, `E00_MATERIAL_A_ID`, `E00_JOB_A_ID`, `E00_STORAGE_A_PATH`. Tokens/paths reais não devem ser anexados ao resultado.

Executar na pasta `backend`, com deps instaladas. Não ativa worker, não insere/edita/exclui dados e não usa chave administrativa. Gera tokens temporários de Storage e faz download apenas da fixture sintética.

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
const read = (name) => { assert(process.env[name], `Missing variable: ${name}`); return process.env[name]; };
try {
  assert.equal(read('E00_STAGING_READS_APPROVED'), 'true');
  const ref = read('E00_STAGING_PROJECT_REF');
  assert.notEqual(ref, 'fxsuagrcfargpejglwtl', 'Existing project is not approved staging');
  const supabaseUrl = new URL(read('E00_STAGING_SUPABASE_URL'));
  assert.equal(supabaseUrl.hostname, `${ref}.supabase.co`);
  assert.equal(supabaseUrl.protocol, 'https:');
  const apiUrl = new URL(read('E00_STAGING_API_URL'));
  assert(apiUrl.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(apiUrl.hostname));
  const key = read('E00_STAGING_PUBLISHABLE_KEY');
  assert(!key.startsWith('sb_secret_'), 'Administrative key prohibited');
  if (!key.startsWith('sb_publishable_')) {
    assert.equal(JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role, 'anon');
  }
  const tokenA = read('E00_USER_A_TOKEN'), tokenB = read('E00_USER_B_TOKEN');
  const get = (path, token) => fetch(new URL(path, apiUrl), { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  const config = await (await get('/api/config')).json();
  assert.equal(new URL(config.supabaseUrl).hostname, supabaseUrl.hostname);
  assert.equal((await get(`/api/materials/${read('E00_MATERIAL_A_ID')}`, tokenA)).status, 200);
  assert.equal((await get(`/api/materials/${read('E00_MATERIAL_A_ID')}`, tokenB)).status, 404);
  assert.equal((await get(`/api/jobs/${read('E00_JOB_A_ID')}`, tokenB)).status, 404);
  const client = (token) => createClient(supabaseUrl.href, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const a = client(tokenA), b = client(tokenB), path = read('E00_STORAGE_A_PATH');
  const identity = await a.auth.getUser(tokenA);
  assert.equal(identity.data.user?.id, read('E00_USER_A_ID'));
  const denied = await b.storage.from('audios').createSignedUrl(path, 30);
  assert(denied.error, 'Foreign signing must be denied');
  const live = await a.storage.from('audios').createSignedUrl(path, 30);
  assert(!live.error && live.data.signedUrl);
  const liveUrl = new URL(live.data.signedUrl);
  liveUrl.searchParams.set('cacheNonce', randomUUID());
  assert.equal((await fetch(liveUrl, { cache: 'no-store' })).status, 200);
  const cold = await a.storage.from('audios').createSignedUrl(path, 10);
  assert(!cold.error && cold.data.signedUrl);
  await setTimeout(12000);
  const expiredUrl = new URL(cold.data.signedUrl);
  expiredUrl.searchParams.set('cacheNonce', randomUUID());
  const expired = await fetch(expiredUrl, { cache: 'no-store' });
  const body = await expired.json();
  assert(expired.status >= 400 && expired.status < 500);
  assert(body.code === 'InvalidJWT' || /expired/i.test(String(body.message || body.error || '')));
  console.log(JSON.stringify({ passed: true, foreignMaterialStatus: 404, foreignJobStatus: 404, expiredUrlStatus: expired.status }));
} catch {
  console.error('Staging probe failed or prerequisites are missing; inspect privately, without printing credentials or URLs.');
  process.exitCode = 1;
}
NODE
```

Este probe valida expiração do serviço com TTL curto; o teste local da API verifica delegação de **600 segundos**. Não confundir os dois. Fazer também um ensaio da URL real do player após seu TTL em duas etapas, sem manter ferramenta bloqueada dez minutos. Resposta servida por cache depois da expiração não prova falha de validação na origem: TTL do token e cache são independentes. A documentação de [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn) descreve esse comportamento e o `cacheNonce`; registrar status/cache sem copiar a URL. Não apagar objeto para “forçar” o teste de expiração.

## Ensaio de restore e janela de reversão

1. Confirmar alvo descartável, snapshot protegido e checksum. Restore/seed são ações de escrita e permanecem bloqueados até aprovação; não restaurar sobre o projeto conectado nesta E00.
2. Restaurar pelo procedimento suportado, com API/worker parados. Rever roles gerenciadas, schema/policies/grants/RPCs/default privileges e configurações externas antes de ligar serviços. Não executar 001 por cima do schema restaurado.
3. Restaurar blobs no alvo autorizado, preservando mapeamento/propriedade. Comparar manifest, tamanhos reais e hashes; ausência de blob impede considerar restore completo.
4. Comparar contagens por tabela, constraints/FKs, revisões/snapshots, versões atuais, lotes e jobs com o snapshot. Diferenças justificadas devem ser registradas; não mascarar falhas apagando registros.
5. Testar login real A/B, RLS com seus JWTs, ownership HTTP, assinaturas/expiração e fluxo de fixture ASR/Groq primeiro em mock. Real IA/OAuth exige autorização/configuração específica; nenhuma chamada paga é implícita.
6. Medir duração de recuperação, verificar RPO/RTO aprovados e obter confirmação humana antes de fechar a janela. Guardar só resultados/status/hashes no relatório público.

Gatilhos para suspender avanço e reverter: contagens inexplicadas, órfãos/referências sem blob, owner incorreto, grants/RLS diferentes, gabarito visível indevidamente, dupla revisão/versão atual, falha de login ou segredo no artefato.

Rollback desta E00 é **somente local**: recuperar a revisão aprovada 7 do pacote/hashes e reaplicar apenas alterações aceitas, conservando `.env` da instalação e dados locais/de usuário. Nenhum rollback SQL é necessário porque não houve migration/escrita remota. Não apagar os arquivos criados nesta entrega para simular reversão; usar outra cópia de trabalho. Rollback futuro de feature deve preservar tabelas aditivas e desligar apenas flags que realmente existirem; elas ainda não existem na 0.3.1.

## Verificação manual do Space ASR

Responsável confirma `HF_ASR_SPACE_ID`, status no painel do Space, versão Gradio, endpoint em Use via API, campos/tarefa, tipo de resposta e segmentos. Conferir permissões/quota de `HF_TOKEN` sem publicar valor. Com autorização, usar fixture curta não pessoal e registrar duração/status/modelo, não o áudio real ou token. Se houver somente texto, confirmar fallback de segmento único; não declarar qualidade/sincronismo a partir desse fallback. Dependências Python/modelo precisam ser reproduzidas em E01.

## Checklist de execução

- [x] Código vigente e hashes preservados; pacote anterior auditado.
- [x] Metadados RLS/grants/RPCs/bucket/extensões e contagens consultados sem escrita.
- [x] Fixture local A/B e testes executados; auditor de distribuição testado.
- [x] Procedimento de snapshot/Storage/restore/rollback documentado.
- [ ] Staging identificado e explicitamente autorizado.
- [ ] Backup real completo, protegido, com checksums e cobertura validada.
- [ ] Restore completo ensaiado e RPO/RTO/janela aprovados.
- [ ] A/B, RLS, assinatura e expiração executados no alvo real.
- [ ] Responsável confirmou exposição histórica/rotação quando aplicável.

Referências primárias consultadas: [backup Supabase](https://supabase.com/docs/guides/platform/backups), [pg_dump 17](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_dumpall 17](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [libpq service file](https://www.postgresql.org/docs/17/libpq-pgservice.html). Os comandos de dump/probe acima não foram executados remotamente nesta entrega.
