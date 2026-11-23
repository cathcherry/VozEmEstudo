// Question attempts (quiz_v2 sessions) for the simulated app: the same release rules as the
// backend repository (the key of an answered question only in immediate mode or after
// completion; answers are final), plus switches to make a save fail. Nothing real is reached.
//
// Use: data.extraBatches = { 'l-foto': [QUIZ_BATCH] } so the lesson offers the list, then open
// /responder.html?material=l-foto&batch=bq. Options in `data.quiz`:
//   failAnswers: n   — the next n answer saves fail with a 503
//   delayMs: n       — answer saves take n ms
//   noOptionText     — the result drops option text (older data)
const QUIZ_BATCH = {
  id: 'bq',
  title: 'Fotossíntese — revisão',
  generated_count: 4,
  source_transcription_revision: 1,
  created_at: new Date(Date.now() - 86400000).toISOString(),
  questions: [
    { id: 'qa', position: 0, statement: 'Em qual organela ocorre a fotossíntese?', options: ['Mitocôndria', 'Cloroplasto', 'Núcleo', 'Ribossomo'] },
    { id: 'qb', position: 1, statement: 'Qual gás as plantas liberam na fase clara?', options: ['Gás carbônico', 'Nitrogênio', 'Oxigênio', 'Metano'] },
    { id: 'qc', position: 2, statement: 'Quantas moléculas de ATP a glicólise produz, em saldo?', options: ['2', '4', '13', '15'] },
    { id: 'qd', position: 3, statement: 'O que a clorofila absorve?', options: ['Luz', 'Água', 'Sais minerais', 'Glicose'] },
  ],
};
const KEY = {
  qa: { correct_index: 1, explanation: 'Os cloroplastos têm a clorofila, que capta a luz usada no processo.', evidence: 'a fotossíntese acontece dentro dos cloroplastos, onde fica a clorofila' },
  qb: { correct_index: 2, explanation: 'A quebra da água na fase clara libera oxigênio.', evidence: 'na fase clara a água é quebrada e o oxigênio é liberado' },
  qc: { correct_index: 0, explanation: 'A glicólise gasta 2 ATP e produz 4, com saldo de 2.', evidence: null },
  qd: { correct_index: 0, explanation: 'A clorofila é o pigmento que absorve a energia luminosa.', evidence: 'a clorofila absorve a energia luminosa' },
};

function store(data) {
  data.quiz ||= {};
  data.quiz.sessions ||= {};
  return data.quiz;
}

function read(quiz, record) {
  const { session } = record;
  const questions = record.questionIds.map((id) => QUIZ_BATCH.questions.find((q) => q.id === id));
  const show = session.status === 'completed' || session.feedback_mode === 'immediate';
  const answers = record.answers.map((a) => {
    const entry = { questionId: a.questionId, selectedIndex: a.selectedIndex, answeredAt: a.answeredAt };
    if (show) {
      const key = KEY[a.questionId];
      entry.correct = a.selectedIndex === key.correct_index;
      entry.correctIndex = key.correct_index;
      entry.explanation = key.explanation;
      entry.evidence = key.evidence;
    }
    return entry;
  });
  return { session, questions, answers, progress: { answered: answers.length, total: questions.length } };
}

function handleQuiz({ request, p, method, json, data }) {
  const quiz = store(data);
  const list = () => [...Object.values(quiz.sessions).map((r) => r.session).reverse(), ...(data.quizSessions || [])];
  if (p === '/api/quiz-sessions' && method === 'GET') return json(list());
  if (p === '/api/quiz-sessions' && method === 'POST') {
    const body = request.postDataJSON();
    const id = `qs-new-${Object.keys(quiz.sessions).length + 1}`;
    const session = {
      id, material_id: body.materialId, batch_id: body.batchId, feedback_mode: body.feedbackMode,
      status: 'active', kind: 'full', created_at: new Date().toISOString(), completed_at: null,
    };
    quiz.sessions[id] = { session, questionIds: QUIZ_BATCH.questions.map((q) => q.id), answers: [] };
    return json(session, 201);
  }
  const [, , , id, action] = p.split('/');
  const record = quiz.sessions[id];
  if (!record) return json({ error: { message: 'Tentativa não encontrada.' } }, 404);
  if (!action && method === 'GET') return json(read(quiz, record));
  if (action === 'answers' && method === 'POST') {
    const body = request.postDataJSON();
    const reply = () => {
      if (quiz.failAnswers > 0) {
        quiz.failAnswers -= 1;
        return json({ error: { message: 'Sem conexão com o servidor.' } }, 503);
      }
      if (record.session.status === 'completed')
        return json({ error: { message: 'Esta tentativa já foi concluída.' } }, 409);
      const prior = record.answers.find((a) => a.questionId === body.questionId);
      if (prior && prior.selectedIndex !== body.selectedIndex)
        return json({ error: { message: 'Esta questão já foi respondida com outra alternativa.' } }, 409);
      if (!prior) record.answers.push({ ...body, answeredAt: new Date().toISOString() });
      return json({ recorded: true });
    };
    if (quiz.delayMs) return new Promise((resolve) => setTimeout(resolve, quiz.delayMs)).then(reply);
    return reply();
  }
  if (action === 'finish' && method === 'POST') {
    if (record.answers.length < record.questionIds.length)
      return json({ error: { message: 'Responda todas as questões antes de concluir.' } }, 409);
    record.session.status = 'completed';
    record.session.completed_at = new Date().toISOString();
    return json({ completed: true });
  }
  if (action === 'diagnostic' && method === 'GET') {
    const { questions, answers, session } = read(quiz, record);
    if (session.status !== 'completed') return json({ error: { message: 'Conclua a tentativa antes de ver o diagnóstico.' } }, 409);
    const toReview = [];
    for (const q of questions) {
      const a = answers.find((x) => x.questionId === q.id);
      if (a.correct) continue;
      toReview.push({
        questionId: q.id, position: q.position, statement: q.statement,
        selectedIndex: a.selectedIndex, correctIndex: a.correctIndex,
        selectedText: quiz.noOptionText ? null : q.options[a.selectedIndex],
        correctText: quiz.noOptionText ? null : q.options[a.correctIndex],
        explanation: a.explanation, evidence: a.evidence,
      });
    }
    const total = questions.length;
    const correct = total - toReview.length;
    return json({
      sessionId: session.id, materialId: session.material_id, total, correct,
      incorrect: toReview.length, percent: Math.round((correct * 100) / total), toReview,
      interpretation: 'Resultado conferido com o gabarito gerado automaticamente.',
    });
  }
  if (action === 'review' && method === 'POST') {
    const wrong = record.answers.filter((a) => a.selectedIndex !== KEY[a.questionId].correct_index);
    const rid = `${id}-review`;
    quiz.sessions[rid] = {
      session: { ...record.session, id: rid, kind: 'review', status: 'active', feedback_mode: 'deferred', source_session_id: id, created_at: new Date().toISOString() },
      questionIds: wrong.map((a) => a.questionId),
      answers: [],
    };
    return json({ id: rid });
  }
  return json({ error: { message: `Sem simulação para ${method} ${p}` } }, 404);
}

module.exports = { QUIZ_BATCH, QUIZ_KEY: KEY, handleQuiz };
