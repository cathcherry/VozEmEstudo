// Profile cards 3.7: templates offered, link validation for the embeds, the safe text format,
// checklist state and compatibility with the cards of older versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_TEMPLATE_IDS,
  buildCard,
  cardTemplateOf,
  cardValues,
  checklistItems,
  embedFrame,
  formatSelection,
  isLegacyCard,
  parseInline,
  parseRichText,
  parseSpotify,
  parseYouTube,
  plainText,
  toggleChecklistItem,
} from '../js/utils/profile-cards.js';

test('the creation gallery offers useful templates only: no 3D, code or HTML', () => {
  assert.deepEqual(CARD_TEMPLATE_IDS, ['text', 'checklist', 'image', 'gif', 'youtube', 'spotify']);
  for (const retired of ['aurora', 'cyber', 'code', 'widget', 'raw', 'html', 'quote'])
    assert(!CARD_TEMPLATE_IDS.includes(retired), retired);
  const page = readFileSync(new URL('../pages/conta.html', import.meta.url), 'utf8');
  const start = page.indexOf('id="block-dialog"');
  const dialog = page.slice(start, page.indexOf('</dialog>', start));
  assert.doesNotMatch(dialog, /Aurora|Neon|C(ó|&#243;)digo|HTML|CSS|block-kind/);
});

test('YouTube links become youtube-nocookie embeds; anything else is refused', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=PL123`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ])
    assert.equal(parseYouTube(link).src, `https://www.youtube-nocookie.com/embed/${id}`, link);
  assert.equal(
    parseYouTube(`https://youtu.be/${id}?t=1m30s`).src,
    `https://www.youtube-nocookie.com/embed/${id}?start=90`,
  );
  for (const bad of [
    'javascript:alert(1)',
    `javascript://youtube.com/watch?v=${id}`,
    'data:text/html,<script>alert(1)</script>',
    `https://youtube.com.evil.example/watch?v=${id}`,
    `https://evil.example/?u=https://youtu.be/${id}`,
    'https://vimeo.com/123456',
    'https://www.youtube.com/watch?v=short',
    `https://www.youtube.com/watch?v=${id}"onload="x`,
    `https://user:pw@www.youtube.com/watch?v=${id}`,
    `ftp://youtube.com/watch?v=${id}`,
    '',
  ])
    assert.throws(() => parseYouTube(bad), Error, bad);
});

test('Spotify links become open.spotify.com/embed; other hosts and kinds are refused', () => {
  const id = '4cOdK2wGLETKBW3PvgPWqT';
  assert.equal(
    parseSpotify(`https://open.spotify.com/track/${id}?si=abc`).src,
    `https://open.spotify.com/embed/track/${id}`,
  );
  assert.equal(
    parseSpotify(`https://open.spotify.com/intl-pt/playlist/${id}`).src,
    `https://open.spotify.com/embed/playlist/${id}`,
  );
  assert.equal(
    parseSpotify(`spotify:album:${id}`).src,
    `https://open.spotify.com/embed/album/${id}`,
  );
  assert.equal(parseSpotify(`https://open.spotify.com/embed/episode/${id}`).height, 152);
  assert.equal(parseSpotify(`https://open.spotify.com/playlist/${id}`).height, 352);
  for (const bad of [
    'javascript:alert(1)',
    `https://spotify.com/track/${id}`,
    `https://open.spotify.com.evil.example/track/${id}`,
    `https://open.spotify.com/user/${id}`,
    'https://open.spotify.com/track/abc',
    'https://soundcloud.com/a/b',
  ])
    assert.throws(() => parseSpotify(bad), Error, bad);
});

test('stored embed addresses are re-checked at render time', () => {
  assert.equal(
    embedFrame('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ').provider,
    'youtube',
  );
  assert.equal(
    embedFrame('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT').height,
    152,
  );
  for (const bad of [
    'javascript:alert(1)',
    'https://evil.example/embed/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&x=<script>',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'http://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
    undefined,
  ])
    assert.equal(embedFrame(bad), null, String(bad));
});

test('formatted text is a tree of known nodes; links are http(s) only; no HTML passes through', () => {
  const tree = parseRichText(
    '## Título\nTexto **forte** e *leve* com ==marca==.\n\n- um\n- dois\n\n1. a\n> citação\n---\n<img src=x onerror=alert(1)>',
  );
  assert.deepEqual(
    tree.map((b) => b.t),
    ['h', 'p', 'ul', 'ol', 'quote', 'hr', 'p'],
  );
  assert.deepEqual(
    tree[1].lines[0].map((n) => n.t),
    ['text', 'b', 'text', 'i', 'text', 'mark', 'text'],
  );
  assert.deepEqual(tree.at(-1).lines[0], [{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  assert.equal(parseInline('[ok](https://example.org/a)')[0].href, 'https://example.org/a');
  assert.equal(
    parseInline('[mau](javascript:alert(1))').some((n) => n.t === 'a'),
    false,
  );
  assert.equal(plainText('## Oi\n- **a**'), 'Oi\n\n• a');
});

test('toolbar formatting wraps the selection and toggles line prefixes', () => {
  assert.deepEqual(formatSelection('um dois', 3, 7, 'bold'), {
    value: 'um **dois**',
    start: 5,
    end: 9,
  });
  assert.equal(formatSelection('a\nb', 0, 3, 'list').value, '- a\n- b');
  assert.equal(formatSelection('- a\n- b', 0, 7, 'list').value, 'a\nb');
  assert.equal(formatSelection('a\nb', 0, 3, 'numbered').value, '1. a\n2. b');
  assert.equal(formatSelection('x', 0, 0, 'link').value, '[texto do link](https://)x');
});

test('checklist toggling is stored and readable by older versions', () => {
  const card = {
    id: 'c1',
    ...buildCard('checklist', { title: 'Passos', items: 'Ler\n\nRevisar\n Praticar ' }),
  };
  assert.equal(card.type, 'checklist');
  assert.equal(card.templateId, 'checklist', 'older versions render it as a checklist');
  assert.equal(card.templateValues.items, 'Ler\nRevisar\nPraticar');
  const blocks = [card, { id: 'other', title: 'x', type: 'text' }];
  const next = toggleChecklistItem(blocks, 'c1', 1, true);
  assert.deepEqual(
    checklistItems(next[0]).map((i) => i.done),
    [false, true, false],
  );
  assert.deepEqual(blocks[0].checkedItems, {}, 'original untouched');
  // Editing the list: ticks follow their text.
  assert.deepEqual(
    buildCard('checklist', { title: 'Passos', items: 'Revisar\nLer' }, next[0]).checkedItems,
    {
      0: true,
    },
  );
  // The old checklist template (type widget) opens in the checklist editor.
  const old = {
    id: 'o',
    title: 'Velho',
    type: 'widget',
    templateId: 'checklist',
    templateValues: { items: 'a\nb' },
    checkedItems: { 1: true },
  };
  assert.equal(cardTemplateOf(old), 'checklist');
  assert.equal(cardValues(old).items, 'a\nb');
});

test('old 3D, HTML and code cards are recognised as read-only legacy cards', () => {
  for (const block of [
    {
      id: '1',
      title: 'Aurora 3D',
      type: 'widget',
      content: '<div class="stage"></div>',
      css: '.x{}',
    },
    { id: '2', title: 'Código', type: 'code', content: 'console.log(1)' },
    { id: '3', title: 'Link estranho', type: 'embed', url: 'https://evil.example/' },
    { id: '4', title: 'Desconhecido', type: 'hologram' },
  ])
    assert.equal(isLegacyCard(block), true, block.title);
  for (const block of [
    { id: 'a', type: 'text', content: 'oi' },
    { id: 'b', type: 'embed', url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
    { id: 'c', type: 'image', media: 'card-x', card: 'gif' },
    { id: 'd', type: 'data', source: 'recent' },
  ])
    assert.equal(isLegacyCard(block), false, block.type);
});

test('cards are validated before saving', () => {
  assert.throws(() => buildCard('text', { title: '', text: 'x' }), /título/);
  assert.throws(() => buildCard('text', { title: 'T', text: '  ' }), /texto/);
  assert.throws(() => buildCard('image', { title: 'T' }), /imagem/);
  assert.throws(() => buildCard('youtube', { title: 'T', url: 'javascript:alert(1)' }));
  assert.throws(() => buildCard('widget', { title: 'T' }), /tipo/);
  const text = buildCard('text', { title: 'T', text: '**oi**', tone: 'sun' });
  assert.equal(text.format, 'rich');
  assert.equal(text.tone, 'sun');
  assert.equal(buildCard('text', { title: 'T', text: 'x', tone: 'url(javascript:1)' }).tone, '');
  const video = buildCard('youtube', { title: 'V', url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(video.type, 'embed', 'older versions show it as an embed');
  assert.equal(video.url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  const gif = buildCard('gif', { title: 'G', media: 'card-1', alt: 'gato', fit: 'weird' });
  assert.deepEqual([gif.type, gif.card, gif.fit, gif.content], ['image', 'gif', 'cover', 'gato']);
});
