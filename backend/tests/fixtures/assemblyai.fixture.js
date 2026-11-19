/**
 * Synthetic AssemblyAI transcript of a ~4-minute Brazilian Portuguese lecture returned as ONE
 * utterance with hundreds of word objects (start/end in ms, confidence, speaker), mirroring the
 * shape of GET /v2/transcript/{id}. Deterministic: no network, no randomness.
 */
const SENTENCES = [
  'Bom dia, turma, hoje nós vamos falar sobre a conservação de energia em sistemas mecânicos.',
  'A ideia, a ideia principal, é que a energia total de um sistema isolado permanece constante.',
  'Quando uma bola cai, a energia potencial gravitacional se transforma em energia cinética.',
  'Em 1847, Hermann von Helmholtz formulou de maneira geral esse princípio, que não admite exceções conhecidas.',
  'Vamos pensar num pêndulo simples, sem atrito, oscilando de um lado para o outro.',
  'No ponto mais alto a velocidade é zero, e no ponto mais baixo a velocidade é máxima.',
  'Agora, se houver atrito com o ar, parte da energia vira calor, mas ela não desaparece.',
  'Essa distinção é importante para a prova: energia mecânica pode diminuir, energia total não.',
  'Anotem a fórmula: energia cinética igual a um meio de m vezes v ao quadrado.',
  'E a energia potencial gravitacional é m vezes g vezes h, onde h é a altura em relação ao referencial.',
];

export function assemblyAiFourMinuteTranscript({ id = 'transcript-pt-4min', speaker = 'A' } = {}) {
  const words = [];
  let cursor = 320;
  let index = 0;
  // Repeat the lecture until it covers four minutes of speech.
  while (cursor < 240000) {
    const sentence = SENTENCES[index % SENTENCES.length];
    index += 1;
    for (const text of sentence.split(' ')) {
      const duration = 180 + ((text.length * 37) % 260);
      words.push({
        text,
        start: cursor,
        end: cursor + duration,
        confidence: Number((0.82 + ((text.length * 13) % 17) / 100).toFixed(2)),
        speaker,
      });
      cursor += duration + (/[,:]$/.test(text) ? 260 : 90);
    }
    cursor += 520; // breath between sentences
  }
  const text = words.map((word) => word.text).join(' ');
  return {
    id,
    status: 'completed',
    language_code: 'pt',
    speech_model_used: 'assemblyai-stt-3-7',
    audio_duration: Math.ceil(cursor / 1000),
    text,
    words,
    utterances: [
      { start: words[0].start, end: words.at(-1).end, text, speaker, confidence: 0.9, words },
    ],
  };
}
