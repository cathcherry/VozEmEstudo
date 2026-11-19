# 11 — Autoria de estudo: resumos, listas de questões, exportação, compartilhamento e Flashcards 2.0

Branch `feat/study-authoring`. Nada foi mesclado em `main` nem aplicado em banco remoto.

## Onde cada recurso aparece

| Local | Mudança |
| --- | --- |
| `material.html` → aba **Resumo** | Uma ação "Gerar resumo"/"Gerar novo resumo" abre um diálogo: nome da versão (com a migration), 7 formatos, 3 extensões, linguagem simples e, recolhidas em "Opções avançadas", 9 prioridades em seleção múltipla. Menu "Versões" lista nome, data e "mais recente"; "Renomear" nomeia a versão exibida. "Criar flashcards" (com as flags de flashcards) fica na mesma barra. |
| `material.html` → aba **Questões** | Ação principal "Gerar lista". Diálogo: nome, quantidade (3/5/10/20 ou "Outra quantidade…", até o limite do servidor), botão "i" com recomendação sob demanda, dificuldade e habilidades (seleção múltipla) e, recolhidas, foco temático, distribuição, política para listas anteriores e feedback sugerido do Quiz 2.0. Listas aparecem em linhas compactas com menu "⋯": Ver questões, Renomear, Exportar, Compartilhar. |
| Cabeçalho do material | "Organizar" e "Exportar" (diálogo único de exportação). |
| `historico.html` (Biblioteca) | Menu da linha: "Abrir material", "Editar transcrição" (abre a aba Transcrição já em edição), "Organizar" (título, disciplina ou pasta/unidade do catálogo e tags, em diálogo compacto). O rótulo genérico "Editar" foi removido. |
| `painel.html` → Flashcards | Filtro por conjunto, "Conjuntos de flashcards" (ver cartões, renomear, arquivar/reativar, excluir com confirmação, exportar CSV/Markdown), cartão manual dentro de um conjunto e exclusão de cartão com confirmação. |
| `compartilhado.html` | Links `#tipo=lista&token=…` mostram a folha de questões somente leitura. |

Continuam exatamente três abas no material; não houve página nova, item novo na barra lateral, botão flutuante ou configuração de geração em Configurações.

## Flags e migrations (candidatas, NÃO aplicadas)

1. `database/checks/authoring-preflight.sql` (somente leitura) — confere E02/E05/E13, a restrição atual de `requested_count` e as contagens.
2. `database/migrations/20261119120000_study_authoring.sql` — depois habilitar `FEATURE_STUDY_AUTHORING=true`.
3. `database/migrations/20261119121000_flashcard_sets.sql` (requer E13) — depois habilitar `FEATURE_FLASHCARD_SETS=true` (junto de `FEATURE_FLASHCARDS`).
4. `database/checks/authoring-postflight.sql` — contagens iguais às do preflight, RLS ligado, tabelas e funções fora do alcance do papel `authenticated`.

Ambas são aditivas: colunas novas anuláveis ou com padrão, tabelas e funções novas; nenhuma função existente é substituída. A única alteração de restrição **amplia** `question_batches.requested_count` de {3,5,10,20} para 1..100 (todas as linhas atuais continuam válidas; a migration aborta se encontrar uma restrição legada com outro nome). Reaplicar é recusado. Reverter = desligar as flags; o esquema pode permanecer.

Sem as flags o comportamento anterior é preservado: o diálogo mostra só as quantidades fixas, o worker usa o caminho E02 (`questions-v1`, quantidade exata) e o resumo cai para `commit_summary_admin` se a função nova não existir. `MAX_QUESTION_LIST_COUNT` (padrão 40, teto 100) limita listas personalizadas.

## Geração de questões (com `FEATURE_STUDY_AUTHORING`)

1. **Análise**: o modelo lista conceitos distintos da revisão confirmada, cada um com trecho literal; itens sem trecho localizável ou com rótulo repetido são descartados.
2. **Plano**: pares distintos (conceito, habilidade); um conceito aparece no máximo duas vezes e só com habilidades diferentes. As dificuldades são distribuídas igualmente (sobras para os níveis mais fáceis), intercaladas ou em ordem crescente. O plano é limitado pelo conteúdo.
3. **Geração** por slot, com a lista de questões anteriores a evitar.
4. **Validação** item a item (formato, 4 alternativas distintas, uma correta, explicação, trecho literal) e **redundância**: duplicata exata, paráfrase (trigramas ≥ 0,72 ou termos ≥ 0,6), mesmo conhecimento (mesmo conceito e habilidade, ou mesma resposta com enunciados próximos) — dentro da lista e contra listas anteriores, exceto na política "Permitir repetição para revisão".
5. **Uma rodada de substituição** para slots vazios. No máximo 3 chamadas ao modelo por lista.

Se o conteúdo não sustenta a quantidade pedida, a lista é salva com menos questões e a linha explica o motivo. A detecção de redundância é lexical e por conceito planejado; **não há embeddings** e não se promete unicidade perfeita. Cada questão guarda dificuldade, habilidade, conceito, trecho e referência aos segmentos (posição e tempos).

**Formatos**: só múltipla escolha com uma correta está implementada de ponta a ponta. O modelo (`questions.format`, `metadata`) foi preparado para seleção múltipla, verdadeiro/falso, resposta curta e aberta, mas eles não são aceitos pelo validador nem pelo banco e aparecem no diálogo apenas como "ainda não disponíveis".

**Recomendação de quantidade**: faixas por duração (<5 min: 3–5; 5–15: 5–10; 15–30: 10–20; mais longas: depende da densidade), ajustadas por termos distintos da transcrição e pelo número de habilidades. É heurística, não limite.

## Exportação

Um modelo de documento alimenta Markdown, TXT e a página de impressão A4 ("PDF (pela impressão do navegador)" — o PDF é gerado pelo diálogo de impressão do navegador). Preserva títulos, negrito/itálico, listas, marcações de tempo e questões numeradas com alternativas a–d; listas começam em página nova e questões não são partidas. Todo texto entra por nós de texto e pelo renderizador Markdown seguro. Só dados salvos no servidor entram no arquivo.

Variantes de lista: **folha do aluno** (sem respostas, mesmo que o gabarito esteja carregado), **gabarito do professor** (busca `GET …/answer-key`, somente do dono, `no-store`; recusado com 409 enquanto o dono tiver uma tentativa com feedback ao final em aberto nessa lista) e **relatório da última tentativa concluída** (Quiz 2.0; usa o gabarito que o servidor já libera após a conclusão).

CSV de flashcards: UTF-8 com BOM, vírgula, CRLF, aspas RFC 4180, cabeçalho `front,back,set,lesson,difficulty,focus,style,source_revision_id,evidence`; células iniciadas por `= + - @` recebem apóstrofo para não virarem fórmula. Para Anki/Quizlet, mapear `front` e `back` aos dois campos.

## Compartilhamento de listas

`question_list_shares`: guarda só o SHA-256 de um token de 256 bits gerado no navegador; validade 1/7/30 dias; revogação; limite de 100 links ativos; RLS ligado sem permissões para `anon`/`authenticated`. O instantâneo congelado contém título, aula, disciplina, revisão, enunciados e alternativas — nunca gabarito, explicação, trecho, metadados, transcrição, mídia ou anotações. O endpoint público ainda filtra os campos por lista branca e responde com `no-store`, `no-referrer` e `noindex`. Turmas, prazos, entregas e relatórios ficam para uma etapa futura.

## Flashcards 2.0

Conjuntos nomeados por aula, prévia editável (editar, rejeitar, gerar outro), quantidade personalizada (1–50), dificuldade e foco em seleção múltipla, estilos pergunta/resposta, termo/definição e explicação concisa. A prévia nunca completa a quantidade com conteúdo sem apoio: exige trecho literal, descarta duplicatas e quase duplicatas (inclusive contra cartões já salvos da aula ou do conjunto) e faz no máximo duas chamadas ao modelo. Cada cartão guarda revisão de origem, trecho e segmentos.

O agendamento é o da E13 (regras fixas no estilo SM-2: "De novo" 10 min; "Difícil", "Bom", "Fácil" ajustam intervalo e facilidade). Ele **não** é uma previsão personalizada de aprendizagem. Avaliação, última revisão, próxima data e histórico continuam no banco, por conta, e os cartões de conjuntos entram na fila do Painel. Arquivar um conjunto tira os cartões da fila sem apagar o histórico; excluir (com confirmação) remove o conjunto, os cartões e o histórico deles.

## Testes

- Backend: `study-authoring.test.js`, `study-authoring-migration.test.js` (PGlite: RPCs, idempotência, rollback, isolamento A/B, expiração/revogação, ausência de gabarito, pre/postflight), `study-authoring-http.test.js` (Express + Supabase simulado: limites, listas parciais, nomes, gabarito somente do dono, links públicos), `question-generation.test.js` (plano, distribuição, redundância, fonte, orçamento de chamadas), `flashcard-sets-migration.test.js`, `flashcards-v2.test.js`.
- Frontend: `study-authoring.test.mjs`, `study-document.test.mjs` (Markdown/TXT/A4, gabarito, CSV), `flashcard-ui.test.mjs` (conjuntos no Painel).
- Navegador (`npm run test:browser`; neste ambiente com `BROWSER_EXECUTABLE=/opt/pw-browsers/chromium`): resumo avançado e versões, Biblioteca, lista personalizada, recomendação, renomear, exportação do aluno/professor, link compartilhado e revogação, Flashcards 2.0 com CSV, axe sem violações automáticas nos novos diálogos e largura de 390 px.

## Limitações conhecidas

- Migrations não aplicadas nem ensaiadas em staging; PGlite usa uma conexão (sem teste de concorrência real).
- Qualidade real das questões/cartões depende do provedor; os testes usam respostas simuladas.
- Redundância semântica é aproximada (sem embeddings).
- PDF depende do diálogo de impressão do navegador.
- Formatos além da múltipla escolha com uma correta estão adiados.
- Renomear conjunto no Painel usa o `prompt()` do navegador.
- A falha AAC do teste FFmpeg real já existia neste contêiner (codec), não relacionada a esta entrega.

## Ajustes pedidos depois da entrega

- **Leitura em voz alta**: o botão grande "Ouvir resumo" virou um ícone de alto-falante (32 px, nome em `aria-label`/dica) ao lado do título da versão; nas listas, fica no canto do bloco "Ver questões". Em **Aparência → Leitura e foco → Leitura em voz alta** é possível ocultar os botões e escolher a velocidade (mais lenta, normal, mais rápida, rápida). As escolhas seguem a conta como as demais preferências e não mudam o tema ativo. "Renomear esta versão" passou para dentro do menu "Versões".
- **Busca na transcrição**: os termos encontrados aparecem em negrito com fundo suave, ignorando acentos e maiúsculas, apenas no modo leitura (os campos de edição continuam com texto simples).
- **Busca do painel** (`GET /api/search`, sem migration): procura nos títulos/disciplinas das aulas, nos enunciados das questões (nunca no gabarito) e nos trechos das transcrições, somente nas aulas da própria conta. A barra sugere aulas com o termo e onde procurar (tudo, títulos, questões, transcrições). Os resultados ficam no próprio painel, em abas que só aparecem quando têm resultado; com uma única categoria não há abas; sem nada, o Nino curioso explica. Um trecho encontrado abre a aula na aba Transcrição com o termo já buscado e destacado. No celular a barra passa para baixo do cabeçalho. O endereço guarda a busca (`?busca=…&em=…`).
- **Nino** nos estados vazios e caminhos sem saída: busca sem resultado e Biblioteca sem resultado (curioso), Biblioteca e painel vazios (notebook), listas, resumos, conjuntos, agenda e anotações vazias (descansando), revisão de flashcards em dia (comemorando), objetivos (lendo), tentativa ou aula indisponível e link compartilhado expirado (curioso). As imagens são decorativas (`alt=""`); a mensagem continua no texto.
- **Leitura em voz alta em três níveis** (Aparência → Leitura e foco): *Ícones discretos* (padrão), *Em todo o site* (acrescenta no topo de cada página um alto-falante que lê a seleção ou o conteúdo principal, também por Alt+L) e *Desligada*. Preferências antigas "on" viram "Ícones discretos".
- **Modo para leitores de tela**: preferência da conta, ligada em Aparência ou pelo segundo Tab de qualquer página ("Ativar modo para leitores de tela", logo após "Pular para o conteúdo"). Remove animações, transições, sombras, imagens decorativas (inclusive o Nino) e os botões de leitura do próprio site; usa layout em uma coluna, links sublinhados e foco reforçado. Não altera texto, ordem nem rótulos. Auditado com axe; o teste com NVDA/VoiceOver/TalkBack reais continua pendente.
- **Migration de autoria**: passou a exigir apenas a E02 (a E05 era usada só por uma chave estrangeira composta, substituída por uma chave simples com verificação de dono nas funções) e a guarda lista pelo nome cada pré-requisito ausente.

## Aplicação em produção (19/11/2026)

Com autorização explícita, `20261119120000_study_authoring.sql` foi aplicada no projeto Supabase **audioestudo** (nome `study_authoring` no histórico de migrations do Supabase), depois de: diagnóstico somente leitura (E02 presente; E05, E10, E13 e E19 ausentes), preflight (restrição `question_batches_requested_count_check` com o nome esperado; 18 aulas, 14 resumos, 15 lotes, 90 questões) e um ensaio do DDL principal dentro de uma transação encerrada com `rollback`, conferido em seguida.

Postflight: tabela, funções e regra 1..100 presentes; RLS ligado em `question_list_shares`, sem leitura para `anon`/`authenticated`; funções só para `service_role`; contagens idênticas; nenhuma questão com formato inesperado. Advisor de segurança: apenas o aviso informativo "RLS sem política" na tabela nova, intencional (acesso só pelo servidor, como `ai_job_executions`).

Ainda não aplicada: `20261119121000_flashcard_sets.sql` (exige E03/E05/E13, ausentes nesse projeto). As funcionalidades só aparecem com `FEATURE_STUDY_AUTHORING=true` e o código desta branch publicado.

## Revisão antes do merge (19/11/2026)

- Revisão de código do diff completo: 6 achados, todos corrigidos (quantidade personalizada sem `config`, busca em lotes de 100 ids, contagem por conjunto, reativação de conjunto sem reviver cartões arquivados individualmente, cabeçalho da migration, exportação só da revisão confirmada).
- `20261119130000_security_hardening.sql` aplicada no **audioestudo** (nome `security_hardening`): `rls_auto_enable()` (função de event trigger da plataforma) sem EXECUTE para `anon`/`authenticated`; `set_updated_at()` com `search_path` fixo. Ensaiada antes com `rollback`.
- Avisos que permanecem de propósito: "RLS sem política" em tabelas só do servidor (`ai_job_executions`, `transcription_word_alignments`, `question_list_shares`) e `storage_owns_material` executável por `authenticated` (exigido pelas políticas de vídeo; só responde se o material é do próprio usuário).
- Pendente fora do código: ativar a proteção contra senhas vazadas em Authentication → Policies/Password security no painel do Supabase.
- Avisos de performance (todos anteriores a esta branch, nível INFO/WARN): índices em chaves estrangeiras e `auth.uid()` reavaliado por linha nas políticas da 001; não bloqueiam o merge com o volume atual.
