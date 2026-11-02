// Synthetic identities only. These UUIDs do not designate accounts in any remote project.
export const identities = {
  a: { id: '11111111-1111-4111-8111-111111111111', token: 'e00-fixture-user-a' },
  b: { id: '22222222-2222-4222-8222-222222222222', token: 'e00-fixture-user-b' },
};

export const resourceIds = {
  materialA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  materialB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  newMaterial: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  missing: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  jobA: '33333333-3333-4333-8333-333333333333',
  jobB: '44444444-4444-4444-8444-444444444444',
  batchA: '55555555-5555-4555-8555-555555555555',
  batchB: '66666666-6666-4666-8666-666666666666',
  questionA: '77777777-7777-4777-8777-777777777777',
  questionB: '88888888-8888-4888-8888-888888888888',
};

export function createOwnershipFixture() {
  const material = (id, owner, title) => ({ id, user_id: owner, title, subject: 'Disciplina de teste', status: 'PRONTO', initial_question_count: 5 });
  const audio = (id, owner) => ({ id: `audio-${id}`, material_id: id, extension: 'wav', duration_ms: 3000, retain_original: true, storage_path: `retained/${owner}/${id}/fixture.wav` });
  const batch = (id, materialId) => ({ id, material_id: materialId, requested_count: 5, generated_count: 1, source_transcription_revision: 1 });
  const question = (id, batchId) => ({ id, batch_id: batchId, position: 0, statement: 'Questão sintética?', options: ['A', 'B', 'C', 'D'], correct_index: 1, explanation: 'Explicação sintética.' });
  return {
    materials: [material(resourceIds.materialA, identities.a.id, 'Material A'), material(resourceIds.materialB, identities.b.id, 'Material B')],
    audio_files: [audio(resourceIds.materialA, identities.a.id), audio(resourceIds.materialB, identities.b.id)],
    question_batches: [batch(resourceIds.batchA, resourceIds.materialA), batch(resourceIds.batchB, resourceIds.materialB)],
    questions: [question(resourceIds.questionA, resourceIds.batchA), question(resourceIds.questionB, resourceIds.batchB)],
    processing_jobs: [
      { id: resourceIds.jobA, material_id: resourceIds.materialA, status: 'CONCLUIDA' },
      { id: resourceIds.jobB, material_id: resourceIds.materialB, status: 'CONCLUIDA' },
    ],
    processing_job_events: [{ id: 1, job_id: resourceIds.jobA, message: 'Evento sintético.' }],
    transcriptions: [],
    summary_versions: [],
    transcription_versions: [],
  };
}
