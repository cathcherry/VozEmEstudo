# Primeira rodada de testes — Voz em Estudo

O código das nove frentes está reunido no [PR #2 em rascunho](https://github.com/cathcherry/VozEmEstudo/pull/2), branch `feat/etapa-2-biblioteca-2-0`. A `main` permanece preservada. Implementação preparada não equivale a homologação: ainda precisamos do banco configurado e do uso real pelo navegador.

Este roteiro usa o GitHub, o painel do Supabase e o iniciador que já acompanha o projeto. Não exige Docker, instalação local de PostgreSQL nem configuração de terminal.

## 1. Conferir a versão e o destino

1. No GitHub, abra a branch acima e obtenha essa versão, não a `main`. Se baixar ZIP, extraia em uma pasta própria para testes.
2. Preserve o `backend/.env` que já funciona. Na pasta de testes, use uma cópia dele; não substitua suas credenciais pelos campos vazios de `.env.example`. Nunca publique esse arquivo nem envie suas chaves no relatório de erro.
3. Confira no painel do Supabase qual projeto corresponde à URL desse `.env`. **Uma branch Git não isola o banco**: apontar para o mesmo projeto usa os mesmos dados. Prefira um projeto de teste quando disponível. Não execute SQL sem confirmar o destino.
4. Antes de qualquer alteração no banco, confirme um backup atual e um caminho de recuperação. O backup anterior não comprova que os dados atuais estejam protegidos; esta preparação não executou nem verificou restauração.
5. No SQL Editor do projeto escolhido, execute somente `database/checks/first-test-inventory.sql`. É leitura: mostra tabelas/colunas, RLS, privilégios, funções e configuração dos buckets, sem retornar conteúdo de aulas ou contas. `PRESENTE` significa estrutura encontrada, não recurso aprovado.

Se houver objeto parcialmente instalado, pare e compare com o preflight e o histórico do SQL Editor. Não reaplique arquivos às cegas. SQL aplicado manualmente pode não constar no ledger de migrations. A base `001_initial.sql` e a E02 não devem ser repetidas num projeto já existente; há relato anterior de aplicação da E02, que o inventário atual precisa confirmar.

## 2. Preparar o schema, uma mudança de cada vez

Os arquivos abaixo são candidatos versionados; nenhum foi aplicado ao Supabase por esta preparação. A execução real depende da confirmação do destino e backup. Para cada linha necessária: leia o preflight, aplique apenas a migration ausente e confira o postflight antes de seguir. Todos os caminhos são relativos à raiz do projeto.

| Ordem | Recurso | Arquivo em `database/migrations/` | Checks em `database/checks/` |
| --- | --- | --- | --- |
| Base | Permissão e revisão acadêmica | `20261009101846_academic_review.sql` | `e02-preflight.sql` / `e02-postflight.sql` |
| 1 | Disciplinas/unidades | `20261104190000_catalog_units.sql` | `e03-preflight.sql` / `e03-postflight.sql` |
| 2 | Objetivos, subobjetivos e tarefas | `20261104203000_study_planning.sql` | `e05-preflight.sql` / `e05-postflight.sql` |
| 3 | Tentativas de questões | `20261104223000_quiz_sessions.sql` | `e10-preflight.sql` / `e10-postflight.sql` |
| 4 | Revisão de erros | `20261104233000_quiz_review.sql` | `e12-preflight.sql` / `e12-postflight.sql` |
| 5 | Flashcards | `20261104234500_flashcards.sql` | `e13-preflight.sql` / `e13-postflight.sql` |
| 6 | MP4 privado | `20261105003500_player_video.sql` | `e07-preflight.sql` / `e07-postflight.sql` |
| 7 | Progresso e tempo de estudo | `20261105011000_study_tracking.sql` | `e08-preflight.sql` / `e08-postflight.sql` |
| 8 | Anotações e destaques | `20261105014000_annotations.sql` | `e14-e19-preflight.sql` / `e14-e19-postflight.sql` conjuntamente com a próxima linha |
| 9 | Calendário e compartilhamento | `20261105014500_calendar_sharing.sql` | Mesmos checks conjuntos da linha anterior |

O preflight conjunto E14–E19 deve rodar **antes das duas últimas migrations**; seu postflight, depois das duas. O E05 atual preserva `reference_url`, `sort_order` e `completed_at`; não use uma cópia antiga desse candidato. Cada migration é transacional, mas o conjunto inteiro não é uma única transação. Se uma falhar, não continue para as dependentes nem apague objetos para tentar de novo. Desligar uma flag não desfaz SQL ou alterações de dados.

Execute novamente o inventário após a preparação. Nas tabelas novas opcionais, espera-se RLS ligado, sem SELECT direto de `anon`/`authenticated`, com acesso de `service_role`. Nas funções administrativas, EXECUTE é exclusivo do servidor; a função de versão E02 tem regras próprias. Os postflights específicos continuam necessários para verificar constraints, políticas e contratos.

## 3. Iniciar e ativar gradualmente

Abra `INICIAR.cmd` na versão de teste, usando o Node já exigido pelo projeto (22.19+ ou 24). O iniciador verifica a configuração, inicia a API e o worker; abra `http://localhost:3000/painel.html` se estiver usando a porta padrão.

O diagnóstico consulta o banco e os buckets sem gravar dados. Quando uma flag estiver ativa, verifica também as tabelas e colunas correspondentes. Uma estrutura ausente ou bucket incompatível bloqueia a inicialização e indica o módulo. Ele não testa login, RLS com usuários reais, execução de todas as funções SQL, quotas ou processamento de IA.

Primeiro teste o fluxo antigo com todas as flags opcionais em `false`. Depois, no **`.env` de testes**, altere para `true` somente os grupos cujo schema já passou nos checks; reinicie pelo iniciador após cada mudança e recarregue a página:

| Grupo | Flags a ativar |
| --- | --- |
| Biblioteca e planejamento | `FEATURE_CATALOG_UNITS`, `FEATURE_PLANNING` |
| Questões e cartões | `FEATURE_QUIZ_V2`, `FEATURE_QUIZ_REVIEW`, `FEATURE_FLASHCARDS` |
| Vídeo e progresso | `FEATURE_MP4_RETENTION`, `FEATURE_STUDY_TRACKING` |
| Anotações, calendário e cópias | `FEATURE_ANNOTATIONS`, `FEATURE_CALENDAR`, `FEATURE_SHARING` |

Mantenha `FEATURE_SOCIAL_BASIC=false`: a rede social não está implementada. `FEATURE_QUIZ_REVIEW` requer `FEATURE_QUIZ_V2=true`. Para homologação real, `MOCK_EXTERNAL_SERVICES=false`; um modo simulado não comprova integração externa. Não há necessidade de ativar tudo para iniciar a primeira parte dos testes.

## 4. Roteiro de uso e resultado esperado

Use duas contas de teste e uma gravação curta sem dados de alunos. Para a conta B, use outro perfil do navegador ou janela privativa. Registre cada linha como passou, falhou ou bloqueada.

| Caso | Ação | Resultado esperado |
| --- | --- | --- |
| 1. Acesso | Entrar, sair, recuperar senha e entrar novamente | Sessão válida; conta errada não herda dados da anterior. Verificar OAuth no endereço efetivamente usado. |
| 2. Material antigo | Abrir uma aula anterior, texto, resumo e questões | Conteúdo e referências de mídia preservados. |
| 3. Fluxo principal | Enviar áudio curto, acompanhar processamento, conferir/corrigir e confirmar transcrição; gerar resumo e questões | Jobs terminam sem simulação; revisão confirmada é a fonte dos conteúdos gerados; erros são visíveis. |
| 4. Organização | Criar disciplina/unidade, vincular aula, criar objetivo/subobjetivo e duas tarefas, editar, reordenar e concluir | Organização persiste após recarregar; HTTPS de referência é aceito, esquema inseguro é recusado. |
| 5. Questões | Fazer tentativa imediata e diferida; errar propositalmente e revisar erros | Modo diferido não revela gabarito antes de finalizar; revisão usa os erros daquela tentativa e persiste. |
| 6. Cartões e resumo | Criar cartão manual, gerar prévia por IA, selecionar quais salvar, revisar; variar formato/extensão do resumo | Prévia não salva sem escolha; avaliação agenda próxima revisão e não duplica ao reenviar. |
| 7. Player | Enviar MP4 com retenção, alternar áudio/vídeo, procurar trecho, mudar velocidade e retomar | Vídeo privado e posição relativa ao recorte coerente; navegação não perde o texto. URLs assinadas expiradas devem ser renovadas. |
| 8. Estudo | Marcar andamento, abrir segunda aba, usar sessão/Pomodoro e ajustar meta/fuso | Uma sessão ativa por conta, sem contar tempo duplicado entre abas; progresso persiste. Ao interromper a rede brevemente e reconectar, fila é reenviada ou conflito é explicado. |
| 9. Notas | Destacar trecho, anotar, buscar, editar e exportar TXT/Markdown; imprimir para PDF | Nota ancorada na revisão correta; arquivo e impressão legíveis, com acentos. |
| 10. Calendário | Criar/editar evento, ver prazo de tarefa, exportar ICS e importar no calendário usado | Data e fuso corretos; evento/tarefa não duplicam indevidamente na visualização. |
| 11. Cópia compartilhada | Criar cópia com validade, abrir link sem login, alterar aula original e revogar link | Link mostra somente a cópia selecionada; alterações futuras não mudam o snapshot; revogação bloqueia novo acesso. |
| 12. Duas contas | Na conta B, tentar abrir os IDs de aulas/itens privados da A | Acesso recusado, sem título, transcrição, notas, mídia ou tarefas da A; a exceção é o conteúdo deliberadamente publicado por link de cópia válido. |

Em caso de falha, anote: caso, conta A/B, navegador/dispositivo, flags ativas, ação, esperado, observado e horário. Inclua imagem ou erro visível sem credenciais nem conteúdo pessoal. Não continue um grupo dependente se o anterior estiver bloqueado.

## 5. O que está fora do aceite desta rodada

| Limite atual | Escopo disponível |
| --- | --- |
| Anexos no planejamento | Links HTTPS; upload de anexos ainda não implementado. |
| Exclusão de objetivos/subobjetivos | Ainda pendente; criação e edição estão no escopo. |
| Etiquetas pessoais | Permanecem locais; não prometer sincronização entre dispositivos. |
| PDF | Impressão do navegador para PDF, sem geração automática no servidor. |
| Repetição espaçada | Agendamento simples; não algoritmo adaptativo avançado. |
| Calendário | Sem recorrência, convites ou notificações automáticas. |

Os testes automatizados usam dados sintéticos e PostgreSQL embarcado para a cadeia de migrations. Eles complementam o uso real: não comprovam Supabase remoto, login, Storage real, Hugging Face/Groq, impressão nem importação ICS. A restauração de backup continua sendo uma verificação operacional separada.

Depois da primeira rodada, corrigiremos as falhas encontradas na mesma branch e repetiremos os casos afetados. O merge na `main` permanece para depois do seu aceite.
