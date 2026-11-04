import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_TYPES, groupLibraryResources } from '../js/utils/library-views.js';

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
