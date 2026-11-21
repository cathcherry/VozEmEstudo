// Personalização 3.0 — the student's own image (or GIF) as the page wallpaper.
// Stored like the profile picture (profile-media, per account, synced when the bucket exists;
// otherwise kept on this device). Shown from the local copy first so a large GIF is not
// downloaded on every page; a readability veil keeps content legible; with reduced motion an
// animated GIF becomes its first frame; low stimulation and screen-reader mode hide it.
import {
  readLocalProfileMedia,
  readProfileMedia,
  saveProfileMedia,
  removeProfileMedia,
} from './profile-storage.js';
import { setUiPreference, getUiPreferences } from './preferences.js';
import { toast } from './toast.js';

export const WALLPAPER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;
const SLOT = 'wallpaper';

/** Returns an error message, or '' when the file can be used. */
export function wallpaperFileProblem(file) {
  if (!file) return 'Escolha uma imagem.';
  if (!WALLPAPER_TYPES.includes(file.type)) return 'Use uma imagem PNG, JPEG, WebP ou GIF.';
  if (file.size > WALLPAPER_MAX_BYTES) return 'A imagem passa de 8 MB. Escolha um arquivo menor.';
  return '';
}

const reduceMotion = () =>
  document.documentElement.dataset.reducedMotion === 'true' ||
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** First frame of an animated image, as a still PNG (for reduced motion). */
async function stillFrame(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await new Promise((resolve) =>
      canvas.toBlob((still) => resolve(still || blob), 'image/png'),
    );
  } catch {
    return blob;
  }
}

let currentUrl = null;
async function show(blob) {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  const root = document.documentElement;
  if (!blob) {
    root.style.removeProperty('--user-wallpaper');
    return;
  }
  const image = blob.type === 'image/gif' && reduceMotion() ? await stillFrame(blob) : blob;
  currentUrl = URL.createObjectURL(image);
  root.style.setProperty('--user-wallpaper', `url("${currentUrl}")`);
}

/** Every page: apply the image when the resolved wallpaper is 'image'. Aparência: the picker. */
export async function initWallpaperImage(userId) {
  if (!userId) return;
  const wanted = () => document.documentElement.dataset.wallpaper === 'image';
  if (wanted()) {
    const local = await readLocalProfileMedia(userId, SLOT);
    if (local) await show(local);
    // Another device may have a newer image: refresh in the background.
    void readProfileMedia(userId, SLOT).then((remote) => {
      if (remote && (!local || remote.size !== local.size)) void show(remote);
    });
  }
  const picker = document.querySelector('[data-wallpaper-image]');
  if (!picker) return;
  const input = picker.querySelector('input[type=file]');
  const remove = picker.querySelector('[data-wallpaper-image-remove]');
  const status = picker.querySelector('[data-wallpaper-image-status]');
  remove.hidden = !(await readLocalProfileMedia(userId, SLOT));
  input.addEventListener('change', async () => {
    const file = input.files[0];
    const problem = wallpaperFileProblem(file);
    if (problem) {
      status.textContent = problem;
      input.value = '';
      return;
    }
    status.textContent = 'Salvando imagem…';
    await saveProfileMedia(userId, SLOT, file);
    setUiPreference('wallpaper', 'image');
    await show(file);
    remove.hidden = false;
    status.textContent = '';
    toast('Imagem de fundo aplicada.', { type: 'success' });
  });
  remove.addEventListener('click', async () => {
    await removeProfileMedia(userId, SLOT);
    if (getUiPreferences().wallpaper === 'image') setUiPreference('wallpaper', 'none');
    await show(null);
    remove.hidden = true;
    input.value = '';
    toast('Imagem de fundo removida.');
  });
  // Choosing another wallpaper while an image exists keeps the file for later.
  window.addEventListener('voz-wallpaper-change', async () => {
    if (wanted()) await show(await readLocalProfileMedia(userId, SLOT));
  });
}
