import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuizDiagnostic } from '../src/services/quiz-diagnostic.service.js';
import { buildQuizSessionService } from '../src/services/quiz-session.service.js';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const first = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const second = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const completed = {
  session: { id:sessionId, material_id:user, status:'completed', feedback_mode:'deferred' },
  questions: [
    { id:first, position:0, statement:'Questão A' },
    { id:second, position:1, statement:'Questão B', options:['10','13','14','15'] },
  ],
  answers: [
    { questionId:first, selectedIndex:0, correctIndex:0, explanation:'Explicação A' },
    { questionId:second, selectedIndex:1, correctIndex:3, explanation:'Explicação B' },
  ],
};

test('diagnóstico é calculado apenas das respostas corrigidas existentes',()=>{
  const d=buildQuizDiagnostic(completed);
  assert.deepEqual([d.correct,d.incorrect,d.percent,d.total],[1,1,50,2]);
  assert.deepEqual(d.toReview,[{
    questionId:second,position:1,statement:'Questão B',
    selectedIndex:1,correctIndex:3,selectedText:'13',correctText:'15',
    explanation:'Explicação B',evidence:null,
  }]);
  assert.match(d.interpretation,/gabarito gerado/);
  assert(d.interpretation.length < 80, 'one short line, not a long disclaimer');
});

test('option text missing in older data stays null instead of being invented',()=>{
  const old={...completed,questions:completed.questions.map((q)=>({...q,options:undefined})),
    answers:completed.answers.map((a)=>({...a,evidence:'trecho'}))};
  const [item]=buildQuizDiagnostic(old).toReview;
  assert.equal(item.selectedText,null);
  assert.equal(item.correctText,null);
  assert.equal(item.evidence,'trecho');
  const short={...completed,questions:[completed.questions[0],{...completed.questions[1],options:['a','b']}]};
  assert.equal(buildQuizDiagnostic(short).toReview[0].correctText,null,'index outside the stored options');
  assert.equal(buildQuizDiagnostic(short).toReview[0].selectedText,'b');
});

test('resultado é bloqueado antes de concluir, nos dois modos de feedback',()=>{
  for(const feedback_mode of ['immediate','deferred'])
    assert.throws(
      ()=>buildQuizDiagnostic({...completed,session:{...completed.session,status:'active',feedback_mode}}),
      e=>e.code==='QUIZ_DIAGNOSTIC_LOCKED' && e.status===409,
    );
});

test('dados incompletos ou sem chave não produzem resultado inventado',()=>{
  for(const answers of [
    [],[completed.answers[0]],
    [{...completed.answers[0],correctIndex:undefined},completed.answers[1]],
    [completed.answers[0],completed.answers[0]],
  ]) assert.throws(()=>buildQuizDiagnostic({...completed,answers}),
    e=>e.code==='QUIZ_DIAGNOSTIC_UNAVAILABLE');
});

test('serviço aplica a conta autenticada antes de calcular diagnóstico',async()=>{
  const s=buildQuizSessionService({
    async readOwnedSession(owner,id) {
      assert.equal(owner,user);
      assert.equal(id,sessionId);
      return completed;
    },
  });
  assert.equal((await s.diagnostic(user,sessionId)).incorrect,1);
});

test('criação de revisão nunca aceita uma lista arbitrária de questões',async()=>{
  const s=buildQuizSessionService({
    async createOwnedReviewSession(owner,id,mode) {
      assert.deepEqual([owner,id,mode],[user,sessionId,'immediate']);
      return {id:first};
    },
  });
  assert.deepEqual(await s.createReview(user,sessionId,{feedbackMode:'immediate'}),{id:first});
  await assert.rejects(s.createReview(user,sessionId,{feedbackMode:'immediate',questionIds:[first]}));
  await assert.rejects(s.createReview(user,sessionId,{feedbackMode:'invalid'}));
});
