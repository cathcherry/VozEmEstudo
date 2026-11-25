# Padrões de código

Contrato canônico: Manual Técnico REVISADO, seções 31–34. Estes padrões entram no escopo E01 autorizado em 09/10/2026; não implicam aprovação dos gates pendentes da E00.

## Idioma e nomes

Símbolos técnicos, arquivos, caminhos REST, logs estruturados e código novo usam inglês. A interface e as mensagens apresentadas às pessoas usam pt-BR. A documentação principal permanece em português.

| Elemento               | Convenção                             | Exemplo                                 |
| ---------------------- | ------------------------------------- | --------------------------------------- |
| Variáveis e funções JS | camelCase, nome expressivo            | activeStudySeconds, calculateWeeklyGoal |
| Classes JS             | PascalCase                            | StudySessionService                     |
| Constantes de módulo   | UPPER_SNAKE_CASE com unidade          | DEFAULT_FOCUS_SECONDS                   |
| Arquivos JS/CSS        | kebab-case e responsabilidade         | material.service.js, history.page.js    |
| Python e SQL           | snake_case; classes Python PascalCase | start_ms, material_id                   |
| REST novo              | substantivos plurais, kebab-case      | /api/study-sessions                     |
| DTO novo               | camelCase                             | sourceRevisionId, feedbackMode          |

Glossário: subject = disciplina; unit = unidade; material = aula/material fonte; transcript e transcriptionVersion = transcrição e snapshot; summaryVersion = versão de resumo; questionBatch = lote; quizSession = sessão de resolução; studyGoal = objetivo; subgoal = subobjetivo; studyTask = tarefa; studySession = sessão de estudo; studyActivityInterval = intervalo temporal; evidence = sustentação identificada. Subject não é topic; quizSession não é studySession; duração de mídia não mede atenção nem tempo ativo de estudo.

Não renomear estados em português, colunas snake_case ou DTOs legados que já têm consumidores. Toda transição de contrato requer documentação, testes e depreciação explícita; não fazer conversão global automática.

## Camadas e arquitetura

Preservar route → controller → service → repository. Routes ligam métodos HTTP e middleware; controllers validam limites HTTP, convertem resposta e delegam; services decidem regras de negócio; repositories persistem e aplicam filtros de ownership. Integrações isolam SDKs/ASR/LLM; validators validam entrada externa com Zod. O navegador usa módulos ES, sem SQL nem chave administrativa.

Reutilizar getOwnedMaterial/getOwnedJob antes de ações por ID. Um service_role não comprova autorização da pessoa. Flags são opções de implantação, nunca controles de acesso. Guardas de caminhos do Storage da E00 devem permanecer antes de assinatura, download, move e delete.

Aplicar Clean Code, SOLID, DRY, KISS e YAGNI conforme o problema: não criar interfaces, classes, camadas ou arquivos vazios sem necessidade. Comentários explicam motivos e invariantes. Preservar testes de mídia, regras e jornadas existentes.

## Contratos e unidades

- Novos DTOs usam schemas Zod nos limites HTTP e integrações. Decidir explicitamente campos desconhecidos, coerção, opcionais e null; preferir strict para comandos novos. Legado mantém a coerção já testada.
- Erros HTTP usam `{ error: { code, message, details? }, requestId }`, códigos técnicos estáveis e mensagem segura em pt-BR. Não retornar stack, tokens ou erros brutos de provedor. Correlacionar x-request-id com requestId.
- IDs persistidos são UUIDs imutáveis. userId vem da sessão validada; nunca do corpo para definir ownership.
- Persistir datas UTC em ISO 8601; calendário/dia/semana recebem timeZone explícito. Usar sufixos Ms e Seconds, converter apenas na fronteira. Manter duration_ms/start_ms/end_ms existentes; não confundir com activeStudySeconds.
- Novas coleções extensas usam cursor opaco, limite validado e ordenação estável com ID como desempate. Não alterar silenciosamente o array legado de /materials.
- Operações futuras com efeitos repetíveis precisam de chave de idempotência por usuário/operação, constraints/transação e teste de concorrência. E01 não implementa idempotência fictícia em localStorage.
- Novos estados possuem enum e transições explícitas. Preservar MATERIAL_STATUS, JOB_STATUS e PROCESSING_STAGE atuais; não traduzir valores de contrato apenas para satisfazer nomenclatura.

## Qualidade e contribuição

Indentação JS/JSON/YAML/CSS/HTML de dois espaços; Python de quatro. UTF-8, LF e newline final. Prettier é o formatter JS/documentos; Ruff é o lint/formatter Python. ESLint separa Node, ESM browser e scripts clássicos. Bundles de terceiros, binários, segredos e evidências históricas geradas não são reformatados.

Antes de PR, executar os comandos de [TESTING.md](TESTING.md). Formatação legada deve ficar em diff separado de mudanças de lógica. Nenhuma licença do projeto é escolhida nesta entrega.

## Organização dos estilos (etapa 1)

O CSS existente tem camadas históricas compartilhadas; não reescrevê-las em massa para resolver uma tela. Para mudanças de interface, consulte [CSS_GUIDE.md](CSS_GUIDE.md): defina o arquivo proprietário de cada componente, use classe de página no `body` para regras locais e não acrescente seletores globais de `h1`, `input`, `button` ou `.login-box` em folhas compartilhadas. As telas de autenticação devem modificar exclusivamente `auth-pages.css` após as folhas base. Acrescente ou atualize teste focado e mantenha o fluxo legado sem alterações desnecessárias.
