import { createHash } from 'node:crypto';

export const PERMISSION_TEXT =
  'Declaro que possuo permissão para utilizar esta gravação no Voz em Estudo e enviá-la para transcrição e geração dos materiais de revisão';
export function declarationVersion(text) {
  return 'permission-v1:' + createHash('sha256').update(text).digest('hex').slice(0, 16);
}
export const PERMISSION_DECLARATION = Object.freeze({
  version: declarationVersion(PERMISSION_TEXT),
  text: PERMISSION_TEXT,
});
