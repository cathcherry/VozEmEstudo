// Labels for the transitions a classroom submission offers (the server sends `actions`).
// The same target state can mean two things: `transcription_confirmed` from `processing` is the
// teacher's confirmation of the transcript, but from `published` it UNPUBLISHES the lesson
// (the graph's "despublicar" edge). Found on staging (3.4 E2E): a published submission showed
// "Conferir e confirmar transcrição", and confirming it silently took the lesson off the class.
export const SUBMISSION_ACTION = Object.freeze({
  approved_for_processing: 'Aprovar para processar',
  processing: 'Já processei a gravação',
  transcription_confirmed: 'Conferir e confirmar transcrição',
  published: 'Publicar na turma',
  rejected: 'Recusar',
  withdrawn: 'Retirar envio',
});

/** True when moving to `to` takes a published submission's lesson off the class. */
export const isUnpublish = (status, to) => status === 'published' && to === 'transcription_confirmed';

/** Visible label of one action button. */
export function submissionActionLabel({ status, isMine }, to, processingLabel = 'Em processamento') {
  if (isUnpublish(status, to)) return 'Despublicar da turma';
  if (to === 'processing' && !isMine) return processingLabel;
  return SUBMISSION_ACTION[to] || to;
}
