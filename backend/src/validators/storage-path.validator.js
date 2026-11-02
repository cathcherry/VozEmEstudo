import { errors } from '../domain/errors.js';

// eslint-disable-next-line no-control-regex -- Reject C0 controls in raw Storage keys.
const unsafeCharacters = /[\\?#%\u0000-\u001f\u007f]/;

export function assertSafeStoragePath(storagePath) {
  // Storage keys must stay unchanged when the SDK constructs a request URL.
  // The browser uploads raw keys; percent escapes can conceal dot segments.
  if (
    typeof storagePath !== 'string' ||
    !storagePath ||
    unsafeCharacters.test(storagePath) ||
    storagePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw errors.forbidden();
  }
  return storagePath;
}
