# Envio e material de estudo

O fluxo usa divulgação progressiva: envio → espera → conferência → resumo → questões.
`material.html` possui três painéis de abas, com navegação por teclado. A confirmação
salva edições antes de confirmar a revisão retornada pelo servidor. Falhas ou
conflitos não confirmam a revisão anterior. Resumos e conjuntos anteriores continuam
acessíveis nas suas abas; gerar novamente não apaga conteúdo já produzido.

## Conservação de vídeo

Áudio e vídeo têm escolhas independentes. O trecho enviado para transcrição é um MP3 mono compacto (~0,5 MB/min; aulas antigas podem estar em WAV),
enviado por upload retomável;
quando solicitado e habilitado por `FEATURE_MP4_RETENTION=true`, o MP4 original
inteiro é conservado separadamente no bucket privado `study-videos`, com metadados
em `material_videos`. Partes fora do recorte também são conservadas no original.

Na etapa de identificação, a escolha “Guardar o vídeo MP4 original” aparece para
toda gravação com vídeo e sempre começa desmarcada. Quando não pode ser atendida,
ela fica visível e desabilitada com o motivo: arquivo MOV/WebM (somente MP4) ou
`FEATURE_MP4_RETENTION` desligada no servidor. Assim o vídeo nunca é descartado em
silêncio. Com a flag ligada, o envio só segue para a transcrição depois que o MP4 é
guardado e registrado; uma falha mostra a etapa e oferece nova tentativa.

### Ativar a conservação do MP4 (feito por quem administra o Supabase)

Nenhuma migration nova é necessária: a E07 já contém tabela, bucket e políticas.

1. **Backup** do projeto de destino e confirmação de que é o projeto certo.
2. `database/checks/e07-preflight.sql` (somente leitura). Esperado: a constraint
   `materials_id_user_planning_unique` existe; `material_videos` e o bucket
   `study-videos` **não** existem. Se existirem, parar e inspecionar.
3. Aplicar `database/migrations/20261105003500_player_video.sql` uma única vez.
   Em seguida aplicar `database/migrations/20261120090000_player_video_storage_owner_fix.sql`
   (pode ser reaplicada): as políticas originais liam `materials` como `authenticated`, papel
   que não tem esse acesso no projeto real, e o envio falhava com "permission denied for table
   materials".
4. `notify pgrst, 'reload schema';` para a API enxergar a tabela nova.
5. `database/checks/e07-postflight.sql`: RLS ligada, sem acesso `anon`/`authenticated`
   à tabela, bucket privado (`video/mp4`, 100 MiB) e nenhum objeto órfão.
6. Reiniciar o backend com `FEATURE_MP4_RETENTION=true` e rodar
   `node backend/src/diagnostics/check-runtime.js` (valida tabela e bucket).
7. Teste manual com duas contas: enviar MP4 com "Vídeo MP4 original" ligado, reproduzir
   na aula, conferir que a outra conta recebe 404, remover o vídeo.

Até lá a opção aparece desabilitada com o motivo, e o vídeo nunca é descartado em
silêncio.

### Legendas por palavra e idioma da gravação

- As legendas por trecho funcionam com qualquer transcrição cujos trechos tenham tempos
  úteis. O destaque palavra a palavra exige a migration
  `20261119030000_ai_executions.sql` (tabela `transcription_word_alignments`) e uma
  transcrição AssemblyAI ainda não editada; sem isso, `/captions` devolve
  `granularity: "segment"` e o player usa trechos.
- "Idioma da gravação" aparece só quando o provedor de ASR aceita idioma (AssemblyAI).
  A lista vem de `ASR_SELECTABLE_LANGUAGES` (padrão `pt,en,es,zh`); confira a cobertura
  do modelo configurado e remova códigos não suportados. A escolha vai no snapshot do job
  como `language_code` fixo ou `language_detection` e o idioma reconhecido fica em
  `transcriptions.language`. Nada é traduzido.

O schema E07 está em `database/migrations/20261105003500_player_video.sql`.
Antes de qualquer aplicação, verificar se já existe no banco e conferir o destino;
essa migration não deve ser reaplicada cegamente. A migration de MP4 em
`audio_files` da branch simplificar foi excluída desta consolidação.
Nenhuma alteração remota foi executada. A timeline apresentada corresponde ao
trecho transcrito, compensando `clipStartMs` ao reproduzir o vídeo original.

## Sincronização

O Space público pode retornar somente texto. Nesse caso o adaptador registra um
segmento de duração integral; isso não permite legendas precisas. O player oferece
legendas WebVTT e acompanhamento do texto apenas para segmentos curtos com tempos
reais. Não são inventados timestamps dividindo a duração pelo número de palavras.

O adaptador em `asr-space/app.py` solicita timestamps por palavra ao Whisper e
agrupa em trechos curtos usando os tempos retornados. Para obter esse comportamento
no serviço externo, publicar o adaptador no Space próprio e configurar
`HF_ASR_SPACE_ID`, endpoint e saída de segmentos conforme o README do Space.
Transcrições antigas não recebem novos tempos automaticamente. O teste local usa
fixtures; não mede qualidade de reconhecimento nem latência do provedor.

## Espera e dados

`processando.html` aguarda a tarefa confirmada no servidor e redireciona para a
conferência. Fechar a página não cancela o worker. O tempo mostrado é decorrido,
não uma previsão: sem histórico de latência, nenhuma estimativa é inventada.

As informações sobre provedores ficam em `privacidade.html`, acessível no envio e
na Ajuda. O aceite de permissão continua sendo versionado por gravação no backend.
A tela de envio preserva o texto completo da declaração recebida da API, para não
registrar aceite de uma declaração diferente da exibida.

## Verificação

- `npm run check` (usar o Python do venv e FFmpeg/FFprobe configurados).
- `BROWSER_EXECUTABLE=/usr/bin/chromium FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe npm run test:browser`.
- O teste SQL E07 está em `scripts/tests/e07-pglite.test.mjs`; usa banco descartável.
- Markdown é convertido em elementos DOM com texto, sem interpretar HTML recebido.
