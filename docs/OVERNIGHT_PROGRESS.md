# Sessão autônoma noturna — Voz em Estudo 3.0

Registro vivo da sessão. Atualizado a cada marco para que outra sessão possa continuar.

## Estado inicial (21/11/2026, ~04:50 UTC)

| Item | Valor |
| --- | --- |
| Branch de trabalho anterior | `feat/personalization-2-0` |
| SHA inicial | `cc7ec56` (CI Quality verde) |
| `main` antes da sessão | `47b64bf` |
| Referência de segurança | branch `backup/pre-voz-3-0` → `cc7ec56` (tags são recusadas pelo proxy) |
| Branch de integração desta sessão | `feat/voz-3-0` (a partir de `cc7ec56`) |

## Marcos

| # | Marco | Situação | Commits |
| --- | --- | --- | --- |
| M0 | Integrar PR #7 em `main` | **Feito** — merge `fee4222` (CI verde no SHA `cc7ec56`) | `fee4222` |
| M1 | Material 3.0: preparação × espaço de estudo | Implementado e testado (mock) | ver abaixo |
| M3 | Questões 3.0: falsa insuficiência | Implementado e testado (unidade + HTTP mock) | ver abaixo |
| M2 | Focar 3.0: sessão única, painel e cápsula | Em seguida | — |
| M4 | Personalização 3.0 (fundações) | Pendente | — |
| M5 | Plano diretor 3.0 + relatório | Pendente | — |

## Decisões de arquitetura

- **Modo da aula pelo estado real** (`lessonMode` em `frontend/js/utils/lesson-steps.js`):
  transcrição não confirmada → preparação; confirmada sem resumo, lista, resposta, escuta ou
  "Começar a estudar" → preparação ("Aula pronta para estudar"); caso contrário → espaço de estudo.
  A escolha "Começar a estudar" e a última aba ficam em `voz-study-v1` (sincronizado pela
  `profile_state` existente), sem migration.
- **Questões 3.0**: plano por conceito × habilidade × faceta (definição, mecanismo, relação,
  causa/efeito, aplicação, implicação), limitado pelo tamanho da transcrição
  (`WORDS_PER_QUESTION = 60`), não por "no máximo 2 por conceito". Vagas extras (spare) absorvem
  rejeições sem nova chamada; uma rodada de reposição limitada (máx. 3 chamadas). Motivo da falta
  classificado: `insufficient_content` só quando o plano foi limitado pela fonte; senão
  `unsupported`, `invalid`, `redundancy` ou `model_omitted`. Prompt `questions-v2.2`.

## Testes

Ver seção de cada marco no relatório final. Distinção: unidade/HTTP com mock ≠ integração real ≠
produção. Nenhuma chamada paga a provedores de IA foi feita.

## Migrations

Nenhuma nova até agora.

## Próximos passos

1. Focar 3.0 (M2): uma sessão autoritativa entre páginas/abas, painel direito e cápsula.
2. Presets de questões (Essencial, Compreender, Aplicar, Equilibrado, Prova) na UI.
3. Plano diretor 3.0.
