// Turns on the Voz em Estudo 3.4 features in backend/.env (the file INICIAR.cmd uses).
// The production database already has every migration they need (applied 21/11/2026, see
// docs/RUNBOOK_PRODUCAO_3_4.md). Idempotent; keeps a copy as backend/.env.antes-3-4; never prints
// or changes secret values (only the keys listed below are written).
// Usage: node scripts/release/enable-3-4-features.mjs [path/to/.env] [--dry-run]
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

export const RELEASE_SETTINGS = Object.freeze({
  FEATURE_CATALOG_UNITS: 'true',
  FEATURE_PLANNING: 'true',
  FEATURE_MP4_RETENTION: 'true',
  FEATURE_STUDY_TRACKING: 'true',
  FEATURE_QUIZ_V2: 'true',
  FEATURE_QUIZ_REVIEW: 'true',
  FEATURE_FLASHCARDS: 'true',
  FEATURE_SHARING: 'true',
  FEATURE_ANNOTATIONS: 'true',
  FEATURE_CALENDAR: 'true',
  FEATURE_STUDY_AUTHORING: 'true',
  FEATURE_FLASHCARD_SETS: 'true',
  FEATURE_FLASHCARDS_V3: 'true',
  FEATURE_GENERATION_REUSE: 'true',
  FEATURE_CLASSROOMS: 'true',
  FEATURE_NOTEBOOKS: 'true',
  FEATURE_MULTI_LESSON: 'true',
  // 3.5 staging only: its migration (20261123090000_discoveries.sql) is not in production.
  FEATURE_DISCOVERIES: 'false',
  // Not implemented: must stay off.
  FEATURE_SOCIAL_BASIC: 'false',
  GROQ_MODEL: 'openai/gpt-oss-120b',
  LLM_REASONING_EFFORT: 'low',
  AI_DAILY_GENERATION_LIMIT: '40',
});

/** Returns the new .env text: existing keys are updated in place, missing ones appended. */
export function applySettings(text, settings = RELEASE_SETTINGS) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const out = lines.map((line) => {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!m || !(m[1] in settings)) return line;
    seen.add(m[1]);
    return `${m[1]}=${settings[m[1]]}`;
  });
  const missing = Object.keys(settings).filter((k) => !seen.has(k));
  if (missing.length) {
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push('', '# Voz em Estudo 3.4 (scripts/release/enable-3-4-features.mjs)', ...missing.map((k) => `${k}=${settings[k]}`), '');
  }
  return { text: out.join('\n'), changed: [...seen].filter((k) => !lines.includes(`${k}=${settings[k]}`)), added: missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'backend/.env';
  const dry = process.argv.includes('--dry-run');
  if (!existsSync(file)) {
    console.error(`[ERRO] ${file} não encontrado. Crie-o a partir de backend/.env.example.`);
    process.exit(1);
  }
  const before = readFileSync(file, 'utf8');
  const { text, changed, added } = applySettings(before);
  if (text === before) {
    console.log('Nada a mudar: os recursos da 3.4 já estão ativos.');
    process.exit(0);
  }
  console.log(`Alterados: ${changed.join(', ') || '—'}`);
  console.log(`Acrescentados: ${added.join(', ') || '—'}`);
  if (dry) process.exit(0);
  copyFileSync(file, `${file}.antes-3-4`);
  writeFileSync(file, text);
  console.log(`Pronto. Cópia anterior: ${file}.antes-3-4. Reinicie o INICIAR.cmd.`);
}
