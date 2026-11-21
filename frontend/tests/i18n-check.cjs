// Interface languages in a real browser with a simulated API: every representative page in
// pt-BR, en, es and zh-CN — document language, translated interface, lesson content untouched,
// no horizontal overflow at phone and desktop widths, labels for assistive technology, axe.
// Nothing here calls a real backend, AI provider or Supabase project.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {
  state,
  errors,
  passed,
  record,
  axeCheck,
  noHorizontalScroll,
  openApp,
  shotter,
  allFlags,
  startServer,
  launchBrowser,
} = require('./support/mock-app.cjs');

const output = path.join(__dirname, 'artifacts', 'i18n');
fs.mkdirSync(output, { recursive: true });
const shot = shotter(output);

// Page → [selector, expected text per language]. Lesson title must stay as written.
const EXPECT = {
  'painel.html': [
    '.primary-navigation a[href="./historico.html"] span',
    { 'pt-BR': 'Biblioteca', en: 'Library', es: 'Biblioteca', 'zh-CN': '资料库' },
  ],
  'historico.html': [
    'h1',
    { 'pt-BR': 'Biblioteca', en: 'Library', es: 'Biblioteca', 'zh-CN': '资料库' },
  ],
  'material.html?id=l-foto': ['[data-material-title]', null],
  'revisar.html': ['h1', { 'pt-BR': 'Revisar', en: 'Review', es: 'Repasar', 'zh-CN': '复习' }],
  'planejar.html': ['h1', { 'pt-BR': 'Planejar', en: 'Plan', es: 'Planificar', 'zh-CN': '计划' }],
  'conta.html': [
    'h1',
    { 'pt-BR': 'Meu perfil', en: 'My profile', es: 'Mi perfil', 'zh-CN': '我的个人资料' },
  ],
  'configuracoes.html': [
    'h1',
    { 'pt-BR': 'Configurações', en: 'Settings', es: 'Configuración', 'zh-CN': '设置' },
  ],
  'aparencia.html': [
    'h1',
    { 'pt-BR': 'Aparência', en: 'Appearance', es: 'Apariencia', 'zh-CN': '外观' },
  ],
  'nova-transcricao.html': ['h1', null],
  'ajuda.html': ['h1', null],
};
const PORTUGUESE_UI = /\b(Salvar|Excluir|Concluir|Configurações|Revisar|Planejar|Início)\b/; // "Biblioteca" is also Spanish

async function main() {
  const { server, base } = await startServer();
  const browser = await launchBrowser();
  try {
    for (const language of ['pt-BR', 'en', 'es', 'zh-CN']) {
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
      ]) {
        const { context, page } = await openApp(browser, base, allFlags, state(), viewport);
        await page.addInitScript((value) => {
          localStorage.setItem('audioestudo-ui-preferences', JSON.stringify({ language: value }));
        }, language);
        for (const [url, [selector, expected]] of Object.entries(EXPECT)) {
          await page.goto(`${base}/${url}`);
          await page.waitForLoadState('networkidle');
          await page.waitForFunction(
            () => !document.documentElement.hasAttribute('data-i18n-pending'),
          );
          await page.waitForTimeout(250);
          const label = `${url} ${language} @${viewport.width}`;
          if (process.env.DEBUG_I18N) console.log('page', label);
          assert.equal(
            await page.evaluate(() => document.documentElement.lang),
            language,
            `${label}: lang`,
          );
          if (expected)
            assert.equal(
              (await page.locator(selector).first().textContent()).trim(),
              expected[language],
              label,
            );
          if (url.startsWith('material'))
            assert.equal(
              (await page.locator('[data-material-title]').textContent()).trim(),
              'Fotossíntese e respiração celular',
              `${label}: lesson title is never translated`,
            );
          if (language !== 'pt-BR') {
            const nav = await page
              .locator('.primary-navigation')
              .innerText()
              .catch(() => '');
            assert.doesNotMatch(nav, PORTUGUESE_UI, `${label}: navigation in Portuguese`);
            // Every interactive control keeps an accessible name after translation.
            const unnamed = await page.evaluate(() =>
              [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select')]
                .filter((el) => el.offsetParent !== null)
                .filter(
                  (el) =>
                    !(
                      el.getAttribute('aria-label') ||
                      el.textContent.trim() ||
                      el.labels?.length ||
                      el.title ||
                      el.getAttribute('aria-labelledby')
                    ),
                )
                .map((el) => el.outerHTML.slice(0, 80)),
            );
            assert.deepEqual(unnamed, [], `${label}: controls without a name`);
          }
          await noHorizontalScroll(page, label);
        }
        if (viewport.width === 390) {
          await page.goto(`${base}/painel.html`);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(400);
          await shot(page, `inicio-${language}-390`);
        } else {
          await page.goto(`${base}/material.html?id=l-foto`);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(400);
          await axeCheck(page, 'main', `Aula ${language}`);
          await shot(page, `aula-${language}-1280`);
        }
        await context.close();
      }
    }
    record(
      'Quatro idiomas em 10 páginas (390 e 1280 px): lang do documento, títulos e menu traduzidos, título da aula intacto, todo controle com nome, sem rolagem lateral, axe na aula',
    );
  } finally {
    await browser.close();
    server.close();
  }
  // The mock has no answer for a few optional endpoints; those 404 messages are expected.
  const unexpected = errors.filter((e) => !/Sem simulação|404/.test(e));
  assert.deepEqual(unexpected, [], 'browser errors');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(passed, null, 2));
  console.log(`${passed.length} language checks passed`);
}
main().catch((error) => {
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors.slice(0, 5));
  process.exit(1);
});
