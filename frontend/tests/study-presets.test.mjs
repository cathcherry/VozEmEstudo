import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStudyPreset, activeStudyPreset, STUDY_PRESETS } from '../js/utils/study-presets.js';

const base = {
  focusMode: false,
  lowStimulation: false,
  reducedMotion: false,
  highContrast: false,
  textSize: 'default',
  readingSpacing: 'comfortable',
  readingWidth: 'comfortable',
  readingFont: 'default',
  readingRuler: 'off',
  navigation: 'sidebar',
  readAloud: 'icons',
  speechRate: 'normal',
  screenReaderMode: false,
  density: 'comfortable',
};

test('each preset changes only its own preferences and is then recognized', () => {
  for (const id of Object.keys(STUDY_PRESETS)) {
    const next = applyStudyPreset(base, id);
    assert.equal(activeStudyPreset(next), id);
    assert.equal(next.readingFont, base.readingFont, 'font untouched');
    assert.equal(next.navigation, base.navigation, 'navigation untouched');
  }
  assert.equal(activeStudyPreset(base), null);
  assert.deepEqual(applyStudyPreset(base, 'unknown'), base);
});

test('presets never weaken accessibility choices', () => {
  const needs = {
    ...base,
    textSize: 'extra-large',
    reducedMotion: true,
    highContrast: true,
    screenReaderMode: true,
    readAloud: 'everywhere',
    speechRate: 'slow',
  };
  for (const id of Object.keys(STUDY_PRESETS)) {
    const next = applyStudyPreset(needs, id);
    assert.equal(next.textSize, 'extra-large', `${id}: text size kept`);
    assert.equal(next.reducedMotion, true);
    assert.equal(next.highContrast, true);
    assert.equal(next.screenReaderMode, true);
    assert.equal(next.readAloud, 'everywhere');
    assert.equal(next.speechRate, 'slow');
  }
  // Larger text than the preset's is fine; a smaller one is raised.
  assert.equal(applyStudyPreset({ ...base, textSize: 'small' }, 'reading').textSize, 'medium');
});

test('a preset adjusted afterwards is no longer shown as active', () => {
  const tuned = { ...applyStudyPreset(base, 'review'), density: 'comfortable' };
  assert.equal(activeStudyPreset(tuned), null);
});
