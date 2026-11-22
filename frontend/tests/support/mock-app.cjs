/* global axe, document */
// Shared simulated app for browser checks: static pages, a mocked API and Supabase SDK, sample
// study data, and helpers (axe, overflow, screenshots). Nothing here reaches a real backend, AI
// provider or Supabase project. Used by dashboard-home-check.cjs and the personalization checks.
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const backend = path.resolve(root, '../backend');
const express = require(path.join(backend, 'node_modules/express'));
const errors = [];

const USER_ID = 'user-dashboard';
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const at = (offset, hour) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
const lesson = (id, title, subject, daysAgo, durationMs) => ({
  id,
  title,
  subject,
  status: 'PRONTO',
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  audio_files: [{ duration_ms: durationMs, extension: 'mp3' }],
});
// Folders of the library (subjects and units), as GET /api/catalog returns them.
const CATALOG = {
  subjects: [
    { id: 'sub-bio', name: 'Biologia', color_token: null, sort_order: 0 },
    { id: 'sub-fis', name: 'Física', color_token: null, sort_order: 1 },
    { id: 'sub-geo', name: 'Geografia', color_token: null, sort_order: 2 },
    { id: 'sub-his', name: 'História', color_token: null, sort_order: 3 },
    { id: 'sub-mat', name: 'Matemática', color_token: null, sort_order: 4 },
  ],
  units: [
    { id: 'unit-energia', subject_id: 'sub-bio', title: 'Metabolismo energético', description: null, sort_order: 0 },
    { id: 'unit-celula', subject_id: 'sub-bio', title: 'Célula', description: null, sort_order: 1 },
  ],
};
const materials = [
  { ...lesson('l-foto', 'Fotossíntese e respiração celular', 'Biologia', 1, 1820000), subject_id: 'sub-bio', unit_id: 'unit-energia' },
  lesson('l-rev', 'Revolução Industrial: causas e consequências', 'História', 3, 2410000),
  lesson('l-func', 'Funções do 2º grau', 'Matemática', 5, 1505000),
  lesson('l-solo', 'Tipos de solo', 'Geografia', 9, 203000),
  lesson('l-ondas', 'Ondas e som', 'Física', 12, 1290000),
];

/** A lesson at a given point of the study path: 'pending' (unconfirmed), 'fresh' (confirmed, nothing generated), 'summary', 'questions'. */
function lessonDetail(m, stage) {
  return {
    ...m,
    review:
      stage === 'pending'
        ? {
            state: 'awaiting_confirmation',
            sourceRevisionId: null,
            revision: 1,
            permissionRequired: false,
          }
        : {
            state: 'ready_to_generate',
            sourceRevisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            revision: 1,
            permissionRequired: false,
          },
    warnings: [],
    audio: m.audio_files[0],
    transcription: {
      current_revision: 1,
      id: `tr-${m.id}`,
      transcription_segments: [
        {
          id: 'seg-1',
          position: 0,
          start_ms: 0,
          end_ms: 1500,
          current_text: 'A fotossíntese converte energia luminosa em energia química.',
        },
      ],
    },
    summaries:
      stage === 'pending' || stage === 'fresh'
        ? []
        : [
            {
              id: 's1',
              is_current: true,
              version: 1,
              source_transcription_revision: 1,
              text: 'A **fotossíntese** ocorre no cloroplasto.',
            },
          ],
    questionBatches:
      stage === 'questions'
        ? [
            {
              id: 'b1',
              generated_count: 1,
              source_transcription_revision: 1,
              questions: [
                {
                  id: 'q1',
                  statement: 'Onde ocorre a fotossíntese?',
                  options: ['Cloroplasto', 'Núcleo', 'Ribossomo'],
                },
              ],
            },
          ]
        : [],
  };
}

function state() {
  return {
    goals: [
      {
        id: 'g1',
        title: 'Revisar para a prova de Biologia',
        status: 'active',
        target_date: day(10),
      },
      { id: 'g2', title: 'Terminar o módulo de História', status: 'active', target_date: null },
    ],
    subgoals: [{ id: 's1', goal_id: 'g1', title: 'Metabolismo', due_date: day(4) }],
    tasks: [
      {
        id: 't1',
        goal_id: 'g1',
        subgoal_id: 's1',
        title: 'Resumir a fase clara da fotossíntese',
        due_date: day(-1),
        material_id: 'l-foto',
        completed_at: null,
        sort_order: 1000,
        created_at: at(-4, 9),
      },
      {
        id: 't2',
        goal_id: 'g1',
        subgoal_id: null,
        title: 'Refazer as questões erradas',
        due_date: day(1),
        material_id: null,
        completed_at: null,
        sort_order: 2000,
        created_at: at(-3, 9),
      },
      {
        id: 't3',
        goal_id: 'g2',
        subgoal_id: null,
        title: 'Ouvir a aula sobre a Revolução Industrial',
        due_date: day(3),
        material_id: 'l-rev',
        completed_at: null,
        sort_order: 1000,
        created_at: at(-2, 9),
      },
      {
        id: 't4',
        goal_id: 'g2',
        subgoal_id: null,
        title: 'Ler o capítulo 4',
        due_date: null,
        material_id: null,
        completed_at: at(-1, 9),
        sort_order: 2000,
        created_at: at(-2, 9),
      },
    ],
    dueCards: [1, 2, 3, 4, 5].map((n) => ({
      id: `c${n}`,
      front_text: [
        'O que a clorofila absorve?',
        'Onde ocorre o ciclo de Calvin?',
        'Qual o produto da fase clara?',
        'O que é respiração aeróbica?',
        'Qual organela produz ATP?',
      ][n - 1],
      back_text: 'Resposta de teste.',
      status: 'active',
      due_at: at(0, 8),
      material_id: 'l-foto',
    })),
    events: [
      {
        kind: 'event',
        id: 'e1',
        title: 'Estudar fotossíntese',
        startsAt: at(1, 14),
        endsAt: at(1, 15),
        description: '',
        materialId: 'l-foto',
        taskId: null,
        version: 1,
      },
      {
        kind: 'event',
        id: 'e2',
        title: 'Grupo de estudos de História',
        startsAt: at(4, 19),
        endsAt: at(4, 20),
        description: '',
        materialId: null,
        taskId: null,
        version: 1,
      },
    ],
    notes: [
      {
        id: 'n1',
        material_id: 'l-foto',
        source_revision: 2,
        color: 'yellow',
        quote: 'A energia luminosa é convertida em energia química',
        note_text: 'Cai na prova!',
        version: 1,
      },
      {
        id: 'n2',
        material_id: 'l-rev',
        source_revision: 1,
        color: 'green',
        quote: 'máquina a vapor',
        note_text: 'Relacionar com a energia do carvão',
        version: 1,
      },
    ],
    quizSessions: [
      {
        id: 'qs1',
        material_id: 'l-foto',
        batch_id: 'b1',
        status: 'active',
        kind: 'full',
        created_at: at(-1, 10),
      },
      {
        id: 'qs2',
        material_id: 'l-rev',
        batch_id: 'b2',
        status: 'completed',
        kind: 'full',
        created_at: at(-3, 10),
      },
    ],
    reviews: 0,
    sessions: 0,
    ticks: [],
    calendarQueries: 0,
    savedEvents: [],
    createdGoals: [],
  };
}

// Minimal query builder for `profile_state`, answered by the mock server (see dbRoute) so the
// table survives page loads and account switches within a test, as the real database would.
const dbClient = `const db=(table)=>{const q={table,op:'select',filters:[],values:null,returning:false,single:false};
const run=async()=>{const r=await fetch('/__mock/db',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(q)});return r.json();};
const b={select(){if(q.op==='select')q.op='select';else q.returning=true;return b;},
insert(v){q.op='insert';q.values=v;return b;},update(v){q.op='update';q.values=v;return b;},
delete(){q.op='delete';return b;},eq(c,v){q.filters.push([c,v]);return b;},
maybeSingle(){q.single=true;return run();},then(res,rej){return run().then(res,rej);}};return b;};`;

const sdk = (user, withDb = false) =>
  `${withDb ? dbClient : ''}export function createClient(){const user=${JSON.stringify(user)};return {auth:{
getSession:async()=>({data:{session:localStorage.getItem('mock-signed-out')?null:{user,access_token:'mock-token'}},error:null}),
getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
signInWithPassword:async()=>{localStorage.removeItem('mock-signed-out');return {data:{user,session:{user,access_token:'mock-token'}},error:null}},
signOut:async()=>{localStorage.setItem('mock-signed-out','1');return {error:null}},updateUser:async()=>({data:{user},error:null})},
${withDb ? 'from:db,' : ''}storage:{from:()=>({upload:async()=>({error:null}),remove:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:''},error:null})})}}}`;

/**
 * Answers the in-browser query builder against `data.profileState` (array of rows). Like RLS,
 * every query is limited to the signed-in user's rows. `data.dbDown = true` simulates an outage.
 */
function dbRoute(currentUser, data) {
  return async (route) => {
    const user = currentUser();
    const q = route.request().postDataJSON();
    const reply = (body) => route.fulfill({ json: body });
    if (data.dbDown) return reply({ data: null, error: { message: 'offline', code: 'MOCK' } });
    if (q.table !== 'profile_state') return reply({ data: null, error: { message: 'no table' } });
    const rows = data.profileState;
    const matches = (row) =>
      row.user_id === user.id && q.filters.every(([c, v]) => String(row[c]) === String(v));
    if (q.op === 'select') {
      const found = rows.filter(matches).map((r) => ({ data: r.data, updated_at: r.updated_at }));
      return reply({ data: q.single ? found[0] || null : found, error: null });
    }
    if (q.op === 'insert') {
      if (q.values.user_id !== user.id) return reply({ data: null, error: { code: '42501' } });
      if (rows.some((r) => r.user_id === q.values.user_id && r.key === q.values.key))
        return reply({ data: null, error: { code: '23505' } });
      rows.push({ ...q.values, updated_at: q.values.updated_at || new Date().toISOString() });
      data.dbWrites = (data.dbWrites || 0) + 1;
      return reply({ data: null, error: null });
    }
    if (q.op === 'update') {
      const changed = rows.filter(matches);
      for (const row of changed) Object.assign(row, q.values);
      if (changed.length) data.dbWrites = (data.dbWrites || 0) + 1;
      return reply({
        data: q.returning ? changed.map((r) => ({ updated_at: r.updated_at })) : null,
        error: null,
      });
    }
    return reply({ data: null, error: { message: 'unsupported' } });
  };
}

const defaultUser = () => ({
  id: USER_ID,
  email: 'estudante@example.test',
  email_confirmed_at: new Date().toISOString(),
  user_metadata: { display_name: 'Marina Souza' },
});

/**
 * Routes the SDK and the API of one browser context. `options.user` replaces the signed-in
 * account; when `data.profileState` is an array, `profile_state` reads and writes are simulated.
 */
async function setup(context, base, flags, data, options = {}) {
  // `data.user` may change during a test (account switch in the same browser).
  const initialUser = options.user || defaultUser();
  const currentUser = () => data.user || initialUser;
  const user = initialUser;
  const withDb = Array.isArray(data.profileState);
  await context.route(base + '/js/vendor/supabase.min.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: sdk(currentUser(), withDb) }),
  );
  if (withDb) await context.route(base + '/__mock/db', dbRoute(currentUser, data));
  await context.route(base + '/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (p === '/api/config')
      return json({
        supabaseUrl: 'https://mock.supabase.co',
        supabasePublishableKey: 'k',
        audioBucket: 'audios',
        featureFlags: flags,
        maxQuestionListCount: 30,
        recordingLanguages: { options: ['pt'], default: 'pt' },
        oauthProviders: [],
      });
    if (p === '/api/materials' && method === 'GET') return json([...materials, ...(data.extraMaterials || [])]);
    if (/^\/api\/materials\/[^/]+$/.test(p) && method === 'GET') {
      const m = [...materials, ...(data.extraMaterials || [])].find((item) => item.id === p.split('/')[3]);
      if (!m) return route.fulfill({ status: 404, json: { error: { message: 'Aula não encontrada.' } } });
      const detail = lessonDetail(m, data.lessonStage?.[m.id] || 'summary');
      // `data.longLesson = n`: a very long transcript (n segments of ~25 words, 5 s each).
      if (data.longLesson) {
        const words = 'a energia luminosa é captada pela clorofila e convertida em energia química armazenada na glicose durante a fase clara e a fase escura do processo'.split(' ');
        detail.transcription.transcription_segments = Array.from({ length: data.longLesson }, (_, i) => ({
          id: `seg-${i}`,
          position: i,
          start_ms: i * 5000,
          end_ms: i * 5000 + 4800,
          current_text: `${i + 1}. ${Array.from({ length: 25 }, (__, w) => words[(i + w) % words.length]).join(' ')}.`,
        }));
        detail.audio = { ...detail.audio, duration_ms: data.longLesson * 5000 };
      }
      // Notes 3.0 journeys: a lesson with several segments, or moved to a later revision.
      if (data.segmentsFor?.[m.id]) detail.transcription.transcription_segments = data.segmentsFor[m.id];
      if (data.lessonRevision?.[m.id]) detail.transcription.current_revision = data.lessonRevision[m.id];
      // Lists created elsewhere for this lesson (e.g. from an integrated material, mock-multi-lesson.cjs).
      if (data.extraBatches?.[m.id]) detail.questionBatches = [...data.extraBatches[m.id], ...detail.questionBatches];
      return json({ ...detail, signedAudioUrl: `${base}/__fixture.wav` });
    }
    if (p.endsWith('/captions')) return json({ revision: 1, granularity: 'segment', words: [] });
    if (p.endsWith('/playback'))
      return json({ video: null, signedVideoUrl: null, signedAudioUrl: `${base}/__fixture.wav` });
    if (p === '/api/planning' && method === 'GET' && data.failPlanning)
      return json({ error: { message: 'O planejamento está indisponível agora.' } }, 503);
    if (/^\/api\/planning\/tasks\/[^/]+\/completion$/.test(p) && method === 'PATCH') {
      const task = data.tasks.find((item) => item.id === p.split('/')[4]);
      task.completed_at = request.postDataJSON().completed ? new Date().toISOString() : null;
      return json(task);
    }
    if (p === '/api/planning' && method === 'GET')
      return json({ goals: data.goals, subgoals: data.subgoals, tasks: data.tasks });
    if (p === '/api/planning/goals' && method === 'POST') {
      const body = request.postDataJSON();
      const goal = {
        id: `g${data.goals.length + 1}`,
        title: body.title,
        status: 'active',
        target_date: body.targetDate,
      };
      data.createdGoals.push(goal);
      return json(goal, 201);
    }
    if (/^\/api\/planning\/goals\/[^/]+\/tasks$/.test(p) && method === 'POST') {
      const body = request.postDataJSON();
      const task = {
        id: `t${data.tasks.length + 1}`,
        goal_id: p.split('/')[4],
        subgoal_id: body.subgoalId || null,
        title: body.title,
        due_date: body.dueDate || null,
        material_id: body.materialId || null,
        reference_url: body.referenceUrl || null,
        completed_at: null,
        sort_order: 9000,
        created_at: new Date().toISOString(),
      };
      data.tasks.push(task);
      return json(task, 201);
    }
    // ---- Flashcards 3.0 (FEATURE_FLASHCARDS_V3) ------------------------------------------------
    const renderNote = (n) => {
      const f = n.fields || {};
      if (n.noteType === 'cloze') {
        const re = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
        if (!re.test(f.text || '')) return null;
        return { front: f.text.replace(re, (_, a, h) => (h ? `[${h}]` : '[…]')), back: f.text.replace(re, '$1') };
      }
      if (n.noteType === 'term') return { front: f.term, back: f.definition };
      return { front: f.front, back: f.back };
    };
    const newSet = (id, name, cards, extra = {}) => {
      const set = {
        id, name, material_id: null, status: 'active', card_count: cards.length, due_count: cards.length,
        template_id: extra.templateId || null, template_base: extra.templateBase || null, config: extra.config || {},
        cards: cards.map((c, i) => ({ id: `${id}-${i}`, front_text: c.front, back_text: c.back, note_type: c.noteType || 'basic', origin_label: c.originLabel || null, set_id: id })),
      };
      data.sets = [...(data.sets || []), set];
      return set;
    };
    if (p === '/api/flashcards/templates' && method === 'GET') return json(data.cardTemplates || []);
    if (/^\/api\/flashcards\/templates\/[^/]+$/.test(p) && method === 'PUT') {
      const id = p.split('/').pop();
      const body = request.postDataJSON();
      const allowed = ['accent', 'paper', 'ink', 'font', 'radius', 'pattern', 'shadow'];
      if (Object.keys(body.body.tokens || {}).some((k) => !allowed.includes(k)))
        return json({ error: { code: 'VALIDATION_ERROR', message: 'Os dados enviados são inválidos.' } }, 400);
      data.cardTemplates = data.cardTemplates || [];
      const existing = data.cardTemplates.find((t) => t.id === id);
      const saved = { ...(existing || { id, version: 0 }), ...body.body, version: (existing?.version || 0) + 1 };
      data.cardTemplates = [saved, ...data.cardTemplates.filter((t) => t.id !== id)];
      return json(saved);
    }
    if (/^\/api\/flashcards\/sets\/[^/]+\/template$/.test(p) && method === 'PUT') {
      const set = (data.sets || []).find((item) => item.id === p.split('/')[4]);
      if (!set) return json({ error: { code: 'FLASHCARD_NOT_FOUND', message: 'Conjunto não encontrado.' } }, 404);
      const body = request.postDataJSON();
      Object.assign(set, { template_id: body.templateId || null, template_base: body.base || null });
      data.templateApplies = (data.templateApplies || 0) + 1;
      return json(set);
    }
    if (/^\/api\/flashcards\/sets\/[^/]+\/notes$/.test(p) && method === 'POST') {
      const set = (data.sets || []).find((item) => item.id === p.split('/')[4]);
      const note = request.postDataJSON();
      const text = renderNote(note);
      if (!text) return json({ error: { code: 'FLASHCARD_NOTE_INVALID', message: 'Marque pelo menos uma lacuna com {{c1::resposta}}.' } }, 400);
      set.cards = set.cards || [];
      set.cards.push({ id: `${set.id}-${set.cards.length}`, front_text: text.front, back_text: text.back, note_type: note.noteType, set_id: set.id });
      set.card_count = set.cards.length;
      data.typedNotes = [...(data.typedNotes || []), note];
      return json({ added: 1, skipped: [] }, 201);
    }
    if (p === '/api/flashcards/decks' && method === 'POST') {
      const body = request.postDataJSON();
      const cards = body.cards.map((n) => ({ ...renderNote(n), noteType: n.noteType }));
      const set = newSet(body.id, body.name, cards, body);
      data.decks = [...(data.decks || []), body];
      return json({ ...set, added: cards.length, skipped: [] }, 201);
    }
    const mergePlan = (sources) => {
      const picked = sources.map((s) => {
        if (!s.classroomId) return (data.sets || []).find((set) => set.id === s.setId);
        // A deck shared in a class (simulated Turmas): content and author only.
        const room = (data.classrooms?.rooms || []).find((r) => r.id === s.classroomId);
        const item = room?.shared.find((x) => x.id === s.sharedId);
        const author = room?.members.find((m) => m.userId === item?.ownerId)?.displayName || item?.name;
        return { id: item.setId, name: item.name, ownerLabel: author, cards: item.cards.map((c) => ({ id: c.id, front_text: c.front, back_text: c.back })) };
      });
      const seen = new Set();
      const byFront = new Map();
      let duplicates = 0;
      let total = 0;
      for (const set of picked)
        for (const card of set.cards || []) {
          total += 1;
          const norm = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          const key = `${norm(card.front_text)}|${norm(card.back_text)}`;
          if (seen.has(key)) { duplicates += 1; continue; }
          seen.add(key);
          const q = norm(card.front_text);
          if (!byFront.has(q)) byFront.set(q, []);
          byFront.get(q).push({ card, set });
        }
      const conflicts = [...byFront].filter(([, e]) => e.length > 1).map(([key, e]) => ({
        key, front: e[0].card.front_text,
        options: e.map(({ card, set }) => ({ cardId: card.id, back: card.back_text, label: set.ownerLabel || set.name, setName: set.name })),
      }));
      return { byFront, duplicates, total, conflicts };
    };
    if (p === '/api/flashcards/merge/preview' && method === 'POST') {
      const plan = mergePlan(request.postDataJSON().sources);
      return json({ total: plan.total, duplicates: plan.duplicates, resulting: plan.byFront.size, overLimit: 0, conflicts: plan.conflicts });
    }
    if (p === '/api/flashcards/merge' && method === 'POST') {
      const body = request.postDataJSON();
      const plan = mergePlan(body.sources);
      const cards = [];
      for (const [key, entries] of plan.byFront) {
        const choice = body.decisions[key] || 'combine';
        const kept = choice.startsWith('keep:') ? entries.find((e) => e.card.id === choice.slice(5)) : null;
        if (entries.length === 1 || kept) {
          const e = kept || entries[0];
          cards.push({ front: e.card.front_text, back: e.card.back_text, originLabel: e.set.ownerLabel || e.set.name });
        } else
          cards.push({ front: entries[0].card.front_text, back: entries.map((e) => `${e.set.ownerLabel || e.set.name}: ${e.card.back_text}`).join('\n\n'), originLabel: entries.map((e) => e.set.ownerLabel || e.set.name).join(' + ') });
      }
      data.merges = [...(data.merges || []), body];
      const set = newSet(body.id, body.name, cards, body);
      return json({ ...set, added: cards.length, skipped: [] }, 201);
    }
    if (p === '/api/flashcards/import/apkg' && method === 'POST') {
      const mode = url.searchParams.get('mode');
      const bytes = request.postDataBuffer() || Buffer.alloc(0);
      if (bytes.subarray(0, 2).toString() !== 'PK')
        return json({ error: { code: 'APKG_INVALID', message: 'O arquivo não é um pacote do Anki.' } }, 400);
      const report = { deckName: 'Química::Orgânica', notes: 2, types: { basic: 1, cloze: 1 }, images: 1, skipped: { empty: 0, unsupported: 0, overLimit: 0, audio: 1, imagesSkipped: 0 },
        sample: [{ noteType: 'basic', front: 'Fórmula do metano?', back: 'CH4' }, { noteType: 'cloze', front: 'O carbono faz […] ligações.', back: 'O carbono faz 4 ligações.' }] };
      if (mode === 'preview') return json(report, 200);
      const set = newSet(url.searchParams.get('id'), url.searchParams.get('name') || report.deckName, report.sample.map((c) => ({ front: c.front, back: c.back, noteType: c.noteType, originLabel: report.deckName })), {
        templateId: url.searchParams.get('templateId'),
        templateBase: url.searchParams.get('templateBase'),
      });
      data.apkgImports = (data.apkgImports || 0) + 1;
      return json({ ...report, ...set, added: 2 }, 201);
    }
    // Like the database: a create with an existing id replays it; a front already in the set
    // (trimmed, any case) is skipped. `data.dropAfterCommit = { create, cards }` makes the next
    // N such requests be saved and then lose their answer (a connection dropped mid-response).
    const committed = (kind, body, status) => {
      const drop = data.dropAfterCommit || {};
      if (drop[kind] > 0) {
        drop[kind] -= 1;
        return route.abort('connectionreset');
      }
      return json(body, status);
    };
    const frontKey = (text) => String(text ?? '').trim().toLowerCase();
    const addToSet = (set, cards) => {
      let added = 0;
      for (const c of cards) {
        if (set.cards.some((x) => frontKey(x.front_text) === frontKey(c.front))) continue;
        set.cards.push({ id: `${set.id}-${set.cards.length}`, front_text: c.front, back_text: c.back });
        added += 1;
      }
      set.card_count = set.due_count = set.cards.length;
      return added;
    };
    if (p === '/api/flashcards/sets' && method === 'POST') {
      const body = request.postDataJSON();
      data.setRequests = (data.setRequests || 0) + 1;
      const existing = (data.sets || []).find((item) => item.id === body.id);
      if (existing) return committed('create', { ...existing, added: 0, replayed: true }, 201);
      const set = {
        id: body.id, name: body.name, material_id: body.materialId, config: body.config,
        status: 'active', card_count: 0, due_count: 0, cards: [],
      };
      const added = addToSet(set, body.cards);
      data.sets = [...(data.sets || []), set];
      return committed('create', { ...set, added, replayed: false }, 201);
    }
    if (/^\/api\/flashcards\/sets\/[^/]+\/cards$/.test(p) && method === 'POST') {
      const set = (data.sets || []).find((item) => item.id === p.split('/')[4]);
      const { cards } = request.postDataJSON();
      if (cards.length > 100) return json({ error: { code: 'VALIDATION', message: 'too many' } }, 400);
      data.setRequests = (data.setRequests || 0) + 1;
      return committed('cards', { added: addToSet(set, cards) }, 201);
    }
    if (/^\/api\/flashcards\/sets\/[^/]+$/.test(p) && method === 'GET') {
      const set = (data.sets || []).find((item) => item.id === p.split('/')[4]);
      return set ? json(set) : json({ error: { code: 'FLASHCARD_NOT_FOUND', message: 'Conjunto não encontrado.' } }, 404);
    }
    if (p === '/api/flashcards/sets') return json(data.sets || []);
    if (/^\/api\/flashcards\/sets\/[^/]+$/.test(p) && method === 'PATCH') {
      const set = (data.sets || []).find((item) => item.id === p.split('/')[4]);
      Object.assign(set, request.postDataJSON());
      return json(set);
    }
    if (p === '/api/flashcards' && method === 'GET') {
      const filter = url.searchParams.get('filter');
      const cards = filter === 'due' ? data.dueCards : (data.allCards ?? data.dueCards);
      return json({ cards, total: cards.length, limit: 100, offset: 0 });
    }
    if (p === '/api/flashcards' && method === 'POST') {
      const body = request.postDataJSON() || {};
      const card = { id: `fc-${Date.now()}`, front: body.front, back: body.back,
        material_id: body.materialId || null, due_at: new Date().toISOString(), archived_at: null };
      data.createdCards = [...(data.createdCards || []), card];
      return json(card, 201);
    }
    if (/^\/api\/flashcards\/[^/]+\/reviews$/.test(p) && method === 'POST') {
      data.reviews++;
      const id = p.split('/')[3];
      data.dueCards = data.dueCards.filter((card) => card.id !== id);
      return json({ dueAt: at(2, 8) });
    }
    if (p === '/api/calendar' && method === 'GET') {
      data.calendarQueries++;
      const items = [
        ...data.events,
        ...data.tasks
          .filter((t) => t.due_date && !t.completed_at)
          .map((t) => ({
            kind: 'task',
            id: t.id,
            title: t.title,
            date: t.due_date,
            materialId: t.material_id,
          })),
      ];
      // `data.calendarPageSize` pages the feed (without `limit`, as an older server would).
      if (data.calendarPageSize) {
        const offset = Number(url.searchParams.get('offset')) || 0;
        return json({
          items: items.slice(offset, offset + data.calendarPageSize),
          total: items.length,
          offset,
        });
      }
      return json({ items, total: items.length, limit: 100, offset: 0 });
    }
    if (p === '/api/calendar' && method === 'PUT') {
      const body = request.postDataJSON();
      data.savedEvents.push(body);
      const existing = data.events.find((event) => event.id === body.id);
      if (existing && existing.version !== body.version)
        return json({ error: { code: 'CALENDAR_CONFLICT', message: 'Outro dispositivo alterou este horário.' } }, 409);
      const version = (existing?.version || 0) + 1;
      if (existing) Object.assign(existing, body.body, { version });
      else data.events.push({ kind: 'event', id: body.id, version, ...body.body });
      return json({ id: body.id, version });
    }
    if (p === '/api/catalog' && method === 'GET') return json(data.catalog || CATALOG);
    if (/^\/api\/catalog\/materials\/[^/]+$/.test(p) && method === 'PATCH') {
      const id = p.split('/').pop();
      const body = request.postDataJSON();
      data.moves = [...(data.moves || []), { id, ...body }];
      const subject = (data.catalog || CATALOG).subjects.find((item) => item.id === body.subjectId);
      return json({ id, subject_id: body.subjectId, unit_id: body.unitId, subject: subject?.name || null });
    }
    if (p === '/api/catalog/resources') return json({});
    // Notes 3.0 lesson notebook: versions like the server (409 on a stale version, replay of the
    // same request id). `data.notebookFailures` answers 503 to that many saves (unknown outcome).
    if (/^\/api\/notebooks\/[^/]+$/.test(p)) {
      const id = p.split('/')[3];
      data.notebooks = data.notebooks || {};
      const view = () => {
        const notebook = data.notebooks[id] || null;
        const cited = new Set((notebook?.doc.blocks || []).filter((b) => b.type === 'annotation_ref').map((b) => b.annotationId));
        return {
          notebook,
          currentRevision: data.lessonRevision?.[id] || 1,
          references: (data.notes || []).filter((n) => cited.has(n.id)).map((n) => ({ deleted: false, ...n })),
        };
      };
      if (method === 'GET') return json(view());
      const body = request.postDataJSON();
      data.notebookSaves = [...(data.notebookSaves || []), body];
      if (data.notebookFailures > 0) {
        data.notebookFailures -= 1;
        return json({ error: { code: 'DATABASE_TEMPORARY_ERROR', message: 'Banco indisponível.' } }, 503);
      }
      const current = data.notebooks[id];
      if (current && current.last_request_id === body.requestId) return json({ ...view(), replayed: true });
      if ((current?.version || 0) !== body.version)
        return json({ error: { code: 'LEARNING_VERSION_CONFLICT', message: 'O registro mudou em outro aparelho. Atualize antes de editar.' } }, 409);
      data.notebooks[id] = {
        id: current?.id || `nb-${id}`,
        material_id: id,
        title: body.title || '',
        doc: body.doc,
        version: (current?.version || 0) + 1,
        visibility: 'private',
        last_request_id: body.requestId,
      };
      return json({ ...view(), replayed: false });
    }
    if (p === '/api/annotations' && method === 'PUT') {
      const body = request.postDataJSON();
      data.savedNotes = [...(data.savedNotes || []), body];
      const existing = data.notes.find((n) => n.id === body.id);
      if (!existing)
        data.notes.unshift({
          id: body.id,
          material_id: body.materialId,
          source_revision: 1,
          source_revision_id: body.body.sourceRevisionId,
          segment_position: body.body.segmentPosition ?? null,
          end_segment_position: body.body.endSegmentPosition ?? body.body.segmentPosition ?? null,
          start_offset: body.body.startOffset ?? null,
          end_offset: body.body.endOffset ?? null,
          quote: body.body.quote || '',
          note_text: body.body.noteText || '',
          color: body.body.color || 'yellow',
          version: 1,
        });
      return json({ id: body.id, version: (existing?.version || 0) + 1 });
    }
    if (p === '/api/annotations') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const notes = data.notes.filter(
        (n) => !q || `${n.quote} ${n.note_text}`.toLowerCase().includes(q),
      );
      if (data.notePageSize) {
        const offset = Number(url.searchParams.get('offset')) || 0;
        return json({
          notes: notes.slice(offset, offset + data.notePageSize),
          total: notes.length,
          limit: data.notePageSize,
          offset,
        });
      }
      return json({ notes, total: notes.length + (q ? 0 : 5), limit: 50, offset: 0 });
    }
    if (p === '/api/study/progress' && method === 'GET')
      return json({ progress: [], total: 0, limit: 100, offset: 0 });
    if (p.startsWith('/api/study/progress/')) return json({ version: 1 });
    if (p === '/api/study/overview') {
      const seconds = [1800, 2700, 0, 1200, 0, 0, 0];
      const monday = new Date();
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const days = seconds.map((s, i) => {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        return {
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          seconds: s,
        };
      });
      return json({
        weekStart: days[0].date,
        timezone: 'America/Sao_Paulo',
        goalMinutes: 150,
        weekSeconds: seconds.reduce((a, b) => a + b, 0),
        completedMaterials: 2,
        days,
        activeSession: null,
      });
    }
    if (p === '/api/study/history') {
      if (data.historyDown) return json({ error: { code: 'STUDY_SCHEMA_REQUIRED', message: 'off' } }, 503);
      const days = Number(url.searchParams.get('days')) || 84;
      data.historyRequests = [...(data.historyRequests || []), days];
      const today = new Date();
      const list = Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (days - 1 - i));
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        // Deterministic pattern: weekdays studied, varying length; nothing on Sundays.
        const seconds = data.emptyHistory || d.getDay() === 0 ? 0 : ((i * 37) % 5) * 300 * (1 + ((Math.floor(i / 7) * 5) % 4));
        return { date: iso, seconds, sessions: seconds ? 1 : 0 };
      });
      return json({
        from: list[0].date, to: list.at(-1).date, timezone: 'America/Sao_Paulo', goalMinutes: 150, days: list,
        topLessons: data.emptyHistory ? [] : [{ materialId: 'l-foto', seconds: 18000 }, { materialId: 'gone', seconds: 600 }],
      });
    }
    if (p === '/api/study/settings') return json({ ok: true });
    if (p === '/api/quiz-sessions' && method === 'GET') return json(data.quizSessions);
    if (p === '/api/study/sessions' && method === 'POST') {
      data.sessions++;
      const body = request.postDataJSON();
      return json({
        id: body.id || 'session-1',
        kind: body.kind,
        last_sequence: 0,
        started_at: new Date().toISOString(),
        total_seconds: 0,
      });
    }
    if (/^\/api\/study\/sessions\/[^/]+\/tick$/.test(p)) {
      const body = request.postDataJSON();
      data.ticks.push(body);
      return json({
        id: p.split('/')[4],
        last_sequence: body.sequence,
        total_seconds: body.sequence,
        ended_at: body.close ? new Date().toISOString() : null,
      });
    }
    if (p === '/api/search')
      return json({
        lessons: [
          {
            materialId: 'l-foto',
            title: 'Fotossíntese e respiração celular',
            subject: 'Biologia',
            createdAt: materials[0].created_at,
          },
        ],
        questions: [],
        transcripts: [],
      });
    // Private classrooms (Turmas): stateful simulation in ./mock-classrooms.cjs.
    if (p.startsWith('/api/classrooms'))
      return require('./mock-classrooms.cjs').handleClassrooms({
        request, p, method, json, user: currentUser(), data, materials,
      });
    // Integrated material of several lessons (Milestone C): ./mock-multi-lesson.cjs.
    if (p.startsWith('/api/multi-lesson'))
      return require('./mock-multi-lesson.cjs').handleMultiLesson({ request, p, method, json, data, materials });
    // 3.5 Milestone 6: investigations, discoveries and the collection (./mock-discoveries.cjs).
    if (/^\/api\/(investigations|discoveries|collection)(\/|$)/.test(p))
      return require('./mock-discoveries.cjs').handleDiscoveries({ request, p, method, json, data, materials });
    return json({ error: { message: `Sem simulação para ${method} ${p}` } }, 404);
  });
  await context.addInitScript(
    ({ owner, ids }) => {
      const now = Date.now();
      const store = {
        [ids[0]]: {
          openedAt: now - 3600000,
          playedAt: now - 3500000,
          position: 742,
          duration: 1820,
          intervals: [[0, 742]],
          visits: 4,
          tags: ['fotossíntese', 'cloroplasto'],
        },
        [ids[1]]: { openedAt: now - 86400000, visits: 2, tags: ['revolução industrial'] },
        [ids[3]]: { openedAt: now - 5 * 86400000, completed: true, visits: 3, tags: [] },
      };
      if (!localStorage.getItem('voz-study-v1:' + owner) && !localStorage.getItem('mock-no-seed'))
        localStorage.setItem('voz-study-v1:' + owner, JSON.stringify(store));
    },
    { owner: user.id, ids: materials.map((m) => m.id) },
  );
}

const passed = [];
const record = (name) => {
  passed.push(name);
  console.log('PASS', name);
};

async function axeCheck(page, selector, label) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(
    async (target) =>
      (
        await axe.run(document.querySelector(target), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        })
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    selector,
  );
  assert.deepEqual(violations, [], `${label}: axe violations`);
}
async function ready(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-dashboard-data]')?.getAttribute('aria-busy') === 'false',
  );
  await page.waitForTimeout(400);
}
async function noHorizontalScroll(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(overflow <= 1, `${label}: horizontal overflow of ${overflow}px`);
}
const focusedText = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return `${el?.tagName}|${(el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 60)}`;
  });

async function openApp(
  browser,
  base,
  flags,
  data,
  viewport = { width: 1440, height: 1000 },
  options = {},
) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options.context });
  await setup(context, base, flags, data, options);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${page.url()} ${e.stack || e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text()))
      errors.push(m.text());
  });
  return { context, page };
}
const shotter =
  (output) =>
  (page, name, fullPage = true) =>
    page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(350);
}

const allFlags = {
  planning: true,
  flashcards: true,
  flashcard_sets: true,
  study_tracking: true,
  annotations: true,
  calendar: true,
  sharing: true,
  study_authoring: true,
  catalog_units: true,
  quiz_v2: true,
  quiz_review: true,
  // Off by default: journeys switch it on explicitly (the 3.2 client-side paths stay covered).
  flashcards_v3: false,
  // Milestone C, off by default; multi-lesson-check.cjs turns it on.
  multi_lesson: false,
  // 3.5 Milestone 6, off by default; discoveries-check.cjs turns it on.
  discoveries: false,
};

/** Serves the static front end on a free local port. */
async function startServer() {
  const app = express();
  app.get('/favicon.ico', (_req, res) =>
    res.sendFile('favicon.png', { root: path.join(root, 'assets/brand') }),
  );
  app.use('/assets', express.static(path.join(root, 'assets')));
  app.use('/js', express.static(path.join(root, 'js')));
  app.use('/css', express.static(path.join(root, 'css')));
  app.use(express.static(path.join(root, 'pages')));
  // browser-check.cjs writes a real fixture; other checks may run first, so fall back to 1 s of silence.
  app.get('/__fixture.wav', (_req, res) => {
    const file = path.join(root, 'tests', 'artifacts', 'fixture.wav');
    if (require('node:fs').existsSync(file)) return res.sendFile(file, { dotfiles: 'allow' });
    res.type('audio/wav').send(silentWav(1));
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const launchBrowser = () =>
  chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || chromium.executablePath(),
    args: ['--no-sandbox'],
  });

module.exports = {
  USER_ID,
  day,
  at,
  lesson,
  materials,
  lessonDetail,
  state,
  setup,
  defaultUser,
  errors,
  passed,
  record,
  axeCheck,
  ready,
  noHorizontalScroll,
  focusedText,
  openApp,
  shotter,
  settle,
  allFlags,
  startServer,
  launchBrowser,
};

/** Mono 8 kHz 16-bit PCM silence. */
function silentWav(seconds) {
  const samples = 8000 * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
