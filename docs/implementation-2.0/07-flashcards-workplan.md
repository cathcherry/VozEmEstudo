# Etapa 5 de 9 — E13: Flashcards e revisão espaçada

**Estado:** primeira implementação versionada na branch `feat/etapa-2-biblioteca-2-0`, PR #2 em rascunho. **Nenhum SQL foi aplicado ao Supabase.** A flag `FEATURE_FLASHCARDS=false` por padrão.

## Funcionalidades preparadas

- Criação manual de cartão de pergunta e resposta, com vínculo opcional a uma aula da própria conta.
- Edição e arquivamento de cartões, sem exclusão destrutiva; cartões arquivados não aparecem na fila de revisão.
- Visualização de cartões vencidos: revelar verso e avaliar a lembrança usando **De novo**, **Difícil**, **Bom** ou **Fácil**.
- Histórico persistente de revisões consultável pela API (50 mais recentes por cartão); agendamento armazenado no Supabase, não no navegador.
- Algoritmo SRS simples, inspirado em revisões por intervalo, **não é implementação validada cientificamente de SM-2/FSRS**. `De novo` agenda +10 minutos; as outras notas ampliam intervalos conforme repetições e fator de facilidade, limitados a 3650 dias. Qualquer horário mostrado usa o fuso do dispositivo.
- Reenvios usam `requestId` único para idempotência. A função SQL bloqueia a linha do cartão enquanto calcula o próximo intervalo e impede dupla atualização com o mesmo ID.
- Limite inicial de **100 cartões por consulta**. O painel indica quando há mais de 100; paginação completa é melhoria futura.

## Segurança, ambiente e aplicação

1. Este módulo não usa novas dependências locais. Ele só requer backend Node já existente e Supabase.
2. **Dependência:** E03 e E05/E06 aprovadas no banco real; E13 usa a FK composta `(material_id,user_id)` da E05. Não depende da E10/E12 para funcionar, mas **respeitar a ordem geral de migrations** ao instalar tudo.
3. Fazer backup restaurável, confirmar projeto correto e executar `database/checks/e13-preflight.sql` no **SQL Editor** (somente leitura).
4. Se o schema estiver compatível e houver aprovação explícita, executar **uma única vez** `database/migrations/20261104234500_flashcards.sql`, transação `BEGIN/COMMIT`. A execução via SQL Editor não registra a migration automaticamente no ledger do CLI.
5. Executar `database/checks/e13-postflight.sql`: contagens legadas inalteradas, RLS ligada, usuários `anon/authenticated` sem acesso direto às novas tabelas e RPC, `service_role` autorizado, zero vínculos de outra conta.
6. Só depois disso ativar `FEATURE_FLASHCARDS=true` em ambiente de teste e validar contas A/B: criar com e sem aula, tentar vincular aula de B, editar, arquivar, reativar, rever em notas distintas e voltar após nova sessão; reproduzir duas requisições com mesmo `requestId` para checar idempotência.
7. Aprovar merge para `main` **somente depois** do teste integrado e aceite humano. Se o módulo falhar, voltar a flag OFF; não fazer `DROP` dos dados para “reverter”.

## Limitações

- Não há geração automática por IA nem importação de cartões de transcrições, resumos ou questões: isso precisa de revisão de qualidade e proteção contra invenção de conteúdo.
- Não há upload de imagens/arquivos nem conjunto de cartões compartilháveis.
- O algoritmo ainda não foi calibrado com dados de aprendizado, o SQL é exercitado com **PostgreSQL embarcado (PGlite)** no CI, mas **não foi validado no Supabase real**, com o schema e as permissões efetivas do projeto. Os testes não substituem a homologação integrada.
- Dados persistidos podem ser usados entre dispositivos **após o backend, migration e flag serem implantados e validados**.
