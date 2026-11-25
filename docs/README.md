# Documentação do Voz em Estudo

Para começar, veja o [README do projeto](../README.md): o que o app faz, o site publicado e como
rodar no computador.

## O sistema

| Documento                                | Conteúdo                                                       |
| ---------------------------------------- | -------------------------------------------------------------- |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | Tudo o que o app faz, página por página, e onde cada dado fica |
| [FLUXO_MATERIAL.md](FLUXO_MATERIAL.md)   | Do envio da gravação à geração dos materiais                   |
| [ARCHITECTURE.md](ARCHITECTURE.md)       | Componentes, camadas do backend, fluxo de uma aula e segurança |
| [API.md](API.md)                         | Rotas HTTP, flags, corpos e erros                              |
| [BANCO_DE_DADOS.md](BANCO_DE_DADOS.md)   | Tabelas, migrations e regras de acesso (RLS)                   |
| [migrations/](migrations/)               | Um documento por migration dos recursos mais recentes          |
| [AI_PROVIDERS.md](AI_PROVIDERS.md)       | Provedores de transcrição e de texto e como trocar             |
| [IDIOMAS.md](IDIOMAS.md)                 | Tradução da interface                                          |
| [AUDIO_E_MUSICA.md](AUDIO_E_MUSICA.md)   | Sons ambientes, mixer e mini-player                            |
| [PERFIL_CARDS.md](PERFIL_CARDS.md)       | Cards do perfil                                                |

## Configurar, publicar e operar

| Documento                                                            | Conteúdo                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [CONFIGURACAO.md](CONFIGURACAO.md)                                   | Variáveis de ambiente, flags e ajustes no painel do Supabase      |
| [CONFIGURAR_LOGIN_SOCIAL.md](CONFIGURAR_LOGIN_SOCIAL.md)             | Login com Google e GitHub                                         |
| [HOSPEDAGEM.md](HOSPEDAGEM.md)                                       | Publicação no Railway (API e worker) e situação atual             |
| [LANCAMENTO_TESTE_PUBLICO.md](LANCAMENTO_TESTE_PUBLICO.md)           | Programa de testes: cotas, administradoras, acompanhar e encerrar |
| [CAPACIDADE_E_CUSTOS.md](CAPACIDADE_E_CUSTOS.md)                     | Custos dos provedores de IA e limites recomendados                |
| [SECURITY_AUDIT_PUBLIC_TESTING.md](SECURITY_AUDIT_PUBLIC_TESTING.md) | Auditoria de segurança antes do teste público                     |
| [RELATORIO_TESTE_PUBLICO.md](RELATORIO_TESTE_PUBLICO.md)             | Relatório da preparação do teste público                          |

## Qualidade e testes

| Documento                                          | Conteúdo                                            |
| -------------------------------------------------- | --------------------------------------------------- |
| [TESTING.md](TESTING.md)                           | Como rodar os testes e o que cada um verifica       |
| [PAINEL_TESTE_MANUAL.md](PAINEL_TESTE_MANUAL.md)   | Roteiro de teste manual com login real              |
| [STAGING_E2E.md](STAGING_E2E.md)                   | Teste ponta a ponta contra o ambiente de staging    |
| [STAGING_BROWSER_AUTH.md](STAGING_BROWSER_AUTH.md) | Login e armazenamento no navegador contra o staging |
| [CODING_STANDARDS.md](CODING_STANDARDS.md)         | Padrões de código                                   |
| [CSS_GUIDE.md](CSS_GUIDE.md)                       | Organização do CSS                                  |

## Design e TCC

| Documento                                                                | Conteúdo                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [tcc-apendice-c/LEGENDAS.md](tcc-apendice-c/LEGENDAS.md)                 | Apêndice C: capturas de todas as telas, com legendas       |
| [academic/e02-tcc-notes.md](academic/e02-tcc-notes.md)                   | Notas para o TCC sobre revisão humana e geração            |
| [decisions/](decisions/)                                                 | Decisões de arquitetura (ADR-001 e ADR-002)                |
| [PLANO_DIRETOR_VOZ_EM_ESTUDO_3_0.md](PLANO_DIRETOR_VOZ_EM_ESTUDO_3_0.md) | Plano da versão 3.0                                        |
| [EXPERIENCE_VISION_3_5.md](EXPERIENCE_VISION_3_5.md)                     | Visão de experiência (atmosferas e personalização)         |
| [ART_DIRECTION_AND_ASSETS.md](ART_DIRECTION_AND_ASSETS.md)               | Direção de arte e ilustrações                              |
| [GAMIFICACAO_2_0_DESIGN.md](GAMIFICACAO_2_0_DESIGN.md)                   | Gamificação verificada pelo servidor (proposta, não feita) |
| [CREDITOS_INTERFACE.md](CREDITOS_INTERFACE.md)                           | Créditos de fontes, ícones e recursos visuais              |

## Glossário

| Termo            | Significado                                                        |
| ---------------- | ------------------------------------------------------------------ |
| Aula / material  | Uma gravação enviada e tudo o que é gerado a partir dela           |
| Versão (revisão) | Estado imutável da transcrição; editar ou restaurar cria uma nova  |
| Confirmação      | A pessoa declara que conferiu uma versão; só ela alimenta gerações |
| Tarefa (job)     | Trabalho do worker: processamento inicial, resumo ou questões      |
| Flag             | `FEATURE_*` no `.env`; liga um recurso                             |
| ASR              | Reconhecimento de fala (transcrição automática)                    |
| Trecho de apoio  | Frase da transcrição que sustenta uma questão ou cartão            |
| Nino             | Mascote do app                                                     |
