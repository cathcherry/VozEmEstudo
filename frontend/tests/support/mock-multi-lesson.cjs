// SIMULATED /api/multi-lesson for browser journeys (Milestone C). It mirrors the contract of
// backend/src/routes/multi-lesson.routes.js; the real rules (confirmed revisions only, frozen
// snapshot, one job for concurrent requests, evidence checks) are tested against Postgres and a
// fake provider in backend/tests/multi-lesson-*.test.js. No AI provider or database is involved.
const QUOTES = {
  'l-foto': 'A fotossíntese converte energia luminosa em energia química.',
  'l-resp': 'A respiração celular libera a energia guardada na glicose.',
};

function lessonsOf(data, materials) {
  return [...materials, ...(data.extraMaterials || [])];
}

function resolve(data, materials, selection) {
  const all = lessonsOf(data, materials);
  let chosen;
  if (selection.kind === 'lessons') chosen = selection.ids.map((id) => all.find((m) => m.id === id)).filter(Boolean);
  else if (selection.kind === 'unit' || selection.kind === 'units') chosen = all.filter((m) => selection.ids.includes(m.unit_id));
  else chosen = all.filter((m) => m.subject_id === selection.ids[0]);
  const unconfirmed = new Set(data.unconfirmedLessons || []);
  const included = chosen
    .filter((m) => !unconfirmed.has(m.id))
    .map((m) => ({ materialId: m.id, revisionId: `rev-${m.id}`, revision: 1, title: m.title, subjectId: m.subject_id || null, unitId: m.unit_id || null }));
  const excluded = chosen.filter((m) => unconfirmed.has(m.id)).map((m) => ({ materialId: m.id, title: m.title, reason: 'unconfirmed' }));
  return { kind: selection.kind, included, excluded, missing: 0, limit: 12, tooMany: included.length > 12 };
}

function result(record) {
  const cite = (source, position = 0) => ({
    materialId: source.materialId,
    revisionId: source.revisionId,
    revision: 1,
    lessonTitle: source.title,
    position,
    quote: QUOTES[source.materialId] || `Trecho simulado de ${source.title} com palavras suficientes.`,
    startMs: 0,
  });
  const [first, second = first] = record.sources;
  const out = {
    lessons: record.sources.map((s, i) => ({ label: `A${i + 1}`, materialId: s.materialId, revisionId: s.revisionId, revision: 1, title: s.title, concepts: 2 })),
    report: { cacheHits: 0, mapCalls: record.sources.length, droppedSections: 0, droppedQuestions: 1, droppedFlashcards: 0, droppedCitations: 1, lessonsWithoutKnowledge: [], repaired: false, modelCalls: record.sources.length + 1 },
  };
  if (record.outputs.includes('summary'))
    out.summary = {
      sections: [
        { heading: 'Energia nas células', text: 'A fotossíntese guarda energia que a respiração celular libera.', citations: [cite(first), cite(second)] },
      ],
    };
  if (record.outputs.includes('questions'))
    out.questions = [
      {
        statement: 'O que relaciona a fotossíntese e a respiração celular?',
        options: ['A energia guardada e liberada', 'A divisão celular', 'A síntese de DNA', 'A digestão'],
        correctIndex: 0,
        explanation: 'Uma guarda, a outra libera energia.',
        citations: [cite(first), cite(second)],
      },
    ];
  if (record.outputs.includes('flashcards'))
    out.flashcards = [{ front: 'Fotossíntese', back: 'Converte luz em energia química.', citations: [cite(first)] }];
  return out;
}

// 3.4: saving a ready material's questions as a list (of its first lesson) and its cards as a set.
function exportOf(data, record, kind, input) {
  const existing = data.multiLessonExports.find((item) => item.multiLessonId === record.id && item.kind === kind);
  if (existing) return { ...existing, replayed: true };
  const materialId = record.sources[0].materialId;
  const item =
    kind === 'questions'
      ? {
          id: `exp-q-${record.id}`,
          kind,
          multiLessonId: record.id,
          materialId,
          batchId: `batch-${record.id}`,
          setId: null,
          itemCount: record.result.questions.length,
          available: true,
          links: {
            answer: `./responder.html?material=${encodeURIComponent(materialId)}&batch=${encodeURIComponent(`batch-${record.id}`)}`,
            lesson: `./material.html?id=${encodeURIComponent(materialId)}#questoes`,
          },
        }
      : {
          id: `exp-f-${record.id}`,
          kind,
          multiLessonId: record.id,
          materialId: null,
          batchId: null,
          setId: `set-${record.id}`,
          itemCount: record.result.flashcards.length,
          available: true,
          skipped: 0,
          links: { review: `./revisar.html?conjunto=${encodeURIComponent(`set-${record.id}`)}#flashcards` },
        };
  data.multiLessonExports.push(item);
  data.multiLessonExportRequests.push({ kind, ...input });
  if (kind === 'questions') {
    data.extraBatches ||= {};
    (data.extraBatches[materialId] ||= []).unshift({
      id: item.batchId,
      title: input.title || `Questões integradas: ${record.title}`,
      generated_count: record.result.questions.length,
      requested_count: record.result.questions.length,
      source_transcription_revision: 1,
      config: { origin: { kind: 'multi_lesson', multiLessonId: record.id } },
      questions: record.result.questions.map((q, i) => ({ id: `${item.batchId}-q${i}`, position: i, statement: q.statement, options: q.options })),
    });
  }
  return { ...item, replayed: false };
}

function handleMultiLesson({ request, p, method, json, data, materials }) {
  data.multiLessons ||= [];
  data.multiLessonRequests ||= [];
  data.multiLessonExports ||= [];
  data.multiLessonExportRequests ||= [];
  const body = () => JSON.parse(request.postData() || '{}');
  const exportMatch = p.match(/^\/api\/multi-lesson\/([^/]+)\/(exports|question-list|flashcard-set)$/);
  if (exportMatch) {
    if (data.multiLessonExportsUnavailable)
      return json({ error: { code: 'MULTI_LESSON_EXPORTS_SCHEMA_REQUIRED', message: 'Salvar o material integrado como lista ou conjunto ainda não foi habilitado no banco.' } }, 503);
    const record = data.multiLessons.find((r) => r.id === exportMatch[1]);
    if (!record) return json({ error: { code: 'MULTI_LESSON_NOT_FOUND', message: 'Material integrado, unidade ou disciplina não encontrado.' } }, 404);
    if (exportMatch[2] === 'exports' && method === 'GET')
      return json(data.multiLessonExports.filter((item) => item.multiLessonId === record.id));
    if (method !== 'POST') return json({ error: { message: `Sem simulação para ${method} ${p}` } }, 404);
    if (record.status !== 'ready')
      return json({ error: { code: 'MULTI_LESSON_NOT_READY', message: 'O material integrado ainda não está pronto.' } }, 409);
    if (data.failNextExport) {
      data.failNextExport = false;
      return json({ error: { code: 'DATABASE_TEMPORARY_ERROR', message: 'O banco está temporariamente indisponível. Tente novamente.' } }, 503);
    }
    return json(exportOf(data, record, exportMatch[2] === 'question-list' ? 'questions' : 'flashcards', body()));
  }
  if (p === '/api/multi-lesson/preview' && method === 'POST') return json(resolve(data, materials, body().selection));
  if (p === '/api/multi-lesson' && method === 'GET')
    return json(
      data.multiLessons.map((r) => ({ id: r.id, title: r.title, status: r.status, selection_kind: r.selection_kind, outputs: r.outputs, source_count: r.sources.length, excluded_count: r.excluded.length, created_at: r.created_at })),
    );
  if (p === '/api/multi-lesson' && method === 'POST') {
    const input = body();
    data.multiLessonRequests.push(input);
    const resolved = resolve(data, materials, input.selection);
    const revisions = resolved.included.map((item) => item.revisionId);
    if (input.expectedRevisionIds && (revisions.length !== input.expectedRevisionIds.length || revisions.some((id) => !input.expectedRevisionIds.includes(id))))
      return json({ error: { code: 'MULTI_LESSON_SOURCES_CHANGED', message: 'As aulas da seleção mudaram. Revise a lista e confirme de novo.' } }, 409);
    const record = {
      id: input.id,
      title: input.title,
      selection_kind: input.selection.kind,
      outputs: input.outputs,
      settings: input.settings || {},
      sources: resolved.included,
      excluded: resolved.excluded,
      status: 'queued',
      polls: 0,
      created_at: new Date().toISOString(),
      job: { status: 'pending', attemptCount: 0, maxAttempts: 2 },
    };
    data.multiLessons.unshift(record);
    return json({ multiLesson: record, generation: { id: `gen-${record.id}`, decision: 'start' } }, 202);
  }
  const match = p.match(/^\/api\/multi-lesson\/([^/]+)$/);
  if (match && method === 'GET') {
    const record = data.multiLessons.find((r) => r.id === match[1]);
    if (!record) return json({ error: { code: 'MULTI_LESSON_NOT_FOUND', message: 'Material integrado, unidade ou disciplina não encontrado.' } }, 404);
    // The simulated worker finishes after the first poll.
    record.polls += 1;
    if (record.status === 'queued' && record.polls > 1) {
      record.status = 'ready';
      record.result = result(record);
      record.job = { status: 'done', attemptCount: 1, maxAttempts: 2 };
    }
    return json(record);
  }
  return json({ error: { message: `Sem simulação para ${method} ${p}` } }, 404);
}

module.exports = { handleMultiLesson };
