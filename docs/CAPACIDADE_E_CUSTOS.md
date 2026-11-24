# Capacidade e custos de uma rodada de testes

Análise de 24/11/2026 para decidir cotas por participante, tetos globais e plano dos provedores
antes de abrir o Voz em Estudo para testers. Nada aqui chamou provedores de IA nem gravou no
banco: os tokens vêm dos **prompts reais do app**, montados pelos próprios construtores de prompt
com uma transcrição representativa, e os números de uso vêm do código.

- Medição de tokens: [`scripts/capacity/measure-prompts.mjs`](../scripts/capacity/measure-prompts.mjs)
  (saída em [`scripts/capacity/measurements.json`](../scripts/capacity/measurements.json)).
- Estimador (parâmetros no topo, sem rede):
  [`scripts/capacity/estimate.mjs`](../scripts/capacity/estimate.mjs).
- Transcrição de teste (fictícia, pt-BR falado, 14 trechos de ~30 s):
  [`scripts/capacity/transcript-fixture.mjs`](../scripts/capacity/transcript-fixture.mjs).

```bash
node scripts/capacity/estimate.mjs                       # tabelas deste documento
node scripts/capacity/estimate.mjs --participants=20,40  # outros tamanhos
# Remedir (opcional; js-tiktoken não é dependência do projeto):
npm install --prefix /tmp/tok js-tiktoken@1.0.21
JS_TIKTOKEN_DIR=/tmp/tok/node_modules/js-tiktoken node scripts/capacity/measure-prompts.mjs --write
```

## Resumo para decisão

1. **Custo é irrisório; o gargalo é o limite do Groq gratuito.** No pior caso (todas as cotas
   usadas no mesmo dia), 100 testers custam cerca de **US$ 4,16/dia (R$ 24)**, somando
   AssemblyAI e Groq pago; com o administrador usando a cota cheia, **US$ 5,64 (R$ 33)**. Mesmo o
   teto absoluto (toda chamada gastando o `max_completion_tokens` inteiro e todas as tentativas
   do worker) fica em **US$ 13/dia** para 100 testers.
2. **O plano gratuito do Groq não comporta as cotas propostas.** Um tester consome ~33 mil tokens
   num dia típico e ~76 mil no pior caso; o limite gratuito é **200 mil tokens/dia por
   organização**. Cabem **2 a 4 testers por dia**, contra 10–100 pretendidos.
3. **Pior: no gratuito, algumas chamadas falham sempre, sem relação com volume.** Relatos (fonte
   secundária) indicam que o Groq soma `entrada + max_completion_tokens` e recusa com **413**
   o pedido que passa do TPM (8.000). Hoje, com uma aula de 5 min: lista de **10 ou 20 questões**
   pede ~10.900; **prévia de 20 ou mais cartões** pede 12.000+. O app trata 413 como erro não
   recuperável (`LLM_FAILED`). Os 3 avisos rodam em paralelo (`Promise.all`) e, juntos, passam de
   8.000 tokens no mesmo minuto para aulas de 5 min ou mais: no gratuito, parte deles vira estado
   `error` silenciosamente.
4. **Recomendação:** passar o Groq para o plano **Developer** (pago por uso) antes da rodada.
   Custo esperado de dezenas de centavos de dólar por dia, e limites (secundários) de 1.000 RPM e
   250 mil TPM, folgados para 100 testers. Se o gratuito for mantido, limite a rodada a **2–4
   testers por dia** e aplique os tetos da seção "Se o Groq continuar no gratuito".
5. **AssemblyAI não é gargalo de custo:** 5 min por tester custam US$ 0,0175; 100 testers + admin
   (10,3 h no pior caso) custam ~US$ 2,17, dentro do crédito inicial de US$ 50, se a conta ainda
   o tiver (não sabemos). O ponto de atenção é a **concorrência de 5 transcrições** em contas
   gratuitas (fonte oficial via busca), pois o worker libera a vaga enquanto espera o provedor.
6. **Supabase gratuito comporta a rodada:** mesmo com 100 testers, banco < 40 MB, storage < 90 MB
   e egress de ~1,9 GB no dia (37% da cota **mensal** de 5 GB). O egress é o recurso que acaba
   primeiro se houver várias rodadas no mês.

## O que é verificado, estimado ou desconhecido

| Item                                                                                   | Situação                                   | Base                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provedores e modelos (AssemblyAI `assemblyai-stt-3-7`, Groq `openai/gpt-oss-120b`)     | **Verificado**                             | Metadados da produção (24/11/2026), informados pelo desenvolvedor                                                                                                                                                           |
| Pedido enviado à AssemblyAI                                                            | **Verificado no código**                   | `speech_models: ["assemblyai-stt-3-7"]`, `punctuate`, `format_text`; `language_code: "pt"` ou `language_detection` quando o usuário escolhe "automático"; `speaker_labels` só se `ASR_SPEAKER_LABELS=true` (padrão `false`) |
| `reasoning_effort` do gpt-oss                                                          | **Verificado no código**                   | `LLM_REASONING_EFFORT`, padrão `low` (o `.env.example` também usa `low`); o valor da produção não foi visto                                                                                                                 |
| Chamadas por ação, `max_completion_tokens` e tentativas                                | **Verificado no código**                   | Seção "Caminhos de IA"                                                                                                                                                                                                      |
| Tokens de entrada                                                                      | **Medido** (o200k_base, offline)           | Prompts reais com transcrição fictícia de 1–7 min; aulas mais longas foram extrapoladas linearmente                                                                                                                         |
| Tokens de saída visíveis                                                               | **Estimado**                               | Amostras de saída escritas à mão e tokenizadas (uma questão ≈ 186 tokens, um cartão ≈ 101, um conceito ≈ 50, um aviso ≈ 60, resumo padrão de 5 min ≈ 462)                                                                   |
| Tokens de raciocínio (cobrados como saída)                                             | **Suposição**                              | Típico: máx(150; 30% da saída visível). Pessimista: máx(400; 100%). Teto: `max_completion_tokens` inteiro. Calibre com os logs `LLM_USAGE` (`completionTokens`)                                                             |
| Preço do Groq US$ 0,15 / 0,60 por milhão                                               | **Secundário**                             | Agregadores; o blog de lançamento citava US$ 0,75 de saída. groq.com estava bloqueado nesta sessão                                                                                                                          |
| Limites gratuitos do Groq (30 RPM, 1.000 RPD, 8.000 TPM, 200.000 TPD, por organização) | **Secundário (reproduz a tabela oficial)** | console.groq.com estava bloqueado; o resultado de busca cita a tabela oficial                                                                                                                                               |
| Limites do Groq Developer (1.000 RPM, 500 mil RPD, 250 mil TPM)                        | **Secundário**                             | Um resumo de terceiros                                                                                                                                                                                                      |
| `max_completion_tokens` conta no TPM antes da resposta (413)                           | **Secundário (relatos)**                   | Fórum da Discourse e comunidade Groq; a documentação oficial não detalha                                                                                                                                                    |
| AssemblyAI-STT-3.7 a US$ 0,21/h; diarização +US$ 0,02/h; crédito inicial de US$ 50     | **Oficial via busca**                      | Blog e documentação da AssemblyAI (o site estava bloqueado para leitura direta)                                                                                                                                             |
| Concorrência AssemblyAI: 5 (gratuita) / 200 (paga), assíncrona                         | **Oficial via busca**                      | Página de rate limits da AssemblyAI; outras páginas falam em concorrência "ilimitada" no pago                                                                                                                               |
| Supabase gratuito: 500 MB de banco, 1 GB de storage, 5 GB de egress (+5 GB em cache)   | **Oficial via busca**                      | supabase.com/pricing                                                                                                                                                                                                        |
| Plano do Groq (gratuito ou Developer) e saldo/plano da AssemblyAI                      | **Desconhecido**                           | Não visível para nós; os dois cenários são apresentados                                                                                                                                                                     |
| Texto exato que o Groq injeta no formato harmony                                       | **Desconhecido**                           | Usamos o padrão do openai-harmony (+67 tokens por pedido)                                                                                                                                                                   |

## Caminhos de IA no código

Os prompts de texto vão todos para `getAiRegistry().text(task)` → `groq.client.js`
(`chat.completions.create` com `max_completion_tokens`, `response_format: json_object` nas
chamadas JSON e `reasoning_effort` para modelos `openai/gpt-oss*`). No gpt-oss, o raciocínio
**consome o mesmo orçamento** de `max_completion_tokens` e é cobrado como saída.

| Ação                                                           | Onde roda                                  | Chamadas por pedido                                                                                    | Entrada                                                                                                                   | `max_completion_tokens`                                                                                              | Repetições possíveis                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Processamento inicial: avisos (`warnings.service`)             | Worker, após a transcrição                 | **3 em paralelo** (educacional, alinhamento ao tema, suspeita factual); 2 se a aula não tem disciplina | Prompt + `full_text` + `segments_snapshot` inteiro em JSON (id, posição, tempos, texto): a transcrição vai **duas vezes** | 1.200 cada                                                                                                           | Falhas são engolidas e salvas como `error`; sem nova tentativa. **Uma rodada por gravação**                                 |
| Avisos sob demanda (`refreshWarnings`)                         | **API, síncrono** (fora da fila do worker) | 3 em paralelo                                                                                          | Igual                                                                                                                     | 1.200 cada                                                                                                           | Uma por chave de idempotência                                                                                               |
| Resumo (`summary.service`)                                     | Worker                                     | 1 (`completeText`)                                                                                     | Prompt (formato, extensão, focos) + transcrição                                                                           | breve 900, padrão 1.800, detalhado 3.500                                                                             | Job: até `JOB_MAX_ATTEMPTS=3` em erro recuperável (429/5xx/rede)                                                            |
| Lista de questões v2 (`question-generation.service`)           | Worker                                     | 2 ou 3 (`MAX_MODEL_CALLS = 3`): conceitos → questões → **1 rodada de reposição** se faltar             | Conceitos: prompt + transcrição. Questões: prompt longo + plano por slot + até 120 enunciados a evitar + transcrição      | Conceitos: `min(8000, 1200 + alvo×160)`, alvo = `min(60, max(8, ⌈1,5×N⌉))`. Questões: `min(16000, 1200 + slots×600)` | Saída inválida em conceitos/questões lança `LLM_INVALID_OUTPUT` (recuperável) → o job inteiro se repete: até **9 chamadas** |
| Lista legada v1 (`question.service`, jobs sem `config`)        | Worker                                     | 1                                                                                                      | Prompt curto + transcrição                                                                                                | `max(2500, N×550)`                                                                                                   | 2 tentativas internas × 3 do job = até 6                                                                                    |
| Prévia de flashcards 2.0                                       | **API, síncrono**                          | 1 + 1 complemento se o modelo devolveu N mas houve descarte                                            | Prompt + até 300 frentes a evitar + transcrição                                                                           | `min(12000, N×550 + 500)`                                                                                            | Sem nova tentativa no servidor                                                                                              |
| "Trocar um cartão"                                             | API, síncrono (mesma rota, `count: 1`)     | 1 (+1 complemento)                                                                                     | Igual, com as frentes atuais em `avoid`                                                                                   | 1.050                                                                                                                | —                                                                                                                           |
| Flashcards v1 (pedido sem `config`)                            | API, síncrono                              | 1                                                                                                      | Prompt + transcrição                                                                                                      | `min(12000, N×550 + 500)`                                                                                            | —                                                                                                                           |
| Multiaulas (`multi-lesson-generation`, desligado para testers) | Worker próprio                             | 1 mapa por revisão **sem cache** + 1 síntese + 1 reparo se o JSON vier inválido                        | Mapa: trechos numerados (até 60 mil caracteres). Síntese: os mapas                                                        | Mapa 4.000; síntese 6.000                                                                                            | `MULTI_LESSON_MAX_ATTEMPTS = 2`                                                                                             |

Outros multiplicadores:

- **SDK do Groq (`groq-sdk` 1.5.0):** `maxRetries = 2` por padrão para 408/409/429/5xx,
  respeitando `retry-after` **sem limite superior**. Cada chamada lógica pode virar 3 pedidos
  HTTP. Um 429 por TPD com `retry-after` longo pode deixar o worker (concorrência 1) parado
  dentro de uma única chamada.
- **Limites por conta que já existem:** `RATE_LIMIT_TRANSCRIPTIONS_PER_DAY=20`,
  `RATE_LIMIT_GENERATIONS_PER_HOUR=30`, `AI_DAILY_GENERATION_LIMIT=40` (gerações iniciadas por dia;
  reuso não conta). Não há teto global nem controle de tokens.
- **Avisos escalam por gravação, não por minuto:** 5 gravações de 1 min fazem 15 chamadas de
  aviso (~22 mil tokens no pessimista) contra 3 chamadas (~12 mil) de uma gravação de 5 min. O
  limite atual de 20 transcrições/dia permite 60 chamadas de aviso por conta. A cota de 300 s
  deveria vir com **no máximo 3 gravações por tester**, ou com cobrança mínima de 1 min por
  gravação.
- **Caminhos síncronos na API** (prévia de cartões e avisos sob demanda) não passam pela fila do
  worker: `WORKER_CONCURRENCY` não os limita. Um controle de ritmo global precisa ficar na camada
  do cliente LLM, compartilhado pelos dois serviços (API e worker são processos separados no
  Railway), ou seja, um contador no banco.

## Medição de tokens

A transcrição de teste fala de ciclo da água e bacias hidrográficas, em registro oral (marcadores
como "tá?", "né", perguntas à turma), com ~148 palavras/min, o ritmo de uma aula expositiva. As
variantes de 1, 2, 3, 5 e 7 min são os primeiros 2, 4, 6, 10 e 14 trechos. Os segmentos imitam o
`segments_snapshot` (22 palavras, ~9 s cada, com UUID). Português rendeu **~4,0 caracteres por
token** no o200k_base; o JSON de segmentos, ~3,2.

O encoding foi carregado do pacote npm `js-tiktoken` (que embute o arquivo do o200k_base), porque
`pip install tiktoken` funcionou mas o download do encoding (openaipublic.blob.core.windows.net)
foi bloqueado pelo proxy. O `o200k_harmony` do gpt-oss é o `o200k_base` com tokens especiais, então
a contagem de texto é a mesma. Sem o pacote, o script usa uma heurística (4,1 caracteres/token em
prosa, 2,9 em JSON), calibrada nestes prompts: erra ~2% nos prompts de prosa e superestima em ~17% os prompts com JSON
de segmentos (avisos), o que é conservador.

Saída da medição (`entrada` inclui a moldura harmony de ~67 tokens; `saída visível` é a
estimativa sem raciocínio):

```text
Tokenizador: o200k_base (js-tiktoken, offline); sobrecarga do formato harmony por pedido: 67 tokens
Tokens por item de saída (amostras): {"concept":50,"question":186,"flashcard":101,"warning":60,"summaryStandard5min":462}

| Duração | Palavras | Caracteres | Segmentos | Tokens da transcrição | Tokens do JSON de segmentos |
| --- | --- | --- | --- | --- | --- |
| 1 min | 157 | 843 | 8 | 206 | 524 |
| 2 min | 293 | 1613 | 14 | 403 | 958 |
| 3 min | 445 | 2453 | 21 | 613 | 1443 |
| 5 min | 739 | 4035 | 34 | 1009 | 2349 |
| 7 min | 1022 | 5635 | 47 | 1412 | 3261 |

| Chamada | 1 min: entrada / max_completion_tokens / saída visível | 2 min: entrada / max_completion_tokens / saída visível | 3 min: entrada / max_completion_tokens / saída visível | 5 min: entrada / max_completion_tokens / saída visível | 7 min: entrada / max_completion_tokens / saída visível |
| --- | --- | --- | --- | --- | --- |
| Resumo breve | 545 / 900 / ~150 | 742 / 900 / ~150 | 952 / 900 / ~150 | 1348 / 900 / ~231 | 1751 / 900 / ~323 |
| Resumo padrão | 545 / 1800 / ~150 | 742 / 1800 / ~185 | 952 / 1800 / ~281 | 1348 / 1800 / ~462 | 1751 / 1800 / ~647 |
| Resumo detalhado | 553 / 3500 / ~170 | 750 / 3500 / ~332 | 960 / 3500 / ~505 | 1356 / 3500 / ~832 | 1759 / 3500 / ~1164 |
| Aviso (1 de 3) | 1037 / 1200 / ~60 | 1667 / 1200 / ~60 | 2362 / 1200 / ~60 | 3664 / 1200 / ~60 | 4979 / 1200 / ~60 |
| Questões v2 (10): conceitos | 611 / 3600 / ~210 | 808 / 3600 / ~260 | 1018 / 3600 / ~360 | 1414 / 3600 / ~610 | 1817 / 3600 / ~760 |
| Questões v2 (10): questões | 1254 / 3600 / ~754 | 1502 / 4200 / ~940 | 1842 / 5400 / ~1312 | 2500 / 8400 / ~2242 | 2993 / 9000 / ~2428 |
| Questões v2 (10): reposição | 1181 / 2400 / ~382 | 1452 / 2400 / ~382 | 1680 / 2400 / ~382 | 2273 / 3000 / ~568 | 2759 / 3600 / ~754 |
| Questões v2 (20): conceitos | 611 / 6000 / ~210 | 808 / 6000 / ~260 | 1018 / 6000 / ~360 | 1414 / 6000 / ~610 | 1817 / 6000 / ~860 |
| Questões v2 (20): questões | 1254 / 3600 / ~754 | 1502 / 4200 / ~940 | 1842 / 5400 / ~1312 | 2500 / 8400 / ~2242 | 3171 / 11400 / ~3172 |
| Questões v1 legado (10) | 438 / 5500 / ~1500 | 635 / 5500 / ~1500 | 845 / 5500 / ~1500 | 1241 / 5500 / ~1500 | 1644 / 5500 / ~1500 |
| Flashcards v2 (10) | 513 / 6000 / ~313 | 710 / 6000 / ~616 | 920 / 6000 / ~919 | 1316 / 6000 / ~1020 | 1719 / 6000 / ~1020 |
| Flashcards v2 (50) | 513 / 12000 / ~313 | 710 / 12000 / ~616 | 920 / 12000 / ~919 | 1316 / 12000 / ~1525 | 1719 / 12000 / ~2030 |
| Flashcards: trocar 1 | 647 / 1050 / ~111 | 844 / 1050 / ~111 | 1054 / 1050 / ~111 | 1450 / 1050 / ~111 | 1853 / 1050 / ~111 |
| Mapa de conhecimento (multiaulas) | 571 / 4000 / ~580 | 791 / 4000 / ~650 | 1029 / 4000 / ~790 | 1474 / 4000 / ~1140 | 1929 / 4000 / ~1490 |

Síntese multiaulas (4 mapas): entrada 6496, max 6000
Inclinação por minuto de áudio: {"transcriptTokens":199.75,"warningInput":654.25,"summaryInput":199.75,"conceptsInput":199.75,"questionsInputPerTranscript":1,"flashcardInput":199.75}
```

Leitura rápida:

- O prompt de **aviso** é o mais caro por minuto de áudio (~650 tokens/min), porque leva a
  transcrição e o JSON de segmentos. Uma aula de 30 min dá ~20 mil tokens de entrada **por
  aviso**, três vezes por gravação.
- A geração de questões v2 tem ~1.050 tokens fixos (instruções + plano por slot) e a etapa de
  conceitos, ~400. Numa aula de 1 min, as instruções pesam mais que a própria transcrição.
- O `max_completion_tokens` da geração de questões cresce com os slots (600 por slot): 8.400 para
  uma aula de 5 min com 10 ou 20 questões (12 slots, porque a capacidade da aula é ~1 questão
  por 60 palavras).

## Cenários (saída do estimador)

Hipóteses dos perfis (editáveis no topo de `estimate.mjs`):

| Perfil           | Transcrição                                                       | Gerações                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tester típico    | 2 gravações (3 + 2 min); gerações sobre a de 3 min                | 2 resumos padrão; 2 listas de 10 questões (reposição em 50% dos casos); 1 prévia de 10 cartões; 2 trocas; sem reexecutar avisos                                                  |
| Tester pior caso | 1 gravação de 5 min (maior transcrição = mais tokens por chamada) | 2 resumos **detalhados**; 2 listas de **20** questões, sempre com reposição; 1 prévia de **50** cartões com complemento; 5 trocas; 1 reexecução de avisos; raciocínio pessimista |
| Teto absoluto    | Igual ao pior caso                                                | Toda chamada gasta o `max_completion_tokens` inteiro; jobs repetem 3×; cartões e trocas com complemento                                                                          |
| Admin típico     | 1 gravação de 30 min                                              | 5 de cada; 1 multiaulas de 4 aulas                                                                                                                                               |
| Admin cota cheia | 4 × 30 min = 120 min                                              | 20 de cada (resumo detalhado, 20 questões, 50 cartões, 20 trocas, 20 reexecuções de avisos, 20 sínteses multiaulas)                                                              |

Pico: 50% do uso do dia concentrado em 2 horas (média por minuto nessa janela).

Medições: o200k_base (js-tiktoken, offline); câmbio US$ 1 = R$ 5,80. Tabelas por cenário: só testers; a última coluna soma 1 administrador(es) no perfil correspondente.

### Por participante (tester), por dia

| Perfil        | Gravações | Áudio (min) | Pedidos LLM | Tokens entrada | Tokens saída (c/ raciocínio) | Pedidos > 8.000 TPM (entrada+max) | Custo              |
| ------------- | --------- | ----------- | ----------- | -------------- | ---------------------------- | --------------------------------- | ------------------ |
| Típico        | 2         | 5           | 16,0        | 24.506         | 8.803                        | 0,0                               | US$ 0,03 (R$ 0,15) |
| Pior caso     | 1         | 5           | 21,0        | 47.136         | 28.423                       | 4,0                               | US$ 0,04 (R$ 0,24) |
| Teto absoluto | 1         | 5           | 42,0        | 84.926         | 167.100                      | 8,0                               | US$ 0,13 (R$ 0,76) |

### Administrador, por dia

| Perfil                | Áudio (min) | Pedidos LLM | Tokens entrada | Tokens saída | Custo               |
| --------------------- | ----------- | ----------- | -------------- | ------------ | ------------------- |
| Típico (≈25% da cota) | 30          | 41,5        | 405.647        | 64.810       | US$ 0,20 (R$ 1,19)  |
| Cota cheia            | 120         | 256,0       | 2.727.592      | 1.073.420    | US$ 1,47 (R$ 8,54)  |
| Teto absoluto         | 120         | 480,0       | 4.361.520      | 2.974.400    | US$ 2,86 (R$ 16,58) |

### Típico

| Testers | Transcrição (h) | Pedidos LLM/dia | Tokens entrada/dia | Tokens saída/dia | Total tokens/dia | AssemblyAI | Groq (pago) | Total/dia           | Total/dia + admin   |
| ------- | --------------- | --------------- | ------------------ | ---------------- | ---------------- | ---------- | ----------- | ------------------- | ------------------- |
| 10      | 0,83            | 160             | 245.060            | 88.030           | 333.090          | US$ 0,18   | US$ 0,09    | US$ 0,26 (R$ 1,53)  | US$ 0,47 (R$ 2,72)  |
| 30      | 2,50            | 480             | 735.180            | 264.090          | 999.270          | US$ 0,53   | US$ 0,27    | US$ 0,79 (R$ 4,60)  | US$ 1,00 (R$ 5,79)  |
| 50      | 4,17            | 800             | 1.225.300          | 440.150          | 1.665.450        | US$ 0,88   | US$ 0,45    | US$ 1,32 (R$ 7,67)  | US$ 1,53 (R$ 8,86)  |
| 100     | 8,33            | 1.600           | 2.450.600          | 880.300          | 3.330.900        | US$ 1,75   | US$ 0,90    | US$ 2,65 (R$ 15,35) | US$ 2,85 (R$ 16,53) |

### Pior caso (todas as cotas no mesmo dia)

| Testers | Transcrição (h) | Pedidos LLM/dia | Tokens entrada/dia | Tokens saída/dia | Total tokens/dia | AssemblyAI | Groq (pago) | Total/dia           | Total/dia + admin   |
| ------- | --------------- | --------------- | ------------------ | ---------------- | ---------------- | ---------- | ----------- | ------------------- | ------------------- |
| 10      | 0,83            | 210             | 471.360            | 284.230          | 755.590          | US$ 0,18   | US$ 0,24    | US$ 0,42 (R$ 2,41)  | US$ 1,89 (R$ 10,96) |
| 30      | 2,50            | 630             | 1.414.080          | 852.690          | 2.266.770        | US$ 0,53   | US$ 0,72    | US$ 1,25 (R$ 7,24)  | US$ 2,72 (R$ 15,79) |
| 50      | 4,17            | 1.050           | 2.356.800          | 1.421.150        | 3.777.950        | US$ 0,88   | US$ 1,21    | US$ 2,08 (R$ 12,07) | US$ 3,55 (R$ 20,62) |
| 100     | 8,33            | 2.100           | 4.713.600          | 2.842.300        | 7.555.900        | US$ 1,75   | US$ 2,41    | US$ 4,16 (R$ 24,14) | US$ 5,64 (R$ 32,69) |

### Teto absoluto (max_completion_tokens + todas as tentativas)

| Testers | Transcrição (h) | Pedidos LLM/dia | Tokens entrada/dia | Tokens saída/dia | Total tokens/dia | AssemblyAI | Groq (pago) | Total/dia            | Total/dia + admin    |
| ------- | --------------- | --------------- | ------------------ | ---------------- | ---------------- | ---------- | ----------- | -------------------- | -------------------- |
| 10      | 0,83            | 420             | 849.260            | 1.671.000        | 2.520.260        | US$ 0,18   | US$ 1,13    | US$ 1,30 (R$ 7,57)   | US$ 4,16 (R$ 24,15)  |
| 30      | 2,50            | 1.260           | 2.547.780          | 5.013.000        | 7.560.780        | US$ 0,53   | US$ 3,39    | US$ 3,91 (R$ 22,71)  | US$ 6,77 (R$ 39,29)  |
| 50      | 4,17            | 2.100           | 4.246.300          | 8.355.000        | 12.601.300       | US$ 0,88   | US$ 5,65    | US$ 6,52 (R$ 37,84)  | US$ 9,38 (R$ 54,43)  |
| 100     | 8,33            | 4.200           | 8.492.600          | 16.710.000       | 25.202.600       | US$ 1,75   | US$ 11,30   | US$ 13,05 (R$ 75,69) | US$ 15,91 (R$ 92,27) |

### Pico (50% do dia em 2 h, média por minuto) e limites do Groq gratuito — só testers

| Cenário   | Part. | Pedidos/dia vs RPD           | Tokens/dia vs TPD                  | Pedidos/min no pico vs RPM | Tokens/min no pico vs TPM     | Pedidos impossíveis no gratuito (entrada+max > 8.000) |
| --------- | ----- | ---------------------------- | ---------------------------------- | -------------------------- | ----------------------------- | ----------------------------------------------------- |
| Típico    | 10    | 160,0 — ok (1.000)           | **333.090,0 — excede** (200.000)   | 0,7 — ok (30)              | 1.387,9 — ok (8.000)          | 0                                                     |
| Típico    | 30    | 480,0 — ok (1.000)           | **999.270,0 — excede** (200.000)   | 2,0 — ok (30)              | 4.163,6 — ok (8.000)          | 0                                                     |
| Típico    | 50    | 800,0 — ok (1.000)           | **1.665.450,0 — excede** (200.000) | 3,3 — ok (30)              | 6.939,4 — ok (8.000)          | 0                                                     |
| Típico    | 100   | **1.600,0 — excede** (1.000) | **3.330.900,0 — excede** (200.000) | 6,7 — ok (30)              | **13.878,8 — excede** (8.000) | 0                                                     |
| Pior caso | 10    | 210,0 — ok (1.000)           | **755.590,0 — excede** (200.000)   | 0,9 — ok (30)              | 3.148,3 — ok (8.000)          | 40                                                    |
| Pior caso | 30    | 630,0 — ok (1.000)           | **2.266.770,0 — excede** (200.000) | 2,6 — ok (30)              | **9.444,9 — excede** (8.000)  | 120                                                   |
| Pior caso | 50    | **1.050,0 — excede** (1.000) | **3.777.950,0 — excede** (200.000) | 4,4 — ok (30)              | **15.741,5 — excede** (8.000) | 200                                                   |
| Pior caso | 100   | **2.100,0 — excede** (1.000) | **7.555.900,0 — excede** (200.000) | 8,8 — ok (30)              | **31.482,9 — excede** (8.000) | 400                                                   |

### Quantos testers cabem por dia no Groq gratuito (80% do TPD/RPD, sem uso de admin)

| Perfil do tester | Tokens/tester | Pedidos/tester | Máx. pelo TPD | Máx. pelo RPD |
| ---------------- | ------------- | -------------- | ------------- | ------------- |
| Típico           | 33.309        | 16,0           | 4             | 50            |
| Pior caso        | 75.559        | 21,0           | 2             | 38            |

### Chamadas que não cabem num minuto do Groq gratuito (entrada + max_completion_tokens > 8.000)

| Chamada                            | 1 min      | 3 min      | 5 min      | 10 min     | 30 min     |
| ---------------------------------- | ---------- | ---------- | ---------- | ---------- | ---------- |
| Aviso (cada um dos 3, em paralelo) | 2.237      | 3.562      | 4.864      | **8.152**  | **21.302** |
| Resumo detalhado                   | 4.053      | 4.460      | 4.856      | 5.864      | **9.894**  |
| Questões 5: geração                | 4.854      | 7.242      | 7.639      | **8.577**  | **12.327** |
| Questões 10: geração               | 4.854      | 7.242      | **10.900** | **12.673** | **17.203** |
| Questões 20: geração               | 4.854      | 7.242      | **10.900** | **19.758** | **24.908** |
| Flashcards 10                      | 6.513      | 6.920      | 7.316      | **8.324**  | **12.354** |
| Flashcards 20                      | **12.013** | **12.420** | **12.816** | **13.824** | **17.854** |

### Armazenamento e tráfego (Supabase gratuito)

| Testers (+ admin) | Storage de áudio retido (MB) | Banco (MB) | Egress no dia de teste (MB) | Uso do recurso mais apertado            |
| ----------------- | ---------------------------- | ---------- | --------------------------- | --------------------------------------- |
| 10                | 24,5                         | 9,3        | 271                         | 5% (egress conta contra a cota mensal)  |
| 30                | 38,9                         | 15,7       | 627                         | 12% (egress conta contra a cota mensal) |
| 50                | 53,3                         | 22,0       | 984                         | 19% (egress conta contra a cota mensal) |
| 100               | 89,3                         | 37,9       | 1.876                       | 37% (egress conta contra a cota mensal) |

### Tetos globais recomendados (pior caso dos testers + admin com cota cheia + folga) — Groq Developer

| Participantes | Transcrição min/dia | Transcrição min/hora | Pedidos LLM/dia | Tokens estimados/dia | Pedidos LLM/min | Tokens reservados/min (entrada+max) |
| ------------- | ------------------- | -------------------- | --------------- | -------------------- | --------------- | ----------------------------------- |
| 10            | 210                 | 60                   | 600             | 5.500.000            | 10              | 90.000                              |
| 30            | 330                 | 90                   | 1.100           | 7.300.000            | 15              | 120.000                             |
| 50            | 450                 | 120                  | 1.600           | 9.100.000            | 20              | 150.000                             |
| 100           | 750                 | 190                  | 2.850           | 13.650.000           | 40              | 150.000                             |

Notas sobre as tabelas:

- "Pedidos impossíveis no gratuito" conta as chamadas cuja soma `entrada + max_completion_tokens`
  passa de 8.000. Pelos relatos, elas são recusadas com 413 em qualquer horário.
- Os tokens/min no pico são médias. Na prática, uma única lista de questões de uma aula de 5 min
  usa ~7 mil tokens reais em poucos segundos, e os 3 avisos paralelos, ~12 mil. O TPM gratuito
  estoura com **um** usuário, não com a média.
- Na tabela de armazenamento, o egress soma o download do áudio pelo worker, a reprodução do
  áudio retido (30% das gravações, 2 vezes cada), o áudio de demonstração (3 MB × 3 reproduções
  por tester, **se** ele for servido pelo Supabase Storage) e 5 MB/tester de leituras da API.

## Avaliação das cotas propostas

| Cota por tester                     | Avaliação                                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcrição: 300 s acumulados       | Adequada (US$ 0,0175). **Somar: no máximo 3 gravações** (ou cobrar no mínimo 60 s por gravação), porque cada gravação dispara 3 avisos                                                                                            |
| Resumos: 2                          | Adequada. O "detalhado" (3.500) é o mais caro, mas no gratuito só cabe para aulas de até ~20 min                                                                                                                                  |
| Listas de questões: 2               | Adequada no Developer. **Limitar a 10 questões por lista para testers:** numa aula de 5 min a capacidade é ~12 questões, então pedir 20 não rende mais questões e só reserva mais tokens. No gratuito, só 5 questões cabem no TPM |
| Prévia de flashcards: 1 (+5 trocas) | Adequada no Developer; **limitar a 20 cartões** (uma aula de 5 min sustenta ~15 cartões e 50 reserva 12.000 tokens). No gratuito, só até 10. As trocas são baratas (~1,5 mil tokens cada)                                         |
| Reexecução manual de avisos: 1      | Adequada. Ela roda na API, fora da fila: entra no teto global de pedidos                                                                                                                                                          |
| Multiaulas desligado para testers   | Recomendado. Uma síntese com 4 mapas tem ~6,5 mil tokens de entrada e 6.000 de saída máxima, e não cabe no TPM gratuito                                                                                                           |
| Admin: 120 min, 20 de cada          | Domina o consumo: a cota cheia (~3,8 milhões de tokens, US$ 1,47) equivale a ~50 testers no pior caso. Use-a só no plano Developer. No gratuito, uma única aula de 30 min já impede avisos e listas (tabela de 413)               |

## Tetos globais recomendados

### Groq Developer (recomendado)

Valores da última tabela do estimador (pior caso dos testers + admin com cota cheia + 20% de
folga), arredondados:

| Configuração                                              | 10 testers                     | 30 testers | 50 testers | 100 testers |
| --------------------------------------------------------- | ------------------------------ | ---------- | ---------- | ----------- |
| Transcrição global, min/dia                               | 210                            | 330        | 450        | 750         |
| Transcrição global, min/hora                              | 60                             | 90         | 120        | 190         |
| Pedidos LLM/dia                                           | 600                            | 1.100      | 1.600      | 2.850       |
| Tokens estimados/dia (entrada + saída)                    | 5,5 mi                         | 7,3 mi     | 9,1 mi     | 13,7 mi     |
| Pedidos LLM/min (ritmo)                                   | 10                             | 15         | 20         | 40          |
| Tokens reservados/min (entrada + `max_completion_tokens`) | 90 mil                         | 120 mil    | 150 mil    | 150 mil     |
| `WORKER_CONCURRENCY`                                      | 2                              | 2          | 2          | 3           |
| Transcrições simultâneas na AssemblyAI                    | 4 (conta gratuita) / 20 (paga) | idem       | idem       | idem        |
| Gasto diário (alarme / bloqueio)                          | US$ 3 / 6                      | US$ 4 / 8  | US$ 5 / 10 | US$ 8 / 16  |

O teto de tokens reservados por minuto fica em ≤ 60% dos 250 mil TPM do Developer, para sobrar
folga para tentativas. Sem o admin na cota cheia, os tetos de tokens caem ~4,5 milhões (já com a folga).

### Se o Groq continuar no gratuito

| Configuração                                                                           | Valor                                                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Tokens/dia (estimados: entrada + saída prevista)                                       | **160.000** (80% de 200 mil)                                                |
| Pedidos LLM/dia                                                                        | **800** (80% de 1.000)                                                      |
| Pedidos LLM/min                                                                        | **≤ 20**                                                                    |
| Balde de tokens por minuto (entrada + `max_completion_tokens`, reservados na admissão) | **7.000**                                                                   |
| Pedido individual                                                                      | Recusar ou reduzir quando `entrada + max_completion_tokens > 7.500`         |
| Chamadas LLM simultâneas (API + worker)                                                | **1**; os 3 avisos em sequência, não em `Promise.all`                       |
| `WORKER_CONCURRENCY`                                                                   | 1                                                                           |
| Testers por dia                                                                        | **2 (pior caso) a 4 (típico)**; 10 testers precisam de 3–5 dias             |
| Tamanho máximo de aula para gerar tudo                                                 | ~5 min (avisos até ~9 min; listas de 5 questões até ~5 min; cartões até 10) |

### Ritmo, nova tentativa e backoff

- **Groq 429 com `retry-after` ≤ 60 s:** esperar o valor indicado mais 0–25% de jitter, no
  máximo 2 vezes.
- **Groq 429 com `retry-after` > 60 s, ou limite diário (TPD/RPD) esgotado:** não esperar dentro
  do processo. Devolver o job para `waiting_retry` com `next_attempt_at = agora + retry-after`,
  pausar a fila LLM global até lá e avisar o usuário. Hoje o `groq-sdk` dorme pelo
  `retry-after` inteiro: configure `maxRetries: 0` ou `1` no cliente e trate o caso na aplicação,
  o que também mantém a contagem de pedidos correta.
- **Groq 413 (pedido maior que o TPM):** nunca repetir. Reduzir `max_completion_tokens` ou
  recusar com mensagem clara (já é `LLM_FAILED`, não recuperável).
- **Jobs do worker:** manter 15 s e 60 s (`JOB_RETRY_DELAY_1_MS`/`_2_MS`), adicionar jitter e
  preferir o `retry-after` quando houver.
- **AssemblyAI 429/5xx no envio:** reagendar sem consumir tentativa (como já é feito na espera
  pelo provedor), em 30–60 s. Manter `ASR_POLL_INTERVAL_MS=15000`.
- **Contabilidade:** o app já registra `LLM_USAGE` (prompt/completion/total tokens, latência,
  `finish_reason`) a cada chamada. Some isso por dia para alimentar o teto de tokens e, depois do
  primeiro dia de teste, recalibre `P.reasoning` em `estimate.mjs`. `finish_reason = "length"`
  indica que o raciocínio comeu o orçamento.

## Armazenamento e tráfego

- **Upload:** o arquivo original (até 100 MB) vai do navegador para a **API** (`/api/media`),
  que o converte em MP3 mono de 64 kbit/s (~0,48 MB/min). Só esse MP3 vai para o Supabase Storage
  (entrada não é cobrada). O tráfego de 100 MB passa pela hospedagem da API (Railway), não pelo
  Supabase.
- **Transcrição:** o worker baixa o MP3 do Storage (**egress**, ~2,4 MB por tester) e o envia à
  AssemblyAI. Depois o áudio é apagado, salvo quando o usuário escolheu conservá-lo.
- **Banco:** ~40 kB por minuto de áudio (palavras com tempos em `jsonb`, segmentos, versões e
  índices) + ~25 kB por geração salva. 100 testers + admin ≈ 38 MB de 500 MB.
- **Storage:** só o áudio retido. 100 testers + admin com 30% de retenção ≈ 89 MB de 1 GB.
- **Egress:** ~1,9 GB num dia de 100 testers, ou 37% da cota mensal de 5 GB. O áudio de
  demonstração (~3 MB por reprodução) é o maior item variável: 100 testers × 3 reproduções =
  900 MB. Servir esse arquivo pela hospedagem do frontend, com cache, tira esse peso do Supabase.

## Fontes (consultadas em 24/11/2026)

O acesso direto a groq.com, console.groq.com e assemblyai.com estava bloqueado pela rede desta
sessão. Os valores abaixo vêm de resultados de busca que citam essas páginas, e as fontes de
terceiros estão marcadas como **secundárias**. Confira os valores no console de cada provedor
antes da rodada.

- Groq — limites por modelo e por organização; `retry-after` só em 429; tokens em cache não contam
  no limite: https://console.groq.com/docs/rate-limits (oficial, via busca).
- Groq — 413 "Request too large … on tokens per minute (TPM): Limit 8000, Requested …":
  https://community.groq.com/t/gpt-oss-20b-free-tier-getting-413-errors/1411 e
  https://meta.discourse.org/t/ai-exceeds-llm-token-thresholds-randomly-and-unpredictably/402334/4
  (**secundárias**: relatos de que reduzir `max_tokens` resolve).
- Groq — preço do gpt-oss-120b US$ 0,15 / 0,60:
  https://www.morphllm.com/groq-pricing, https://computeprices.com/providers/groq/models/gpt-oss-120b
  (**secundárias**); o lançamento citava US$ 0,75 de saída:
  https://groq.com/blog/day-zero-support-for-openai-open-models. Com US$ 0,75, o custo do Groq
  sobe 25% na saída, sem mudar as conclusões.
- Groq — limites do Developer (1.000 RPM / 500 mil RPD / 250 mil TPM):
  https://www.developersdigest.tech/rate-limits/groq (**secundária**).
- AssemblyAI — STT-3.7 a US$ 0,21/h pré-gravado, pró-rata por segundo; Universal-3.5 Pro
  descontinuado em 17/11/2026: https://assemblyai.com/blog/speech-recognition-cost e
  https://assemblyai.com/pricing (oficial, via busca).
- AssemblyAI — crédito inicial de US$ 50; diarização +US$ 0,02/h; cobrança por canal:
  https://assemblyai.com/docs/billing-and-pricing (oficial, via busca).
- AssemblyAI — concorrência padrão 5 (gratuita) e 200 assíncrona (paga):
  https://www.assemblyai.com/docs/pre-recorded-audio/rate-limits.md (oficial, via busca).
- AssemblyAI — idiomas do STT-3.7 (citado no código em 20/11/2026):
  https://www.assemblyai.com/docs/pre-recorded-audio/supported-languages.
- Supabase — plano gratuito (500 MB de banco, 1 GB de storage, 5 GB de egress + 5 GB em cache, 2
  projetos ativos, pausa após 1 semana sem uso): https://supabase.com/pricing (oficial, via busca).
- Câmbio — PTAX de venda de 17/11/2026, R$ 5,7851; usamos R$ 5,80:
  https://rankia.com.br/dolar-hoje-18-novembro-2026/ (**secundária**; a PTAX de 24/11 não estava
  disponível na busca).
- `groq-sdk` 1.5.0 — `maxRetries = 2` e espera pelo `retry-after` sem teto:
  `backend/node_modules/groq-sdk/client.js` (lido localmente).
