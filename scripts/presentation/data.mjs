import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export function addRevision(material, segments, origin = 'manual') {
  const revision = (material.transcription?.current_revision || 0) + 1;
  const id = randomUUID();
  material.transcription = {
    id: material.transcription?.id || randomUUID(),
    current_revision: revision,
    transcription_segments: structuredClone(segments),
  };
  material.versions.unshift({
    id,
    revision,
    origin,
    created_at: now(),
    segments_snapshot: segments.map((segment) => ({
      id: segment.id,
      position: segment.position,
      text: segment.current_text,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
    })),
  });
  material.review = {
    state: 'awaiting_review',
    sourceRevisionId: id,
    revision,
    permissionRequired: false,
  };
  for (const item of [...material.summaries, ...material.questionBatches, ...material.warnings])
    item.stale = true;
}
export function addSummary(material) {
  for (const summary of material.summaries) summary.is_current = false;
  material.summaries.unshift({
    id: randomUUID(),
    is_current: true,
    version: material.summaries.length + 1,
    source_transcription_revision: material.review.revision,
    source_transcription_version_id: material.review.sourceRevisionId,
    text:
      'Exemplo local, sem IA: ' +
      material.transcription.transcription_segments
        .map((s) => s.current_text)
        .join(' ')
        .slice(0, 800),
  });
}
export function addQuestions(material, count) {
  const templates = [
    [
      'O que deve acontecer antes de gerar materiais de revisão?',
      ['Conferir e confirmar a transcrição', 'Ignorar a transcrição', 'Apagar a gravação'],
    ],
    [
      'Ao editar uma transcrição, qual é o próximo passo?',
      [
        'Conferir e confirmar a nova revisão',
        'Considerar a nova revisão automaticamente confirmada',
        'Excluir os materiais anteriores',
      ],
    ],
    [
      'Como utilizar um resumo gerado automaticamente?',
      [
        'Como apoio, conferindo a fonte original',
        'Como garantia de veracidade',
        'Como substituto de toda revisão',
      ],
    ],
  ];
  material.questionBatches.unshift({
    id: randomUUID(),
    generated_count: count,
    source_transcription_revision: material.review.revision,
    source_transcription_version_id: material.review.sourceRevisionId,
    questions: Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      statement: 'Exemplo de interface — ' + templates[index % templates.length][0],
      options: templates[index % templates.length][1],
    })),
  });
}
export function createExample({ id = randomUUID(), title, subject, text, ready = true }) {
  const material = {
    id,
    title,
    subject,
    status: 'PARCIAL',
    created_at: now(),
    initial_question_count: 3,
    audio: { duration_ms: 12000, extension: 'wav', retain_original: true },
    signedAudioUrl: '/presentation/tone.wav',
    summaries: [],
    questionBatches: [],
    warnings: [],
    versions: [],
  };
  addRevision(
    material,
    [{ id: randomUUID(), position: 0, start_ms: 0, end_ms: 12000, current_text: text }],
    'asr',
  );
  if (ready) {
    material.review.state = 'ready_to_generate';
    material.status = 'PRONTO';
    addSummary(material);
    addQuestions(material, 3);
  }
  return material;
}
export function createState() {
  return {
    materials: [
      createExample({
        title: 'Revisão ativa e aprendizagem',
        subject: 'Métodos de estudo',
        text: 'Exemplo fictício: revisar um conteúdo envolve recuperar ideias da memória, conferir a fonte e identificar dúvidas. Este texto não foi transcrito do áudio; o player reproduz um sinal sonoro de teste.',
      }),
      createExample({
        title: 'Introdução às células',
        subject: 'Biologia',
        text: 'Exemplo fictício para organizar a biblioteca por disciplina. As células são unidades básicas dos seres vivos. Confira o conteúdo com o material da aula.',
        ready: false,
      }),
      createExample({
        title: 'Energia e suas transformações',
        subject: 'Física',
        text: 'Exemplo fictício: em um circuito elétrico, a energia pode ser transformada em luz e calor. Use esta aula para testar tags, questões e o modo foco.',
      }),
    ],
    jobs: new Map(),
    uploads: new Map(),
    attempts: new Map(),
  };
}
export function tone() {
  const rate = 8000,
    samples = rate * 12,
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 1200), 44 + i * 2);
  return buffer;
}
