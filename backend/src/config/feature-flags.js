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
]);

/** Deployment flags expose no credentials and never grant resource access. */
export function createFeatureFlags(source = {}) {
  return Object.freeze(
    Object.fromEntries(
      FEATURE_FLAG_NAMES.map((name) => [name, source[`FEATURE_${name.toUpperCase()}`] === 'true']),
    ),
  );
}

export const featureFlags = createFeatureFlags(process.env);

export function isFeatureEnabled(name) {
  return Object.hasOwn(featureFlags, name) && featureFlags[name] === true;
}
