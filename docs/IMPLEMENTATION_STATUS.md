# Etapa 6 — Player 2.0 implementado; homologação integrada pendente

Reprodução com busca/destaque de trechos, acompanhamento opcional, velocidades 0,5×–3×, atalhos, retomada local por conta, troca áudio/vídeo e renovação de URLs assinadas. Conservação opcional do MP4 original inteiro preparada com bucket privado, registro por conta/aula e recorte relativo à transcrição; migration E07 candidata, checks e teste SQL embarcado. `FEATURE_MP4_RETENTION` permanece OFF; nenhum SQL remoto, deploy ou merge. Lint e 16 novos testes direcionados passaram localmente, além de 28 regressões da etapa 5. Teste real com Supabase/Storage permanece pendente. Ver [guia da etapa 6](implementation-2.0/08-player-workplan.md).

---

# Etapa 5 — implementação concluída, homologação integrada pendente

Flashcards manuais, revisão espaçada, histórico, filtros e paginação foram complementados por prévia de cartões por IA da transcrição confirmada, trechos de apoio e conferência individual antes de salvar. Resumos agora aceitam formato (parágrafos/tópicos) e extensão (breve/intermediária/detalhada), preservados nos parâmetros do job e utilizados pelo worker. Nenhuma nova migration nesta conclusão. Lint e 28 testes direcionados aprovados localmente; IA/banco reais e interface em navegador real ainda não homologados. O PR #2 permanece em rascunho; nenhum merge na `main`, deploy ou SQL remoto. Ver [guia E13](implementation-2.0/07-flashcards-workplan.md).

O registro abaixo preserva o histórico de desenvolvimento e não substitui esta atualização.

---

# Etapa 5 iniciada — Flashcards e revisão espaçada (E13)

Continuação: paginação do gerenciador, filtros por aula e situação, histórico de revisões visível e tratamento de falha ao recarregar após avaliação confirmada. Testes direcionados de API e DOM incluídos; geração por IA e personalização de resumos ainda pendentes. Sem nova migration nesta continuação. O teste integrado no Supabase e o aceite humano continuam pendentes.

Primeira implementação da API, do Painel e da migration E13 salva no PR #2 em Draft, `FEATURE_FLASHCARDS=false`. Inclui histórico, agendamento atômico e testes; **nenhum SQL aplicado e nenhum merge na `main`**. Ver [guia E13](implementation-2.0/07-flashcards-workplan.md). Teste real do PostgreSQL/Supabase e avaliação da interface ainda necessários.

---

# Etapa 4 iniciada — Questões 2.0 (E10)

O PR #2 em Draft agora inclui API e interface de tentativas persistentes com feedback imediato/diferido, migration candidata E10 e checks. `FEATURE_QUIZ_V2` continua OFF. Sem alteração do Supabase, sem teste A/B real e sem merge na `main`. Veja [o plano E10](implementation-2.0/06-quiz-v2-workplan.md).

---

# Continuação da etapa 3 — E06 (subobjetivos e edição)

No PR #2 estão agora **subobjetivos de um nível**, edição de objetivos e tarefas, vínculos seguros a subobjetivos e ordenação/filtros na interface. A migration candidata E05/E06 foi **alterada antes de qualquer aplicação**, incluindo a tabela `study_subgoals` e constraints compostas de escopo. Nenhum SQL foi aplicado ao Supabase; `FEATURE_PLANNING` segue OFF. A revisão atual e os limites constam no [plano de planejamento](implementation-2.0/05-planejamento-workplan.md).

---

# Etapa 3 iniciada — Planejamento de estudos E05/E06

API, primeiro painel de objetivos/tarefas, migração candidata e verificações SQL foram versionados no **PR #2 em Draft**, usando a flag `FEATURE_PLANNING=false` por padrão. A nova migração `20261104203000_study_planning.sql` **depende da E03**, não foi aplicada e não deve ser executada diretamente sem preflight, backup e aprovação. Veja [o plano E05/E06](implementation-2.0/05-planejamento-workplan.md). A implementação de subobjetivos e funcionalidades avançadas continua pendente.

---

# Etapa 2 — Biblioteca 2.0 em desenvolvimento (04/11/2026)

O pull request em **Draft** [#2](https://github.com/cathcherry/VozEmEstudo/pull/2) concentra os commits E03/E04. O backend já contém catálogo autenticado (disciplinas, unidades e vínculo de aulas), e a Biblioteca possui um painel de organização e agrupamento por unidade, mas tudo está protegido por `FEATURE_CATALOG_UNITS=false` por padrão. A migration E03 candidata está em `database/migrations/20261104190000_catalog_units.sql`, com preflight, postflight e runbook. **Não aplicada** no Supabase; o rascunho antigo em `database/proposals` foi desativado. Nenhuma migration remota, ativação da flag ou merge em `main` foi realizada. Testes reais do Supabase, validação visual com a flag ativa e aprovação dos gates estão pendentes; consultar o plano `implementation-2.0/03-biblioteca-workplan.md`.

---

# Estado atual no GitHub — 04/11/2026 (etapa 1)

- **Fonte vigente:** repositório privado `cathcherry/VozEmEstudo`, branch `main`; alterações propostas em `chore/etapa-1-estabilizacao` até aprovação e merge. O histórico abaixo é anterior à publicação e não deve ser tratado como status remoto atualizado.
- **Testes informados pela responsável:** login por Google, GitHub e e-mail, recuperação, cadastro, alternância de senha, notificações e layout de autenticação funcionaram. Upload/transcrição, resumo e questões funcionaram anteriormente, mas **não foram reexecutados** na revisão publicada.
- **Supabase:** a migration E02 foi aplicada na instância de uso conforme relato de operação anterior. Isso **não comprova** inventário atual das migrations, backup restaurável, RLS remota, duas conexões concorrentes ou validação formal de G1. Nesta etapa, nenhuma migration é executada.
- **Engenharia:** a verificação automática padrão prioriza lint, sintaxe, contratos, segredos e testes, enquanto a dívida Prettier de arquivos anteriores fica registrada e não bloqueia o CI (`format:check` pode ser executado manualmente). A execução inicial do GitHub Actions em 02/11 falhou no ESLint (`frontend/tests/auth-style-check.mjs`: globals Node não declarados; `scripts/live/server.mjs`: import duplicado). Correções seguem em PR separado; execução verde só pode ser declarada após confirmação do Actions.
- **CSS:** login, cadastro e recuperação compartilham `frontend/css/auth-pages.css` carregado por último. Os estilos das demais páginas ainda são compostos por arquivos globais/compartilhados; não houve refatoração visual geral. Regras de responsabilidade e prevenção de conflito estão em [CSS_GUIDE.md](CSS_GUIDE.md).
- **Contrato OpenAPI:** `scripts/openapi-check.mjs` referencia `docs/engineering/AudioEstudo_openapi.yaml`, mas o arquivo não consta do repositório publicado. A checagem permanece disponível manualmente, porém não bloqueia `npm run check` nesta etapa; **reconstruir o contrato a partir das rotas existentes antes de alterações de API em E03/E04**, sem inventar schema ou respostas não comprovadas.
- **Escopo:** E00–E02 possuem implementação e evidências anteriores, porém os gates formais dependem de validações externas; E03–E20 ainda não constituem entregas implementadas. A etapa 1 não muda regras de autenticação, serviços de IA, dados ou comportamento do worker.

---

# E02 — implementação local em validação; G1 bloqueado

Permissão versionada, revisão explícita, fontes congeladas, commits transacionais e avisos preliminares implementados localmente sobre a versão 12 da E01. Migration aditiva preparada; nenhuma aplicação remota. Testes, arquivo de base e pendências constam em `implementation-2.0/e02-report.md`; `CONTINUAR.md` registra a retomada. Staging/backup/restore, concorrência nativa e integrações reais permanecem bloqueados. E03–E21 não iniciadas; não presumir aceite dos gates anteriores.

O registro abaixo é histórico e deve ser preservado.

# E01 — infraestrutura de qualidade entregue para revisão

A E01 foi solicitada explicitamente, sobre a revisão 10 auditada. Padrões, ferramentas, contratos, flags OFF, CI e documentação foram implementados e verificados localmente; G0b aguarda aceite e desvios externos permanecem. Resultados/pendências em `implementation-2.0/e01-report.md`. Nenhuma migration/escrita remota/publicação. O registro anterior abaixo é histórico; não substitui o fechamento E01 nem concede aceite G0b.

# Estado da implementação — versão 0.3.1

## Auditoria E00 — 09/10/2026

**Bloqueada para aceite G0a; produto preservado, sem features novas.** Inventário/roadmap/decisões e staging/backup preparados em `implementation-2.0/`. Proteções de distribuição e testes A/B acrescentados. Backend final: 42/42 testes/subtestes; navegador: 31 checks; auditor: 6 testes; estática: 15 HTMLs/88 JS/CJS; axe: 10 estados sem violações automáticas. Evidências e limites em `implementation-2.0/e00-report.md`.

Correção B2 local: validação de caminhos antes de operações administrativas de Storage, após reproduzir bypass com `../`; detalhes em `implementation-2.0/storage-path-fix.md`. Setup limpo offline falhou por ENOTCACHED. Padrões formais, staging autorizado, backup/restore reais, integração remota e confirmação de exposição/rotação histórica permanecem pendentes. Apenas consultas remotas de leitura; zero migrations/deploy/rotação. As seções abaixo preservam o histórico das revisões de produto, sem substituir o aceite E00.

## Revisão 0.3.1

Ajuste visual implementado: status junto ao título, linhas compactas, grupos, resumo do acervo, última aula sem repetição e ações coerentes ao terminar a reprodução. Frases soltas removidas; aviso de armazenamento na Ajuda. Avaliação de produtividade em `PRODUTIVIDADE.md`; nenhum timer, meta estruturada ou calendário de minutos foi implementado. Validação desta revisão concluída: fluxos do navegador/FFmpeg aprovados, 10 estados de acessibilidade sem violações automáticas detectadas e análise estática sem problemas.

## Recursos da versão 0.3 preservados

- [x] Painel neutro como biblioteca, continuidade, último áudio ouvido, progresso e tópicos de acesso.
- [x] Biblioteca com busca, disciplinas, tags, filtros, agrupamento e edição.
- [x] Temas personalizados nomeados, combinando aparência, fonte, espaçamento e foco.
- [x] Sidebar recolhível; foco recolhe automaticamente e permite reabrir.
- [x] Menu móvel com foco contido, fundo inativo e Escape.
- [x] Perfil detalhado no Supabase e oito avatares do Nino; padrão Nino lendo.
- [x] PNGs fornecidos integrados, favicons corrigidos e fallback /favicon.ico.
- [x] Geração de novas questões acessível nos materiais antigos e pela biblioteca, com tratamento de falha.
- [x] Melhorias de leitor de tela/teclado, contraste, menos estímulos e layout até fonte 200%.
- [x] Player, nove formatos, recorte real e OAuth da 0.2 preservados.
- [x] Navegador/FFmpeg revalidado na 0.3.1; 10 estados auditados e análise de 15 HTMLs/84 JS/CJS sem problemas. Relatório dos 17 testes backend da 0.3 preservado (backend sem alteração).
- [x] Documentação e registro de retomada atualizados.

## Persistência

Título/disciplinas via API existente. Perfil/avatar via Supabase Auth. Tags extras, temas nomeados, último acesso, reprodução, revisão e respostas ficam por conta neste navegador, sem sincronização entre aparelhos. Processamento concluído não marca revisão concluída. Não há migration nova.

## Configuração externa

- [ ] Manter/configurar credenciais no .env da instalação.
- [ ] Habilitar Google/GitHub no projeto Supabase conforme instruções.
- [ ] Validar login, Storage, banco, ASR, Groq e worker com contas reais.
- [ ] Publicar no domínio escolhido, se solicitado.
- [ ] Conferir manualmente com leitores de tela e navegadores adicionais.

Nenhuma configuração remota, deploy ou conta real foi alterada. A especificação original em docs/engineering permanece como referência. Itens futuros de infraestrutura da engenharia original não foram adicionados ao escopo desta revisão.

