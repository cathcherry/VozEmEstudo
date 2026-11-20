# Produtividade no Voz em Estudo — proposta enxuta

> ⚠️ **Documento histórico.** Proposta de 08/10/2026; cronômetro e metas foram implementados depois (E08/E09). Para a situação atual, veja [FUNCIONALIDADES.md](FUNCIONALIDADES.md#4-painel).


Avaliação em 8 de outubro de 2026, com base no código da versão 0.3.1. O ajuste visual está implementado. Timer, histórico de minutos e metas abaixo são uma proposta para a próxima etapa; não foram adicionados à interface nem ao banco.

## Um ciclo de estudo

A aplicação já reúne o conteúdo e a revisão. A extensão mais útil é ligar esse material a uma intenção e a uma sessão: escolher a aula, iniciar o estudo, pausar quando necessário e registrar o próximo passo ao terminar. O timer e o histórico devem compartilhar o mesmo registro de sessão. Isso evita criar ferramentas independentes que disputam espaço no painel.

Minha recomendação é começar com **uma sessão de estudo com Pomodoro opcional e uma meta semanal de minutos**. O tempo livre deve funcionar sem limite; o Pomodoro oferece uma duração de estudo e uma pausa ajustáveis, com 25/5 como sugestão inicial. A pausa não entra no tempo estudado. Iniciar, pausar, retomar e encerrar são as ações essenciais. Nenhuma sessão começa apenas por abrir uma página.

No material, um controle discreto “Iniciar estudo” abre o timer perto do player e acompanha também a leitura e as questões. Durante a navegação, o cabeçalho pode mostrar apenas o tempo e “Pausar”, sem uma janela flutuante cobrindo o conteúdo. O modo foco mantém esse controle disponível, sem gráficos, animações ou alertas contínuos.

No painel, basta uma seção “Esta semana”: tempo de hoje, total em relação à meta e sete dias consultáveis. O histórico completo fica recolhido nessa mesma seção. Esse lugar pode substituir o ranking de tópicos quando houver sessões suficientes, em vez de acrescentar mais uma coluna.

## Dificuldade neste projeto

As classificações são estimativas de engenharia a partir da arquitetura atual, e não promessas de prazo.

| Parte | Dificuldade | Motivo e escopo recomendado |
| --- | --- | --- |
| Relógio visível e Pomodoro | Baixa isoladamente; média como recurso completo | A UI é simples. Sessões precisam sobreviver a navegação/reload, excluir pausas e manter um único timer em duas abas. |
| Tempo por dia e semana | Média | Registrar intervalos reais, separar dias no fuso do usuário e evitar duplicação. Os gráficos são derivados das mesmas sessões. |
| Meta semanal de minutos | Baixa após o histórico | Uma meta numérica com progresso calculado. Alterar a meta não modifica o histórico nem apaga sessões. |
| Objetivo e próximo passo | Baixa para texto simples; média com etapas salvas | O perfil já tem `study_goal`. Pode evoluir para um objetivo ativo com uma lista curta de etapas, sem um gerenciador separado. |
| Calendário anual tipo GitHub | Média, com pouco benefício no começo | Exige navegação acessível, resumo textual e estados sem cor. Começar com sete dias e ampliar quando o histórico justificar. |
| Sincronização entre dispositivos | Média e transversal | Exige novos registros persistidos, autorização por usuário, salvamento idempotente e tratamento de rede/reconexão. |

## Metas e tarefas com limite de escopo

Para objetivos de longo prazo, usar **um objetivo em destaque e no máximo um nível de etapas**. Por exemplo, “Preparar a prova de Física” pode ter “Revisar energia”, “Resolver dez questões” e “Rever os erros”. Uma etapa pode apontar para uma aula da Biblioteca. Concluir uma etapa é uma marcação explícita; ouvir o áudio não conclui automaticamente o objetivo.

O painel mostra só a próxima etapa. A lista completa abre dentro do objetivo. Isso atende to-dos e submetas sem acrescentar quadro Kanban, etiquetas de prioridade, múltiplos calendários, recorrências ou dependências entre tarefas. O texto de objetivo que já existe no perfil pode ser aproveitado, sem criar duas versões concorrentes do mesmo objetivo.

Para continuidade semanal, prefiro “3 de 4 dias planejados” ou “80 de 120 minutos” a uma sequência diária obrigatória. Dias de descanso não zeram a semana. A pessoa escolhe se quer acompanhar dias ou minutos; a primeira entrega pode oferecer só minutos. Um calendário anual, badges e comparações públicas podem ficar fora do escopo.

## O que o código atual permite aproveitar

`frontend/js/utils/study-store.js` já separa dados por usuário e registra reprodução, revisão explícita e respostas. Ele mede cobertura do áudio, não tempo total de estudo. `visitMaterial()` conta acessos separados por pelo menos cinco minutos; essa contagem não comprova duração ou atenção. A versão 0.3.1 chama esses números de “acessos” para não apresentá-los como sessões cronometradas.

`material.page.js` e `quiz.page.js` são os pontos para vincular a sessão ao material. O shell compartilhado permite apresentar um timer compacto durante a navegação. O perfil já fornece um objetivo textual. A API e o banco ainda não têm um modelo de sessões de estudo ou metas estruturadas. Não se deve reaproveitar `materials.completed_at`: ele representa conclusão do processamento, e não conclusão do estudo.

Um modelo futuro mínimo é uma sessão com identificador único, usuário, material opcional, modo, estado e intervalos de estudo/pausa. O histórico diário e a meta são calculados desses intervalos; não se grava um segundo contador independente para o mesmo tempo. Uma sessão encerrada não pode ser somada novamente em um retry. Mais de um dispositivo ou aba não deve dobrar o tempo de períodos sobrepostos.

Para a entrega inicial, a sessão deve ser iniciada explicitamente. Ao ocultar a página, pode continuar quando o áudio estiver tocando; com a página oculta e sem reprodução, pausará. Isso mede **tempo de estudo registrado**, sem alegar medir atenção. Uma evolução pode permitir continuar manualmente para estudar em papel, sem detectar atividade por mouse ou registrar ações da pessoa.

O timer deve calcular tempo por diferenças entre marcações de início/pausa, e usar o intervalo do JavaScript apenas para atualizar a tela. Navegadores atrasam callbacks em abas inativas; contar uma unidade por callback causaria erro. Marcações monotônicas ajudam dentro da página, e marcações persistidas permitem reconstruir o estado após navegação. Suspensão do computador ou fechamento do navegador não devem criar horas de estudo; salvar checkpoints e oferecer a retomada em pausa evita isso.

A sincronização real deve seguir a mesma autenticação e autorização por usuário das APIs existentes. Precisa de migration, regras de acesso e testes de isolamento; não pode guardar todo o histórico de sessões em metadados de perfil. O modo local é mais rápido de desenvolver, mas mantém a limitação de um navegador. Para um histórico que a pessoa consultará durante meses, recomendo planejar a persistência desde o início.

## Acessibilidade e validação

O timer não deve anunciar cada segundo ao leitor de tela. Usar um valor consultável, controles nomeados e avisos apenas nas transições de estudo/pausa/fim. Som é opcional, sem depender dele para perceber o término. O encerramento de um ciclo não muda a página, não toma o foco do teclado e não bloqueia a leitura. Texto, rótulos e diferenças de forma acompanham qualquer cor no histórico.

Os testes essenciais da futura implementação são pause/resume, reload, troca de página, duas abas, logout/troca de conta, interrupção inesperada, rede indisponível, virada de dia/fuso, intervalos sobrepostos e retries sem duplicação. Conferir também fonte 200%, teclado e leitura dos estados. Não basta testar a animação de 25:00 até 00:00.

## Ordem de implementação sugerida

1. Sessão manual com tempo livre/Pomodoro opcional, pausas e salvamento confiável.
2. Resumo de sete dias e uma meta semanal calculados das sessões.
3. Um objetivo com próxima etapa vinculada à Biblioteca, somente se esse fluxo fizer falta no uso real.

O valor de cada etapa pode ser avaliado com uma pergunta concreta: a pessoa consegue decidir o que estudar, fazer a sessão e saber o que vem depois? Se a nova informação não ajuda uma dessas decisões, ela não precisa ocupar o painel.

## Referências técnicas

- [MDN — Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API): estados de visibilidade e limitações de execução em segundo plano.
- [MDN — setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout): callbacks podem atrasar, inclusive em abas inativas.
- [MDN — performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now): relógio monotônico e diferenças em relação ao relógio civil.

Estas referências sustentam os cuidados do relógio. A escolha de interface, metas e escopo é uma recomendação para este produto.
