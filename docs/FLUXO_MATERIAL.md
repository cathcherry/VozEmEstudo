# Envio e material de estudo

O fluxo usa divulgação progressiva: envio → espera → conferência → resumo → questões.
`material.html` possui três painéis de abas, com navegação por teclado. A confirmação
salva edições antes de confirmar a revisão retornada pelo servidor. Falhas ou
conflitos não confirmam a revisão anterior. Resumos e conjuntos anteriores continuam
acessíveis nas suas abas; gerar novamente não apaga conteúdo já produzido.

## Conservação de vídeo

A opção de conservação é obrigatória quando o arquivo contém vídeo: não guardar,
somente áudio ou vídeo com áudio. O vídeo guardado corresponde ao trecho escolhido,
convertido para MP4. O worker extrai WAV para ASR e conserva o MP4 privado para o
player. A seleção não é inferida da extensão do arquivo enviado.

Antes de usar essa opção em um Supabase existente, revisar, fazer backup e aplicar
`database/migrations/20261105220000_video_retention.sql` no projeto correto. Ela
aceita MP4 na tabela existente e acrescenta seu MIME ao bucket sem torná-lo público.
A migração foi preparada para execução repetida; não é aplicada pelo aplicativo.
Nenhuma alteração remota foi executada nesta implementação.

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
- O teste PostgreSQL de MP4 usa somente banco descartável PGlite, sem Supabase real.
- Markdown é convertido em elementos DOM com texto, sem interpretar HTML recebido.
