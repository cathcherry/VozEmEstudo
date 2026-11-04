import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const localEnv = resolve(root, 'backend/.env.ia-local');
const sharedEnv = resolve(root, 'backend/.env');
const selectedEnv = existsSync(localEnv) ? localEnv : sharedEnv;

if (!existsSync(selectedEnv)) {
  console.error('Credenciais não encontradas. Copie backend/ia-local.env.example para backend/.env.ia-local e preencha HF e Groq.');
  process.exit(1);
}
process.loadEnvFile(selectedEnv);
// The original project's Llama 3.3 default was deprecated for Free/Developer users.
// Override only this legacy default in the isolated demo; leave other explicit choices intact.
if (!process.env.GROQ_MODEL || process.env.GROQ_MODEL === 'llama-3.3-70b-versatile') {
  console.log('Modelo Groq legado substituído nesta execução por openai/gpt-oss-120b.');
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
}
for (const variable of ['GROQ_API_KEY', 'HF_ASR_SPACE_ID']) {
  if (!process.env[variable]?.trim()) {
    console.error(`${variable} está vazio em ${selectedEnv}.`);
    process.exit(1);
  }
}
if (process.env.MOCK_EXTERNAL_SERVICES === 'true') {
  console.error('MOCK_EXTERNAL_SERVICES=true ativaria resultados fictícios. Remova ou altere para false.');
  process.exit(1);
}
try {
  const [{ createLiveProviders }, { createPresentationServer }] = await Promise.all([
    import('./providers.mjs'),
    import('../presentation/server.mjs'),
  ]);
  const providers = await createLiveProviders();
  const server = createPresentationServer({ liveAI: true, providers });
  const port = Number(process.env.PRESENTATION_PORT || 3000);
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `A porta ${port} está ocupada. Feche o servidor anterior com Ctrl+C ou altere PRESENTATION_PORT.`
      : `Não foi possível iniciar: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\nVoz em Estudo — TRANSCRIÇÃO E RESUMO COM IA REAL\nAbra http://127.0.0.1:${port}`);
    console.log('HF: ' + process.env.HF_ASR_SPACE_ID + ' · Groq: ' + (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'));
    console.log('Sem Supabase. Áudios enviados à Hugging Face; transcrições à Groq.\nDados locais reiniciam ao fechar. Ctrl+C para encerrar.\n');
  });
} catch (error) {
  console.error('Falha ao carregar as dependências da IA. Execute PREPARAR-IA-REAL.cmd primeiro.');
  console.error(error.message);
  process.exitCode = 1;
}
