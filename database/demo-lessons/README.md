# Aulas de demonstração

Três aulas completas, originais e livres para distribuir, que todo participante do programa de
testes pode explorar **sem custo de IA**: áudio, transcrição com tempos, resumo, questões e
cartões já prontos. O seed (escrito à parte) lê apenas `lesson.json` e os arquivos de mídia de
cada pasta.

| Pasta       | Título                                        | Matéria    | Duração | Segmentos | Mídia                           |
| ----------- | --------------------------------------------- | ---------- | ------- | --------- | ------------------------------- |
| `crase/`    | Crase: quando usar o acento grave             | Português  | 3min08  | 25        | áudio (1,5 MB)                  |
| `vacinas/`  | Como as vacinas ensinam o sistema imunológico | Ciências   | 3min31  | 25        | áudio (1,7 MB)                  |
| `internet/` | Como a internet entrega uma página            | Tecnologia | 3min15  | 24        | áudio (1,6 MB) e vídeo (4,4 MB) |

Cada aula tem uma estrutura diferente: regra, exemplos e erros comuns (crase); conceitos e
cadeias de causa e efeito (vacinas); um processo em etapas, com slides (internet).

## Licença e créditos

- Roteiros, resumos, questões, cartões e slides: **originais da equipe Voz em Estudo**, sob
  licença **CC BY 4.0** para uso no programa de testes. Nenhum material de terceiros foi copiado.
- Narração **sintetizada**, sem voz de pessoa real: espeak-ng 1.51 com as vozes MBROLA `br4`
  (feminina; crase e internet) e `br1` (masculina; vacinas). As bases de difones MBROLA são
  distribuídas sob a licença MBROLA, que permite uso não comercial; o uso acadêmico neste TCC se
  enquadra nisso. Se o projeto passar a ter uso comercial, revise essa licença ou regenere a
  narração com outra voz (o processo abaixo é o mesmo).
- O campo `credits` de cada `lesson.json` traz o texto de crédito que a interface deve mostrar.

## Como foram produzidas

- **Transcrição e tempos**: os segmentos _não_ vêm do ASR de produção. O roteiro é sintetizado
  frase por frase; cada frase é aparada do próprio silêncio e as frases são unidas com pausas
  fixas (320 ms entre frases, 420 ms entre segmentos, 750 ms entre parágrafos). Por isso
  `startMs` e `endMs` são medidos nas próprias amostras do áudio: são tempos reais, não
  estimativas. O validador confere, no áudio decodificado, que há fala dentro de cada segmento
  e silêncio logo antes e logo depois dele.
- **Segmentos**: de 1 a 3 frases, entre ~3,4 e 12,5 s, como um ASR produziria.
- **`words: null`**: não há tempos por palavra. O espeak-ng expõe tempos de fonemas, mas não
  marcas confiáveis de palavra; em vez de inventar tempos, o campo fica nulo.
- **Resumo, questões e cartões**: escritos e revisados pela equipe, _não_ gerados pelo LLM de
  produção. Seguem os formatos do app: resumo no subconjunto de Markdown do `summary-v3`
  (títulos `##`, listas, negrito e itálico), questões com os metadados do `questions-v2`
  (`difficulty`, `skill`, `facet`, `concept`, `evidence`, `sourceRefs`) e cartões com
  `evidence` e `sourceSegments`. Toda `evidence` é um trecho literal de um único segmento, e as
  referências são calculadas a partir dela.
- **Texto falado × texto escrito**: quando a voz pronunciaria mal a forma escrita, o roteiro
  guarda as duas versões (`text` vai para a transcrição; `say`, para o sintetizador):
  `IP` → "i pê", `cache` → "quéche", `404` → "quatrocentos e quatro". A transcrição continua
  em português escrito correto e corresponde ao que se ouve.
- **Difones ausentes**: as vozes `br1`/`br4` não têm alguns difones (por exemplo, `z` antes de
  consoante sonora entre palavras). Em vez do silêncio que o MBROLA colocaria, o script troca o
  fonema por uma variante próxima (`z`→`s2`, `r`→`r2`, vogal nasal→oral) e registra cada troca
  na saída. Na versão atual não sobra nenhum difone ausente.

## Arquivos de cada pasta

| Arquivo       | Papel                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| `script.json` | Fonte do roteiro: parágrafos → segmentos → frases (com `say` opcional).   |
| `study.json`  | Fonte do resumo, das questões e dos cartões (sem tempos).                 |
| `lesson.json` | **Arquivo canônico lido pelo seed**, gerado a partir dos dois anteriores. |
| `audio.mp3`   | Narração: mono, 44,1 kHz, 64 kbps.                                        |
| `video.mp4`   | Só em `internet/`: slides 1280×720 (H.264) com o mesmo áudio (AAC).       |
| `timing.json` | Segmentos com o parágrafo de origem; usado só para sincronizar os slides. |

Não edite `lesson.json` à mão: altere `script.json` ou `study.json` e regenere. Ao mudar o
conteúdo de uma aula já publicada, aumente `version` em `study.json`.

## Como regenerar

Requisitos: `espeak-ng` e `mbrola` com as vozes `mbrola-br1` e `mbrola-br4` (pacotes Debian
com esses nomes), Python 3 (com Pillow, só para o vídeo) e `npm install` em `backend/` (traz o
`ffmpeg-static` e o `ffprobe-static`). Nada é baixado nem enviado à rede.

```bash
python scripts/demo-lessons/build-audio.py        # todas as aulas (ou: build-audio.py crase)
python scripts/demo-lessons/build-video.py        # slides + vídeo da aula "internet"
python scripts/demo-lessons/build-audio.py internet   # registra o tamanho do vídeo
node scripts/demo-lessons/validate.mjs            # ou: npm run check:demo-lessons
```

Com as mesmas versões de espeak-ng, MBROLA e ffmpeg, o `build-audio.py` produz arquivos
idênticos byte a byte. O vídeo troca de slide no início de cada parágrafo da narração.

## O que o validador confere

`scripts/demo-lessons/validate.mjs` roda sem rede e usa os validadores do próprio app:

- esquema exato do `lesson.json`, tom de capa válido e emblema existente no manifesto de arte;
- segmentos em ordem, sem sobreposição e dentro da duração; duração do MP3 (ffprobe) igual a
  `durationMs` (±200 ms); fala dentro de cada segmento e silêncio nas bordas;
- questões: 4 alternativas distintas, `correctIndex` de 0 a 3, `difficulty`/`skill`/`facet`
  aceitos pelo backend, respostas espalhadas, sem questões redundantes (`filterRedundant`),
  explicações que não citam "a transcrição";
- `evidence` literal e `sourceRefs`/`sourceSegments` idênticos aos que o `sourceReferences` do
  app calcularia;
- cartões aceitos por `validateNewFlashcardSet` e `validateGeneratedFlashcards`;
- resumo renderizado pelo `renderMarkdown` do frontend (jsdom), sem HTML, links ou tabelas;
- tamanhos: áudio < 3 MB, vídeo ≤ 8 MB, `sizeBytes` iguais aos arquivos.

## Limitações

- A voz sintetizada é inteligível, mas robótica; serve para demonstrar o app, não para
  avaliar a qualidade de um ASR com fala natural.
- Sem tempos por palavra (`words: null`); o destaque fica no nível do segmento.
- Os tempos refletem a síntese, não uma transcrição automática: não representam erros típicos
  de ASR.
