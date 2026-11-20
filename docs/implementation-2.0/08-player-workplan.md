# Etapa 6 de 9 — Player 2.0 / E07

> ⚠️ **Documento histórico.** Plano/runbook da etapa; afirmações como "nenhuma migration aplicada" refletem a data em que foi escrito. Para a situação atual, veja [BANCO_DE_DADOS.md](../BANCO_DE_DADOS.md).


**Implementação preparada no PR #2, fora da `main`. Nenhum SQL, deploy ou ativação de flag foi realizado.** A conservação de MP4 depende da migration candidata E07 e de `FEATURE_MP4_RETENTION=true`. As melhorias de áudio/transcrição/retomada local não exigem nova tabela. A etapa está concluída em código para o escopo abaixo; homologação com Supabase, Storage e mídias reais permanece pendente.

## Reprodução e transcrição

- Velocidades de 0,5× a 3×, botões de ±10 segundos e atalhos quando o próprio player tem foco: Espaço/K reproduz ou pausa; setas esquerda/direita saltam 10 segundos. Inputs, selects, links, botões e edição de texto mantêm o comportamento de teclado normal.
- Trecho atual destacado pelos timestamps existentes do ASR, com acompanhamento de rolagem opcional e desativado inicialmente. Pausas entre segmentos não destacam outro trecho. A rolagem não disputa foco com a edição de um textarea.
- Busca na transcrição sem distinção de acentos/maiúsculas, contagem de **trechos** encontrados e navegação anterior/próximo. A busca lê o texto editado ainda não salvo, sem reescrever os campos nem interpretar HTML. Navegar na busca posiciona o player sem iniciar reprodução.
- Posição e velocidade por aula e conta salvas no armazenamento já existente **deste navegador**. O histórico usa a posição relativa ao trecho transcrito, inclusive no vídeo original. Sincronização de progresso entre aparelhos pertence à etapa 7, não a esta entrega.
- Troca áudio/vídeo e renovação de URL preservam posição relativa, velocidade e estado de reprodução. Recarregar o material não reinicializa o player só porque o servidor retornou uma URL assinada diferente.
- `GET /api/materials/:materialId/playback`: autenticação e propriedade antes de emitir URLs de 600 segundos; resposta `Cache-Control: no-store`. Renovação manual, tentativa automática no erro de mídia (no máximo uma por 30 segundos por página) e renovação a cada oito minutos enquanto reproduz. Falha mantém opção de repetir; não tenta renovar infinitamente um codec incompatível.

## MP4 original opcional

- Ao selecionar um MP4 com vídeo, a opção **Guardar o MP4 original inteiro** aparece somente com a flag ativa. Vem desmarcada e é independente da conservação do WAV. Outros formatos continuam aceitos para extração de áudio, mas não são conservados como vídeo nesta entrega.
- A confirmação antes do envio declara explicitamente que o arquivo inteiro, incluindo partes fora do recorte, será conservado. Imagens não são enviadas ao ASR ou analisadas: o fluxo antigo continua extraindo e transcrevendo somente o WAV do recorte.
- O arquivo MP4 enviado é o original, sem transcodificação, no bucket privado `study-videos`. O áudio e as estruturas históricas não são recriados. Limites: 100 MB e duas horas, conforme inspeção e validação existentes.
- O formulário congela arquivo, duração, recorte e escolhas antes do envio. Depois de criar a aula com o WAV, envia o MP4 e registra o vínculo antes de iniciar o processamento. Se o envio/vínculo falhar, exibe que o áudio está salvo e permite **Concluir envio e iniciar transcrição**; o registro pode ser retomado enquanto a página e o arquivo selecionado estiverem disponíveis. Não omite a escolha silenciosamente.
- Upload em chave determinística `original/{userId}/{materialId}/source.mp4`, sem overwrite. Um reenvio verifica o objeto existente e a API devolve o mesmo registro quando metadados/recorte coincidem; divergências geram conflito. O tamanho/tipo são conferidos no Storage, mas isso não constitui verificação criptográfica de identidade do arquivo.
- A API associa somente o objeto da conta e aula autenticadas e confere se a duração do recorte corresponde ao WAV, com tolerância de 1,5 s por arredondamento/conversão. A duração original e os limites do recorte ficam persistidos.
- No player, `0:00` continua sendo o começo do **trecho transcrito**. Exemplo: recorte original 30–50 s: timestamp 5 s da transcrição vai a 35 s do MP4; a reprodução do trecho para aos 50 s. Há link separado **Abrir MP4 original inteiro** para acessar o arquivo completo. URLs expiradas podem exigir renovação antes de abrir esse link.
- Remover o vídeo pela aula apaga o objeto antes do registro; uma falha no Storage preserva o registro para nova tentativa. Áudio, transcrição e derivados são preservados. Excluir a aula pelo aplicativo também tenta limpar seu vídeo, inclusive se a flag foi desativada depois de usar a funcionalidade; banco antigo sem a tabela é aceito nesse caminho.

## Banco e segurança

Migration candidata: `database/migrations/20261105003500_player_video.sql`. Dependência: E05, que fornece `materials_id_user_planning_unique (id,user_id)`. Respeitar a ordem cronológica completa das migrations já preparadas.

- Tabela `material_videos`, um vídeo por aula, FK composta de conta/aula, caminhos exatos e limites de tamanho/duração/recorte.
- RLS ligada; `anon` e `authenticated` sem acesso direto à tabela. `service_role` tem SELECT/INSERT/DELETE, sem UPDATE concedido por esta migration.
- Bucket privado exclusivo para `video/mp4`, limite 100 MB. Políticas de INSERT e SELECT por prefixo da conta e existência da aula pertencente a ela. Não há política de UPDATE/DELETE do navegador; remoção passa pelo backend.
- O SQL falha caso o bucket já exista, em vez de alterar silenciosamente a privacidade de um bucket encontrado. Políticas genéricas preexistentes em `storage.objects` precisam ser auditadas, pois podem ampliar permissões de políticas específicas.
- Objetos enviados antes de uma falha no registro podem ficar órfãos. O postflight lista candidatos com mais de 24 horas; confirmar que não há upload em andamento e remover pela API/console de Storage, nunca apagando diretamente a linha em `storage.objects`. Exclusões diretas no banco ou de contas fora do aplicativo também exigem essa conferência. Não há rotina automática agendada de limpeza nesta entrega.

## Aplicação futura pelo navegador, sem Docker

1. Conferir projeto/backup restaurável e executar `database/checks/e07-preflight.sql` (somente leitura). Registrar contagens legadas, verificar FK e ausência da nova tabela/bucket; auditar políticas genéricas de Storage.
2. Depois da autorização para a instância real, aplicar a migration completa uma única vez no SQL Editor.
3. Executar `database/checks/e07-postflight.sql`: contagens legadas iguais, bucket privado e MIME/limite corretos, RLS ligada, privilégios esperados e zero vínculos estrangeiros.
4. Implantar frontend/backend juntos em ambiente de teste, reiniciar o backend com `FEATURE_MP4_RETENTION=true`, testar contas A/B e só então considerar o merge com aceite humano.
5. Reversão operacional: desativar a flag para novos envios/acesso ao vídeo; preservar tabela/bucket e dados. Não usar DROP nem excluir objetos para esconder uma falha. As melhorias de player podem ser revertidas pelo commit sem apagar materiais.

## Evidências e limites

Lint dos arquivos alterados e **16 testes direcionados** de serviço/DOM aprovados localmente, mais 28 testes de regressão da etapa 5 (44 no total). Testam caminhos/contas, registro repetido, falhas, recorte original, velocidades, atalhos, renovação/troca de fonte e retomada por conta. O CI também executa o novo teste HTTP com duas contas e o SQL em PostgreSQL embarcado (PGlite), junto à suíte existente de navegador/acessibilidade; seu resultado deve ser conferido no commit publicado.

Nenhum desses testes comprova integração com o Supabase real. Homologar: MP4 com recorte iniciado após zero, preservação byte a byte do original, WAV como única entrada ASR, vídeo sem áudio/mídia incompatível, recusa entre contas, reenvio interrompido, remoção com falha de Storage, acessibilidade manual e renovação após expiração real. A sincronização acompanha os timestamps existentes: não cria alinhamento palavra a palavra nem corrige timestamps do ASR (E20 continua separado).
