// Mini-player: a small window of its own that keeps the soundscape (and a music embed) playing
// while the main tab moves between pages. Pages see it through a heartbeat in localStorage and
// send play/pause/duck over a BroadcastChannel; the mix itself is shared through localStorage.
import { createSoundscapeController } from '../utils/soundscape-controller.js';
import { buildMixer, watchLessonMedia } from '../utils/soundscape-ui.js';

// The account id travels in the fragment (never sent to the server) from the page that opened us.
const userId = new URLSearchParams(location.hash.slice(1)).get('u') || '';
const rootNode = document.querySelector('[data-soundscape-mini-root]');
if (!/^[\w-]{1,80}$/.test(userId)) {
  document.querySelector('[data-soundscape-mini-error]').hidden = false;
} else {
  const controller = createSoundscapeController({ userId, role: 'mini' });
  const mixer = buildMixer(controller, { headingId: 'soundscape-mini-title', variant: 'mini' });
  rootNode.append(mixer.root);
  controller.startHeartbeat();
  watchLessonMedia(controller);
  // The page that opened this window was playing: try to continue. Browsers may still require a
  // click in this window; the play button is then ready and the status says so.
  if (controller.state().mix.playing) void controller.play();
  document.addEventListener('visibilitychange', () => void controller.wake());
  window.addEventListener('pagehide', () => controller.dispose());
  mixer.title.focus();
}
