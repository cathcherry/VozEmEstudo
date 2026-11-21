import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyDashboardLayout,
  defaultDashboardLayout,
  isDefaultDashboardLayout,
  moveUnit,
  normalizeDashboardLayout,
  toggleWidget,
} from '../js/utils/dashboard-layout.js';

test('a missing, old or tampered layout becomes a valid one', () => {
  assert.deepEqual(normalizeDashboardLayout(null), defaultDashboardLayout());
  assert.deepEqual(normalizeDashboardLayout('x'), defaultDashboardLayout());
  const layout = normalizeDashboardLayout({
    hidden: ['cards', 'cards', 'navigation', '<img>', 42],
    order: { main: ['recent', 'continue', 'recent'], rail: ['notes', 'unknown'] },
  });
  assert.deepEqual(layout.hidden, ['cards'], 'only optional cards can be hidden');
  // Blocks missing from a saved order (e.g. added in a later version) return next to their
  // default neighbour; the saved blocks keep their relative order.
  assert.deepEqual(layout.order.main, ['plan', 'recent']);
  assert.deepEqual(layout.order.rail, ['week', 'agenda', 'subjects', 'notes']);
  assert.deepEqual(
    normalizeDashboardLayout({ order: { rail: ['subjects', 'week', 'notes'] } }).order.rail,
    ['subjects', 'week', 'agenda', 'notes'],
  );
});

test('toggle and move keep the layout valid and report the default', () => {
  let layout = defaultDashboardLayout();
  assert.equal(isDefaultDashboardLayout(layout), true);
  layout = toggleWidget(layout, 'week', false);
  layout = toggleWidget(layout, 'week', false);
  assert.deepEqual(layout.hidden, ['week']);
  assert.equal(isDefaultDashboardLayout(layout), false);
  layout = toggleWidget(layout, 'week', true);
  assert.equal(isDefaultDashboardLayout(layout), true);
  layout = moveUnit(layout, 'subjects', -1);
  assert.deepEqual(layout.order.rail, ['week', 'subjects', 'agenda', 'notes']);
  assert.deepEqual(moveUnit(layout, 'week', -1).order.rail, layout.order.rail, 'top stays top');
  assert.deepEqual(moveUnit(layout, 'plan', 1).order.main, ['recent', 'plan']);
});

test('applying a layout moves DOM nodes (reading order follows the screen) and marks hidden cards', () => {
  const { window } = new JSDOM(`<div class="dash-main"><section id="continue"></section>
    <div data-widget-unit="plan"><section data-widget="tasks"></section><section data-widget="cards"></section></div>
    <section data-widget="recent" data-widget-unit="recent"></section></div>
    <aside class="dash-rail"><section data-widget="week" data-widget-unit="week"></section>
    <section data-widget="agenda" data-widget-unit="agenda"></section>
    <section data-widget="subjects" data-widget-unit="subjects"></section>
    <section data-widget="notes" data-widget-unit="notes"></section></aside>`);
  const doc = window.document;
  const order = (selector) =>
    [...doc.querySelector(selector).children].map((n) => n.id || n.dataset.widgetUnit);
  applyDashboardLayout(
    { hidden: ['cards'], order: { main: ['recent', 'plan'], rail: ['notes', 'week'] } },
    doc,
  );
  assert.deepEqual(order('.dash-main'), ['continue', 'recent', 'plan'], 'continue stays first');
  assert.deepEqual(order('.dash-rail'), ['notes', 'week', 'agenda', 'subjects']);
  assert.equal(doc.querySelector('[data-widget="cards"]').hasAttribute('data-user-hidden'), true);
  assert.equal(doc.querySelector('.dash-rail').classList.contains('has-custom-order'), true);
  applyDashboardLayout(defaultDashboardLayout(), doc);
  assert.deepEqual(order('.dash-main'), ['continue', 'plan', 'recent']);
  assert.deepEqual(order('.dash-rail'), ['week', 'agenda', 'subjects', 'notes']);
  assert.equal(doc.querySelector('[data-user-hidden]'), null);
  assert.equal(doc.querySelector('.has-custom-order'), null);
});
