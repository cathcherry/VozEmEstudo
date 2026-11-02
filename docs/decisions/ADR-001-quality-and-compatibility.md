# ADR-001 — Qualidade incremental e compatibilidade

Status: implementado localmente em E01, pendente de aceite G0b e confirmação de versões pela equipe. Data: 09/10/2026. Contrato: Manual Técnico REVISADO §§31–34 e entrega E01.

## Contexto

A revisão 10 já contém produto 0.3.1, controles de ownership e guardas de Storage. Não há Git, padrões, CI, formatter/lint ou dom-check.cjs. A E00 registrou bloqueio por padrões ausentes e instalação offline. O pedido explícito E01 autoriza resolver essa infraestrutura; não aprova staging, restore, mudanças em produção ou as entregas seguintes.

## Alternativas

1. Reescrever em React/TypeScript ou workspaces: amplia escopo, cria migração de arquitetura e ameaça contratos existentes.
2. Reformatar todos os arquivos junto da lógica: mistura mudanças extensas com regressões pequenas, dificulta revisão e preservação do histórico.
3. Ferramentas na raiz, pacotes de execução independentes e débito legado por hash: melhora revisão e CI sem refazer o produto.

## Decisão

Adotar a alternativa 3. Preservar ES Modules/HTML/CSS, Express, worker, adapters e três lockfiles independentes. Node 24.19.0/npm 11.9.0 e Python 3.12 são referências verificadas; ferramentas e Ruff são fixados. ESLint 9 foi rejeitado após aviso de fim de suporte; seleção final 10.12.0, @eslint/js 10.0.1. Não aumentar versões do SDK por conveniência.

Código novo segue inglês, interface pt-BR e domínio do manual. DTOs novos usarão Zod, UUID, UTC, unidades explícitas, erros seguros e ownership central. Colunas/estados snake_case/português do legado são contratos preservados. Cursor/idempotência/transações são padrões para próximas capacidades, não endpoints fictícios nesta etapa.

Corrigir somente apontamentos reais de lint, contrato de JSON malformado e exposição de chave privada configurada no campo publicável. A guard de /api/config aceita chave publishable/anon ou configuração vazia de setup; não altera Auth remoto. Definir flags futuras OFF com normalização server/browser e teste de configuração antiga. CI padrão usa fixtures sem secrets; leituras remotas são workflow manual separado, com environment protegido a ser configurado pelo responsável.

## Consequências

Há um npm ci adicional para ferramentas da raiz e Ruff de desenvolvimento. Instalação da inferência ASR, GPU e pinning de seus pacotes continuam separados. Arquivos legados idênticos podem continuar fora do formatter, identificados por hash/issue; qualquer alteração exige formatação. Evidências E00 e migration inicial não são reescritas.

Nenhuma licença, repositório público, branch remota ou publicação é escolhida automaticamente. Sem Git, hashes e patches separados documentam a base; commits só existirão após inicialização/repositório realmente criado pela equipe.

## Reversão

Reverter módulos de flags, campo público featureFlags, ajuste de parser/erros e infraestrutura E01 para a revisão 10, preservando os guards de Storage da E00 e dados externos. Isso restaura o erro legado de JSON malformado; registrar explicitamente a regressão caso haja rollback. Não executar rollback de banco: E01 não modifica schema.
