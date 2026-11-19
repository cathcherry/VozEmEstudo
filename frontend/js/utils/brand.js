export const mascotReading = '/assets/brand/mascot-reading.png?v=nino-20261118';

// Nino poses for empty states and dead ends. Decorative: the message always carries the meaning.
const pose = (name) => `/assets/brand/avatars/${name}.png?v=nino-20261118`;
export const NINO = Object.freeze({
  reading: pose('reading'),
  curious: pose('curious'),
  rest: pose('rest'),
  listening: pose('listening'),
  laptop: pose('laptop'),
  glasses: pose('glasses'),
  happy: pose('happy'),
  celebrate: pose('celebrate'),
});
