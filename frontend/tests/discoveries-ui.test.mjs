import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestQuestions, definedTerm, missingForDiscovery } from '../js/utils/investigation-prompts.js';
import {
  COLLECTIBLES,
  applyExperienceMode,
  describeCollectible,
  passageHref,
  readExperienceMode,
  saveExperienceMode,
} from '../js/utils/collectibles.js';

test('prompts come from the lesson itself (title, a defined term, its questions), without duplicates', () => {
  const segments = [{ text: 'Hoje vamos falar de plantas. A fotossíntese é o processo que converte luz.' }];
  assert.equal(definedTerm(segments), 'fotossíntese');
  const prompts = suggestQuestions({ lesson: { title: 'Fotossíntese' }, segments, lessonQuestions: ['Onde ocorre?', 'Onde ocorre?', ''] });
  assert.deepEqual(prompts.map((p) => p.text), [
    'Qual é a ideia central de “Fotossíntese”?',
    'Por que “fotossíntese” importa nesta aula?',
    'Como eu explicaria “Fotossíntese” para quem faltou à aula?',
    'Onde ocorre?',
  ]);
  assert.equal(prompts.at(-1).own, true, 'lesson questions are content, never translated');
  assert.deepEqual(suggestQuestions({}), []);
});

test('only evidence and an own explanation (20+ characters) are required to register', () => {
  const view = (evidence, explanation) => ({ evidence, investigation: { explanation } });
  assert.deepEqual(missingForDiscovery(view([], '')), ['evidence', 'explanation']);
  assert.deepEqual(missingForDiscovery(view([{}], '   curta   ')), ['explanation']);
  assert.deepEqual(missingForDiscovery(view([{}], 'x'.repeat(20))), []);
});

test('collectible wording says what the person did and never claims mastery', () => {
  for (const [id, item] of Object.entries(COLLECTIBLES)) {
    assert.match(id, /^(stamp|object|cover)\.[a-z0-9-]+$/);
    assert.match(item.memory, /^Você /, id);
    assert.doesNotMatch(`${item.name} ${item.memory} ${item.hint}`, /domin|mestre|perde|expira|sequência/i, id);
  }
  assert.equal(describeCollectible('object.unknown').name, 'object.unknown');
});

test('experience modes default to cozy, survive blocked storage and apply to the root', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readExperienceMode(storage), 'cozy');
  const root = { dataset: {} };
  assert.equal(applyExperienceMode('quiet', root), 'quiet');
  assert.equal(root.dataset.experienceMode, 'quiet');
  assert.equal(applyExperienceMode('loud', root), 'cozy');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readExperienceMode(blocked), 'cozy');
  assert.equal(saveExperienceMode('adventure', storage), 'adventure');
  assert.equal(readExperienceMode(storage), 'adventure');
});

test('evidence links open the lesson on the passage', () => {
  assert.equal(passageHref('l 1', 'Energia é\nconservada', 3), './material.html?id=l+1&busca=Energia+%C3%A9&trecho=3#transcricao');
});
