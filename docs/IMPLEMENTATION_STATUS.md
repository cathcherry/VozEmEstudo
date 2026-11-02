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
