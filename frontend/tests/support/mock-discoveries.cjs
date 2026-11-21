// SIMULATED /api/investigations, /api/discoveries and /api/collection for browser journeys
// (3.5, Milestone 6). It mirrors the contract of backend/src/routes/discovery.routes.js; the
// real rules (confirmed revision only, quote equal to the snapshot, idempotent server-owned
// unlocks, revisits, privacy) are tested against Postgres in backend/tests/discoveries-*.test.js.
const SEGMENTS = [
  'A fotossíntese é o processo que converte energia luminosa em energia química.',
  'Ela acontece nos cloroplastos das células vegetais.',
  'A respiração celular libera a energia guardada na glicose.',
];
const CATALOG = [
  ['stamp.first-evidence', 'stamp', 'evidence_verified', 1],
  ['stamp.own-explanation', 'stamp', 'explanation_written', 1],
  ['stamp.first-investigation', 'stamp', 'investigation_completed', 1],
  ['stamp.first-reflection', 'stamp', 'reflection_written', 1],
  ['stamp.connection', 'stamp', 'connection_made', 1],
  ['stamp.revisit', 'stamp', 'revisit_made', 1],
  ['object.magnifying-glass', 'object', 'investigation_completed', 3],
  ['object.desk-lamp', 'object', 'investigation_completed', 5],
  ['object.specimen-jar', 'object', 'evidence_verified', 10],
  ['object.pressed-flower', 'object', 'revisit_made', 3],
  ['object.globe', 'object', 'subjects_explored', 3],
  ['cover.matcha-linen', 'cover', 'connection_made', 3],
].map(([id, kind, event, count]) => ({ id, kind, event, count }));
const SLOTS = ['desk-left', 'desk-center', 'desk-right', 'shelf-left', 'shelf-right', 'window', 'wall', 'lamp-corner'];
const now = () => new Date().toISOString();
const error = (json, status, code, message) => json({ error: { code, message } }, status);

function init(data, materials) {
  if (data.discoveryState) return data.discoveryState;
  const s = { investigations: new Map(), unlocks: [], layout: { items: [], version: 0 }, requests: [] };
  // `data.seedDiscovery`: a discovery recorded earlier in another lesson and subject.
  for (const seed of data.seedDiscoveries || []) {
    const lesson = materials.find((m) => m.id === seed.materialId);
    s.investigations.set(seed.id, {
      id: seed.id, materialId: seed.materialId, lessonTitle: lesson?.title, subject: lesson?.subject,
      sourceRevisionId: `rev-${seed.materialId}`, sourceRevision: 1, question: seed.title, questionOrigin: 'student',
      explanation: seed.explanation, reflection: '', explored: true, status: 'completed', version: 3,
      createdAt: seed.createdAt, updatedAt: seed.createdAt, completedAt: seed.createdAt,
      evidence: [{ id: `${seed.id}-e1`, segmentPosition: 0, endSegmentPosition: 0, startOffset: 0, endOffset: seed.quote.length, quote: seed.quote, note: '', sourceRevision: 1 }],
      links: [], discovery: { title: seed.title, explanation: seed.explanation, version: 1, history: [{ version: 1, title: seed.title, explanation: seed.explanation, createdAt: seed.createdAt }] },
      reflections: [], connections: [], revisits: [],
    });
  }
  for (const unlock of data.seedUnlocks || []) s.unlocks.push({ unlockedAt: unlock.occurredAt, kind: unlock.id.split('.')[0], ...unlock });
  data.discoveryState = s;
  return s;
}

function segmentsOf(data, materialId) {
  return (data.investigationSegments?.[materialId] || SEGMENTS).map((text, position) => ({ position, startMs: position * 4000, endMs: position * 4000 + 4000, text }));
}

/** Same rule as the database: the quote must equal the snapshot between the offsets. */
function verified(data, rec, body) {
  const segments = segmentsOf(data, rec.materialId);
  const end = body.endSegmentPosition ?? body.segmentPosition;
  const pieces = [];
  for (let p = body.segmentPosition; p <= end; p += 1) {
    const chars = [...(segments[p]?.text ?? '')];
    if (!segments[p]) return false;
    const from = p === body.segmentPosition ? body.startOffset : 0;
    const to = p === end ? body.endOffset : chars.length;
    if (to > chars.length || from > to) return false;
    pieces.push(chars.slice(from, to).join(''));
  }
  return pieces.join('\n') === body.quote;
}

function award(s, data, id, rec, extra = {}) {
  if (s.unlocks.some((u) => u.id === id)) return null;
  const unlock = {
    id, kind: id.split('.')[0], event: extra.event, sourceId: extra.sourceId || rec.id, investigationId: rec.id,
    discoveryId: rec.status === 'completed' ? rec.id : null, currentDiscoveryId: rec.id, materialId: rec.materialId,
    lessonTitle: rec.lessonTitle, subject: rec.subject, occurredAt: now(), unlockedAt: now(), ruleVersion: 1,
  };
  s.unlocks.push(unlock);
  return unlock;
}

function investigationView(rec, newUnlocks = []) {
  return {
    investigation: {
      id: rec.id, materialId: rec.materialId, sourceRevisionId: rec.sourceRevisionId, sourceRevision: rec.sourceRevision,
      question: rec.question, questionOrigin: rec.questionOrigin, explanation: rec.explanation, reflection: rec.reflection,
      explored: rec.explored, status: rec.status, completedAt: rec.completedAt || null,
      discoveryId: rec.status === 'completed' ? rec.id : null, version: rec.version, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    },
    lesson: { id: rec.materialId, title: rec.lessonTitle, subject: rec.subject },
    evidence: rec.evidence.map((e) => ({ ...e, investigationId: rec.id, materialId: rec.materialId })),
    links: rec.links,
    canComplete: rec.status === 'open' && rec.evidence.length > 0 && [...rec.explanation.trim()].length >= 20,
    newUnlocks,
  };
}

function discoveryView(s, rec, newUnlocks = []) {
  const others = (c) => s.investigations.get(c.otherId);
  return {
    discovery: { id: rec.id, title: rec.discovery.title, explanation: rec.discovery.explanation, version: rec.discovery.version, subject: rec.subject, materialId: rec.materialId, createdAt: rec.completedAt, updatedAt: rec.updatedAt },
    lesson: { id: rec.materialId, title: rec.lessonTitle, subject: rec.subject },
    investigation: { id: rec.id, question: rec.question, questionOrigin: rec.questionOrigin, sourceRevision: rec.sourceRevision, startedAt: rec.createdAt, completedAt: rec.completedAt },
    evidence: rec.evidence,
    links: rec.links,
    reflections: rec.reflections,
    connections: rec.connections.map((c) => ({ ...c, otherTitle: others(c).discovery.title, otherSubject: others(c).subject, otherLessonTitle: others(c).lessonTitle, acrossSubjects: Boolean(rec.subject && others(c).subject && rec.subject.toLowerCase() !== others(c).subject.toLowerCase()) })),
    revisits: rec.revisits,
    history: [...rec.discovery.history].reverse(),
    stamps: s.unlocks.filter((u) => u.investigationId === rec.id),
    newUnlocks,
  };
}

function handleDiscoveries({ request, p, method, json, data, materials }) {
  const all = [...materials, ...(data.extraMaterials || [])];
  const s = init(data, all);
  const body = () => JSON.parse(request.postData() || '{}');
  if (data.discoveriesUnavailable)
    return error(json, 503, 'DISCOVERIES_SCHEMA_REQUIRED', 'As investigações e o Arquivo de Descobertas ainda não foram habilitados no banco.');
  let m;
  if ((m = p.match(/^\/api\/investigations\/source\/([^/]+)$/))) {
    const lesson = all.find((x) => x.id === m[1]);
    if (!lesson) return error(json, 404, 'DISCOVERY_NOT_FOUND', 'Investigação, descoberta ou aula não encontrada.');
    if ((data.lessonStage || {})[lesson.id] === 'pending' || (data.unconfirmedLessons || []).includes(lesson.id))
      return error(json, 409, 'DISCOVERY_REVISION_UNCONFIRMED', 'Confirme a transcrição desta aula antes de investigar com ela.');
    return json({
      lesson: { id: lesson.id, title: lesson.title, subject: lesson.subject },
      revisionId: `rev-${lesson.id}`, revision: 1, confirmedAt: now(),
      segments: segmentsOf(data, lesson.id),
      lessonQuestions: ['Onde ocorre a fotossíntese?'],
      investigations: [...s.investigations.values()].filter((r) => r.materialId === lesson.id).map((r) => ({ id: r.id, question: r.question, status: r.status, updatedAt: r.updatedAt, evidenceCount: r.evidence.length })),
    });
  }
  if ((m = p.match(/^\/api\/investigations\/([^/]+)(?:\/(.+))?$/))) {
    const [, id, rest = ''] = m;
    let rec = s.investigations.get(id);
    if (!rest && method === 'GET') return rec ? json(investigationView(rec)) : error(json, 404, 'DISCOVERY_NOT_FOUND', 'Investigação, descoberta ou aula não encontrada.');
    if (!rest && method === 'PUT') {
      const input = body();
      s.requests.push({ kind: 'save', ...input });
      if (!rec) {
        const lesson = all.find((x) => x.id === input.body.materialId);
        if (input.body.sourceRevisionId !== `rev-${lesson.id}`) return error(json, 409, 'DISCOVERY_SOURCE_CHANGED', 'A transcrição confirmada desta aula mudou.');
        rec = {
          id, materialId: lesson.id, lessonTitle: lesson.title, subject: lesson.subject, sourceRevisionId: `rev-${lesson.id}`, sourceRevision: 1,
          question: input.body.question, questionOrigin: input.body.questionOrigin || 'student', explanation: '', reflection: '', explored: false,
          status: 'open', version: 1, createdAt: now(), updatedAt: now(), evidence: [], links: [], reflections: [], connections: [], revisits: [],
        };
        s.investigations.set(id, rec);
        return json(investigationView(rec));
      }
      if (rec.version !== input.version) return error(json, 409, 'DISCOVERY_VERSION_CONFLICT', 'Este registro mudou em outro aparelho. Atualize antes de editar.');
      const unlocks = [];
      for (const key of ['question', 'questionOrigin', 'explanation', 'reflection']) if (key in input.body) rec[key] = input.body[key];
      if (input.body.explored) rec.explored = true;
      if ([...rec.explanation.trim()].length >= 20) unlocks.push(award(s, data, 'stamp.own-explanation', rec, { event: 'explanation_written' }));
      rec.version += 1;
      rec.updatedAt = now();
      return json(investigationView(rec, unlocks.filter(Boolean)));
    }
    if (!rec) return error(json, 404, 'DISCOVERY_NOT_FOUND', 'Investigação, descoberta ou aula não encontrada.');
    if (rest === 'evidence' && method === 'POST') {
      const input = body();
      s.requests.push({ kind: 'evidence', ...input });
      if (!verified(data, rec, input)) return error(json, 409, 'DISCOVERY_ANCHOR_CONFLICT', 'O trecho escolhido não corresponde à transcrição confirmada. Selecione o trecho de novo.');
      const end = input.endSegmentPosition ?? input.segmentPosition;
      if (rec.evidence.some((e) => e.segmentPosition === input.segmentPosition && e.startOffset === input.startOffset && e.endSegmentPosition === end && e.endOffset === input.endOffset))
        return error(json, 409, 'DISCOVERY_EVIDENCE_DUPLICATE', 'Este trecho já está entre as evidências.');
      const evidence = { id: input.id, segmentPosition: input.segmentPosition, endSegmentPosition: end, startOffset: input.startOffset, endOffset: input.endOffset, quote: input.quote, note: input.note || '', sourceRevision: 1, startMs: input.segmentPosition * 4000, createdAt: now() };
      rec.evidence.push(evidence);
      const unlocks = [award(s, data, 'stamp.first-evidence', rec, { event: 'evidence_verified', sourceId: evidence.id })];
      return json({ ...investigationView(rec, unlocks.filter(Boolean)), evidenceId: evidence.id });
    }
    if ((m = rest.match(/^evidence\/([^/]+)$/)) && method === 'DELETE') {
      if (rec.status === 'completed' && rec.evidence.length <= 1) return error(json, 409, 'DISCOVERY_EVIDENCE_REQUIRED', 'Reúna pelo menos um trecho da aula como evidência.');
      rec.evidence = rec.evidence.filter((e) => e.id !== m[1]);
      return json(investigationView(rec));
    }
    if (rest === 'link-options')
      return json({
        questions: [{ id: 'q1', label: 'Onde ocorre a fotossíntese?', answeredAt: now() }],
        flashcards: [],
        annotations: (data.notes || []).filter((n) => n.material_id === rec.materialId).map((n) => ({ id: n.id, label: n.quote || n.note_text, note: n.note_text })),
        notebooks: [],
      });
    if (rest === 'links' && method === 'PUT') {
      const input = body();
      const options = { question: { q1: 'Onde ocorre a fotossíntese?' }, annotation: Object.fromEntries((data.notes || []).map((n) => [n.id, n.quote])) };
      const label = options[input.kind]?.[input.refId];
      if (!label) return error(json, 409, 'DISCOVERY_LINK_INVALID', 'Só é possível ligar questões que você respondeu e cartões, destaques ou cadernos seus.');
      if (!rec.links.some((l) => l.kind === input.kind && l.refId === input.refId))
        rec.links.push({ id: `link-${rec.links.length}`, kind: input.kind, refId: input.refId, target: { label, materialId: rec.materialId }, missing: false, createdAt: now() });
      return json(investigationView(rec));
    }
    if ((m = rest.match(/^links\/([^/]+)\/([^/]+)$/)) && method === 'DELETE') {
      rec.links = rec.links.filter((l) => !(l.kind === m[1] && l.refId === m[2]));
      return json(investigationView(rec));
    }
    if (rest === 'complete' && method === 'POST') {
      if (rec.status === 'completed') return json({ ...discoveryView(s, rec), replayed: true });
      if (!rec.evidence.length) return error(json, 409, 'DISCOVERY_EVIDENCE_REQUIRED', 'Reúna pelo menos um trecho da aula como evidência.');
      if ([...rec.explanation.trim()].length < 20) return error(json, 409, 'DISCOVERY_EXPLANATION_REQUIRED', 'Escreva a sua explicação (pelo menos 20 caracteres) antes de registrar a descoberta.');
      rec.status = 'completed';
      rec.completedAt = now();
      rec.version += 1;
      rec.discovery = { title: rec.question, explanation: rec.explanation, version: 1, history: [{ version: 1, title: rec.question, explanation: rec.explanation, createdAt: now() }] };
      const unlocks = [award(s, data, 'stamp.first-investigation', rec, { event: 'investigation_completed' })];
      if (rec.reflection.trim()) {
        rec.reflections.push({ id: `${rec.id}-r0`, text: rec.reflection, createdAt: now() });
        if (rec.reflection.trim().length >= 20) unlocks.push(award(s, data, 'stamp.first-reflection', rec, { event: 'reflection_written' }));
      }
      for (const u of s.unlocks) if (u.investigationId === rec.id) u.discoveryId = rec.id;
      return json({ ...discoveryView(s, rec, unlocks.filter(Boolean)), replayed: false });
    }
  }
  const completed = () => [...s.investigations.values()].filter((r) => r.status === 'completed');
  if (p === '/api/discoveries' && method === 'GET')
    return json(
      completed().map((r) => ({
        id: r.id, title: r.discovery.title, subject: r.subject, materialId: r.materialId, lessonTitle: r.lessonTitle,
        createdAt: r.completedAt, updatedAt: r.updatedAt, version: r.discovery.version, evidenceCount: r.evidence.length,
        connectionCount: r.connections.length, revisitCount: r.revisits.length,
        stamps: s.unlocks.filter((u) => u.investigationId === r.id).map((u) => u.id),
      })),
    );
  if ((m = p.match(/^\/api\/discoveries\/([^/]+)(?:\/(.+))?$/))) {
    const rec = s.investigations.get(m[1]);
    if (!rec || rec.status !== 'completed') return error(json, 404, 'DISCOVERY_NOT_FOUND', 'Investigação, descoberta ou aula não encontrada.');
    const rest = m[2] || '';
    if (!rest && method === 'GET') return json(discoveryView(s, rec));
    if (!rest && method === 'PUT') {
      const input = body();
      if (input.version !== rec.discovery.version) return error(json, 409, 'DISCOVERY_VERSION_CONFLICT', 'Este registro mudou em outro aparelho. Atualize antes de editar.');
      rec.discovery.title = input.title ?? rec.discovery.title;
      rec.discovery.explanation = input.explanation ?? rec.discovery.explanation;
      rec.discovery.version += 1;
      rec.discovery.history.push({ version: rec.discovery.version, title: rec.discovery.title, explanation: rec.discovery.explanation, createdAt: now() });
      rec.updatedAt = now();
      return json(discoveryView(s, rec));
    }
    if (rest === 'reflections' && method === 'POST') {
      const input = body();
      rec.reflections.push({ id: input.id, text: input.text, createdAt: now() });
      const unlocks = input.text.trim().length >= 20 ? [award(s, data, 'stamp.first-reflection', rec, { event: 'reflection_written' })] : [];
      return json(discoveryView(s, rec, unlocks.filter(Boolean)));
    }
    if (rest === 'connections' && method === 'POST') {
      const input = body();
      const other = s.investigations.get(input.otherId);
      if (!other || other.id === rec.id) return error(json, 409, 'DISCOVERY_CONNECTION_INVALID', 'Escolha outra descoberta para ligar.');
      if (rec.connections.some((c) => c.otherId === other.id)) return json({ ...discoveryView(s, rec), replayed: true });
      const connection = { id: input.id, note: input.note || '', createdAt: now() };
      rec.connections.push({ ...connection, otherId: other.id });
      other.connections.push({ ...connection, otherId: rec.id });
      const across = rec.subject && other.subject && rec.subject.toLowerCase() !== other.subject.toLowerCase();
      const unlocks = across ? [award(s, data, 'stamp.connection', rec, { event: 'connection_made', sourceId: connection.id })] : [];
      return json(discoveryView(s, rec, unlocks.filter(Boolean)));
    }
  }
  const collection = () => ({
    catalog: CATALOG,
    slots: SLOTS,
    unlocks: s.unlocks,
    layout: s.layout,
    counts: { investigations: completed().length, evidence: [...s.investigations.values()].reduce((n, r) => n + r.evidence.length, 0), revisits: 0, connections: completed().reduce((n, r) => n + r.connections.length, 0) / 2 },
  });
  if (p === '/api/collection' && method === 'GET') return json(collection());
  if (p === '/api/collection/layout' && method === 'PUT') {
    const input = body();
    s.requests.push({ kind: 'layout', ...input });
    if (input.version !== s.layout.version) return error(json, 409, 'DISCOVERY_VERSION_CONFLICT', 'Este registro mudou em outro aparelho. Atualize antes de editar.');
    if (input.items.some((item) => !s.unlocks.some((u) => u.id === item.objectId)))
      return error(json, 409, 'COLLECTION_NOT_UNLOCKED', 'Só é possível colocar na mesa objetos que você já encontrou.');
    s.layout = { items: input.items, version: s.layout.version + 1, updatedAt: now() };
    return json(collection());
  }
  return json({ error: { message: `Sem simulação para ${method} ${p}` } }, 404);
}

module.exports = { handleDiscoveries, SEGMENTS };
