# Plano diretor — Voz em Estudo 3.0

Documento vivo, escrito a partir do código e do manual "Voz em Estudo 3.0 — Manual e Prompts" de 21/11/2026.

Para cada parte, este documento registra:

- o que **existe e foi testado**;
- o que é **fundação**;
- o que é **desenho** ainda não implementado.

Nada aqui deve ser lido como entregue se o status não disser isso.

**Legenda de status**: Planejado → Desenhado → Implementado → Testado automaticamente → Integrado (em `main`) → Validado manualmente → Publicado.

Até 21/11/2026, nada da versão 3.0 foi validado manualmente com contas reais nem publicado.

---

## 1. Visão

O Voz em Estudo deixa de ser apenas "transcrever uma aula e gerar resumo" e passa a ser um ambiente de estudo pessoal, que pode ser colaborativo e é profundamente personalizável. Ele ajuda a:

- organizar aulas gravadas;
- encontrar informação na gravação;
- entender o que é central;
- praticar recuperação ativa (questões e flashcards);
- anotar;
- planejar;
- manter o foco;
- estudar com quem a pessoa já conhece.

Princípios:

1. **O aprendizado vem primeiro.** Personalização, gamificação e social enriquecem o estudo; nunca o atrapalham.
2. **Abrir uma aula e estudar é imediato.** Recursos avançados não complicam o caminho comum.
3. **Privado por padrão.** Compartilhar é sempre um ato explícito, com permissão clara e revogável quando isso for tecnicamente possível.
4. **Fonte confirmada.** Todo material gerado aponta para uma revisão confirmada da transcrição e para os trechos que o sustentam. O áudio não captura o que só aparece visualmente na aula, e isso é dito ao estudante.
5. **Integridade acadêmica.** Este projeto é um TCC. As funções 3.0 descritas aqui **não** fizeram parte das avaliações com usuários já relatadas e não devem ser apresentadas como se tivessem feito.

## 2. Arquitetura atual (verificada no código)

- **Front end:** páginas HTML separadas e módulos ES, sem etapa de build.
  - `theme-init.js` aplica as preferências antes da primeira pintura.
  - `preferences.js` controla as opções de interface.
  - `shell.js` autentica e inicia sincronizações e ferramentas.
  - O catálogo de frases (`js/i18n`) traduz a interface para en, es e zh-CN.
- **Back end:** Node/Express (`backend/src`), com worker de jobs, provedores de IA intercambiáveis (`src/ai`), prompts versionados (`src/prompts`) e Supabase (Postgres com RLS e funções `*_admin` chamadas pelo service role).
- **Dados do estudante:**
  - `profile_state` guarda chaves por conta (preferências, histórico de estudo local `voz-study-v1`, layouts), com comparação e troca (compare-and-set).
  - `study_sessions` e `study_time_credits` guardam o tempo de estudo, creditado pelo servidor.
  - `study_annotations` guarda anotações ancoradas a uma revisão imutável.
- **Testes:**
  - backend com `node:test`;
  - front end com testes de unidade (jsdom);
  - jornadas de navegador (Playwright) com API e Supabase simulados (`frontend/tests/support/mock-app.cjs`);
  - axe em vários temas;
  - CI "Quality" no GitHub.

## 3. Linguagem visual e sistema de design

As referências do usuário fornecem a direção. Nenhum ativo de terceiros é copiado; tudo é desenho próprio. As referências são:

- iOS Core / Desktopcore;
- macOS (Finder, Aqua);
- planners kawaii e scrapbook;
- matcha, lavanda e pastel;
- LifeAt, Pomofox, YPT.

Elementos da linguagem visual:

- **Objetos digitais reconhecíveis:** pastas (Biblioteca como explorador), janelas e cartões com brilho superior (tema Mesa digital), cápsulas e popovers translúcidos (cronômetro, ações de seleção), chips de modo.
- **Uma ousadia por tela:** o anel do foco com o Nino; o resto silencioso.
- **Tokens, não cores soltas.** Os temas mudam `--background`, `--surface`, `--accent*`, `--button-*` e `--studio-sprinkle`. Fundos e vidro usam essas cores, o que mantém todo tema coerente.
- **Liberdade com garantias:** contraste mínimo nos temas prontos (axe em todos); pouco estímulo, leitor de tela e alto contraste desligam a decoração; "Restaurar visual padrão" sempre disponível.

| Item | Status |
| --- | --- |
| Biblioteca como explorador (pastas, grade/lista, busca) | Integrado (antes da 3.0) |
| Temas Matcha, Mesa digital e Planner | Testado automaticamente (`1a07155`) |
| Fundos declarativos, por página, superfícies de vidro | Testado automaticamente (`1a07155`) |
| Breadcrumbs, seleção múltipla e capas de pasta na Biblioteca | Planejado |
| Estúdio avançado (fontes, formas, adesivos, widgets, import/export) | Desenhado (§11) |

## 4. Material 3.0 — espaço de estudo da aula

**Implementado e testado automaticamente** (`1acde64`).

- O modo vem do estado real da aula (`lessonMode`), não do caminho de navegação:
  - transcrição não confirmada → **preparação** ("Prepare esta aula": conferir, corrigir, confirmar);
  - transcrição confirmada sem nada gerado ou estudado → preparação ("Aula pronta para estudar": gerar resumo, questões ou flashcards, ou "Começar a estudar");
  - nos demais casos → **espaço de estudo**: título, player com waveform e abas (Transcrição, Resumo, Questões, Anotações).
- "Guia da aula" reabre as etapas quando o estudante quiser.
- A última aba é restaurada a partir do estado sincronizado (`voz-study-v1.lastTab`). A posição de escuta já era restaurada.

Pendente:

- ~~aba própria de Flashcards na aula~~: feito em `a31e078` (conjuntos da aula, "Revisar agora" com `?conjunto=`);
- teste de transcrições muito longas;
- teste do estado "processando" em navegador real.

## 5. Shell de ferramentas e Focar 3.0

**Implementado e testado automaticamente** (`5501d38`).

**Diagnóstico.** Antes, cada página criava um cronômetro em memória. Sair da página encerrava a sessão no servidor, e a página seguinte começava parada. Planejar e a aula compartilhavam só os dados.

**Modelo.** Há uma sessão de foco por conta (`voz-focus-v1:<userId>`, `utils/focus-session.js`), com várias apresentações.

| Regra | Como funciona |
| --- | --- |
| Tempo restante | Calculado pelos horários de relógio: planejado − (acumulado + agora − início do trecho). Sobrevive a navegação e recarga. |
| Abas | Uma aba visível é a líder: confirma a execução (`lastSeen`) e envia o heartbeat a cada 15 s. Outra aba assume se a líder sumir. |
| Navegação | `pagehide` passa a liderança adiante; a próxima página continua sem lacuna. |
| Tick perdido | Gravado antes do envio; a próxima página reenvia o mesmo número de sequência, aceito de forma idempotente pelo servidor. |
| Nenhuma página visível | Após 20 s sem confirmação, a execução para nesse ponto; o intervalo oculto **não** é creditado. |
| Crédito | Só o servidor credita, com os próprios horários: no máximo 30 s por tick, e lacunas acima de 45 s encerram a sessão. Pausas nunca contam. |
| Outro aparelho | Se houver sessão ativa em outro aparelho, o cronômetro corre aqui, avisando que o tempo conta só lá. |
| Blocos | Foco, pausa curta e pausa longa configuráveis; pausa longa a cada N; início automático opcional; som opcional; histórico de blocos. |

Apresentações:

- página **Focar**;
- Planejar › Tempo de estudo;
- **painel lateral**: estreita o conteúdo em telas a partir de 1280 px; folha inferior no celular;
- **cápsula** flutuante.

Fechar ou esconder qualquer uma delas não para a sessão.

Pendente:

- a duração escolhida fica por navegador, não sincronizada;
- o histórico de ciclos não vai para a conta (precisaria de uma chave `profile_state` ou de uma tabela);
- notificações do sistema;
- atalho "Iniciar foco" no Início;
- teste em aparelhos reais com suspensão.

## 6. Questões 3.0

**Implementado e testado automaticamente** (`8fad422`, `b8b4b63`).

**Causas da falsa "falta de conteúdo"**, encontradas no código:

1. O plano limitava cada conceito a 2 vagas (1 com uma só habilidade). Três conceitos amplos davam no máximo 3 questões.
2. Conceitos com citação parafraseada eram descartados.
3. Conceito igual com habilidade igual era sempre tratado como "mesmo conhecimento", mesmo quando o aspecto era outro.
4. Toda falta era rotulada `insufficient_content`.

**Novo plano** (`question-plan.js`, `questions-v2.2`):

- Vagas combinam conceito × habilidade × **faceta**: definição, mecanismo, relação, causa/efeito, aplicação e implicação.
- Os conceitos são percorridos em rodízio: todos são cobertos antes de algum ser repetido, e uma repetição sempre muda de faceta.
- A capacidade é limitada pelo tamanho da fonte (cerca de 60 palavras por questão) e nunca enche uma aula curta com perguntas de preenchimento.
- Vagas reserva absorvem as rejeições.
- Há uma rodada de reposição limitada (no máximo 3 chamadas por lista).

**Motivos de falta**:

| Motivo | Quando aparece |
| --- | --- |
| `insufficient_content` | Só quando a fonte limitou o plano. |
| `unsupported` | A citação não está na aula. |
| `invalid` | O formato veio errado. |
| `redundancy` | Questões repetidas foram descartadas. |
| `model_omitted` | O modelo pulou vagas. |

A interface explica cada motivo e só culpa a aula no primeiro caso.

**Interface**:

- objetivos (presets) **Essencial, Compreender, Aplicar, Equilibrado, Preparação para prova** e a quantidade em primeiro plano;
- dificuldade, habilidades, ordem e listas anteriores em "Opções avançadas".

Testes de regressão:

- uma aula real de 1.000 palavras (solos) com 3 conceitos amplos → 5 questões distintas, com 1 ou 2 habilidades;
- omissões absorvidas por vagas reserva;
- reposição;
- citações inventadas → `unsupported`;
- aula curta → `insufficient_content`.

Pendente:

- ranking explícito de importância pedagógica (hoje o prompt orienta a priorizar o central);
- evidências em vários fragmentos;
- reportar, editar ou rejeitar uma questão;
- medição com provedor real (custo e validade) — ainda não feita.

## 7. Anotações 3.0 e caderno da aula

**Fundação implementada e testada automaticamente** (`edfb5b1`):

- Selecionar palavras no texto da transcrição (modo leitura) abre um popover com **Destacar** (salva na hora) e **Comentar** (abre a aba Anotações com o trecho anexado).
- As âncoras usam as coordenadas já validadas pelo servidor: revisão, segmento, offsets em code points e citação.
- No caderno, cada destaque tem **Ouvir mm:ss** (toca o trecho) e **Ir ao destaque** (seleciona as palavras e recusa revisões diferentes).

**Desenho** (exige migrations; não aplicadas):

```sql
-- Âncoras com vários segmentos (aditiva; mantém as colunas atuais para destaques antigos).
alter table public.study_annotations
  add column end_segment_position integer,
  add column anchor_version smallint not null default 1;
-- start em (segment_position,start_offset), fim em (end_segment_position,end_offset);
-- validação na função admin: todos os segmentos pertencem à revisão e a citação confere.

-- Cadernos ricos (documento próprio, privado por padrão).
create table public.study_notebooks (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('material','unit','subject','personal')),
  scope_id uuid, title text not null check (length(title) <= 160),
  doc jsonb not null default '{"type":"doc","content":[]}',   -- árvore de blocos validada no servidor
  version integer not null default 1, created_at timestamptz default now(), updated_at timestamptz default now(),
  deleted_at timestamptz
);
-- RLS como nas demais tabelas: só service role; funções *_admin verificam o dono.
```

Editor:

- blocos estruturados (título, parágrafo, listas, checklist, citação, callout, tabela, link, imagem, código, referência a trecho);
- persistidos em JSON e validados no servidor;
- renderizados sem `innerHTML` de entrada do usuário.

Compartilhar uma nota é um ato explícito e por item. Compartilhar um caderno nunca inclui comentários privados não selecionados.

## 8. Flashcards 3.0 — conteúdo, aparência e histórico separados

**Desenho**. A fundação de templates ainda não foi implementada.

O princípio é ter **três camadas independentes**:

1. **Conteúdo educacional**:
   - `flashcard_notes`: tipo (pergunta e resposta, termo, cloze, causa e efeito, comparação, sequência, aplicação, identificação de erro), campos estruturados, fonte (revisão e trechos), autoria;
   - gerado pela IA como **dados**, nunca como HTML.
2. **Aparência**:
   - `card_templates`: família de template com variantes por tipo de cartão e tokens (fonte, cores, fundo, imagem, layout);
   - HTML/CSS opcional, renderizado em sandbox (iframe `sandbox` sem scripts, CSS sem `url()` externo, sem `@import`);
   - preferência global e substituição por baralho.
3. **Histórico de revisão**:
   - `flashcard_reviews` por usuário e cartão, nunca compartilhado nem copiado.

Trocar o template nunca regenera nem altera o conteúdo, as respostas, as referências ou o histórico.

**Mescla pessoal de baralhos de colegas** (exemplo: 4 de 7 colegas):

1. Escolher baralhos autorizados (e, se quiser, cartões avulsos).
2. Ver uma prévia com duplicatas exatas (hash de campos normalizados) e possíveis duplicatas semânticas (similaridade lexical; embeddings no futuro), para o estudante decidir.
3. O resultado é um **baralho pessoal novo**:
   - as notas são copiadas com `origin_note_id`, `origin_author` e `origin_deck`;
   - sem sincronização automática com a origem;
   - edição e histórico próprios;
   - os baralhos de origem não mudam.
4. Aparência:
   - (A) manter os estilos compatíveis de cada origem; ou
   - (B) aplicar **um** template a todos os cartões, com variantes por tipo, sem tocar o conteúdo.

**Importação Anki `.apkg`**:

- SQLite dentro de um zip;
- ler os note types, campos, cartões básicos e cloze, e a mídia;
- templates do Anki convertidos para tokens ou sandbox; scripts descartados;
- histórico de revisão do Anki tem compatibilidade limitada e é documentado como tal;
- AnkiConnect/AnkiWeb fora do primeiro escopo.

## 9. Aprendizagem multiaula e multiunidade

**Desenho**.

Fontes possíveis: uma aula, várias, uma unidade, uma disciplina, um objetivo ou uma coleção.

1. **Mapa de conhecimento por revisão**: conceitos, objetivos, relações, pré-requisitos. Fica em cache por `(material_id, source_revision_id, prompt_version)`, reutilizado e invalidado quando a revisão muda.
2. **Seleção de fontes sem escolher arquivo por arquivo**: "toda a unidade" gera a lista de revisões confirmadas no momento do pedido, que fica registrada no material gerado.
3. **Geração integradora só com conexões reais**: o plano de cobertura recebe os mapas, e não as transcrições concatenadas. As evidências apontam para cada revisão de origem.
4. Os materiais antigos continuam ligados às revisões que os produziram.

## 10. Turmas privadas, amigos e IA compartilhada

**Desenho**.

**Papéis**: professor (dono), gestor e aluno.

O aluno envia uma gravação para uma **fila de envios**, que passa por etapas separadas:

1. envio;
2. aprovação para processar;
3. transcrição;
4. confirmação humana;
5. aprovação para publicar;
6. disponível na turma.

Nada é publicado automaticamente. Publicar significa "visível aos membros", nunca público na internet.

Entrar numa turma **não** expõe notas, gravações pessoais ou progresso de cada aluno.

**Geração uma vez, reutilizada quando apropriado**:

```text
generation_key = sha256(json_canonical({
  scope: classroom_id | user_id,
  sources: [sorted source_revision_ids],
  kind: 'questions' | 'summary' | 'flashcards',
  settings: { ...apenas os que mudam o conteúdo (objetivo, habilidades, dificuldades, quantidade, foco) },
  prompt_version, model_family
}))
```

- Tabela `generation_jobs(generation_key unique where status in ('queued','running'))`: dois pedidos equivalentes ao mesmo tempo esperam o mesmo job.
- Resultados concluídos podem ser reutilizados conforme as regras da turma.
- Template visual e idioma da interface **não** entram na chave.
- Tentativas e revisões continuam individuais.

**Regras configuráveis pelo professor**:

- quem pode gerar (só o professor, aluno com aprovação, aluno com cota);
- como publicar (automática após validação, com aprovação do professor, rascunho privado).

**Amigos**:

- convite por link ou código, sem lista de contatos;
- compartilhar com amigos selecionados, sempre autenticado (um link reencaminhado não dá acesso);
- presença de foco voluntária;
- revogação explicada: uma cópia independente já feita não volta.

Público e comunidade abertos ficam para uma fase posterior, com moderação, denúncias e remoção. Não serão implementados agora.

## 11. Personalização 3.0 — estúdio criativo

Já existe:

- temas, perfis de tema salvos, modos de estudo;
- Estúdio visual (fundos, fundo por página, vidro, restaurar);
- tudo em `audioestudo-ui-preferences` e `audioestudo-theme`, sincronizados por conta.

**Desenho** do esquema declarativo versionado (`voz-studio-v1`), dentro de `profile_state`:

```json
{ "v": 1, "base": "matcha", "typography": { "heading": "serif-editorial", "body": "inter" },
  "shape": { "radius": "soft", "shadow": "lifted", "glass": 0.74 },
  "wallpaper": { "kind": "pattern|gradient|image", "ref": "dots|asset:<id>" },
  "pages": { "focus": { "wallpaper": "stars" } }, "widgets": { "capsule": { "corner": "br" } },
  "stickers": [ { "asset": "nino-reading", "page": "dashboard", "x": 0.8, "y": 0.1 } ] }
```

- Imagens e GIFs ficam no Storage, com tamanho e tipo validados, e são servidos por URL assinada.
- Nada de CSS ou JS livre.
- Os controles essenciais (navegação e restaurar) ficam fora do alcance da personalização.
- Avisos de legibilidade, sem proibir estéticas pessoais.
- Modos simples e avançado, com prévia ao vivo.

## 12. Música

**Primeira fatia implementada (`6439743`):** sons ambientes gerados no navegador (Web Audio: ruído marrom, chuva suave e ondas), sem gravações nem licenças, como a ferramenta "Som" do mesmo painel do Focar. Inclui volume e redução automática (ducking) enquanto a gravação da aula toca, e oferece "Retomar som" depois de trocar de página.

**Ainda em desenho:** faixas licenciadas, playlists, Spotify e YouTube.

- O player é uma ferramenta do mesmo shell do Focar: cápsula, painel e página Focar.
- Música e foco são independentes.
- Fontes: faixas próprias ou licenciadas para streaming (a definir). Spotify e YouTube só por SDK ou embed oficiais, com o player visível como exigem os termos.
- Duck automático: o volume da música baixa enquanto a gravação da aula toca. É viável com áudio próprio (Web Audio) e limitado com players de terceiros.
- **Limite técnico:** com páginas HTML separadas, o áudio para a cada navegação. A continuidade exige navegação parcial (SPA ou "shell" com iframe) ou um popup dedicado; nada disso foi feito nem testado. O cronômetro, ao contrário, já continua, porque é estado e não um fluxo de áudio.

## 13. Planejar 3.0

Já existe (antes desta sessão):

- objetivos e tarefas em diálogos;
- calendário mensal com agenda;
- tempo de estudo com meta semanal.

Desenho:

- objetivos ligados a unidades, com inclusão de aulas novas por regra explícita;
- semana em blocos de horário com movimentação acessível (arrastar é opcional);
- estatísticas semanais e mapa anual opcional;
- nada de streaks punitivos; visitas a páginas não contam como estudo.

## 14. Segurança, dados e custos

- RLS e funções `*_admin` em todas as tabelas novas.
- Chaves de idempotência (`last_request_id`) nas gravações.
- Limites por conta nas rotas caras.
- Nenhuma migration de produção sem autorização explícita. Esta sessão **não** criou nem aplicou migrations.
- Custos de IA: chamadas limitadas por pedido, já aplicado nas Questões (no máximo 3), e reutilização por `generation_key` (desenho).

## 15. Fases

| Fase | Conteúdo | Depende de |
| --- | --- | --- |
| 3.0-a (esta sessão) | Material, Focar, Questões, Estúdio visual, destaques no texto | — |
| 3.0-b | Cadernos ricos + âncoras multissegmento (migrations §7) | aprovação das migrations |
| 3.0-c | Flashcards 3.0: tipos, templates, mescla, Anki | 3.0-b (compartilhamento) |
| 3.0-d | Multiaula / mapa de conhecimento | Questões 3.0 |
| 3.0-e | Turmas privadas, envios aprovados, `generation_key` | 3.0-c, 3.0-d |
| 3.0-f | Amigos e salas de foco; música licenciada | shell de ferramentas |
| depois | Comunidade pública moderada | moderação, políticas |

## 16. Testes exigidos

Toda fase precisa de:

- testes de unidade do domínio;
- jornadas de navegador (desktop e celular, axe);
- testes HTTP com permissões entre contas;
- migrations testadas em ambiente não produtivo;
- validação manual com contas reais antes de declarar "Validado".

Resultados mock não equivalem a integração real.

## 17. Riscos e limites conhecidos

- O tempo restante do cronômetro usa o relógio do aparelho; o crédito usa o do servidor. Um relógio muito errado só afeta a exibição.
- O fundo "vidro" depende de `backdrop-filter`; em navegadores sem suporte, as superfícies ficam sólidas.
- Destaques com vários segmentos ainda não são possíveis.
- Os presets de Questões e a classificação de faltas não foram medidos com provedor real.
- As traduções dos textos novos não foram revisadas por falantes nativos.
