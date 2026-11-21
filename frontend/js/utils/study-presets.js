// Study presets: named combinations of the existing interface preferences (no new settings).
// A preset only changes what it is about and never weakens an accessibility choice: it does not
// lower the text size, and it never turns off reduced motion, high contrast, the screen-reader
// mode or read-aloud. Every value can be adjusted afterwards, one by one.

export const TEXT_SIZE_ORDER = ['small', 'default', 'medium', 'large', 'extra-large', 'maximum'];

export const STUDY_PRESETS = Object.freeze({
  reading: {
    label: 'Leitura confortável',
    description: 'Texto um pouco maior, linhas mais curtas e mais espaço entre elas.',
    values: {
      focusMode: false,
      lowStimulation: false,
      textSize: 'medium',
      readingSpacing: 'wide',
      readingWidth: 'narrow',
      readingRuler: 'off',
      density: 'comfortable',
    },
  },
  focus: {
    label: 'Foco profundo',
    description: 'Menu recolhido, menos estímulos visuais, sem animações e guia de leitura.',
    values: {
      focusMode: true,
      lowStimulation: true,
      reducedMotion: true,
      readingRuler: 'focus',
      readingWidth: 'comfortable',
      density: 'comfortable',
    },
  },
  review: {
    label: 'Revisão rápida',
    description: 'Cartões compactos e linhas largas para ver mais conteúdo de uma vez.',
    values: {
      focusMode: false,
      lowStimulation: false,
      readingSpacing: 'compact',
      readingWidth: 'wide',
      readingRuler: 'off',
      density: 'compact',
    },
  },
});

const size = (value) => Math.max(0, TEXT_SIZE_ORDER.indexOf(value));

/** The preferences after applying a preset to `current` (unknown preset: unchanged). */
export function applyStudyPreset(current, id) {
  const preset = STUDY_PRESETS[id];
  if (!preset) return { ...current };
  const next = { ...current, ...preset.values };
  // Accessibility choices are only ever reinforced.
  if (size(current.textSize) > size(next.textSize)) next.textSize = current.textSize;
  for (const key of ['reducedMotion', 'highContrast', 'screenReaderMode'])
    if (current[key] === true) next[key] = true;
  next.readAloud = current.readAloud;
  next.speechRate = current.speechRate;
  return next;
}

/** The preset whose values are all in effect, if any (to mark it as selected). */
export function activeStudyPreset(current) {
  for (const [id, preset] of Object.entries(STUDY_PRESETS)) {
    const applied = applyStudyPreset(current, id);
    if (Object.keys(preset.values).every((key) => current[key] === applied[key])) return id;
  }
  return null;
}
