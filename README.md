# Voz em Estudo

Plataforma de estudo que transforma a **gravação de uma aula** em material de estudo:
transcrição revisável, resumos, listas de questões, flashcards e ferramentas de revisão, com foco em
acessibilidade. Projeto de TCC.

```
gravação → recorte → transcrição automática → conferência humana → resumos, questões e cartões → estudo
```

Nada é gerado antes de a pessoa **conferir e confirmar** a transcrição, e tudo o que é gerado guarda
a versão exata da transcrição de origem.

## O que o app faz

- **Envio de aulas**: áudio ou vídeo (MP4, MOV, WebM, MP3, WAV, M4A, AAC, OGG, FLAC) até 100 MB;
  recorte de até ~54 min no navegador; envio retomável que continua de onde parou se a internet cair.
- **Transcrição** com Whisper (Hugging Face) ou AssemblyAI, com idioma da gravação, legendas por
  trecho ou palavra a palavra, edição com histórico de versões e três avisos automáticos de conteúdo.
- **Resumos** em 7 formatos, 3 extensões, linguagem simples com glossário e prioridades de estudo;
  versões nomeadas.
- **Listas de questões** com quantidade personalizada, dificuldades, habilidades cognitivas e foco
  temático; cada questão traz o trecho da aula que a sustenta; filtro de repetidas; compartilhamento
  de folhas sem gabarito.
- **Biblioteca** com busca, filtros, grade/lista e pastas de disciplinas e unidades.
- **Busca global** em aulas, questões e transcrições.
- **Exportação** em PDF, Markdown, TXT e CSV (flashcards).
- **Acessibilidade**: modo para leitores de tela, leitura em voz alta, modo foco, fontes para
  dislexia, régua de leitura, temas de alto contraste e temas personalizados.
- **Perfil** com marcos de estudo e o mascote Nino.
- Recursos prontos no código e aguardando migrations no banco de produção: planejamento,
  tentativas e diagnóstico de questões, flashcards com revisão espaçada, tempo de estudo,
  anotações, calendário e cópias de leitura de materiais.

Lista completa, com o que depende de cada flag: **[docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md)**.

## Como iniciar no Windows

Requisito: **Node.js 22.19 ou mais novo** (de preferência 24).

1. Coloque seu arquivo privado `backend/.env` (modelo em `backend/.env.example`; variáveis
   explicadas em [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md)).
2. Dê dois cliques em **INICIAR.cmd**. Na primeira vez ele instala as dependências do backend
   (precisa de internet).
3. Espere as mensagens de que a API e o worker iniciaram.
4. Abra **http://localhost:3000/painel.html**.
5. Deixe a janela aberta. Para encerrar, pressione **Ctrl+C**. Depois de mudar o `.env` ou de
   atualizar o código, feche e abra o `INICIAR.cmd` de novo.

### Pelo PowerShell

Se o PowerShell bloquear scripts, use `npm.cmd` em vez de `npm`. Em dois terminais, dentro da
pasta `backend`:

```bash
npm.cmd ci
```

```bash
npm.cmd start
```

```bash
npm.cmd run worker
```

## Atualizar pelo GitHub Desktop

1. **Fetch origin** e depois **Pull origin** na branch desejada.
2. Feche e abra o `INICIAR.cmd`; no navegador, **Ctrl+F5**.
3. Para publicar mudanças: crie uma branch, faça **Commit** e **Push origin**, abra um pull request
   e confira a verificação **Quality** no GitHub Actions antes do merge.

Mudanças no banco vêm como SQL versionado em `database/migrations/` e nunca são aplicadas
automaticamente: ver [docs/BANCO_DE_DADOS.md](docs/BANCO_DE_DADOS.md).

## Organização do repositório

| Pasta        | Conteúdo                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------- |
| `frontend/`  | Páginas HTML, CSS e JavaScript (módulos ES, sem etapa de build)                             |
| `backend/`   | API Express (`src/server.js`), worker de processamento (`src/worker.js`), integrações de IA |
| `database/`  | Migrations, verificações e propostas de SQL                                                 |
| `asr-space/` | Space do Hugging Face com Whisper (transcrição com tempos)                                  |
| `scripts/`   | Inicializador do `INICIAR.cmd`, verificações de qualidade, segredos e distribuição          |
| `docs/`      | Documentação — comece pelo [índice](docs/README.md)                                         |
| `quality/`   | Linha de base de formatação                                                                 |

## Documentação

| Documento                                          | Para quê                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [docs/README.md](docs/README.md)                   | Índice de toda a documentação                                                |
| [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) | Tudo o que o app faz, página por página, e o que está disponível em produção |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Arquitetura e fluxo de processamento                                         |
| [docs/API.md](docs/API.md)                         | Rotas HTTP                                                                   |
| [docs/BANCO_DE_DADOS.md](docs/BANCO_DE_DADOS.md)   | Tabelas, migrations, segurança e situação da produção                        |
| [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md)       | Variáveis de ambiente e flags                                                |
| [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md)       | Provedores de transcrição e texto                                            |
| [docs/TESTING.md](docs/TESTING.md)                 | Como rodar os testes                                                         |

## Segurança

- **Nunca publique `backend/.env`** nem chaves, mesmo em repositório privado. Ver
  [PUBLICAR_NO_GITHUB.md](PUBLICAR_NO_GITHUB.md).
- O navegador não escreve no banco: tudo passa pela API, que confere o dono de cada dado.
- Links de compartilhamento guardam só o hash do token, expiram e podem ser revogados.
