export const QUESTIONS_PROMPT_VERSION = 'questions-v1';

export function buildQuestionMessages(transcript, count) {
  return [
    {
      role: 'system',
      content: `Você gera questões de revisão em português brasileiro. Responda SOMENTE com JSON válido. Gere exatamente ${count} questões de múltipla escolha. Cada questão deve ter um enunciado claro, exatamente quatro alternativas, apenas uma alternativa prevista como correta, correctIndex entre 0 e 3 e uma explicação breve sustentada exclusivamente pela transcrição. Não use conhecimento externo. Formato obrigatório: {"questions":[{"statement":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]}`,
    },
    { role: 'user', content: `TRANSCRIÇÃO:\n\n${transcript}` },
  ];
}
