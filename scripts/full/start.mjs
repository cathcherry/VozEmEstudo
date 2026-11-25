/** Inicialização unificada do backend persistente e worker de processamento. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backend = path.join(root, 'backend');
if (!existsSync(path.join(backend, '.env'))) {
  console.error(
    '[ERRO] Crie o arquivo backend/.env a partir de backend/.env.example (ver README.md).',
  );
  process.exit(1);
}
const version = process.versions.node.split('.').map(Number);
if (version[0] < 22 || (version[0] === 22 && version[1] < 19)) {
  console.error('[ERRO] É necessário Node.js 22.19 ou superior (recomendado Node 24).');
  process.exit(1);
}
const diagnostic = spawnSync(process.execPath, ['src/diagnostics/check-runtime.js'], {
  cwd: backend,
  stdio: 'inherit',
  env: { ...process.env },
  windowsHide: true,
});
if (diagnostic.error || diagnostic.status !== 0) {
  console.error('\nInicialização interrompida para evitar um sistema parcialmente funcional.');
  console.error('Confira o diagnóstico acima e docs/CONFIGURACAO.md.');
  process.exit(1);
}

const children = [];
let stopping = false;
function shutdown(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode == null && !child.killed) {
      if (process.platform === 'win32') {
        // Termina o processo filho Node; o modo de execução não abre subshells.
        child.kill();
      } else child.kill(signal);
    }
  }
}
for (const [role, script] of [
  ['API', 'src/server.js'],
  ['WORKER', 'src/worker.js'],
]) {
  const child = spawn(process.execPath, [script], {
    cwd: backend,
    stdio: 'inherit',
    env: { ...process.env },
    windowsHide: true,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`[ERRO] ${role}: ${error.message}`);
    shutdown();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[ERRO] ${role} encerrou (${code ?? signal}). Encerrando os outros processos.`);
      process.exitCode = code || 1;
      shutdown();
    }
  });
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
console.log('\nVoz em Estudo — modo PERSISTENTE (Supabase + Hugging Face + Groq).');
console.log('API e worker iniciados. Acesse http://localhost:3000/painel.html');
console.log('Para encerrar os dois processos, pressione Ctrl+C nesta janela.\n');
