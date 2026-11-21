import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Found by axe on staging (3.4 E2E, rule label-content-name-mismatch, WCAG 2.5.3): the brand link
// is labelled "Voz em Estudo" but its visible text was "VozemEstudo" (three spans, no spaces), so
// speech-input users could not say the name they see. The spans sit in a flex row with `gap`, so
// the spaces do not change the layout.
const pages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../pages');

test('every brand name reads "Voz em Estudo" (visible text matches the link label)', () => {
  let checked = 0;
  for (const file of readdirSync(pages).filter((name) => name.endsWith('.html'))) {
    const { document } = new JSDOM(readFileSync(path.join(pages, file), 'utf8')).window;
    for (const brand of document.querySelectorAll('.brand-name')) {
      const text = brand.textContent.replace(/\s+/g, ' ').trim();
      assert.equal(text, 'Voz em Estudo', `${file}: "${text}"`);
      const link = brand.closest('a[aria-label]');
      if (link) assert.ok(link.getAttribute('aria-label').includes(text), `${file}: label and text differ`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `only ${checked} brand names found`);
});
