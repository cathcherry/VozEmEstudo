// Representative pt-BR lesson transcript for capacity estimates (fictional, written for this
// purpose; no real student or teacher). Spoken style: fillers, repetitions and questions to the
// class, as AssemblyAI returns them (punctuate + format_text, no disfluency cleanup).
// Paragraph = roughly 30 s of speech (about 75 words at ~150 words/min).
export const LESSON_PARAGRAPHS = [
  'Bom dia, pessoal. Então, vamos começar. Hoje a gente vai falar sobre o ciclo da água e sobre bacias hidrográficas, que é um assunto que cai bastante em prova, tá? E não só em prova, né, ele explica muita coisa do dia a dia, por exemplo por que falta água em algumas cidades no inverno e por que outras alagam no verão. Antes de tudo, quem lembra o que é evaporação? Isso, é quando a água passa do estado líquido para o gasoso.',
  'Então, o ciclo da água, também chamado de ciclo hidrológico, é o movimento contínuo da água entre a superfície da Terra e a atmosfera. Ele não tem começo nem fim, mas, pra facilitar, a gente costuma começar pela evaporação. O Sol aquece os oceanos, os rios, os lagos, e uma parte dessa água evapora. E tem também a transpiração das plantas, que a gente chama de evapotranspiração quando junta as duas coisas, tá bom?',
  'Esse vapor sobe, e conforme ele sobe a temperatura vai caindo. Quando o ar esfria, o vapor condensa, ou seja, volta a ser gotinhas de água líquida, e são essas gotinhas que formam as nuvens. Reparem: a nuvem não é vapor, a nuvem é água líquida em gotas muito pequenas, ou até cristais de gelo, dependendo da altitude. Isso aqui é uma confusão muito comum, então anotem.',
  'Quando essas gotas crescem, se juntam e ficam pesadas demais pra ficar suspensas, acontece a precipitação. Precipitação não é só chuva, tá? Pode ser neve, pode ser granizo, pode ser garoa. E aí vem a parte que interessa pra bacia hidrográfica: o que acontece com a água depois que ela cai no chão? Basicamente, ela tem dois caminhos principais. Ou ela infiltra no solo, ou ela escoa pela superfície.',
  'A infiltração depende muito do tipo de solo e da cobertura vegetal. Um solo arenoso deixa a água passar com mais facilidade; um solo argiloso segura mais. E a vegetação é fundamental, porque as raízes abrem caminhos no solo e as folhas diminuem a força da chuva. A água que infiltra pode abastecer os aquíferos, que são as reservas de água subterrânea, como o Aquífero Guarani, que fica embaixo de parte do Brasil, do Paraguai, do Uruguai e da Argentina.',
  'Já o escoamento superficial é a água que corre por cima do terreno, e ela vai sempre do ponto mais alto pro ponto mais baixo, por causa da gravidade. Essa água forma os córregos, que se juntam e formam rios maiores. E aqui entra o conceito principal da aula de hoje, que é a bacia hidrográfica. Bacia hidrográfica é a área de terra drenada por um rio principal e pelos seus afluentes.',
  'Ou seja, toda a chuva que cai dentro dessa área acaba indo parar, de um jeito ou de outro, naquele rio principal. E o que separa uma bacia da outra? São os divisores de águas, que geralmente são as partes mais altas do relevo, tipo serras e chapadas. Se a chuva cai de um lado da serra, ela vai pra uma bacia; se cai do outro lado, vai pra outra bacia. Faz sentido? Ótimo.',
  'Agora, alguns termos que vocês precisam saber. A nascente é o lugar onde o rio começa. A foz é onde ele termina, que pode ser no mar, num lago ou em outro rio. Os afluentes são os rios menores que deságuam no rio principal. E o leito é o canal por onde o rio corre. Tem ainda a margem direita e a margem esquerda, que a gente define olhando no sentido da correnteza, da nascente pra foz.',
  'Por que isso tudo importa? Porque a bacia hidrográfica é a unidade de planejamento dos recursos hídricos aqui no Brasil. A Lei das Águas, de 1997, estabelece que a gestão da água deve ser feita por bacia, com participação do poder público, dos usuários e da sociedade, através dos comitês de bacia. Então não adianta uma cidade cuidar só do pedaço de rio dela se a cidade de cima despeja esgoto sem tratamento.',
  'E aí a gente chega na relação entre uso do solo e enchente, que eu comentei lá no começo. Quando a gente desmata e impermeabiliza o solo, com asfalto, concreto, telhado, a água não consegue infiltrar. O que acontece? Aumenta o escoamento superficial, a água chega muito mais rápido e em maior quantidade nos rios, e eles transbordam. Por isso as cidades grandes alagam com tanta facilidade quando chove forte.',
  'E o contrário também vale. Se a água não infiltra, os aquíferos não são recarregados, e no período seco os rios ficam com pouca água, porque quem mantém o rio correndo na seca é justamente a água subterrânea que vai saindo devagarinho. Então desmatamento causa os dois problemas: enchente na época de chuva e falta de água na época seca. Isso é uma relação de causa e consequência que cai muito, tá?',
  'Outro ponto: a mata ciliar. Mata ciliar é a vegetação que fica nas margens dos rios, e o nome vem de cílio, porque ela protege o rio do mesmo jeito que o cílio protege o olho. Ela segura o solo das margens, evita erosão e evita o assoreamento, que é o acúmulo de sedimentos no fundo do rio. Rio assoreado fica mais raso, transborda mais fácil e fica pior pra navegação.',
  'Pra fechar, vamos comparar rapidamente duas bacias brasileiras. A Bacia Amazônica é a maior do mundo em área e em volume de água, tem rios de planície, muito bons pra navegação. Já a Bacia do Paraná tem muitos rios de planalto, com desníveis e quedas, o que favorece a geração de energia hidrelétrica, como a usina de Itaipu. Então o relevo influencia diretamente o uso que a gente faz de cada rio.',
  'Resumindo: o ciclo da água tem evaporação, condensação, precipitação, infiltração e escoamento; a bacia hidrográfica é a área drenada por um rio principal e seus afluentes, separada das outras pelos divisores de águas; e o uso do solo, principalmente o desmatamento e a impermeabilização, altera o equilíbrio entre infiltração e escoamento. Pra próxima aula, tragam um mapa da bacia onde fica a cidade de vocês, combinado? Até lá.',
];

/** Transcript of the first `minutes` minutes (two paragraphs per minute). */
export function transcriptFor(minutes) {
  const paragraphs = LESSON_PARAGRAPHS.slice(0, Math.max(1, Math.round(minutes * 2)));
  return paragraphs.join(' ');
}

/**
 * Display segments shaped like transcription_versions.segments_snapshot
 * ({id, position, startMs, endMs, text}); about 22 words (~9 s) each, as the word-based
 * segmentation (3 to 12 s) produces.
 */
export function segmentsFor(minutes, wordsPerSegment = 22) {
  const words = transcriptFor(minutes).split(/\s+/u);
  const segments = [];
  const msPerWord = 400;
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    const position = segments.length;
    segments.push({
      id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
      position,
      startMs: i * msPerWord,
      endMs: Math.min(words.length, i + wordsPerSegment) * msPerWord,
      text: words.slice(i, i + wordsPerSegment).join(' '),
    });
  }
  return segments;
}

// Sample model OUTPUTS, used only to calibrate visible output size (tokens per item).
export const SAMPLE_OUTPUTS = {
  summaryStandard5min: `## Ciclo da água

O **ciclo hidrológico** é o movimento contínuo da água entre a superfície e a atmosfera. Começa, por convenção, pela **evaporação** de oceanos, rios e lagos, somada à transpiração das plantas (**evapotranspiração**). O vapor sobe, esfria e **condensa** em gotas ou cristais que formam as nuvens — a nuvem é água líquida, não vapor. Quando as gotas ficam pesadas, ocorre a **precipitação** (chuva, neve, granizo ou garoa).

## Destino da água no solo

- **Infiltração**: depende do tipo de solo (arenoso deixa passar mais; argiloso retém) e da vegetação, que abre caminhos com as raízes e reduz a força da chuva. Abastece os **aquíferos**, como o Aquífero Guarani.
- **Escoamento superficial**: a água corre do ponto mais alto para o mais baixo e forma córregos e rios.

## Bacia hidrográfica

É a área drenada por um rio principal e seus afluentes, separada das demais pelos **divisores de águas** (serras e chapadas). Termos: **nascente**, **foz**, **afluentes**, **leito** e margens direita e esquerda, definidas no sentido da correnteza.

A Lei das Águas (1997) adota a bacia como unidade de gestão, com comitês de bacia que reúnem poder público, usuários e sociedade.

## Uso do solo e suas consequências

Desmatamento e impermeabilização reduzem a infiltração e aumentam o escoamento: os rios transbordam nas chuvas e, sem recarga dos aquíferos, ficam baixos na seca. A **mata ciliar** protege as margens, evita erosão e **assoreamento**.

## Comparação

A Bacia Amazônica, de planície, favorece a navegação; a Bacia do Paraná, de planalto, favorece hidrelétricas como Itaipu. O relevo influencia o uso de cada rio.`,
  concept: {
    label: 'Divisores de águas',
    evidence:
      'E o que separa uma bacia da outra? São os divisores de águas, que geralmente são as partes mais altas do relevo, tipo serras e chapadas.',
  },
  question: {
    slot: 's3',
    statement:
      'Uma cidade substituiu grande parte de sua vegetação por asfalto e concreto. Qual consequência é esperada para os rios da região durante chuvas fortes?',
    options: [
      'Os rios recebem mais água em menos tempo e tendem a transbordar.',
      'Os aquíferos são recarregados mais rapidamente e os rios baixam.',
      'A evaporação aumenta e impede a formação de enchentes.',
      'A infiltração cresce e o escoamento superficial diminui.',
    ],
    correctIndex: 0,
    explanation:
      'Sem vegetação e com o solo impermeabilizado, a água não infiltra e escoa pela superfície, chegando aos rios mais rápido e em maior volume. A alternativa sobre infiltração inverte essa relação.',
    evidence:
      'Aumenta o escoamento superficial, a água chega muito mais rápido e em maior quantidade nos rios, e eles transbordam.',
  },
  flashcard: {
    front: 'O que é mata ciliar e por que ela recebe esse nome?',
    back: 'É a vegetação das margens dos rios; o nome vem de cílio, porque protege o rio como o cílio protege o olho.',
    evidence:
      'Mata ciliar é a vegetação que fica nas margens dos rios, e o nome vem de cílio, porque ela protege o rio do mesmo jeito que o cílio protege o olho.',
    difficulty: 'basic',
    focus: 'definitions',
  },
  warning: {
    state: 'no_warning',
    reason:
      'A gravação apresenta conteúdo expositivo de geografia sem indícios que exijam conferência específica.',
    guidance:
      'Confira datas e nomes próprios citados, como a Lei das Águas de 1997, se forem usados em prova.',
    segments: [],
  },
};
