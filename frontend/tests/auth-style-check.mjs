/** Smoke tests de CSS/HTML das páginas de autenticação (sem dependências). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'css/auth-pages.css'), 'utf8');
for (const [name, type] of Object.entries({'login.html':'login','cadastro.html':'register','recuperar-senha.html':'recovery'})) {
  const html=readFileSync(resolve(root,'pages',name),'utf8');
  assert.match(html, /class="auth-page"/);
  assert.ok(html.includes(`data-page="${type}"`), name);
  assert.equal((html.match(/\/css\/auth-pages\.css/g)||[]).length,1,name);
  for (const old of ['auth-toast.css','auth-layout.css','password-controls.css']) assert.ok(!html.includes(old),`${name}: CSS antigo ${old}`);
  const idx=html.lastIndexOf('rel="stylesheet"');
  assert.ok(html.slice(idx).includes('/css/auth-pages.css'), `${name}: CSS central deve carregar por último`);
}
for (const selector of ['.auth-toast[data-type="success"]','.auth-toast[data-type="error"]','.password-toggle','.register-brand-mascot','.recovery-layout','.auth-brand-panel h1']) {
 assert.ok(css.includes(selector), `Ausente CSS ${selector}`);
}
console.log('Auth UI smoke: OK (3 páginas, CSS único, componentes presentes).');
