import { getPublicConfig } from '../api/config.js';

export const FEATURE_FLAG_NAMES = Object.freeze([
  'catalog_units',
  'planning',
  'mp4_retention',
  'study_tracking',
  'quiz_v2',
  'quiz_review',
  'flashcards',
  'social_basic',
  'sharing',
  'annotations',
  'calendar',
  'study_authoring',
  'flashcard_sets',
  'flashcards_v3',
  'generation_reuse',
  'classrooms',
  'notebooks',
  'multi_lesson',
]);

export function normalizeFeatureFlags(source = {}) {
  return Object.freeze(
    Object.fromEntries(FEATURE_FLAG_NAMES.map((name) => [name, source?.[name] === true])),
  );
}

export async function getFeatureFlags() {
  const config = await getPublicConfig();
  return normalizeFeatureFlags(config.featureFlags);
}

export async function isFeatureEnabled(name) {
  if (!FEATURE_FLAG_NAMES.includes(name)) return false;
  return (await getFeatureFlags())[name];
}

