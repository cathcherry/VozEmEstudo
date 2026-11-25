# Voz em Estudo

Plataforma web que transforma a **gravação de uma aula** em material de estudo: transcrição
revisável, resumos, questões, flashcards e um caderno de anotações, com foco em acessibilidade.
Trabalho de Conclusão de Curso de Catharine e Gabriela.

```
gravação → recorte → transcrição automática → conferência humana → resumos, questões e cartões → estudo
```

## Acesse online

**https://vozemestudo-production.up.railway.app**

Não precisa instalar nada: crie uma conta (e-mail ou Google) e use. Contas novas entram no
programa de testes, que já traz **três aulas de demonstração** (crase, vacinas e internet) e
limites de uso para controlar o custo dos serviços de IA.

## O que o app faz

| Área               | Recursos                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Envio**          | Áudio ou vídeo (MP4, MOV, WebM, MP3, WAV, M4A, AAC, OGG, FLAC) até 100 MB, recorte do trecho no navegador e envio que retoma se a internet cair                          |
| **Transcrição**    | Automática (AssemblyAI ou Whisper), com player sincronizado, legendas, edição, histórico de versões e confirmação humana antes de gerar qualquer material                |
| **Materiais**      | Resumos em vários formatos, listas de questões com o trecho da aula que sustenta cada resposta e flashcards com repetição espaçada                                       |
| **Anotações**      | Destaques na transcrição e um caderno por aula, com capas, papéis, listas, checklist e citações de trechos da aula                                                       |
| **Organização**    | Biblioteca por disciplinas e unidades, busca global, planejamento com tarefas e calendário, painel de foco (Pomodoro) e turmas                                           |
| **Acessibilidade** | Modo para leitores de tela, leitura em voz alta, fontes para dislexia, régua de leitura, alto contraste, 12 temas prontos (ou um personalizado) e interface em 4 idiomas |

Descrição completa, página por página: [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md).
Capturas de todas as telas: [docs/tcc-apendice-c/](docs/tcc-apendice-c/LEGENDAS.md).

## Rodar no computador (Windows)

O site publicado é a forma recomendada de usar o app. Para rodar o código localmente:

1. Instale o **Node.js 24 LTS** (ou 22.19 ou mais novo): https://nodejs.org
2. Dê dois cliques em **`INICIAR.cmd`**.
   - Na primeira vez, ele cria `backend/.env` a partir do modelo e abre o arquivo no Bloco de
     Notas. Preencha as chaves (tabela abaixo), salve e abra o `INICIAR.cmd` de novo.
   - Depois, ele instala as dependências (só na primeira vez, precisa de internet), inicia a API e
     o worker e abre **http://localhost:3000/painel.html** no navegador.
3. Deixe a janela aberta enquanto usa. **Ctrl+C** encerra.

| Variável em `backend/.env`                                                                                                                            | Onde conseguir                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`                                                                                     | Projeto no [Supabase](https://supabase.com) › Project Settings › API                               |
| Transcrição: `ASR_PROVIDER=assemblyai` e `ASSEMBLYAI_API_KEY` (como no site publicado) ou `HF_TOKEN` com o Whisper do Hugging Face (padrão do modelo) | [AssemblyAI](https://www.assemblyai.com) ou [Hugging Face](https://huggingface.co/settings/tokens) |
| `GROQ_API_KEY` (resumos, questões e flashcards)                                                                                                       | [Groq](https://console.groq.com)                                                                   |

O banco precisa das migrations de `database/migrations/` aplicadas em ordem
([docs/BANCO_DE_DADOS.md](docs/BANCO_DE_DADOS.md)). Todas as variáveis e flags estão explicadas em
[docs/CONFIGURACAO.md](docs/CONFIGURACAO.md).

<details>
<summary>Sem o <code>INICIAR.cmd</code> (macOS, Linux ou terminal)</summary>

Com o `backend/.env` preenchido, na raiz do projeto:

```bash
npm ci --prefix backend
```

```bash
node scripts/full/start.mjs
```

Ou em dois terminais separados, dentro de `backend/`: `npm start` (API) e `npm run worker`
(processamento). No PowerShell, use `npm.cmd` se o `npm` for bloqueado.

</details>

## Testes

Os testes usam dados falsos e não precisam de chaves. Instale as dependências das três partes
(e o Ruff, para os testes em Python) uma vez:

```bash
npm ci && npm ci --prefix backend && npm ci --prefix frontend
```

```bash
python -m pip install -r requirements-dev.txt
```

Depois:

```bash
npm test
```

`npm test` roda os testes do backend (com PostgreSQL embutido), da interface e da qualidade.
`npm run test:browser` roda as jornadas completas no Chromium. Detalhes em
[docs/TESTING.md](docs/TESTING.md).

## Organização do código

| Pasta        | Conteúdo                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| `frontend/`  | Páginas HTML, CSS e JavaScript (módulos ES, sem etapa de build) e testes da interface        |
| `backend/`   | API Express (`src/server.js`), worker de processamento (`src/worker.js`) e integrações de IA |
| `database/`  | Migrations, verificações, rollback e as aulas de demonstração                                |
| `asr-space/` | Space do Hugging Face com Whisper (transcrição alternativa)                                  |
| `scripts/`   | Inicializador, verificações de qualidade e segredos, testes de apoio                         |
| `deploy/`    | Configuração dos serviços no Railway                                                         |
| `docs/`      | Documentação ([índice](docs/README.md))                                                      |

Tecnologias: Node.js e Express, Supabase (Postgres, Auth, Storage e RLS), AssemblyAI, Groq,
FFmpeg, Docker e Railway.

## Documentação

| Documento                                          | Para quê                                         |
| -------------------------------------------------- | ------------------------------------------------ |
| [docs/FUNCIONALIDADES.md](docs/FUNCIONALIDADES.md) | Tudo o que o app faz, página por página          |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Arquitetura e fluxo de processamento de uma aula |
| [docs/API.md](docs/API.md)                         | Rotas HTTP                                       |
| [docs/BANCO_DE_DADOS.md](docs/BANCO_DE_DADOS.md)   | Tabelas, migrations e segurança (RLS)            |
| [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md)       | Variáveis de ambiente e flags                    |
| [docs/HOSPEDAGEM.md](docs/HOSPEDAGEM.md)           | Como o site foi publicado no Railway             |
| [docs/README.md](docs/README.md)                   | Índice com os demais documentos                  |

## Segurança

- **Nunca publique `backend/.env`** nem chaves: o arquivo fica fora do Git (`.gitignore`). Em
  produção, as chaves ficam só no painel do Railway.
- Aulas, transcrições e materiais passam pela API, que confere o dono de cada dado; o banco reforça
  isso com regras de acesso por linha (RLS).
- Links de compartilhamento guardam só o hash do token, expiram e podem ser revogados.
- Auditoria do teste público: [docs/SECURITY_AUDIT_PUBLIC_TESTING.md](docs/SECURITY_AUDIT_PUBLIC_TESTING.md).
