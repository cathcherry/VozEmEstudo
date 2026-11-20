# Etapas 8 e 9 — Anotações/exportação e calendário/compartilhamento

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


Implementação preparada no PR #2 em rascunho, fora da `main`. **Nenhuma migration aplicada, deploy, link público real ou ativação de flag.** Novas flags `FEATURE_ANNOTATIONS` e `FEATURE_CALENDAR`; a flag existente `FEATURE_SHARING` controla os links. Todas OFF por padrão. A implementação do escopo abaixo está preparada; validação integrada com dados reais e aceite continuam pendentes.

## Etapa 8 — E14/E15

Anotações privadas por conta/aula com criação, edição do texto, arquivamento e busca literal sem distinção de maiúsculas. Na aula, selecionar até 1.000 caracteres da transcrição salva e usar **Usar seleção da transcrição**; acrescentar nota opcional e escolher amarelo, verde ou azul. Notas sem seleção também são aceitas, com até 5.000 caracteres.

O destaque guarda ID/número da revisão, posição do segmento, offsets em caracteres Unicode e citação literal. A referência é conferida no snapshot imutável, não no texto enviado pelo navegador. Alterações da nota não mudam a referência. **Ir ao destaque** seleciona o trecho no campo de edição quando revisão e texto ainda correspondem. Se mudaram, o cartão preserva a citação e informa que ela pertence a outra revisão; não reancora automaticamente. A cor é apresentada na citação do cartão; não é um editor de texto rico com marcação inline permanente dentro dos textareas.

A busca no painel abrange as anotações da própria conta, com links para as aulas. Busca na aula fica restrita a ela. Resultados paginados em 50, inclusive para grandes acervos. Notas arquivadas não aparecem na busca/exportação normal. A API mantém versões e identificadores de envio; conflitos exigem atualizar a tela, e respostas de rede incertas podem ser confirmadas repetindo os mesmos dados. Os rascunhos de formulário são mantidos na página durante a falha, sem promessa de autosave offline; recarregar pode perder uma edição ainda não enviada.

Na aula, **Exportar textos salvos** permite escolher transcrição, resumo e, com a flag ativa, anotações pessoais. TXT e Markdown são downloads UTF-8. **Imprimir / salvar PDF** abre um documento de leitura A4 e o diálogo nativo do navegador, onde se escolhe Salvar como PDF. Não é download automático de PDF pelo servidor, nem requer aplicativo/conversor novo. A página de impressão usa texto via DOM, sem interpretar HTML do conteúdo.

Cada seção identifica sua versão/revisão-fonte, inclusive resumo antigo ou nota de outra revisão. Exporta o texto salvo, não rascunhos dos campos. Anotações pessoais vêm desmarcadas por padrão e sua exportação percorre todas as páginas, sem limitar o arquivo aos primeiros 50 registros.

## Etapa 9 — E18/E19

### Calendário e ICS

Calendário mensal privado no painel, com grade de segunda a domingo e agenda do mês/dia selecionado. Criação, edição e remoção de horários, título, descrição opcional e vínculo com aula. Prazos de tarefas pendentes dos objetivos não arquivados aparecem como itens de dia inteiro; **Agendar horário para esta tarefa** cria um horário vinculado, sem alterar o prazo original. Concluir uma tarefa a remove da lista de prazos pendentes, mas não apaga horários já criados.

Horários são exibidos e inseridos no fuso do navegador; a tela mostra esse fuso. O backend recebe instantes com offset e armazena `timestamptz`. Datas de prazos continuam datas, sem conversão indevida para a véspera. A preferência de fuso da meta semanal da etapa 7 é independente desta visualização. A edição preserva o instante original quando o campo local não mudou; horários inexistentes na mudança de fuso/horário de verão são recusados no formulário. Horários agendados duram até sete dias.

Consultas são limitadas a intervalos de até 62 dias, paginadas em 100 registros e restritas à conta. Há navegação de carregamento e exportação do **mês completo**, percorrendo todas as páginas. ICS usa UTC para horários e `VALUE=DATE` para prazos, escapes de texto e quebra de linhas em até 75 octetos UTF-8. Não envia convites, não cria eventos no Google Calendar e não assina um feed automático; o usuário baixa e importa o arquivo no aplicativo de calendário que escolher. Recorrência, notificações e convites não fazem parte desta entrega.

### Cópias compartilhadas

Na aula, selecionar transcrição confirmada e/ou resumo da mesma revisão; validade de 1, 7 ou 30 dias. O backend lê o conteúdo real da conta e monta uma cópia congelada. Não aceita snapshot arbitrário enviado pelo navegador, não inclui mídia, gabaritos, notas privadas ou progresso. O resumo precisa corresponder à revisão confirmada; gerar novamente se estiver antigo. A cópia não acompanha alterações futuras, mas excluir a aula remove o vínculo e interrompe novos acessos ao link.

O navegador gera um token de 32 bytes com Web Crypto, em hexadecimal. O servidor guarda somente SHA-256 e metadados; o token original fica no fragmento do link `compartilhado.html#token=...`, sem ir no GET da página ou no referrer. A página pública o envia por POST sem credenciais, recebe somente título, disciplina, número de revisão e textos escolhidos, renderizados como texto. Respostas são `no-store`, `no-referrer` e `noindex`. Nenhuma conta é necessária para quem já possui o link: ter o endereço concede leitura até expirar/revogar.

O dono pode listar seus links em páginas de 50 e revogar os ainda válidos. Expiração e revogação são conferidas no banco a cada abertura; indisponível/expirado/revogado têm a mesma resposta pública. O endereço completo só é mostrado após criar: copiá-lo nesse momento. Se a resposta se perder, repetir o envio na mesma página preserva token/requestId; após recarregar, revogar o registro sem endereço e criar outra cópia. Revogar impede novos acessos, mas não recolhe conteúdo já lido ou baixado. O serviço limita a criação quando já encontra 100 links ativos da conta; não é uma quota distribuída rigorosa contra criações simultâneas em aulas diferentes.

## Banco, correção de dependência e implantação

- `20261105014000_annotations.sql`: tabela/RPCs de anotações privadas, referências e versões.
- `20261105014500_calendar_sharing.sql`: horários privados, unicidade composta de tarefas, snapshots e tokens hashed, RPCs de calendário/compartilhamento.
- Dependem de E02 e E05 (que depende de E03); manter a ordem cronológica completa já preparada no repositório.
- A integração revelou um erro de montagem na candidata **E05**, ainda não aplicada: regex de URL interrompida e trecho duplicado após `COMMIT`. A candidata foi corrigida, preservando `reference_url`, `sort_order`, `completed_at`, FKs e RPC de ordenação. O novo teste executa **E03 → E05 corrigida → E14 → E18/E19** sobre a base E02 real de teste, em vez de verificar só padrões no arquivo. Não reaplicar E05 sobre um banco que já possua suas tabelas; reconciliar o schema antes.
- RLS ligada, tabelas e funções novas sem acesso direto de `anon/authenticated`; somente backend `service_role`. FKs de conta/material/tarefa, validação de fonte e versões impedem vínculos entre contas. Os dados legados não são recriados.

Aplicação futura sem Docker: confirmar backup/projeto, executar `database/checks/e14-e19-preflight.sql`, aplicar cada candidata completa uma única vez e executar `e14-e19-postflight.sql`; contagens legadas iguais, RLS/privilégios corretos e zero vínculos estrangeiros. Só ativar flags depois de backend/frontend e migrations compatíveis em ambiente de teste. Para desativar, desligar as flags e preservar os dados; não usar DROP para reverter. O compartilhamento público também fica inacessível com a flag OFF.

## Validação e pendências

Lint e 13 testes novos locais de serviço, Unicode, ICS, exportação segura, reenvio e DOM; seis regressões de flags/E05 também aprovadas. O CI inclui HTTP com duas contas, leitura pública limitada e revogação, além da cadeia SQL completa em PostgreSQL embarcado e da suíte existente de navegador/acessibilidade. Conferir o resultado no commit publicado.

Homologar no Supabase real: duas contas, edição concorrente de notas/horários, destaque antes/depois de revisão, exportação extensa e PDF nativo (inclusive fonte/impressão), importação ICS em outro aplicativo, fuso/horário de verão, link expirado/revogado e conteúdo congelado, remoção da aula e navegação por teclado com flags ativas. PostgreSQL embarcado e mocks não substituem essas verificações. As nove etapas terem código preparado não significa implantação, aceite do manual completo ou merge autorizado.
