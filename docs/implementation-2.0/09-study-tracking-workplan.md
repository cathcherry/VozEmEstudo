# Etapa 7 de 9 — Progresso, tempo, Pomodoro e metas (E08/E09)

Implementação preparada no PR #2, em rascunho e fora da `main`. **Nenhuma migration foi aplicada, nenhum deploy ou ativação de flag ocorreu.** `FEATURE_STUDY_TRACKING` permanece OFF por padrão. Depende da E05 para a chave composta de conta/aula. O código da etapa está concluído para o escopo abaixo; integração real e aceite humano continuam pendentes.

## Andamento da conta e histórico antigo

- Posição relativa ao trecho transcrito, velocidade, marcação manual de revisão concluída e união dos intervalos ouvidos são persistidos por conta/aula. O material, a transcrição e os derivados existentes não são recriados. Processamento ou reprodução não marcam revisão concluída automaticamente.
- A conta carrega o andamento na entrada das páginas autenticadas; o painel e a biblioteca usam esse mesmo estado. Retomada funciona entre aparelhos **depois da implantação, migration e flag ativa**. Tags pessoais, contagem local de acessos e respostas do fluxo antigo não são enviados por esta etapa; as tentativas do Questões 2.0 já pertencem ao módulo próprio.
- O histórico local continua sendo gravado imediatamente. Envios de progresso são agrupados e tentados a cada dez segundos enquanto a aba está visível, na volta da conexão, ao sair da página e pelo botão **Sincronizar agora**. Uma fila por conta no navegador conserva a identificação e o corpo de envios sem confirmação. Erros de rede aguardam pelo menos 30 segundos entre tentativas automáticas; o mesmo envio não avança a versão duas vezes.
- Atualizações usam versão esperada e `requestId`. Outro aparelho que já atualizou a aula causa conflito, sem sobrescrita automática. O painel oferece escolha explícita entre a versão da conta e a deste navegador; ao escolher a conta, recarregar a aula aplica também a posição no player. A escolha local é uma nova atualização consciente sobre a versão recém-consultada.
- Ao encontrar histórico local anterior à sincronização e uma cópia na conta, o sistema conserva a cópia local na fila e pede essa escolha. Onde não existe registro na conta, o histórico local pode ser importado pelo botão do painel ou enviado nas novas alterações de estudo. **Não se convertem acessos antigos, posição do áudio ou percentual ouvido em minutos históricos de estudo.**
- Duração do áudio vem do banco, não do navegador. Posição é limitada a essa duração. Intervalos são validados e unidos no servidor; saltos na reprodução não criam cobertura intermediária. A duração máxima de progresso é duas horas, com até 300 intervalos enviados por atualização e 600 intervalos separados na união; o limite rejeita a atualização com mensagem de conferência, preservando o registro anterior.

## Sessões e Pomodoro

- Painel e aula têm **Estudo livre**, **Foco de 25 minutos** e **Pausa de 5 minutos**. Na aula, a sessão pode ser vinculada ao material. O usuário inicia e pausa explicitamente. O Pomodoro exige iniciar cada fase; a pausa não soma estudo.
- A contagem pausa quando a aba fica oculta, perde o foco ou o navegador apresenta uma interrupção longa. O aplicativo não declara estudo ocorrido durante suspensão, tela bloqueada ou perda prolongada de conexão.
- O relógio visual usa tempo monotônico, sem somar um salto maior que cinco segundos. O saldo da fase é mantido ao pausar e retomar na mesma página; fechar/recarregar a página reinicia o relógio visual. O tempo já confirmado permanece na conta.
- Heartbeats a cada 15 segundos usam o relógio do servidor. Cada um credita no máximo 30 segundos; uma lacuna maior que 45 segundos encerra a sessão sem creditar a lacuna. Existe **uma sessão ativa por conta**, também entre aparelhos/abas. Uma aba abandonada expira; o painel permite encerrar a sessão encontrada em outro aparelho.
- Início e heartbeats são reenviáveis: UUID do início e sequência/corpo do heartbeat são preservados quando a resposta se perde. Antes de abrir outra sessão, o cliente reconcilia o envio anterior e encerra a sessão que ainda estiver aberta. Atualizações do contador são serializadas pelo banco por conta.
- O cronômetro visual e os segundos confirmados não são idênticos em falhas: a conta pode registrar menos tempo por latência, arredondamento para segundos inteiros e encerramento da página. Não há compensação retrospectiva de minutos offline nem multiplicação por velocidade do player. Trata-se de tempo de sessões observadas, **não de comprovação de atenção, dedicação efetiva ou aprendizagem**.

## Meta e indicadores

- Meta semanal de 0 a 10.080 minutos (0 desativa), com fuso IANA salvo na conta. Padrão: 120 minutos e UTC. O botão **Usar fuso deste aparelho** preenche o fuso; salvar confirma a mudança. Não se altera silenciosamente o fuso de outro dispositivo.
- Semana de segunda-feira a domingo no fuso configurado; indicadores mostram semana, minutos confirmados, sete totais diários, meta e revisões manualmente concluídas. Heartbeats são atribuídos ao dia da confirmação; o desvio na borda de uma data é limitado pelo intervalo creditado.
- Alterar o fuso recalcula os agrupamentos das mesmas marcações UTC. Não duplica créditos. Remover uma aula apaga seu progresso de retomada, mas conserva as sessões e seus minutos, desvinculando o material. A exclusão da conta pode remover os dados pela cascata de usuário.

## Contrato e integridade

Todas as rotas abaixo exigem autenticação e a flag ativa; `user_id` vem exclusivamente da sessão autenticada. Respostas têm `Cache-Control: no-store`.

- `GET /api/study/progress?offset=0`: páginas de 200 registros, ordenadas por aula e restritas à conta.
- `PUT /api/study/progress/:materialId`: `{version,requestId,patch:{position?,playbackRate?,completed?,intervals?}}`.
- `GET /api/study/overview`: semana, fuso, meta, totais diários e sessão ativa da conta.
- `PUT /api/study/settings`: `{goalMinutes,timezone}`.
- `POST /api/study/sessions`: `{sessionId,materialId:null|UUID,kind:reading|pomodoro}`.
- `POST /api/study/sessions/:sessionId/tick`: `{sequence,active,close}`. Não aceita segundos, hora inicial ou duração alegados pelo cliente.

Migration candidata: `database/migrations/20261105011000_study_tracking.sql`. Cria `study_settings`, `study_progress`, `study_sessions` e `study_time_credits`, RLS ligada e acesso direto revogado de `anon/authenticated`. Apenas o backend com `service_role` pode chamar as cinco funções e operar as tabelas. Chaves compostas impedem vínculos entre contas; restrições e locks protegem exclusividade de sessão, versões e créditos duplicados. A aprovação automática não equivale a teste de concorrência com conexões nativas distintas.

## Aplicação futura, sem instalação no computador

1. Conferir projeto correto e backup restaurável; executar `database/checks/e08-preflight.sql` no SQL Editor e registrar as contagens legadas. Se alguma tabela/função nova já existir, parar para reconciliar o estado.
2. Com autorização para o banco real, aplicar a migration completa uma única vez, depois das anteriores. Executar `database/checks/e08-postflight.sql`: legado preservado, RLS/privilégios corretos e zero vínculos estrangeiros, sessões simultâneas ou diferenças entre créditos e total da sessão.
3. Implantar frontend/backend compatíveis, reiniciar backend com `FEATURE_STUDY_TRACKING=true` em ambiente de teste e validar as duas contas.
4. Teste integrado: retomada áudio/MP4 em outro aparelho; importação local; conflito entre aparelhos; rede interrompida antes/depois do commit; retomada de aba e suspensão; um foco e uma pausa; dupla sessão recusada; troca de fuso e semana; remoção da aula preservando minutos. Conferir acessibilidade e teclado com o painel ativo.
5. Só fazer merge após aceite. Para desativar, voltar a flag OFF e preservar tabelas, créditos e filas locais. Não apagar dados nem fabricar minutos para compensar divergências.

Validação local desta implementação: lint aprovado e **16 testes novos** de serviço, sincronização, relógio e DOM, além de 16 regressões da etapa 6. Testes HTTP com duas contas e SQL em PostgreSQL embarcado (PGlite) estão incluídos no CI e precisam ser conferidos no commit publicado. Nenhuma conta, mídia ou chave real foi usada. As verificações existentes de navegador/acessibilidade com flags padrão não substituem a homologação do painel ativo no Supabase real.
