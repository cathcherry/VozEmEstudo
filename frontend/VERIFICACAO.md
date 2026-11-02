# Verificação E02 — fluxo acadêmico e regressão

A implementação local E02 acrescenta permissão desmarcada/versionada, revisão de escolhas, confirmação explícita da transcrição e avisos compactos com snapshot. Biblioteca, áudio/recorte, temas, perfil, foco/sidebar e login existentes permanecem. O relatório E02 e `docs/TESTING.md` registram os resultados atuais e os limites: APIs/Auth/Storage simulados, FFmpeg real, PostgreSQL embutido para SQL/RLS, sem integração remota aprovada.

Capturas novas: `tests/artifacts/upload-review-desktop.png`, `confirmation-awaiting-desktop.png`, `warnings-desktop.png`. Reflow/teclado/axe são automáticos; leitores de tela reais permanecem pendentes. G1 está bloqueado para aceite integrado. O registro abaixo é histórico das revisões visuais; não equivale ao resultado atual do backend E02.

# Verificação da versão 0.3.1

Execução em 8 de outubro de 2026. A revisão 0.3.1 alterou o frontend e a documentação. Navegador e análise estática foram executados novamente; o backend permaneceu sem alterações, com seu relatório da 0.3 preservado. Nenhuma conta, banco ou configuração remota foi alterada.

## Resultados

| Verificação                      | Resultado                                                                                         | Evidência                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Chromium + FFmpeg real           | Fluxos aprovados, incluindo upload, recorte, biblioteca, revisão e OAuth                          | `tests/artifacts/browser-results.json`       |
| Backend Node.js + FFmpeg/FFprobe | 17 testes aprovados na 0.3; backend sem alteração nesta revisão                                   | `../backend/tests/media-results.tap`         |
| Auditoria axe-core 4.14.0        | 9 telas principais e menu móvel aberto (10 estados); 0 violações automáticas A/AA detectadas      | `tests/artifacts/accessibility-results.json` |
| Sintaxe e referências estáticas  | 15 HTMLs, 84 arquivos JS/CJS, 0 problemas                                                         | `tests/artifacts/static-results.json`        |
| Inspeção visual                  | Painel claro/escuro/foco, biblioteca, aviso de dados, perfil, player e telas ampliadas conferidos | PNGs em `tests/artifacts/`                   |

As capturas usam materiais, nomes e sessão de teste. Não são dados remotos da usuária. A produção exibe materiais da API e histórico local da conta.

## O que foi conferido

- Painel com biblioteca, dados reais de API, estados vazio/erro e recuperação; uma última aula sem repetição nos recentes. Status junto ao título, resumo do acervo alinhado e grupos de disciplinas legíveis. Nenhuma aula ou revisão inventada.
- Áudio no fim oferece Revisar, sem apresentar retomada na posição final e sem marcar a revisão como concluída.
- Frases soltas removidas; aviso de armazenamento com papel de nota e contexto na Ajuda, acessível pelo rodapé. Links em instruções têm sublinhado.
- Busca por título/disciplinas/tags, agrupamento, edição de título e disciplina pelo PATCH existente e persistência de tags por conta.
- Novas questões de aula antiga pelo link da biblioteca; formulário focalizado e visível abaixo da navegação fixa. Lotes antigos preservados, falha de geração sem falsa confirmação e nova tentativa disponível.
- Reprodução real do áudio, posição retomada sem autoplay, cobertura sem contar seek, revisão explícita e respostas registradas no histórico local.
- Perfil com instituição, curso, objetivo e apresentação; oito avatares PNG, padrão Nino lendo e seleção por teclado. Payload Supabase e persistência testados com SDK simulado.
- Temas claro/escuro/foco nomeados: salvar, aplicar, atualizar, excluir, recuperar após reload e separar por conta; tema inicial aplicado antes da primeira pintura.
- Sidebar desktop recolhível, auto recolhida ao entrar no foco, reabertura manual e restauração da preferência ao sair.
- Menu móvel com fundo inativo, foco contido, Escape e retorno ao botão. Favicons PNG e avatar retornam por rotas locais; /favicon.ico também verificado no app Express real.
- Nove telas de estudo/ajuda a 320, 390 e 1280px com texto 200%, espaçamento amplo, fonte de leitura e foco; sidebar completa a 1280px e páginas públicas a 320px também sem overflow horizontal.
- MP4: prévia limitada ao recorte, download real com vídeo e envio de 750ms em WAV mono 16kHz. Retry do processamento sem repetir upload/material.
- Google/GitHub: parâmetros PKCE, callback, destino interno, bloqueio de retorno externo e erros de provedor/código. SDK Supabase local inicializa sem CDN.

O backend confere nove formatos (MP4, MP3, WAV, M4A, AAC, OGG, FLAC, WebM e MOV), waveform, cortes, exportações, intervalos e limites, arquivo malformado, vídeo sem som, rota HTTP, autenticação e configuração pública sem chave secreta. Inclui os testes de domínio anteriores.

## Reproduzir

```sh
cd backend
npm ci
npm test
```

```sh
cd frontend
npm ci
npx playwright install chromium
npm test
```

O teste cria seu servidor e usa o conversor de mídia real. Supabase/Auth, Storage e geração são simulados; não exige credenciais. Defina `FFMPEG_PATH`, `FFPROBE_PATH` e `BROWSER_EXECUTABLE` para executáveis do sistema. As fixtures de áudio/vídeo são geradas durante o teste.

Foram usados Chromium Headless Shell 145.0.7632.6, Playwright 1.62.1, axe-core 4.14.0 e FFmpeg/FFprobe do sistema. Evite executar validação pesada de sintaxe ao mesmo tempo que os testes de mídia em ambientes com pouca CPU.

## Limites da verificação

A auditoria automática confere as regras A/AA disponíveis no axe, sem constituir certificação WCAG. Os resultados `incomplete` estão preservados no JSON para conferência manual; não foram tratados como aprovação automática. Não foi executado um leitor de tela real (NVDA, VoiceOver ou equivalente). A interface foi verificada quanto a nomes, grupos, landmarks, status e fluxo de teclado.

OAuth com consentimento real, banco/Storage remoto, Whisper e Groq não foram executados com credenciais da usuária. A ativação Google/GitHub segue `../docs/CONFIGURAR_LOGIN_SOCIAL.md`. Safari, Firefox, cargas de produção e codecs fora das fixtures não foram testados.

Tags extras, temas nomeados e andamento ficam neste navegador por conta. Perfil, avatar, título e disciplina usam Supabase/API existentes. Não há migration nova. Timer, histórico de minutos e metas estruturadas foram avaliados em `../docs/PRODUTIVIDADE.md`; ainda não foram implementados.
