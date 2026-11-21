// Simulated /api/classrooms for browser checks (no real server or database). It mirrors the
// contract of backend/src/services/classroom.service.js closely enough for the journeys: roles,
// invites by code, published lessons, the submission state machine, shared flashcard sets and the
// reviewed contributions (flashcard sets and integrated materials).
// The real permission rules are tested against Postgres in backend/tests/classrooms-*.test.js.
const crypto = require('node:crypto');

const NEXT = {
  submitted: { approved_for_processing: 'manager', rejected: 'manager', withdrawn: 'owner' },
  approved_for_processing: { processing: 'owner', rejected: 'manager', withdrawn: 'owner' },
  processing: { transcription_confirmed: 'manager', rejected: 'manager', withdrawn: 'owner' },
  transcription_confirmed: { published: 'manager', rejected: 'manager', withdrawn: 'owner' },
  published: { transcription_confirmed: 'manager', withdrawn: 'owner' },
};
const normalize = (code) =>
  String(code || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');

function store(data) {
  data.classrooms ||= { rooms: [], requests: [] };
  return data.classrooms;
}

async function handleClassrooms({ request, p, method, json, user, data, materials }) {
  const db = store(data);
  db.requests.push(`${method} ${p}`);
  const body = request.postDataJSON?.() || {};
  const error = (code, message, status) => json({ error: { code, message } }, status);
  const member = (room) => room.members.find((m) => m.userId === user.id && m.status === 'active');
  const manager = (m) => m && ['teacher', 'assistant'].includes(m.role);
  const name = (room, userId) => room.members.find((m) => m.userId === userId)?.displayName || '';
  const summary = (room) => {
    const me = member(room);
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      status: room.status,
      role: me.role,
      displayName: me.displayName,
      isOwner: me.role === 'teacher',
      canManage: manager(me),
      memberCount: room.members.filter((m) => m.status === 'active').length,
      lessonCount: room.lessons.filter((l) => l.status === 'published').length,
      teacherName: room.members.find((m) => m.role === 'teacher')?.displayName,
    };
  };
  const actions = (room, s) =>
    Object.entries(NEXT[s.status] || {})
      .filter(([, actor]) =>
        actor === 'manager' ? manager(member(room)) : s.studentId === user.id,
      )
      .map(([to]) => to);
  const submissionRow = (room, s) => ({
    id: s.id,
    materialId: s.materialId,
    materialTitle: s.materialTitle,
    student: { userId: s.studentId, displayName: name(room, s.studentId) },
    status: s.status,
    note: s.note,
    decisionNote: s.decisionNote || null,
    lessonId: s.lessonId || null,
    isMine: s.studentId === user.id,
    actions: actions(room, s),
  });
  const lessonRow = (room, l) => ({
    id: l.id,
    title: l.title,
    source: l.source,
    status: l.status,
    revision: 1,
    author: { userId: l.ownerId, displayName: name(room, l.ownerId) },
  });

  if (p === '/api/classrooms' && method === 'GET')
    return json(db.rooms.filter(member).map(summary));
  if (p === '/api/classrooms' && method === 'POST') {
    const room = {
      id: body.id,
      name: body.name,
      description: body.description,
      status: 'active',
      members: [
        { userId: user.id, displayName: body.displayName, role: 'teacher', status: 'active' },
      ],
      invites: [],
      lessons: [],
      submissions: [],
      shared: [],
      resources: [],
    };
    db.rooms.push(room);
    return json(summary(room), 201);
  }
  if (p === '/api/classrooms/join' && method === 'POST') {
    const room = db.rooms.find((r) =>
      r.invites.some((i) => i.code === normalize(body.code) && i.state === 'active'),
    );
    if (!room)
      return error('CLASSROOM_INVITE_INVALID', 'Convite inválido, expirado ou revogado.', 404);
    const invite = room.invites.find((i) => i.code === normalize(body.code));
    if (!member(room)) {
      invite.useCount++;
      room.members.push({
        userId: user.id,
        displayName: body.displayName,
        role: 'student',
        status: 'active',
      });
    }
    return json(summary(room));
  }
  const [, , , classId, section, itemId, extra] = p.split('/');
  const room = db.rooms.find((r) => r.id === classId);
  if (!room || !member(room))
    return error('CLASSROOM_NOT_FOUND', 'Turma ou item não encontrado.', 404);
  const me = member(room);
  const forbid = () =>
    error('CLASSROOM_FORBIDDEN', 'Seu papel nesta turma não permite esta ação.', 403);
  if (!section && method === 'GET') return json(summary(room));
  if (!section && method === 'PATCH') {
    if (me.role !== 'teacher') return forbid();
    if ('archived' in body) room.status = body.archived ? 'archived' : 'active';
    return json(summary(room));
  }
  if (section === 'leave') {
    me.status = 'left';
    room.shared = room.shared.filter((s) => s.ownerId !== user.id);
    for (const c of room.contributions || [])
      if (c.ownerId === user.id && ['pending', 'approved'].includes(c.status))
        c.status = c.status === 'pending' ? 'withdrawn' : 'revoked';
    return json({ status: 'left' });
  }
  if (section === 'members' && method === 'GET')
    return json(
      room.members
        .filter((m) => m.status === 'active')
        .map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          role: m.role,
          isMe: m.userId === user.id,
        })),
    );
  if (section === 'members' && method === 'PATCH') {
    if (me.role !== 'teacher') return forbid();
    room.members.find((m) => m.userId === itemId).role = body.role;
    return json({ userId: itemId, role: body.role });
  }
  if (section === 'members' && method === 'DELETE') {
    if (me.role !== 'teacher') return forbid();
    room.members.find((m) => m.userId === itemId).status = 'removed';
    return json({ userId: itemId, status: 'removed' });
  }
  if (section === 'invites') {
    if (!manager(me)) return forbid();
    if (method === 'GET')
      return json(
        room.invites.map((i) => ({
          id: i.id,
          state: i.state,
          useCount: i.useCount,
          maxUses: i.maxUses,
          expiresAt: i.expiresAt,
        })),
      );
    if (method === 'POST') {
      assertCode(body.code);
      room.invites.unshift({
        id: body.id,
        code: normalize(body.code),
        state: 'active',
        useCount: 0,
        maxUses: body.maxUses,
        expiresAt: new Date(Date.now() + body.days * 86400000).toISOString(),
      });
      return json({ id: body.id, maxUses: body.maxUses }, 201);
    }
    room.invites.find((i) => i.id === itemId).state = 'revoked';
    return json({ id: itemId, revoked: true });
  }
  if (section === 'lessons') {
    if (method === 'GET' && !itemId)
      return json(
        room.lessons.filter((l) => l.status === 'published').map((l) => lessonRow(room, l)),
      );
    if (method === 'GET') {
      const l = room.lessons.find((x) => x.id === itemId && x.status === 'published');
      if (!l) return error('CLASSROOM_NOT_FOUND', 'Turma ou item não encontrado.', 404);
      return json({
        ...lessonRow(room, l),
        transcript: {
          revision: 1,
          fullText: l.text,
          segments: [{ position: 0, startMs: 0, endMs: 1500, text: l.text }],
        },
        summary: l.summaryId
          ? { label: null, text: 'A fotossíntese ocorre no cloroplasto.' }
          : null,
        questionLists: l.questionBatchIds.map((id) => ({
          id,
          title: 'Lista 1',
          questions: [
            {
              position: 0,
              statement: 'Onde ocorre a fotossíntese?',
              options: ['Cloroplasto', 'Núcleo', 'Ribossomo', 'Parede'],
              correctIndex: 0,
              explanation: 'No cloroplasto.',
            },
          ],
        })),
      });
    }
    if (!manager(me)) return forbid();
    if (method === 'POST') {
      const material = materials.find((m) => m.id === body.materialId);
      const lesson = {
        id: body.id,
        title: material.title,
        source: 'teacher',
        status: 'published',
        ownerId: user.id,
        text: 'A fotossíntese converte energia luminosa em energia química.',
        summaryId: body.summaryId,
        questionBatchIds: body.questionBatchIds || [],
      };
      room.lessons.unshift(lesson);
      data.publishedBodies = [...(data.publishedBodies || []), body];
      return json(lessonRow(room, lesson), 201);
    }
    room.lessons.find((l) => l.id === itemId).status = 'unpublished';
    return json({ id: itemId, status: 'unpublished' });
  }
  if (section === 'submissions') {
    if (method === 'GET' && !itemId)
      return json(
        room.submissions
          .filter((s) => manager(me) || s.studentId === user.id)
          .map((s) => submissionRow(room, s)),
      );
    if (method === 'POST' && !itemId) {
      if (me.role !== 'student') return forbid();
      const material = materials.find((m) => m.id === body.materialId);
      const s = {
        id: body.id,
        materialId: body.materialId,
        materialTitle: material?.title,
        studentId: user.id,
        status: 'submitted',
        note: body.note,
        events: [
          {
            fromStatus: null,
            toStatus: 'submitted',
            actorRole: 'student',
            note: null,
            at: new Date().toISOString(),
          },
        ],
      };
      room.submissions.unshift(s);
      return json(submissionRow(room, s), 201);
    }
    const s = room.submissions.find((x) => x.id === itemId);
    if (!s || (!manager(me) && s.studentId !== user.id))
      return error('CLASSROOM_NOT_FOUND', 'Turma ou item não encontrado.', 404);
    if (method === 'GET')
      return json({
        ...submissionRow(room, s),
        events: s.events || [],
        review: ['processing', 'transcription_confirmed', 'published'].includes(s.status)
          ? {
              revisionId: 'rev-sub',
              revision: 1,
              fullText: 'Gravação do aluno: a luz é absorvida pela clorofila.',
              studentConfirmed: true,
            }
          : null,
      });
    if (extra === 'transitions') {
      const actor = NEXT[s.status]?.[body.to];
      if (!actor)
        return error('CLASSROOM_ILLEGAL_TRANSITION', 'Esta etapa não pode ser feita agora.', 409);
      if (actor === 'manager' ? !manager(me) : s.studentId !== user.id) return forbid();
      if (body.to === 'transcription_confirmed' && body.revisionId !== 'rev-sub')
        return error('REVISION_CONFLICT', 'A transcrição mudou.', 409);
      if (body.to === 'published') {
        const lesson = {
          id: crypto.randomUUID(),
          title: s.materialTitle,
          source: 'submission',
          status: 'published',
          ownerId: s.studentId,
          text: 'Gravação do aluno: a luz é absorvida pela clorofila.',
          questionBatchIds: [],
        };
        room.lessons.unshift(lesson);
        s.lessonId = lesson.id;
      }
      s.events = [
        ...(s.events || []),
        {
          fromStatus: s.status,
          toStatus: body.to,
          actorRole: actor === 'manager' ? me.role : 'student',
          note: body.note || null,
          at: new Date().toISOString(),
        },
      ];
      s.status = body.to;
      if (body.note && actor === 'manager') s.decisionNote = body.note;
      data.transitions = [...(data.transitions || []), { to: body.to, by: user.id }];
      return json(submissionRow(room, s));
    }
  }
  if (section === 'flashcard-sets') {
    if (method === 'GET' && !itemId)
      return json(
        room.shared.map((x) => ({
          sharedId: x.id,
          setId: x.setId,
          name: x.name,
          cardCount: x.cards.length,
          isMine: x.ownerId === user.id,
          author: { userId: x.ownerId, displayName: name(room, x.ownerId) },
        })),
      );
    if (method === 'GET') {
      const x = room.shared.find((item) => item.id === itemId);
      return json({
        sharedId: x.id,
        name: x.name,
        author: { userId: x.ownerId, displayName: name(room, x.ownerId) },
        cards: x.cards,
      });
    }
    if (method === 'POST') {
      const set = (data.sets || []).find((item) => item.id === body.setId);
      room.shared.unshift({
        id: body.id,
        setId: body.setId,
        name: set.name,
        ownerId: user.id,
        cards: [
          {
            id: 'sc1',
            front: 'O que é clorofila?',
            back: 'Pigmento verde.',
            style: null,
            difficulty: null,
            focus: null,
          },
          {
            id: 'sc2',
            front: 'Onde ocorre o ciclo de Calvin?',
            back: 'No estroma.',
            style: null,
            difficulty: null,
            focus: null,
          },
        ],
      });
      return json({ sharedId: body.id }, 201);
    }
    room.shared = room.shared.filter((item) => item.id !== itemId);
    return json({ sharedId: itemId, revoked: true });
  }
  // Contributions (20261122090000_classroom_contributions.sql): students' wait for review.
  if (section === 'contributions' || section === 'integrated-materials') {
    if (data.classroomContributionsMissing)
      return error(
        'CLASSROOM_CONTRIBUTIONS_SCHEMA_REQUIRED',
        'Contribuições e materiais integrados nas turmas ainda não foram habilitados no banco.',
        503,
      );
    room.contributions ||= [];
    const record = (c) => (data.multiLessons || []).find((r) => r.id === c.itemId);
    const set = (c) => (data.sets || []).find((x) => x.id === c.itemId);
    const visibleTo = (c) => manager(me) || c.ownerId === user.id;
    const contributionRow = (c) => ({
      id: c.id,
      kind: c.kind,
      title: c.kind === 'flashcard_set' ? set(c)?.name : record(c)?.title,
      status: c.status,
      note: c.note || null,
      feedback: c.feedback || null,
      reviewedRole: c.reviewedRole || null,
      sharedId: c.status === 'approved' ? c.sharedId || null : null,
      isMine: c.ownerId === user.id,
      itemId: c.ownerId === user.id ? c.itemId : null,
      author: { userId: c.ownerId, displayName: name(room, c.ownerId) },
      actions: [
        ...(c.status === 'pending' && manager(me) && c.ownerId !== user.id
          ? ['approve', 'reject']
          : []),
        ...(c.status === 'pending' && c.ownerId === user.id ? ['withdraw'] : []),
        ...(c.status === 'approved' && (c.ownerId === user.id || manager(me)) ? ['revoke'] : []),
      ],
    });
    // Members read the generated content only (never the owner's report, model or lesson ids).
    const content = (r) => {
      const cite = (list = []) =>
        list.map(({ lessonTitle, position, quote }) => ({ lessonTitle, position, quote }));
      const out = {};
      if (r.result?.summary)
        out.summary = {
          sections: r.result.summary.sections.map((s) => ({
            heading: s.heading,
            text: s.text,
            citations: cite(s.citations),
          })),
        };
      if (r.result?.questions)
        out.questions = r.result.questions.map((q) => ({
          statement: q.statement,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          citations: cite(q.citations),
        }));
      if (r.result?.flashcards)
        out.flashcards = r.result.flashcards.map((f) => ({
          front: f.front,
          back: f.back,
          citations: cite(f.citations),
        }));
      return {
        sources: r.sources.map((s) => ({ title: s.title, revision: 1 })),
        content: out,
      };
    };
    const shareSetNow = (c) => {
      const owned = set(c);
      c.sharedId = crypto.randomUUID();
      room.shared.unshift({
        id: c.sharedId,
        setId: c.itemId,
        name: owned.name,
        ownerId: c.ownerId,
        cards: [
          { id: 'sc1', front: 'O que é clorofila?', back: 'Pigmento verde.' },
          { id: 'sc2', front: 'Onde ocorre o ciclo de Calvin?', back: 'No estroma.' },
        ],
      });
    };
    if (section === 'integrated-materials') {
      const shared = room.contributions.filter(
        (c) => c.kind === 'integrated_material' && c.status === 'approved',
      );
      if (method === 'GET' && !itemId)
        return json(
          shared.map((c) => ({
            id: c.id,
            title: record(c).title,
            sourceCount: record(c).sources.length,
            isMine: c.ownerId === user.id,
            author: { userId: c.ownerId, displayName: name(room, c.ownerId) },
          })),
        );
      const c = shared.find((x) => x.id === itemId);
      if (!c) return error('CLASSROOM_NOT_FOUND', 'Turma ou item não encontrado.', 404);
      return json({
        id: c.id,
        status: c.status,
        title: record(c).title,
        isMine: c.ownerId === user.id,
        author: { userId: c.ownerId, displayName: name(room, c.ownerId) },
        ...content(record(c)),
      });
    }
    if (method === 'GET' && !itemId)
      return json(room.contributions.filter(visibleTo).map(contributionRow));
    if (method === 'POST' && !itemId) {
      const c = {
        id: body.id,
        kind: body.kind,
        itemId: body.itemId,
        note: body.note,
        ownerId: user.id,
        status: manager(me) ? 'approved' : 'pending',
      };
      if (c.kind === 'integrated_material' && record(c)?.status !== 'ready')
        return error(
          'CLASSROOM_ITEM_NOT_READY',
          'Este material integrado ainda não está pronto.',
          409,
        );
      room.contributions.unshift(c);
      if (c.status === 'approved' && c.kind === 'flashcard_set') shareSetNow(c);
      data.contributionBodies = [...(data.contributionBodies || []), body];
      return json(contributionRow(c), 201);
    }
    const c = room.contributions.find((x) => x.id === itemId);
    if (!c || !visibleTo(c))
      return error('CLASSROOM_NOT_FOUND', 'Turma ou item não encontrado.', 404);
    if (method === 'GET')
      return json({
        ...contributionRow(c),
        preview: !['pending', 'approved'].includes(c.status)
          ? null
          : c.kind === 'flashcard_set'
            ? { cards: [{ front: 'O que é clorofila?', back: 'Pigmento verde.' }] }
            : content(record(c)),
      });
    if (extra === 'review') {
      if (!manager(me) || c.ownerId === user.id) return forbid();
      if (c.status !== 'pending')
        return error('CLASSROOM_ILLEGAL_TRANSITION', 'Esta etapa não pode ser feita agora.', 409);
      c.status = body.decision;
      c.feedback = body.feedback || null;
      c.reviewedRole = me.role;
      if (c.status === 'approved' && c.kind === 'flashcard_set') shareSetNow(c);
      data.reviews = [
        ...(data.reviews || []),
        { decision: body.decision, feedback: body.feedback },
      ];
      return json(contributionRow(c));
    }
    if (method === 'DELETE') {
      if (c.status === 'pending' && c.ownerId !== user.id) return forbid();
      if (['pending', 'approved'].includes(c.status))
        c.status = c.status === 'pending' ? 'withdrawn' : 'revoked';
      room.shared = room.shared.filter((x) => x.id !== c.sharedId);
      return json(contributionRow(c));
    }
  }
  if (section === 'resources') {
    if (method === 'GET') return json(room.resources);
    if (!manager(me)) return forbid();
    if (method === 'POST') {
      room.resources.unshift({
        id: body.id,
        title: body.title,
        url: body.url,
        description: body.description,
      });
      return json(room.resources[0], 201);
    }
    room.resources = room.resources.filter((r) => r.id !== itemId);
    return json({ id: itemId, removed: true });
  }
  return error('NOT_FOUND', `Sem simulação para ${method} ${p}`, 404);
}

/** The browser must send a well-formed code (the server hashes it). */
function assertCode(code) {
  if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code))
    throw new Error(`malformed invite code: ${code}`);
}

module.exports = { handleClassrooms };
