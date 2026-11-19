import { isFeatureEnabled } from '../config/feature-flags.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { createAudioSignedUrl } from '../services/audio.service.js';
import { videoService } from '../services/video.service.js';
import { captionService } from '../services/caption.service.js';

export async function playback(req, res, next) {
  try {
    const material = await getOwnedMaterial(req.user.id, req.params.materialId);
    const audio = Array.isArray(material.audio_files) ? material.audio_files[0] : material.audio_files;
    const signedAudioUrl = audio?.retain_original && audio?.storage_path
      ? await createAudioSignedUrl(audio.storage_path) : null;
    const video = isFeatureEnabled('mp4_retention')
      ? await videoService.playback(req.user.id, req.params.materialId)
      : { video: null, signedVideoUrl: null };
    res.set('Cache-Control', 'no-store');
    res.json({ signedAudioUrl, ...video, expiresInSeconds: 600 });
  } catch (error) { next(error); }
}
export async function attachVideo(req, res, next) {
  try { res.status(201).json(await videoService.attach(req.user.id, req.params.materialId, req.body)); }
  catch (error) { next(error); }
}
export async function removeVideo(req, res, next) {
  try { await videoService.remove(req.user.id, req.params.materialId); res.status(204).end(); }
  catch (error) { next(error); }
}
export async function captions(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await captionService.captions(req.user.id, req.params.materialId));
  } catch (error) { next(error); }
}
