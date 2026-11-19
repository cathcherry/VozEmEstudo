import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { RESOURCE_TYPES, groupLibraryResources } from '../js/utils/library-views.js';

const switcherSource = readFileSync(new URL('../js/pages/library-views.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export function', 'function');

for (const unavailable of [false, true]) {
  test(`view switcher returns to lessons and handles resource ${unavailable ? 'failure' : 'availability'}`, async () => {
    const dom = new JSDOM(`<fieldset data-library-view-switch hidden>
      <input type="radio" name="view" value="lessons" checked>
      <input type="radio" name="view" value="resources">
      </fieldset><p data-library-view-status></p>`, { runScripts: 'outside-only' });
    try {
      const { document, Event } = dom.window;
      const initialize = dom.window.Function('getLibraryResources', 'groupLibraryResources', 'setStatus',
        `${switcherSource}\nreturn initLibraryViewSwitcher;`)(
        async () => {
          if (unavailable) throw new Error('Recursos indisponíveis');
          return { [a.id]: { summary: true } };
        }, groupLibraryResources, (element, message) => { element.textContent = message; },
      );
      let changed;
      const view = initialize({ onChange: () => changed?.() });
      const lessons = document.querySelector('[value="lessons"]');
      const resources = document.querySelector('[value="resources"]');
      assert.equal(document.querySelector('fieldset').hidden, false);
      assert.equal(view.isResourceView(), false);
      const rendered = new Promise((resolve) => { changed = resolve; });
      resources.checked = true;
      resources.dispatchEvent(new Event('change', { bubbles: true }));
      await rendered;
      assert.equal(view.isResourceView(), !unavailable);
      assert.equal(resources.disabled, false);
      assert.equal(lessons.disabled, false);
      if (unavailable) {
        assert.equal(lessons.checked, true);
        assert.match(document.querySelector('p').textContent, /Recursos indisponíveis/);
      } else {
        assert.equal(view.groupsFor([a])[0].items[0].href, `./material.html?id=${a.id}#resumo`);
        lessons.checked = true;
        lessons.dispatchEvent(new Event('change', { bubbles: true }));
        assert.equal(view.isResourceView(), false);
      }
    } finally {
      dom.window.close();
    }
  });
}

const a = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Aula A',
  subject: 'História',
};
const b = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Aula B',
  subject: null,
};

test('only verified available resources are rendered; no fabricated links', () => {
  const available = {
    [a.id]: { audio: false, transcription: true, summary: true, questions: false },
    [b.id]: { audio: true, transcription: true, summary: false, questions: true },
  };
  const groups = groupLibraryResources([a, b], available);
  assert.deepEqual(
    groups.map((group) => [group.type, group.items.length]),
    [
      ['audio', 1],
      ['transcription', 2],
      ['summary', 1],
      ['questions', 1],
    ],
  );
  assert.equal(groups[0].items[0].href, `./material.html?id=${b.id}`);
  assert.equal(groups[1].items[0].href, `./material.html?id=${a.id}#transcricao`);
  assert.equal(groups[2].items[0].href, `./material.html?id=${a.id}#resumo`);
  assert.equal(groups[3].items[0].href, `./material.html?id=${b.id}#questoes`);
});

test('duplicate material listings cannot duplicate resource references', () => {
  const groups = groupLibraryResources([a, a, b], {
    [a.id]: { summary: true },
    [b.id]: { summary: false },
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].subject, 'História');
});

test('empty availability does not infer resources from material status', () => {
  assert.deepEqual(groupLibraryResources([{ ...a, status: 'PRONTO' }], {}), []);
  assert.equal(RESOURCE_TYPES.length, 4);
});

test('resource links keep the original material ID rather than a copied artifact ID', () => {
  const groups = groupLibraryResources([{ ...a, title: '<script>' }], {
    [a.id]: { transcription: true },
  });
  assert.equal(groups[0].items[0].materialId, a.id);
  assert.equal(groups[0].items[0].title, '<script>');
  assert.equal(groups[0].items[0].href, `./material.html?id=${a.id}#transcricao`);
});
