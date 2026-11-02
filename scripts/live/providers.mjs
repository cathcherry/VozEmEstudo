// Uses the product's actual ASR, LLM prompts and Groq adapters.
// Only import after the launcher has loaded backend/.env[.ia-local].
export async function createLiveProviders() {
  const [{ transcribeAudio }, { createTextCompletion, createJsonCompletion }, { buildSummaryMessages }, { buildQuestionMessages }, { validateQuestionsPayload }] = await Promise.all([
    import('../../backend/src/integrations/asr/huggingface-whisper.client.js'),
    import('../../backend/src/integrations/llm/groq.client.js'),
    import('../../backend/src/prompts/summary.v1.js'),
    import('../../backend/src/prompts/questions.v1.js'),
    import('../../backend/src/validators/llm-output.validator.js'),
  ]);
  return {
    transcribe: transcribeAudio,
    summarize: (text) => createTextCompletion({ messages: buildSummaryMessages(text), maxTokens: 1800 }),
    questions: async (text, count) => {
      const output = await createJsonCompletion({ messages: buildQuestionMessages(text, count), maxTokens: 5000 });
      return validateQuestionsPayload(output, count);
    },
  };
}
