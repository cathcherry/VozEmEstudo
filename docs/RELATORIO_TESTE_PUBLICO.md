# Relatório: versão de testes públicos controlados

Data: 24/11/2026. Branch `claude/keen-shannon-sj3ut5`. Runbook operacional:
[LANCAMENTO_TESTE_PUBLICO.md](LANCAMENTO_TESTE_PUBLICO.md). Auditoria:
[SECURITY_AUDIT_PUBLIC_TESTING.md](SECURITY_AUDIT_PUBLIC_TESTING.md). Custos:
[CAPACIDADE_E_CUSTOS.md](CAPACIDADE_E_CUSTOS.md).

## 1. URL publicada

**Nenhuma.** A API e o worker não estão hospedados: publicar exige as suas contas e chaves (Railway,
AssemblyAI, Groq), que não estão disponíveis nesta sessão. Não divulgue nenhum endereço antes de
seguir as seções 2.1 a 2.4 do runbook.

## 2. Commit

Código pronto para publicar: o último commit de `claude/keen-shannon-sj3ut5` (ver `git log -1`). O
banco de produção recebeu as migrações do commit `57a10c08b10493c816b31ecf3b7427865e73fc2d`
(conteúdo idêntico ao do branch atual).

## 3. Avaliação GO/NO-GO

- **Banco de produção e código: GO.** Nenhum achado crítico. Os achados altos de código foram
  corrigidos, as migrações foram aplicadas com backup e as pós-checagens passaram.
- **Divulgação aos participantes: NO-GO até cumprir 5 condições.** Todas dependem do seu acesso:
  1. Publicar com `NODE_ENV=production`, `APP_ORIGIN` https, sem serviços simulados, uma instância
     da API, sem `UNSAFE_PRODUCTION_CONFIG` no log.
  2. Supabase Auth: confirmação de e-mail, SMTP próprio, proteção de senhas vazadas, redirect URLs
     restritas e CAPTCHA (ou cadastro por convite).
  3. Groq no plano Developer, ou aceitar a capacidade do gratuito (item 18).
  4. Texto de privacidade e consentimento do participante, com processo manual de exclusão.
  5. Cadastrar as administradoras e ligar o programa (runbook 2.5 e 2.6).

## 4. Problemas críticos ou de alto risco encontrados

- **Críticos: nenhum.**
- **Altos:**
  - A-01: a API aceitava tokens de contas com e-mail não confirmado e de logins anônimos.
  - A-02: a CSP vinha desligada por padrão.
  - A-03: ligar a CSP quebraria a checagem de senhas vazadas e o redirecionamento de `leitura.html`.
  - A-04: proteção de senhas vazadas desligada no Supabase, sem CAPTCHA.
  - A-05: sem exclusão ou exportação de conta e com texto de privacidade incompleto.
- **Achado meu, nesta rodada:** os papéis do navegador (`anon`, `authenticated`) tinham TRUNCATE,
  TRIGGER e REFERENCES em 13 tabelas centrais, também em produção. TRUNCATE ignora RLS. A API REST e
  o GraphQL não emitem TRUNCATE, então não era explorável por ali, mas foi revogado.

## 5. Problemas corrigidos

- A-01, A-02, A-03, A-08, A-09, A-11, A-20 no código:
  - tokens não confirmados e anônimos recusados;
  - CSP aplicada em produção;
  - limite nos links públicos e `TRUST_PROXY`;
  - no máximo 3 uploads de mídia simultâneos antes de ler o corpo;
  - logs sem tokens nem e-mails;
  - alerta `UNSAFE_PRODUCTION_CONFIG` na inicialização.
- A-12 a A-14 no banco, nas migrações `20261125090000` e `20261125110000`, aplicadas em staging e
  produção:
  - `storage_owns_material` saiu do schema exposto (aviso 0029 do Supabase resolvido);
  - as 13 políticas originais passaram a valer só para `authenticated`;
  - TRUNCATE/TRIGGER/REFERENCES revogados, inclusive para tabelas futuras.
- A-15: o helper temporário de release (`release_tmp`) foi removido da produção.
- Duração confiável (A-10, parte do programa): a cota usa a duração medida no servidor com ffprobe,
  não o `durationMs` do navegador.

## 6. Autenticação e RLS: resultados

Os testes rodaram em **Postgres real** (staging e produção), com duas contas sintéticas, papel
`authenticated` e claims de JWT de verdade. Tudo foi desfeito por rollback, sem resíduo (conferido).

| Verificação | Staging | Produção |
| --- | --- | --- |
| Conta A lê material, segmentos ou permissões da conta B | negado | negado |
| Navegador lê `usage_ledger`, `app_admins`, `demo_lessons`, cópias e configuração | negado | negado |
| Navegador chama RPCs `*_admin` e a função `security definer` | negado | negado |
| Navegador se cadastra como administradora | negado | negado |
| `anon` lê demonstrações ou chama a função de uso | negado | — |
| Cópias de demonstração diferentes por conta; abrir de novo devolve a mesma cópia | ok | ok |
| Cota: 200 s ok, repetição sem custo, 101 s a mais recusado (`user_quota`), exatamente 300 s ok | ok | ok (parcial) |
| Privilégios TRUNCATE/TRIGGER/REFERENCES do navegador | 0 | 0 |

Pela API (PGlite com as migrações reais), os testes automatizados cobrem:

- falha fechada sem o schema (503);
- 401 sem login;
- papel lido só do servidor;
- visão geral 404 para quem não é administradora e sem identidades para quem é;
- repetição de pedido que não conta duas vezes;
- `/demo-media` com Range (206) e travessia de caminho recusada (404).

## 7. Migrações em produção

1. Backup `backup_pre_public_testing_20261124`: 64 tabelas públicas, buckets, políticas, privilégios
   e manifesto (4 contas e o md5 dos ids, 32 objetos, 22 materiais).
2. Aplicadas, cada uma com o sha256 do arquivo conferido:
   - `20261125090000_security_hardening_public`
   - `20261125100000_public_testing`
   - `20261125110000_public_grants_hardening`
3. Pós-checagens:
   - md5 dos ids das contas igual, 32 objetos, 22 materiais;
   - programa **desligado** (`enabled=false`), 0 administradoras, livro de uso vazio;
   - testes de isolamento passando;
   - advisors só com avisos INFO intencionais (tabelas acessíveis apenas pelo servidor) e a proteção
     de senhas vazadas, que é configurada no painel.
4. O helper `release_tmp` foi removido.

## 8. As três aulas de demonstração

| Aula | Matéria | Duração | Conteúdo |
| --- | --- | --- | --- |
| Crase: quando usar o acento grave | Português | 3 min 8 s | 25 segmentos, resumo, 8 questões, 10 cartões |
| Como as vacinas ensinam o sistema imunológico | Ciências | 3 min 31 s | 25 segmentos, resumo, 8 questões, 10 cartões |
| Como a internet entrega uma página | Tecnologia | 3 min 15 s | 24 segmentos, resumo, 8 questões, 10 cartões, **vídeo** com slides |

- Roteiros originais da equipe, com narração sintetizada (espeak-ng + MBROLA), licença CC BY 4.0
  para o programa. Sem dados pessoais.
- Validadas em Postgres real (staging): cada cópia fica "pronta para gerar", com resumo atual,
  8 questões, 10 cartões e nenhuma tarefa na fila.

## 9. Como o conteúdo é compartilhado

- **Catálogo único:** cada aula é uma linha em `public.demo_lessons`, só acessível pelo servidor. A
  API a carrega na inicialização a partir de `database/demo-lessons/*/lesson.json` (upsert por slug,
  sem duplicar).
- **Mídia única:** o áudio e o vídeo ficam no próprio repositório e são servidos pela API em
  `/demo-media/<aula>/audio.mp3`. Não há cópia no Storage nem gasto de egress do Supabase, e os
  arquivos nunca são apagados pela exclusão de uma aula.
- **Cópia leve por conta:**
  - As tabelas de estudo (questões respondidas, cartões, anotações, progresso) têm chaves que
    amarram cada linha ao dono do material, então um único material compartilhado é impossível por
    construção.
  - Por isso, ao abrir uma demonstração, o servidor cria para a pessoa uma cópia **só das linhas de
    texto** (transcrição, resumo, questões), apontando para a mídia canônica.
  - A cópia não chama IA, não usa Storage e não consome cota (livro de uso = 0, conferido).

## 10. Progresso privado

Respostas, cartões revisados, anotações e progresso ficam presos à cópia da pessoa, pelas chaves de
dono e pelo RLS. Ninguém vê o que outra conta fez (item 6). Abrir de novo devolve a mesma cópia.

## 11. A cota de 5 minutos: como funciona

1. Antes de enfileirar, a API recusa logo quem não tem saldo (`TRANSCRIPTION_QUOTA_EXCEEDED`, 403,
   com a mensagem "As aulas de demonstração… continuam disponíveis"). Isso é só experiência de uso.
2. **A cobrança real acontece no worker, antes de enviar o áudio ao provedor:**
   1. o worker baixa o arquivo e mede a duração com **ffprobe**;
   2. corrige `audio_files.duration_ms` se o valor declarado diferir em mais de 1 s;
   3. reserva no banco, numa única transação com travas por conta e uma trava global:
      `testing_reserve_admin(conta, 'transcription_seconds', 'initial:<material>', segundos)`.
3. Regras da reserva:
   - o saldo é **acumulado** (300 s no período);
   - a mesma referência nunca conta duas vezes (repetir, reenviar ou retentar não cobra de novo);
   - duas abas ao mesmo tempo não passam do limite, porque a trava serializa;
   - se a gravação inteira não cabe no saldo, é recusada com o quanto resta.
4. Se a tarefa falha antes de chegar ao provedor, a reserva é devolvida.
5. A reserva também conta 1 "gravação processada" (limite de 3), porque cada gravação gera chamadas
   de IA.

## 12. Limites de geração por IA (participante / administradora)

| Ação | Participante | Administradora |
| --- | --- | --- |
| Transcrição acumulada | 5 min | 120 min |
| Gravações processadas | 3 | 60 |
| Resumos | 2 | 30 |
| Listas de questões (até 10 por lista) | 2 | 30 |
| Geração de flashcards (até 20) | 1 | 20 |
| Nova sugestão de cartão | 5 | 60 |
| Nova análise de avisos | 1 | 20 |
| Material integrado | indisponível | 10 |

- Cada pedido carrega uma chave de idempotência; repetir o mesmo pedido não conta.
- Mudar opções conta como pedido novo.
- O que já foi gerado continua disponível.
- Tudo é editável em `public_testing_config`.

## 13. Administradoras

O papel vem **só** de `public.app_admins` (UUID), lido pelo servidor, com cache de 30 s. Não usa o
perfil do navegador, que a pessoa pode editar. Não cadastrei ninguém: os UUIDs não foram informados
e não adivinho identidades. A operação exata está no runbook (2.5):

```sql
select id, email from auth.users where email = 'EMAIL-DA-ADMINISTRADORA';
insert into public.app_admins (user_id, granted_by, note) values ('UUID', 'quem autorizou', 'equipe');
```

## 14. Aviso de boas-vindas

- Para participantes, uma vez por sessão do navegador, no canto inferior direito (largura total no
  celular), com fechar e Esc.
- O texto é o pedido, montado com o limite real e o número real de aulas. Com os padrões fica
  idêntico ao especificado:
  > **Estamos em fase de testes!**
  > Para que mais pessoas possam experimentar o Voz em Estudo gratuitamente, reduzimos
  > temporariamente o limite de transcrição para 5 minutos por participante. Também preparamos 3
  > aulas completas para você explorar sem gastar seu limite!
- Ação **"Ver meus limites"**, que leva a `conta.html#limites` (Conta de participante, com
  medidores).
- Nenhum "limite normal" é mencionado.

## 15. Provedores de IA atuais

- Transcrição: AssemblyAI, modelo `assemblyai-stt-3-7`.
- Texto: Groq, modelo `openai/gpt-oss-120b` com `reasoning_effort` baixo.
- Fonte: configuração da produção informada e código. As chaves das contas não estão nesta sessão.

## 16. Limites dos provedores verificados

- **Não foi possível verificar nas contas** (plano, saldo e limites não estão visíveis aqui).
- Fontes públicas, várias secundárias porque os sites estavam bloqueados para leitura direta:
  - **Groq gratuito:** ~30 req/min, 1.000 req/dia, 8.000 tokens/min e 200.000 tokens/dia por
    organização. Pedidos acima de ~8.000 tokens podem falhar de vez (413).
  - **Groq Developer:** ~1.000 req/min e 250 mil tokens/min.
  - **AssemblyAI:** 5 transcrições simultâneas no gratuito; ~US$ 0,21/h.
- Detalhes e fontes: CAPACIDADE_E_CUSTOS.md.

## 17. Custos estimados por dia (Groq pago + AssemblyAI)

| Participantes | Típico | Pior caso (todas as cotas no mesmo dia) | Teto absoluto |
| --- | --- | --- | --- |
| 10 | US$ 0,26 | US$ 0,42 | US$ 1,30 |
| 30 | US$ 0,79 | US$ 1,25 | US$ 3,91 |
| 50 | US$ 1,32 | US$ 2,08 | US$ 6,52 |
| 100 | US$ 2,65 | US$ 4,16 | US$ 13,05 |

Uma administradora com a cota cheia acrescenta até ~US$ 1,47 por dia. São estimativas com preços de
fontes secundárias e tokens medidos offline. Calibre com os logs `LLM_USAGE`.

## 18. Capacidade por dia e por hora

Os **tetos globais** (no banco, valem para todas as contas somadas):

- Transcrição: 5 h por dia (60 participantes usando os 5 min inteiros), 1,5 h por hora, 15 h no
  total, 2 simultâneas.
- Texto: 800 pedidos por dia e 300 por hora, 160 mil tokens estimados por dia e 60 mil por hora.

O teto de tokens foi escolhido para caber no **Groq gratuito**. Um participante que usa todas as
gerações gasta ~33 mil tokens. Então, **com o gratuito, só ~5 participantes por dia conseguem usar
todas as gerações**. Os demais recebem "Atingimos o limite do programa por agora", e as
demonstrações seguem disponíveis. Com o **Developer**, suba o teto (ex.: 3 milhões de tokens por
dia, ~US$ 1–3 por dia para 100 pessoas):

```sql
update public.public_testing_config
set global_limits = jsonb_set(jsonb_set(global_limits, '{llm_tokens,day}', '3000000'), '{llm_tokens,hour}', '600000')
where id = 1;
```

## 19. Controles globais de segurança de orçamento

- Tetos por hora, dia e total para transcrição, pedidos e tokens, com reserva atômica e trava
  global.
- No máximo 2 transcrições ao mesmo tempo no provedor (`concurrent_transcriptions`). As demais
  esperam na fila sem gastar tentativas e começam assim que abre uma vaga. Use 0 para pausar novas
  transcrições.
- Fila limitada pelas próprias cotas: cada participante tem no máximo 3 gravações e 2 pedidos de
  cada geração, então 100 participantes nunca passam de algumas centenas de tarefas.
- Novas tentativas respeitam `Retry-After` (até 1 h), e o cliente Groq faz no máximo 1 nova
  tentativa interna, com tempo limite de 120 s.
- Falha fechada: com a flag ligada e o schema ausente, nada caro começa (503).
- No máximo 40 objetos de áudio por conta no Storage.
- Cortes de emergência (zerar tetos, parar o worker, desligar o programa) no runbook, seção 4.

## 20. Testes automatizados e de navegador

| Suíte | Resultado |
| --- | --- |
| Backend (`npm run test:backend`) | 451/451 |
| `npm test` (backend, DOM, UI, Python, qualidade) | 769 testes, 0 falhas (inclui Python e qualidade) |
| Navegador (`npm run test:browser`, 30 roteiros, inclui o novo do programa) | todos passando (saída 0) |
| CSP aplicada em 33 páginas | sem violações |
| ESLint, checagem estática, checagem de segredos | limpos |
| Postgres real (staging/produção) | item 6 |

**Não testado:** fluxo ponta a ponta com AssemblyAI, Groq e Supabase reais por uma API hospedada,
porque não há chaves nem hospedagem nesta sessão. Faça o roteiro do item 22 com uma conta sua antes
de convidar pessoas.

## 21. Riscos e limitações restantes

- Hospedagem, chaves e configurações do Supabase Auth dependem de você (item 3).
- No Groq gratuito, a capacidade de gerações é pequena (item 18), e pedidos grandes podem falhar
  (413). Para participantes, os pedidos foram limitados a 10 questões e 20 cartões.
- Os limites por minuto da API ficam em memória: use uma instância. As cotas do programa estão no
  banco e não têm esse problema.
- O limite de 40 objetos no Storage pode ser passado por envios simultâneos (efeito pequeno).
- Áudio e transcrição ficam na AssemblyAI depois do processamento (A-07, proposto).
- Privacidade e LGPD: falta o texto, o consentimento e o processo de exclusão (A-05).
- Os schemas `backup_*` em produção guardam cópias completas: apague-os após o teste.
- Demonstrações: uma cópia leve por conta. Com 100 contas são cerca de 300 materiais pequenos (texto),
  bem abaixo do limite do banco gratuito.

## 22. Roteiro simples para participantes

1. Crie a conta, confirme o e-mail e entre.
2. Leia o aviso "Estamos em fase de testes!" e toque em **Ver meus limites** se quiser.
3. Em **Biblioteca › Aulas de demonstração**, toque em **Começar** numa das três aulas.
4. Ouça a aula acompanhando a transcrição; toque numa frase para pular até ela.
5. Leia o **Resumo**, responda às **Questões** e veja a correção.
6. Estude os **Flashcards** e faça uma anotação num trecho.
7. Opcional: em **Nova transcrição**, envie uma gravação **sua** de até 5 minutos (com permissão de
   quem fala) e confira a transcrição.
8. Conte o que achou no canal combinado com a equipe.
