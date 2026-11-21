# Sessão de desenvolvimento — Personalização 2.0, UX e validação

Documento de passagem: o que foi feito, o que falta e como retomar.

## Objetivo

Estabilizar a nova navegação, validar os recursos ativados em 20/11/2026, implementar a
Personalização 2.0 (perfil e Início), modos de estudo, idiomas da interface e revisão de
acessibilidade — sem tocar em produção.

## Base

| Item             | Valor                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Branch de origem | `feat/ux-navigation` @ `6a54c4e` (CI verde)                                                                                 |
| `main`           | `47b64bf` (não alterada)                                                                                                    |
| Branch de work   | `feat/personalization-2-0`                                                                                                  |
| Produção         | Nenhuma migration, SQL, deploy, chamada paga de IA ou mudança de credenciais                                                |
| Banco            | Só chaves novas de `profile_state` (`dashboard-layout`, `profile-layout`), no formato já exigido; nenhuma mudança de schema |

## Como rodar os testes aqui

```bash
npm ci && (cd frontend && npm ci) && (cd backend && npm ci) && pip install -r requirements-dev.txt
npm run lint && npm run check:syntax && npm run check:secrets
npm run test:backend            # 1 falha conhecida: recorte AAC depende da versão do FFmpeg (passa no CI)
npm run test:personalization    # e as demais suítes test:* (ver package.json)
BROWSER_EXECUTABLE=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run test:browser
```

No contêiner da sessão, o Playwright fixado (1.62.1) não encontra o Chromium dele; use
`BROWSER_EXECUTABLE` apontando para o Chromium instalado.

## Etapas

| #   | Etapa                           | Situação                   | Commits                         |
| --- | ------------------------------- | -------------------------- | ------------------------------- |
| 1   | Estabilizar UX e navegação      | Concluída                  | `8f87e6e`                       |
| 2   | Refinamento visual              | Parcial (ajustes pontuais) | `4b47a39`, `dbd2e73`, `1d3bf72` |
| 3   | Validar recursos ativados       | Concluída (automático)     | `888eb38`, `5a4f746`            |
| 4   | Perfil: visualização/edição     | Concluída                  | `e88dc3d`                       |
| 5   | Personalizar o Início           | Concluída                  | `4b47a39`                       |
| 6   | Aparência e modos de estudo     | Concluída                  | `1f5c086`                       |
| 7   | Idiomas da interface            | Base + cobertura parcial   | `ce37d5d`                       |
| 8   | Acessibilidade e confiabilidade | Parcial                    | `dbd2e73`                       |
| 9   | Validação final e documentação  | Concluída                  | este commit                     |

## Resultado dos testes (21/11/2026, neste contêiner)

- lint, check:syntax, check:ci, check:secrets: OK.
- Backend: 258 de 260 (as 2 falhas são o mesmo caso AAC/FFmpeg 6.1 da linha de base).
- DOM, auth-css, catalog, planning, quiz v2, diagnóstico, flashcards, player, tempo de estudo,
  learning tools, study authoring, personalization (17), Python, quality (34): todos passam.
- Navegador: `browser-check` (57), `subject-menu`, `password-signup`, `dashboard-home` (9),
  `navigation` (3), `personalization` (8), `feature-validation` (4): todos passam.

## Decisões

- **Simulação compartilhada** para testes de navegador: `frontend/tests/support/mock-app.cjs`
  (API, SDK do Supabase e `profile_state` em memória servida pelo servidor de teste).
- **Layout do Início** em `profile_state` (`dashboard-layout`) pela mesma `profile-cloud.js`; o
  padrão nunca é gravado. Blocos movidos no DOM, não só com CSS (ordem de leitura = tela).
- **Perfil**: blocos continuam em `profile-blocks` com campos opcionais (`hidden`, `source`) que
  versões antigas ignoram; seções ocultas em `profile-layout`. Blocos "Seus dados" só mostram
  dados reais e são montados com `textContent`.
- **Densidade** e **idioma** são preferências de interface comuns, fora dos temas salvos.
- **Modos de estudo** só combinam preferências existentes e nunca enfraquecem acessibilidade.
- **Idiomas**: português é a fonte e a reserva; em português o DOM não é reescrito. Trocar de
  idioma recarrega a página. Cobertura parcial declarada na própria interface e em `IDIOMAS.md`.

## Bugs corrigidos

Ver mensagens dos commits; principais: botão da conta invisível no celular; busca de Revisar e
Planejar diferente da do Início; erro ao concluir tentativa apagado pela própria tela; revogar link
sem confirmação; "Arquivar anotação" que excluía; lista vazia sem explicação em filtros;
tarefas de objetivos concluídos no Início; exportação ICS que podia parar na primeira página;
contagem de conjuntos com timer; títulos quebrando no meio da palavra; contraste de blocos ocultos;
"0 aula" em vez de "0 aulas" (regra de plural do pt-BR).

## Pendências que dependem de você

- Testes manuais com login real (lista em `PAINEL_TESTE_MANUAL.md`, itens 1–32).
- Decidir se objetivos/tarefas devem poder ser **excluídos** (hoje só arquivar o objetivo).
- Migration de desempenho de RLS (`20261119140000_rls_performance.sql`) continua não aplicada.
- Revisar e decidir o merge do branch (nada foi mesclado em `main`).

## Próximos passos sugeridos

1. Traduzir as ferramentas de Revisar/Planejar, Biblioteca, aula e login (seguir `IDIOMAS.md`).
2. Preferências por conta (ROADMAP §5.2): hoje aparência, idioma e densidade são do navegador.
3. Trocar o `prompt()` de "Renomear conjunto" por um diálogo do app.
4. Teste com leitores de tela reais nas telas novas.

---

# Continuação (21/11/2026) — etapas 10 a 15

Base: `feat/personalization-2-0` @ `5aabbb1` (PR #7, rascunho, CI verde). Mesmo branch, mesmo PR.
Nada de produção: sem migration, SQL, deploy, chamada paga de IA ou credencial.

## Situação

| #   | Etapa                                | Situação                               | Commits              |
| --- | ------------------------------------ | -------------------------------------- | -------------------- |
| 10  | Internacionalização completa         | Concluída (limites abaixo)             | `4ed1070`, `2bea5c3` |
| 11  | Preferências por conta e privacidade | Concluída (hora do servidor: proposta) | `4ed1070`            |
| 12  | UX em todo o app                     | Parcial                                | `8a12ce4`            |
| 13  | Confiabilidade e dívidas             | Concluída em parte                     | `6a8ae52`, `1cfa22b` |
| 14  | Preparação para hospedagem           | Concluída (não publicado)              | `1cfa22b`            |
| 15  | Validação final e passagem           | Concluída                              | este commit          |

## O que mudou

- **Idiomas**: catálogo de frases (o português é a chave) aplicado ao DOM, inclusive ao que os
  scripts acrescentam depois, a rótulos e a diálogos nativos; 1.678 frases e 131 padrões por idioma.
  Conteúdo de usuário protegido (frase inteira, contêineres de conteúdo, padrões curtos só com
  números ou palavras da interface). Datas pelo idioma. Cobertura em `IDIOMAS.md`.
  Tradução feita com subagentes a partir de um glossário (`scripts/i18n/build-phrases.mjs` gera os
  catálogos); **não revisada por falantes nativos**.
- **Preferências**: separação conta × dispositivo; sair restaura o dispositivo; conta nova parte do
  dispositivo; conta que volta recupera as suas. Indicador de sincronização e "Apagar dados desta
  conta neste navegador" em Configurações. Cópia pública com as preferências do visitante.
- **UX**: diálogo do app para renomear conjuntos (no lugar de `prompt()`), diagnóstico em cache por
  tentativa, ações do diálogo de compartilhar com o estilo do app.
- **Confiabilidade**: duração exata de AAC; bucket configurável ao excluir; testes de flags
  desligadas; limites por conta; desligamento da API em até 10 s; CSP opcional.
- **Hospedagem**: `docs/HOSPEDAGEM.md`, `deploy/railway.api.json`, `deploy/railway.worker.json`.

## Bugs encontrados e corrigidos

1. Tema e idioma de uma conta apareciam na tela de entrada e para a próxima conta no mesmo
   navegador.
2. Após apagar os dados locais, o histórico de estudo era regravado ao sair da página (`pagehide`).
3. A navegação do botão "Sair" era abortada por um recarregamento de idioma.
4. Texto longo inserido na página (ex.: script do axe) travava o tradutor (padrões com backtracking).
5. Texto do estado vazio do perfil corrompido por uma edição da sessão anterior.
6. Duração de AAC bruto estimada pela taxa de bits (até 0,26 s de erro).
7. Exclusão de aula usava o bucket fixo `audios`.
8. Foco não voltava ao botão depois de fechar um diálogo quando o botão estava ocupado.

## Testes (21/11/2026, neste contêiner)

- `npm run lint`, `check:syntax`, `check:ci`, `check:secrets`: OK.
- Backend: **264/264** (antes 258/260; inclui os novos testes de flags e limites).
- Front end (Node): todas as suítes `test:*`; `test:personalization` inclui idiomas e catálogo.
- Navegador (API simulada): `browser-check` (57), `subject-menu`, `password-signup`,
  `dashboard-home`, `navigation`, `personalization`, `feature-validation` (5), `i18n-check`
  (4 idiomas × 10 páginas × 2 larguras), `account-privacy` (6), `theme-check` (3 temas × 8
  páginas). Resultado final na seção de validação do PR.
- **Não feito**: login real, Supabase real, provedores de IA, leitores de tela reais (NVDA,
  VoiceOver, TalkBack), dois aparelhos reais, revisão nativa das traduções.

## Pendências que dependem de você

- Testes manuais 1–41 de `PAINEL_TESTE_MANUAL.md` (prioridade: 33–37 e o fluxo de estudo 2–6).
- Publicação: seguir `HOSPEDAGEM.md` (serviços, variáveis, URLs do Supabase, CSP).
- Aprovar ou não: hora do servidor em `profile_state` (migration), migration de desempenho de RLS,
  limite global com Redis/tabela, exclusão de objetivos/tarefas.

## Próximos passos sugeridos

1. Revisão das traduções por falantes nativos (principalmente chinês).
2. Mensagens de erro do servidor no idioma da interface (enviar `Accept-Language`).
3. Redesenho do "Organizar meus cartões" (hoje um formulário com seletor) e das listas longas do
   Planejar.
4. `ai_job_executions` de tarefas de texto continuam em `pending` após terminar (dívida).
