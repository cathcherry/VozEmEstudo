/**
 * Builds the user-facing description of where recordings go, from the server's
 * `processingDisclosure` (derived from the active AI configuration). Provider names are never
 * hardcoded here, so the notice follows configuration changes instead of going stale.
 */
export function describeProcessing(disclosure) {
  const recognition = disclosure?.recognitionProvider;
  const text = disclosure?.textProvider;
  const fallback = disclosure?.fallbackRecognitionProvider;
  const audio = recognition
    ? `O áudio do trecho é enviado a ${recognition} para transcrição${
        fallback ? ` (ou a ${fallback}, se o serviço principal falhar)` : ''
      }.`
    : 'O áudio do trecho é enviado a um serviço externo de reconhecimento de fala.';
  const transcript = text
    ? `O texto transcrito é enviado a ${text} para avisos preliminares e, após sua confirmação, resumo e questões.`
    : 'O texto transcrito é enviado a um serviço externo de IA para avisos preliminares e, após sua confirmação, resumo e questões.';
  const visual = disclosure?.audioOnly === false ? '' : ' Imagens de vídeos não são enviadas.';
  return `${audio} ${transcript}${visual}`;
}

const POLICIES = Object.freeze([
  ['Hugging Face', 'https://huggingface.co/privacy'],
  ['AssemblyAI', 'https://www.assemblyai.com/legal/privacy-policy'],
  ['Groq', 'https://groq.com/privacy-policy/'],
]);

/** Privacy-policy links for the vendors named in the disclosure (all known ones when unknown). */
export function providerPolicies(disclosure) {
  const named = [
    disclosure?.recognitionProvider,
    disclosure?.fallbackRecognitionProvider,
    disclosure?.textProvider,
  ]
    .filter(Boolean)
    .join(', ');
  const matching = POLICIES.filter(([vendor]) => named.includes(vendor));
  return (matching.length ? matching : POLICIES).map(([name, href]) => ({ name, href }));
}
