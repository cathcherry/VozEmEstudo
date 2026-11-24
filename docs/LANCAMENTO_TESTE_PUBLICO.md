# Lançamento do teste público (30–100 participantes)

Runbook do programa de testes: o que **já está feito** no banco de produção, o que **falta** (passos
manuais que dependem das suas contas) e como ligar, acompanhar, fechar e desfazer.

Documentos ligados: [SECURITY_AUDIT_PUBLIC_TESTING.md](SECURITY_AUDIT_PUBLIC_TESTING.md) (auditoria),
[CAPACIDADE_E_CUSTOS.md](CAPACIDADE_E_CUSTOS.md) (custos e tetos), [HOSPEDAGEM.md](HOSPEDAGEM.md)
(serviços, variáveis, domínio).

## 1. Estado em 24/11/2026

| Item                                         | Estado                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Código (branch `claude/keen-shannon-sj3ut5`) | Pronto. Backend 450/450 testes, lint e checagens de navegador passando                                                                                                                                        |
| Supabase **staging**                         | Migrações `20261125090000`, `20261125100000`, `20261125110000` aplicadas; isolamento entre duas contas testado com RLS real                                                                                   |
| Supabase **produção** (`audioestudo`)        | Backup `backup_pre_public_testing_20261124` (64 tabelas + manifesto) → as 3 migrações aplicadas (sha256 conferido) → pós-checagens OK. Dados intactos: 4 contas (md5 dos ids igual), 22 materiais, 32 objetos |
| Programa                                     | **Ligado em 24/11/2026 08:15 UTC**: contas criadas a partir daí são participantes; as 4 contas anteriores ficam como estavam (`apply_to_existing_accounts = false`). Nenhuma administradora cadastrada ainda  |
| Aulas de demonstração                        | Carregadas pela API na primeira inicialização em produção (crase, vacinas, internet)                                                                                                                          |
| Hospedagem (API + worker)                    | **Publicada no Railway** (projeto `voz-em-estudo`, ambiente `production`): API em https://vozemestudo-production.up.railway.app e serviço `worker`, ambos a partir da `main` com o `Dockerfile`               |

## 2. Passos que faltam (na ordem)

### 2.1 Supabase › Authentication (painel)

1. **Confirm email**: ligado.
2. **SMTP próprio** (Resend, Brevo, SES…): o SMTP embutido envia poucas mensagens por hora, pouco
   para 30–100 cadastros.
3. **Leaked password protection**: ligar (Authentication › Policies/Passwords). Se o plano não
   oferecer, mantenha a política de senha do app.
4. **URL Configuration**: Site URL `https://SEU-DOMINIO`; Redirect URLs só
   `https://SEU-DOMINIO/auth-callback.html` e `https://SEU-DOMINIO/recuperar-senha.html`.
5. **Rate limits** de cadastro e login revisados. CAPTCHA (hCaptcha/Turnstile) recomendado, ou
   cadastro só por convite.

### 2.2 Groq: plano

No plano gratuito do Groq, uma chamada com mais de ~8.000 tokens por minuto falha de vez (413), e o
limite diário da organização é de cerca de 200 mil tokens. Os padrões do programa cabem nisso, mas
**o plano Developer é o recomendado** (ver CAPACIDADE_E_CUSTOS.md, “Tetos globais”). Não consegui
ver o plano nem o saldo da conta daqui.

### 2.3 Railway: dois serviços (feito em 24/11/2026)

Configuração real, feita pela API do Railway (o Railway não aceita mais `railway.json` para serviços
novos; tudo fica nas configurações de cada serviço):

- **VozEmEstudo (API):** build pelo `Dockerfile`; início `node backend/src/server.js`; healthcheck
  `/api/health`; domínio `vozemestudo-production.up.railway.app` na porta 3000 (`PORT=3000` fixo,
  senão o domínio aponta para uma porta diferente da do container e responde 502).
- **worker:** o mesmo `Dockerfile`; início `node backend/src/worker.js`; reinício sempre. As
  variáveis referenciam as da API (`${{VozEmEstudo.NOME}}`), inclusive as chaves secretas, que ficam
  só no serviço da API.

Referência original dos passos:

Siga [HOSPEDAGEM.md](HOSPEDAGEM.md) (API + worker, raiz do repositório,
`deploy/railway.api.json` e `deploy/railway.worker.json`), com estas variáveis **nos dois**:

```
NODE_ENV=production
FEATURE_PUBLIC_TESTING=true
# mais as FEATURE_* que você quer abertas, iguais nos dois serviços
```

Só na API:

```
APP_ORIGIN=https://SEU-DOMINIO
TRUST_PROXY=1
CONTENT_SECURITY_POLICY=          # vazio = enforce em produção
DEMO_LESSONS_AUTOSEED=true
```

Nunca defina `MOCK_EXTERNAL_SERVICES` em produção. Mantenha **uma** instância da API (os limites
por minuto ficam em memória). As cotas e os tetos do programa ficam no banco e valem para
qualquer número de instâncias.

Chaves secretas (`SUPABASE_SECRET_KEY`, `ASSEMBLYAI_API_KEY`, `GROQ_API_KEY`) só no painel da
plataforma.

### 2.4 Verificar a publicação

1. `GET /api/health` → `{"ok":true}`.
2. O log da API mostra `API_STARTED`, **sem** `UNSAFE_PRODUCTION_CONFIG`, e
   `DEMO_LESSONS_SEEDED {"inserted":["crase","vacinas","internet"]}` (nas próximas inicializações,
   `unchanged`).
3. `GET /demo-media/crase/audio.mp3` → 200 (áudio).
4. No SQL Editor: `select slug, published from public.demo_lessons order by sort_order;` → 3 linhas.

### 2.5 Cadastrar as administradoras (por UUID, sem adivinhar)

Cada administradora entra no app uma vez. Depois, no SQL Editor (papel `postgres`):

```sql
-- Encontre o UUID pela conta que você controla:
select id, email, created_at from auth.users where email = 'EMAIL-DA-ADMINISTRADORA';

-- Cadastre (repita por pessoa):
insert into public.app_admins (user_id, granted_by, note)
values ('UUID-AQUI', 'nome de quem autorizou', 'equipe do TCC')
on conflict (user_id) do update set revoked_at = null;
```

Revogar: `update public.app_admins set revoked_at = now() where user_id = 'UUID';` (vale em até
30 s). O papel nunca vem do navegador: só desta tabela, lida pelo servidor.

### 2.6 Ligar o programa e definir a turma

```sql
update public.public_testing_config
set enabled = true,
    registration_starts_at = now(),          -- contas criadas a partir daqui são participantes
    registration_ends_at = null,             -- ou uma data para fechar a janela
    apply_to_existing_accounts = false,      -- true: contas antigas também viram participantes
    demo_access_enabled = true
where id = 1;
```

- **Participante**: conta criada dentro da janela (ou qualquer conta, com
  `apply_to_existing_accounts = true`). Limites de `tester_limits`.
- **Administradora**: está em `app_admins` sem `revoked_at`. Limites de `admin_limits`.
- **Legado**: contas antigas fora da janela, sem cotas do programa (só os limites por conta já
  existentes). Com o programa ligado, elas não veem a seção de limites.

Padrões (editáveis em `tester_limits`, `admin_limits`, `global_limits`, `kind_costs`):

| Por participante                                | Limite           |
| ----------------------------------------------- | ---------------- |
| Transcrição (acumulada, medida no servidor)     | 300 s (5 min)    |
| Gravações processadas                           | 3                |
| Resumos / listas de questões                    | 2 / 2            |
| Geração de flashcards / nova sugestão de cartão | 1 / 5            |
| Nova análise de avisos                          | 1                |
| Material integrado                              | 0 (indisponível) |

| Teto global                    | Total           | Dia      | Hora    |
| ------------------------------ | --------------- | -------- | ------- |
| Transcrição                    | 54.000 s (15 h) | 18.000 s | 5.400 s |
| Requisições ao modelo de texto | —               | 800      | 300     |
| Tokens estimados               | —               | 160.000  | 60.000  |
| Transcrições simultâneas       | 2               |          |         |

Exemplo: dobrar os resumos dos participantes:

```sql
update public.public_testing_config
set tester_limits = tester_limits || '{"summary": 4}'::jsonb where id = 1;
```

## 3. Acompanhar

- No app, conta administradora › **Conta › Programa de testes**: participantes, cópias das demos,
  minutos e requisições por hora, dia e total contra os tetos.
- SQL:

```sql
select public.testing_overview_admin();                        -- mesmo resumo, sem identidades
select kind, status, sum(units) from public.usage_ledger group by 1, 2 order by 1, 2;
```

## 4. Fechar ou pausar

- **Fechar novos cadastros na turma**: `update public.public_testing_config set registration_ends_at = now() where id = 1;`
- **Cortar todo gasto com IA na hora**: zere os tetos globais
  (`update public.public_testing_config set global_limits = jsonb_set(jsonb_set(global_limits, '{llm_requests,hour}', '0'), '{transcription_seconds,hour}', '0') where id = 1;`)
  ou pare o worker. Aulas, demos e materiais continuam disponíveis.
- **Encerrar o programa**: `enabled = false` (contas voltam ao regime normal) ou
  `FEATURE_PUBLIC_TESTING=false` nos dois serviços.

## 5. Desfazer (rollback)

1. Primeiro, desligue: `FEATURE_PUBLIC_TESTING=false` e reinicie os serviços.
2. Para remover o programa do banco: `database/rollback/public-testing-rollback.sql`. Remove só os
   objetos do programa e mantém as cópias das demos já abertas como aulas comuns.
3. As migrações de reforço (`20261125090000`, `20261125110000`) só retiram privilégios que o app não
   usa. Não precisam ser desfeitas. Se for preciso, o estado anterior de políticas e privilégios
   está em `backup_pre_public_testing_20261124.storage_policies` e `.table_grants`.
4. Dados: cópia integral das tabelas públicas em `backup_pre_public_testing_20261124` (sem RLS e sem
   acesso pela API; apague o schema ao fim do teste, ver auditoria A-06).

## 6. Pendências fora do código (auditoria)

- A-05: um texto de privacidade e consentimento do participante (controladora, contato, transferência
  internacional, retenção, direitos) e um processo manual de exclusão de conta.
- A-06: apagar os schemas `backup_*` antigos depois de exportá-los.
- A-07: apagar as transcrições na AssemblyAI após o processamento (proposto, não feito).
