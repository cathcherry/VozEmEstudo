/** Verificação exclusivamente de leitura. Não cria tabelas, não executa jobs, nem grava dados. */
import { env, missingRuntimeSecrets } from '../config/env.js';
import { PERMISSION_DECLARATION } from '../config/permission-declaration.js';
import { getAdminSupabase } from '../integrations/supabase/admin-client.js';
import { featureFlags } from '../config/feature-flags.js';
import { createAiConfig, missingAiCredentials } from '../ai/provider-config.js';
import { createReadinessChecks, readinessFlagErrors, runReadinessChecks } from './readiness.js';

const errors = readinessFlagErrors(featureFlags);
const missing = missingRuntimeSecrets();
if (missing.length) errors.push(`Faltam configurações Supabase: ${missing.join(', ')}`);
let aiConfig;
try {
  aiConfig = createAiConfig();
  for (const name of missingAiCredentials(aiConfig)) errors.push(`${name} ausente.`);
  if (aiConfig.asr.provider === 'huggingface' && !env.hfAsrSpaceId) errors.push('HF_ASR_SPACE_ID ausente.');
} catch (error) {
  errors.push(error.message);
}
if (env.mockExternalServices) errors.push('MOCK_EXTERNAL_SERVICES=true: os resultados seriam simulados.');
if (!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(env.supabaseUrl)) {
  errors.push('SUPABASE_URL inválida. Confira backend/.env.');
}
if (errors.length) {
  errors.forEach((error) => console.error('[ERRO]', error));
  process.exit(1);
}

const checks = createReadinessChecks(getAdminSupabase(), featureFlags, env.audioBucket, PERMISSION_DECLARATION.version, { asrProvider: aiConfig.asr.provider });
console.log('Verificando Supabase e recursos ativos (sem alterar nenhum dado)...');
const results = await runReadinessChecks(checks);
for (const result of results) {
  const tag = result.ok ? 'OK' : result.optional ? 'AVISO' : 'ERRO';
  console.log(`[${tag}] ${result.label}${result.ok ? '' : ': ' + result.reason}`);
  // An optional sub-feature without its migration only answers a scoped 503; it never blocks startup.
  if (!result.ok && !result.optional) errors.push(result.label);
}
console.log(`IA: ASR ${aiConfig.asr.provider}/${aiConfig.asr.model}; texto ${[...new Set(Object.values(aiConfig.llm).map((t) => t.provider))].join(', ')} (conectividade/quotas não testadas).`);
if (errors.length) {
  console.error('Inicialização bloqueada. Consulte docs/first-integrated-test.md e os preflights; não reaplique migrations existentes.');
  process.exit(1);
}
console.log('Probes de banco e Storage aprovados. Login real, funções SQL, RLS e processamento ainda exigem os testes do roteiro.');
