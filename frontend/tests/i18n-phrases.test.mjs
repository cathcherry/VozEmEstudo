import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPhraseTranslator, translateTree, observeTranslations } from '../js/i18n/phrases.js';
import en from '../js/i18n/phrases/en.js';
import es from '../js/i18n/phrases/es.js';
import zh from '../js/i18n/phrases/zh-CN.js';

const catalog = {
  phrases: {
    Salvar: 'Save',
    'Nova transcrição': 'New transcription',
    Concluída: 'Completed',
    'Buscar aulas': 'Search lessons',
  },
  patterns: [
    ['Revisar {0} cartões', 'Review {0} cards'],
    ['Situação da tarefa: {0}', 'Task status: {0}'],
  ],
};

test('exact phrases and patterns, keeping surrounding whitespace', () => {
  const tr = createPhraseTranslator(catalog);
  assert.equal(tr.text('  Salvar\n '), '  Save\n ');
  assert.equal(tr.phrase('Revisar 12 cartões'), 'Review 12 cards');
  assert.equal(
    tr.phrase('Situação da tarefa: Concluída'),
    'Task status: Completed',
    'values that are phrases are translated',
  );
  assert.equal(tr.phrase('Salvar agora'), null, 'only whole phrases');
  assert.equal(tr.phrase('Revisar  12   cartões'), 'Review 12 cards', 'whitespace normalized');
});

test('pages: interface text, labels and later additions change; user content does not', async () => {
  const dom = new JSDOM(`<main><button aria-label="Salvar">Salvar</button>
    <input placeholder="Buscar aulas"><h1 data-material-title>Salvar</h1>
    <div class="flashcard-content">Concluída</div><p translate="no">Salvar</p>
    <textarea>Salvar</textarea></main>`);
  const { document, MutationObserver } = dom.window;
  globalThis.MutationObserver = MutationObserver;
  const tr = createPhraseTranslator(catalog);
  translateTree(document, tr);
  assert.equal(document.querySelector('button').textContent, 'Save');
  assert.equal(document.querySelector('button').getAttribute('aria-label'), 'Save');
  assert.equal(document.querySelector('input').placeholder, 'Search lessons');
  assert.equal(document.querySelector('h1').textContent, 'Salvar', 'lesson title untouched');
  assert.equal(document.querySelector('.flashcard-content').textContent, 'Concluída');
  assert.equal(document.querySelector('[translate=no]').textContent, 'Salvar');
  assert.equal(document.querySelector('textarea').value, 'Salvar');
  observeTranslations(document.documentElement, tr);
  const added = document.createElement('span');
  added.textContent = 'Nova transcrição';
  document.querySelector('main').append(added);
  document.querySelector('button').setAttribute('title', 'Salvar');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(added.textContent, 'New transcription');
  assert.equal(document.querySelector('button').title, 'Save');
  dom.window.close();
});

test('catalogs: same sources in every language, consistent placeholders', () => {
  const sources = (c) => Object.keys(c.phrases).sort();
  assert(Object.keys(en.phrases).length > 900, `${Object.keys(en.phrases).length} phrases`);
  for (const [name, c] of [
    ['es', es],
    ['zh-CN', zh],
  ]) {
    const missing = sources(en).filter((s) => !(s in c.phrases));
    assert(missing.length < 20, `${name} misses ${missing.length}: ${missing.slice(0, 5)}`);
    for (const [source, target] of c.patterns)
      assert.equal(
        (target.match(/\{\d+\}/g) || []).sort().join(),
        (source.match(/\{\d+\}/g) || []).sort().join(),
        `${name}: ${source}`,
      );
  }
  for (const c of [en, es, zh])
    for (const [s, v] of Object.entries(c.phrases)) assert(v && v !== '', s);
});

test('short patterns only take numbers, so they never rewrite a title', () => {
  const tr = createPhraseTranslator({
    phrases: {},
    patterns: [
      ['{0} aula', '{0} lesson'],
      ['Adicionar tarefa em {0}', 'Add task to {0}'],
    ],
  });
  assert.equal(tr.phrase('1 aula'), '1 lesson');
  assert.equal(tr.phrase('Primeira aula'), null);
  assert.equal(tr.phrase('Adicionar tarefa em Biologia'), 'Add task to Biologia');
});

test('short patterns accept known interface words as values', () => {
  const tr = createPhraseTranslator({
    phrases: { média: 'medium' },
    patterns: [['Legenda: {0}', 'Captions: {0}']],
  });
  assert.equal(tr.phrase('Legenda: média'), 'Captions: medium');
  assert.equal(tr.phrase('Legenda: Minha aula'), null);
});

test('long text and scripts are skipped quickly', () => {
  const tr = createPhraseTranslator({
    phrases: {},
    patterns: [['Adicionar tarefa em {0} para {1}', 'x {0} {1}']],
  });
  const started = Date.now();
  assert.equal(tr.phrase('a '.repeat(200000)), null);
  assert(Date.now() - started < 50, 'long text is not matched against patterns');
});
