# Sessão autônoma noturna — Voz em Estudo 3.0

Registro vivo da sessão. É atualizado a cada marco para que outra sessão possa continuar o trabalho.

## Estado inicial (21/11/2026, ~04:50 UTC)

| Item | Valor |
| --- | --- |
| Branch de trabalho anterior | `feat/personalization-2-0` |
| SHA inicial | `cc7ec56` (CI Quality verde) |
| `main` antes da sessão | `47b64bf` |
| Referência de segurança | branch `backup/pre-voz-3-0` → `cc7ec56` (o proxy recusa tags) |
| Branch de integração desta sessão | `feat/voz-3-0`, a partir de `cc7ec56` |
| PR desta sessão | [cathcherry/VozEmEstudo#8](https://github.com/cathcherry/VozEmEstudo/pull/8) (rascunho, base `main`) |

## Marcos

| # | Marco | Situação | Commit |
| --- | --- | --- | --- |
| M0 | Integrar o PR #7 em `main` | **Feito**: merge `fee4222` (CI verde em `cc7ec56`) | `fee4222` |
| M1 | Material 3.0: preparação × espaço de estudo | Implementado e com testes automáticos (mock) | `1acde64` |
| M3a | Questões 3.0: falsa insuficiência (backend) | Implementado e com testes automáticos (unidade + HTTP com mock) | `8fad422` |
| M2 | Focar 3.0: sessão única, painel lateral e cápsula, página Focar | Implementado e com testes automáticos (8 de unidade + jornada) | `5501d38` |
| M3b | Questões 3.0: objetivos (presets) e opções avançadas | Implementado e com testes automáticos | `b8b4b63` |
| M4 | Personalização 3.0: 3 temas, fundos, vidro, fundo por página | Implementado e com testes automáticos (axe) | `1a07155` |
| M6 | Anotações 3.0: Destacar/Comentar no texto, ouvir trecho, voltar ao destaque | Implementado e com testes automáticos | `edfb5b1` |
| M5 | Plano diretor 3.0 | **Feito** | `62f8288` |
| M7 | Flashcards 3.0: modelos visuais separados do conteúdo | Implementado e com testes automáticos (axe em cada modelo) | `52b3284` |
| M8 | IA compartilhada: chave canônica e single flight (fundação) | Implementado e com testes de unidade; ainda não conectado aos jobs | `1a69148` |
| M9 | Início: "Iniciar foco" com um clique | Implementado e com testes automáticos | `98a1e3a` |

O CI do `5501d38` falhou por uma contagem de links no dock do modo foco, que mudou com o novo item "Focar". Isso foi corrigido em `b8b4b63`.

## Decisões de arquitetura

### Modo da aula pelo estado real

- A função `lessonMode`, em `frontend/js/utils/lesson-steps.js`, decide o modo da aula.
- Transcrição não confirmada → preparação.
- Transcrição confirmada sem resumo, lista, resposta, escuta ou "Começar a estudar" → preparação, com o título "Aula pronta para estudar".
- Nos demais casos → espaço de estudo.
- A escolha "Começar a estudar" e a última aba ficam em `voz-study-v1`, já sincronizado pela `profile_state`.

### Questões 3.0

- O plano combina conceito × habilidade × faceta: definição, mecanismo, relação, causa/efeito, aplicação e implicação.
- O tamanho do plano é limitado pela transcrição (cerca de 60 palavras por questão), e não por "no máximo 2 por conceito".
- Vagas reserva absorvem as rejeições.
- Há uma única rodada de reposição, com no máximo 3 chamadas ao modelo.
- O motivo da falta é classificado: `insufficient_content` só quando a fonte limitou o plano; caso contrário, `unsupported`, `invalid`, `redundancy` ou `model_omitted`.
- O filtro de redundância passou a considerar a faceta.
- Conceitos com citação parafraseada são mantidos se as palavras do rótulo estiverem na aula.
- Versão do prompt: `questions-v2.2`.

### Focar 3.0

- Uma sessão por conta, em `localStorage` (`voz-focus-v1:<userId>`), calculada a partir de horários de relógio.
- Uma aba líder, visível, envia o heartbeat ao servidor.
- Os ticks são gravados antes do envio. Assim, a próxima página reenvia o mesmo tick, e o servidor o aceita de forma idempotente.
- Uma execução não confirmada por 20 s para nesse ponto, e o intervalo oculto não recebe crédito.
- O crédito continua 100% no servidor, que usa os próprios horários e credita no máximo 30 s por tick.
- O shell de utilidades (`utility-shell.js`) oferece:
  - botão no topo;
  - painel à direita que estreita o conteúdo em telas largas (folha inferior no celular);
  - cápsula flutuante.

  Esconder qualquer um deles nunca para a sessão.

### Personalização 3.0

- Novos temas `matcha`, `desktop` e `planner`.
- Fundos declarativos: `wallpaper` (CSS com as cores do tema), mais `pageWallpapers` por página e `surfaces` (sólidas ou vidro).
- Tudo fica em `audioestudo-ui-preferences`, já sincronizado. Não foi criado novo armazenamento.

Nenhuma migration foi criada ou aplicada.

## Testes (contêiner, API simulada)

- Backend: suíte completa verde. Inclui `question-generation` (11) e `study-authoring-http` (7).
- Front end, unidade: `test:dom`, `test:study-tracking` (correção: os testes de `focus-session` só passaram a fazer parte deste script em `6439743`; antes eram rodados à mão), `test:planning-ui`, `test:personalization`, `test:study-authoring`, `test:flashcards-ui`, `test:learning-tools` e `test:quality`.
- Navegador:
  - `browser-check` (57);
  - `dashboard-home` (9);
  - `navigation`;
  - `personalization` (8);
  - `feature-validation` (6);
  - `focus-check` (5, novo);
  - `i18n-check`;
  - `account-privacy` (6);
  - `theme-check` (3 casos, com os temas novos).
- Nenhuma chamada paga. Login, Supabase e provedores reais **não** foram testados.

## Próximos passos (em ordem)

1. Anotações 3.0: caderno da aula (comentários com trecho e tempo, ouvir o trecho) e desenho do modelo de âncoras com vários segmentos e de documentos ricos.
2. Plano diretor 3.0 (`docs/PLANO_DIRETOR_VOZ_EM_ESTUDO_3_0.md`).
3. Flashcards 3.0: separação entre conteúdo e template (fundação).
4. Revisar o CI do PR #8 e, com tudo verde, decidir o merge.

## Continuação — branch `feat/voz-3-1` (PR #9)

| Marco | Commit |
| --- | --- |
| Durações do Focar na conta (`focusSettings`) | `f494ef4` |
| Biblioteca em lista estilo Finder; "+ Nova disciplina"; catálogo no simulador | `7263872` |
| Aba Flashcards na aula + `?conjunto=` em Revisar | `a31e078` |
| Blocos do Focar ligados à aula; notificação do sistema (opcional) | `4c6052f` |
| Imagem ou GIF próprio como fundo | `fd83fee` |
| Tipografia dos títulos | `4f35699` |
| Som ambiente gerado no navegador (ruído marrom, chuva, ondas) com ducking | `6439743` |
