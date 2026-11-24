# Documentação do Voz em Estudo

Comece por aqui. Os documentos de **referência** descrevem o sistema como ele é hoje; os
**históricos** registram planos e decisões de cada etapa e levam um aviso no topo.

## Referência (atual)

| Documento                                                | Conteúdo                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [REVISAO_3_7.md](REVISAO_3_7.md)                         | Revisão 3.7: o que mudou, inventário de ativação/validação, referências visuais e pendências      |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md)                 | Tudo o que o app faz, página por página; onde cada dado fica; o que já pode ser ligado em produção |
| [ARCHITECTURE.md](ARCHITECTURE.md)                       | Componentes, camadas do backend, fluxo de uma aula, geração de questões, segurança                 |
| [API.md](API.md)                                         | Todas as rotas HTTP, flags, corpos e erros                                                         |
| [BANCO_DE_DADOS.md](BANCO_DE_DADOS.md)                   | Migrations (com situação da produção), tabelas, RLS e ordem das próximas aplicações                |
| [CONFIGURACAO.md](CONFIGURACAO.md)                       | Variáveis de ambiente, flags e ajustes no painel do Supabase                                       |
| [AI_PROVIDERS.md](AI_PROVIDERS.md)                       | Provedores de transcrição e de texto, como trocar e o que cada um exige                            |
| [CAPACIDADE_E_CUSTOS.md](CAPACIDADE_E_CUSTOS.md)         | Tokens medidos dos prompts, custos e limites por nº de testers, tetos globais recomendados         |
| [FLUXO_MATERIAL.md](FLUXO_MATERIAL.md)                   | Do envio à geração, do ponto de vista do material                                                  |
| [ATIVACAO_RECURSOS.md](ATIVACAO_RECURSOS.md)             | Situação de cada flag (código, banco, validação) e roteiro para ligar o que falta                  |
| [ROADMAP.md](ROADMAP.md)                                 | Pronto, não ativado, migrations pendentes, validação incompleta, dívidas técnicas                  |
| [GAMIFICACAO_2_0_DESIGN.md](GAMIFICACAO_2_0_DESIGN.md)   | Desenho da gamificação verificada pelo servidor (planejado)                                        |
| [TESTING.md](TESTING.md)                                 | Comandos de teste e o que cada um comprova                                                         |
| [AUDIO_E_MUSICA.md](AUDIO_E_MUSICA.md)                   | Sons ambientes gerados no navegador, mixer, retomada entre páginas, mini-player e música (YouTube/Spotify) |
| [CONFIGURAR_LOGIN_SOCIAL.md](CONFIGURAR_LOGIN_SOCIAL.md) | Login com Google e GitHub                                                                          |
| [CODING_STANDARDS.md](CODING_STANDARDS.md)               | Padrões de código                                                                                  |
| [CSS_GUIDE.md](CSS_GUIDE.md)                             | Organização do CSS                                                                                 |
| [CREDITOS_INTERFACE.md](CREDITOS_INTERFACE.md)           | Créditos de recursos visuais                                                                       |
| [../PUBLICAR_NO_GITHUB.md](../PUBLICAR_NO_GITHUB.md)     | Publicar o código sem expor segredos                                                               |

## Decisões

- [ADR-001 — qualidade e compatibilidade](decisions/ADR-001-quality-and-compatibility.md)
- [ADR-002 — revisão humana e fonte imutável](decisions/ADR-002-human-review-and-generation.md)

## Acompanhamento recente

- [implementation-2.0/11-study-authoring-workplan.md](implementation-2.0/11-study-authoring-workplan.md) —
  resumos e listas nomeados, gerador de questões v2, exportação, compartilhamento de listas, flashcards 2.0.
- [implementation-2.0/12-followups-checklist.md](implementation-2.0/12-followups-checklist.md) —
  melhorias de 19–20/11 (upload retomável, questões, disciplinas, senhas) e o que conferir depois do deploy.

## Históricos

Planos e runbooks de cada etapa (`implementation-2.0/01` a `10`, `security-review.md`),
[SETUP.md](SETUP.md), [user-manual.md](user-manual.md), [PRODUTIVIDADE.md](PRODUTIVIDADE.md),
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), [CONSOLIDACAO_TCC.md](CONSOLIDACAO_TCC.md),
[first-integrated-test.md](first-integrated-test.md),
[accessibility-integrated-test.md](accessibility-integrated-test.md) e
[academic/e02-tcc-notes.md](academic/e02-tcc-notes.md).

## Glossário

| Termo            | Significado                                                        |
| ---------------- | ------------------------------------------------------------------ |
| Aula / material  | Uma gravação enviada e tudo o que é gerado a partir dela           |
| Versão (revisão) | Estado imutável da transcrição; editar ou restaurar cria uma nova  |
| Confirmação      | A pessoa declara que conferiu uma versão; só ela alimenta gerações |
| Tarefa (job)     | Trabalho do worker: processamento inicial, resumo ou questões      |
| Flag             | `FEATURE_*` no `.env`; liga um recurso. Desligada por padrão       |
| E02, E03…        | Etapas do projeto; cada uma tem uma migration e um plano           |
| ASR              | Reconhecimento de fala (transcrição automática)                    |
| Trecho de apoio  | Frase da transcrição que sustenta uma questão ou cartão            |
| Nino             | Mascote do app                                                     |
