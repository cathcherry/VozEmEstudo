import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  INVITE_ALPHABET,
  generateInviteCode,
  inviteCodeFrom,
  inviteLink,
} from '../js/api/classroom.api.js';
import {
  INVITE_ALPHABET as SERVER_ALPHABET,
  hashInviteCode,
  normalizeInviteCode,
} from '../../backend/src/services/classroom.service.js';

test('invite codes: unambiguous alphabet shared with the server, 12 characters, grouped', () => {
  assert.equal(INVITE_ALPHABET, SERVER_ALPHABET);
  assert.doesNotMatch(INVITE_ALPHABET, /[01OIL]/);
  for (let i = 0; i < 200; i++)
    assert.match(generateInviteCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  // Bytes at or above 248 are discarded, so every character stays equally likely.
  const bytes = [255, 250, 248, ...Array.from({ length: 13 }, (_, i) => i)];
  assert.equal(
    generateInviteCode(() => Uint8Array.from(bytes)),
    'ABCD-EFGH-JKMN',
  );
});

test('a pasted link or a typed code give the same hash on the server', () => {
  const code = 'ABCD-EFGH-JKMN';
  const link = inviteLink(code, 'https://app.example');
  assert.equal(link, 'https://app.example/turmas.html#convite=ABCD-EFGH-JKMN');
  assert.equal(inviteCodeFrom(link), 'ABCDEFGHJKMN');
  assert.equal(inviteCodeFrom(' abcd efgh-jkmn '), 'ABCDEFGHJKMN');
  assert.equal(normalizeInviteCode('abcd-efgh jkmn'), 'ABCDEFGHJKMN');
  const expected = createHash('sha256').update('ABCDEFGHJKMN').digest('hex');
  assert.equal(hashInviteCode(inviteCodeFrom(link)), expected);
  assert.equal(hashInviteCode('abcd-efgh-jkmn'), expected);
});

test('submission actions: from "published" the transcription_confirmed edge is labelled as unpublishing', async () => {
  const { submissionActionLabel, isUnpublish } = await import('../js/utils/submission-actions.js');
  // Found on staging (3.4 E2E): a published submission offered "Conferir e confirmar transcrição".
  assert.equal(submissionActionLabel({ status: 'published', isMine: false }, 'transcription_confirmed'), 'Despublicar da turma');
  assert.equal(isUnpublish('published', 'transcription_confirmed'), true);
  assert.equal(submissionActionLabel({ status: 'processing', isMine: false }, 'transcription_confirmed'), 'Conferir e confirmar transcrição');
  assert.equal(isUnpublish('processing', 'transcription_confirmed'), false);
  assert.equal(submissionActionLabel({ status: 'approved_for_processing', isMine: true }, 'processing'), 'Já processei a gravação');
  assert.equal(submissionActionLabel({ status: 'approved_for_processing', isMine: false }, 'processing', 'Em processamento'), 'Em processamento');
  assert.equal(submissionActionLabel({ status: 'published', isMine: true }, 'withdrawn'), 'Retirar envio');
});
