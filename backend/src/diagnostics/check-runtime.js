/** Verificação exclusivamente de leitura. Não cria tabelas, não executa jobs, nem grava dados. */
import { env, missingRuntimeSecrets } from '../config/env.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';

const errors = [];
const missing = missingRuntimeSecrets();
if (missing.length) errors.push(`Faltam configurações Supabase: ${missing.join(', ')}`);
if (!env.groqApiKey) errors.push('GROQ_API_KEY ausente.');
if (!env.hfAsrSpaceId) errors.push('HF_ASR_SPACE_ID ausente.');
if (env.mockExternalServices) errors.push('MOCK_EXTERNAL_SERVICES=true: os resultados seriam simulados.');
if (!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(env.supabaseUrl)) {
  errors.push('SUPABASE_URL inválida. Confira backend/.env.');
}
if (errors.length) {
  errors.forEach((error) => console.error('[ERRO]', error));
  process.exit(1);
}

const db = getAdminSupabase();
async function withTimeout(operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tempo limite de 20 segundos.')), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const checks = [
  ['Banco de materiais', () => db.from('materials').select('id', { head: true, count: 'exact' })],
  ['Tabela de permissões (E02)', () => db.from('material_permissions').select('id', { head: true, count: 'exact' })],
  ['Confirmação de transcrição (E02)', () => db.from('transcription_confirmations').select('id', { head: true, count: 'exact' })],
  ['Alertas de revisão (E02)', () => db.from('content_warnings').select('id', { head: true, count: 'exact' })],
  ['Função de versão da permissão (E02)', () => db.rpc('current_permission_version')],
  ['Bucket privado de áudio', () => db.storage.getBucket(env.audioBucket)],
];
console.log('Verificando Supabase (sem alterar nenhum dado)...');
for (const [label, check] of checks) {
  try {
    const result = await withTimeout(check);
    if (result.error) throw result.error;
    if (label.includes('Função de versão') && result.data !== PERMISSION_DECLARATION.version)
      throw new Error('A declaração de permissão do banco não corresponde à versão da aplicação.');
    if (label.includes('Bucket') && result.data?.public)
      throw new Error('O bucket de áudio deve ser privado.');
    console.log(`[OK] ${label}`);
  } catch (error) {
    errors.push(label);
    console.error(`[ERRO] ${label}: ${String(error.message || error).slice(0, 220)}`);
  }
}
console.log('Hugging Face e Groq: configurações presentes (conectividade/quotas não testadas).');
if (errors.length) {
  console.error('\nA execução foi bloqueada para evitar uma falsa impressão de funcionamento.');
  console.error('Se E02 falhar, confira CONFIGURAR-SUPABASE.txt antes de aplicar a migration.');
  process.exit(1);
}
console.log('Supabase acessível: Auth, banco e Storage configurados para o servidor real.');
