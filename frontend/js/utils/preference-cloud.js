import { loadCloudState, saveCloudState } from './profile-cloud.js';
export async function initPreferenceCloud(owner) {
  const appearance = window.VozAppearance;
  if (!appearance) return;
  const keys = ['audioestudo-theme','audioestudo-custom-color','audioestudo-custom-background','audioestudo-custom-text','audioestudo-custom-font','audioestudo-ui-preferences',`voz-theme-profiles-v1:${owner}`];
  const snapshot = () => Object.fromEntries(keys.filter(key => localStorage.getItem(key) !== null).map(key => [key,localStorage.getItem(key)]));
  const remote = await loadCloudState(owner,'preferences',snapshot());
  for (const key of keys) if (typeof remote?.[key] === 'string') localStorage.setItem(key,remote[key]);
  window.dispatchEvent(new Event('voz-preferences-change'));
  const original = appearance.storage.set.bind(appearance.storage);
  appearance.storage.set = (key,value) => {
    const result = original(key,value);
    if (keys.includes(key)) void saveCloudState(owner,'preferences',snapshot());
    return result;
  };
}
