// Static DOM and first-paint regressions; no login or external request is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
let checks = 0;

for (const name of fs
  .readdirSync(path.join(root, 'pages'))
  .filter((file) => file.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, 'pages', name), 'utf8');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.equal(document.documentElement.lang, 'pt-BR', name);
  assert(document.title.trim(), `${name}: meaningful document title`);
  assert.equal(document.querySelectorAll('main').length, 1, `${name}: one main landmark`);
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(ids.length, new Set(ids).size, `${name}: unique IDs`);
  for (const image of document.querySelectorAll('img'))
    assert(image.hasAttribute('alt'), `${name}: image alt`);
  for (const label of document.querySelectorAll('label[for]'))
    assert(document.getElementById(label.htmlFor), `${name}: label targets an existing control`);
  for (const icon of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) {
    const localPath = new URL(icon.getAttribute('href'), 'http://localhost').pathname.replace(
      /^(?:\.\.\/|\/)/,
      '',
    );
    assert(fs.existsSync(path.join(root, localPath)), `${name}: favicon exists`);
  }
  dom.window.close();
  checks += 1;
}

const themeScript = fs.readFileSync(path.join(root, 'js/utils/theme-init.js'), 'utf8');
for (const [preferences, expected] of [
  [{}, false],
  [{ focusMode: true, textSize: 'maximum' }, true],
]) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
    runScripts: 'outside-only',
  });
  dom.window.localStorage.setItem('audioestudo-ui-preferences', JSON.stringify(preferences));
  dom.window.eval(themeScript);
  assert.equal(dom.window.document.documentElement.dataset.focusMode, String(expected));
  assert.equal(dom.window.document.documentElement.dataset.sidebarCollapsed, String(expected));
  if (expected) assert.equal(dom.window.document.documentElement.dataset.textSize, 'maximum');
  dom.window.close();
  checks += 1;
}
console.log(
  JSON.stringify({
    checks,
    passed: checks,
    scope: 'DOM and initial theme; not a screen reader or live auth test',
  }),
);
