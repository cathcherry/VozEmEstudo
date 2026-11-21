import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LOCALES, t, missingKeys } from '../js/i18n/i18n.js';
import ptBR from '../js/i18n/locales/pt-BR.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('every language has every Portuguese key (with plural forms)', () => {
  for (const locale of Object.keys(LOCALES)) assert.deepEqual(missingKeys(locale), [], locale);
});

test('no language has keys the Portuguese source does not know', () => {
  for (const [locale, { messages }] of Object.entries(LOCALES))
    assert.deepEqual(
      Object.keys(messages).filter((key) => !(key in ptBR)),
      [],
      locale,
    );
});

test('placeholders are the same in every language', () => {
  const names = (value) =>
    [
      ...new Set(
        (typeof value === 'string' ? value : Object.values(value).join(' ')).match(/\{\w+\}/g) ||
          [],
      ),
    ].sort();
  for (const [locale, { messages }] of Object.entries(LOCALES))
    for (const key of Object.keys(ptBR))
      assert.deepEqual(names(messages[key]), names(ptBR[key]), `${locale} ${key}`);
});

test('every key used by pages and scripts exists', () => {
  const used = new Set();
  for (const file of readdirSync(new URL('pages/', root)))
    if (file.endsWith('.html')) {
      const html = read(`pages/${file}`);
      for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(key);
      for (const [, pairs] of html.matchAll(/data-i18n-attr="([^"]+)"/g))
        for (const pair of pairs.split(';')) used.add(pair.split(':')[1].trim());
    }
  const scripts = [
    'js/pages/dashboard.page.js',
    'js/pages/dashboard-home.js',
    'js/pages/dashboard-customize.js',
    'js/utils/shell.js',
    'js/utils/preferences.js',
    'js/pages/global-search.js',
  ];
  for (const file of scripts)
    for (const [, key] of read(file).matchAll(/\b(?:t|translate)\(\s*'([a-zA-Z]+\.[\w.]+)'/g))
      used.add(key);
  const unknown = [...used].filter((key) => !(key in ptBR));
  assert.deepEqual(unknown, []);
  assert(used.size > 60, `${used.size} keys in use`);
});

test('fallback, interpolation and plurals', () => {
  assert.equal(t('nav.home', {}, 'en'), 'Home');
  assert.equal(t('nav.home', {}, 'fr'), 'Início', 'unknown language falls back to Portuguese');
  assert.equal(t('no.such.key', {}, 'en'), 'no.such.key');
  assert.equal(t('home.reviewCards', { count: 1 }, 'pt-BR'), 'Revisar 1 cartão');
  assert.equal(t('home.reviewCards', { count: 5 }, 'pt-BR'), 'Revisar 5 cartões');
  assert.equal(
    t('dashboard.inLibrary', { count: 0 }, 'pt-BR'),
    'aulas no acervo',
    'zero is plural',
  );
  assert.equal(t('home.reviewCards', { count: 1 }, 'en'), 'Review 1 card');
  assert.equal(t('home.reviewCards', { count: 3 }, 'zh-CN'), '复习 3 张卡片');
  assert.equal(t('account.openMenu', { name: 'Ana' }, 'es'), 'Abrir el menú de la cuenta de Ana');
  assert.equal(
    t('account.openMenu', {}, 'en'),
    'Open the account menu for {name}',
    'missing params stay visible',
  );
});
