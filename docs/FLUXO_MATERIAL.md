# Envio e material de estudo

O fluxo usa divulgação progressiva: envio → espera → conferência → resumo → questões.
`material.html` possui três painéis de abas, com navegação por teclado. A confirmação
salva edições antes de confirmar a revisão retornada pelo servidor. Falhas ou
conflitos não confirmam a revisão anterior. Resumos e conjuntos anteriores continuam
acessíveis nas suas abas; gerar novamente não apaga conteúdo já produzido.

## Conservação de vídeo

Áudio e vídeo têm escolhas independentes. O trecho enviado para transcrição é WAV;
quando solicitado e habilitado por `FEATURE_MP4_RETENTION=true`, o MP4 original
inteiro é conservado separadamente no bucket privado `study-videos`, com metadados
em `material_videos`. Partes fora do recorte também são conservadas no original.

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
