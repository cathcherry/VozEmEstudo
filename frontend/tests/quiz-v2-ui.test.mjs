import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  feedbackForQuestion, quizScore, firstUnanswered, nextUnanswered, answerLine, primaryAction,
  shouldAutoAdvance,
} from '../js/utils/quiz-v2-view.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const code=readFileSync(resolve(root,'js/pages/quiz-v2.page.js'),'utf8');
const legacy=readFileSync(resolve(root,'js/pages/quiz.page.js'),'utf8');
const html=readFileSync(resolve(root,'pages/responder.html'),'utf8');

test('deferred feedback never guesses correctness before the server releases a key',()=>{
  // No permanent "registered" message: without a released key there is nothing to show.
  assert.equal(feedbackForQuestion({selectedIndex:2},['a','b','c','d']),null);
  const wrong=feedbackForQuestion({selectedIndex:2,correctIndex:0,correct:false},['13','14','15','16']);
  assert.equal(wrong.title,'Resposta incorreta');
  assert.equal(wrong.icon,'close','not colour only');
  assert.deepEqual(wrong.lines,['Sua resposta: C) 15','Resposta correta: A) 13']);
  const right=feedbackForQuestion({selectedIndex:1,correctIndex:1,correct:true,evidence:'trecho'},['x','y']);
  assert.equal(right.title,'Você acertou');
  assert.deepEqual(right.lines,['Sua resposta: B) y']);
  assert.equal(right.evidence,'trecho');
  assert.deepEqual(quizScore([
    {correct:true},{correct:false},{selectedIndex:0},
  ]),{correct:1,total:3});
  assert.doesNotMatch(code,/O gabarito será apresentado ao concluir/);
});

test('letter and text, and honesty when older data has no option text',()=>{
  assert.equal(answerLine('Sua resposta',2,'15'),'Sua resposta: C) 15');
  assert.equal(answerLine('Resposta correta',1,null),'Resposta correta: B (texto da alternativa não disponível)');
  assert.equal(answerLine('Resposta correta',1,'   '),'Resposta correta: B (texto da alternativa não disponível)');
  assert.equal(answerLine('Sua resposta',undefined,'x'),'Sua resposta: não disponível');
});

test('end mode: save then advance; never after a failed save; conclude at the end',()=>{
  assert.deepEqual(primaryAction({mode:'deferred',answered:false,isLast:false,remaining:3}),
    {action:'save',label:'Salvar e avançar'});
  assert.deepEqual(primaryAction({mode:'deferred',answered:false,isLast:true,remaining:1}),
    {action:'save',label:'Salvar resposta'});
  assert.equal(primaryAction({mode:'immediate',answered:false,isLast:false,remaining:2}).label,'Confirmar resposta');
  assert.equal(primaryAction({mode:'immediate',answered:true,isLast:false,remaining:2}).label,'Próxima questão');
  assert.equal(primaryAction({mode:'deferred',answered:true,isLast:true,remaining:0}).label,'Concluir tentativa');
  assert.equal(primaryAction({mode:'deferred',answered:true,isLast:true,remaining:1}).action,'pending');
  assert.equal(shouldAutoAdvance({mode:'deferred',saved:true,target:2}),true);
  assert.equal(shouldAutoAdvance({mode:'deferred',saved:false,target:2}),false,'failed save stays');
  assert.equal(shouldAutoAdvance({mode:'immediate',saved:true,target:2}),false,'immediate waits for Próxima');
  assert.equal(shouldAutoAdvance({mode:'deferred',saved:true,target:-1}),false,'last answer offers Concluir');
  assert.equal(nextUnanswered([{id:'a'},{id:'b'},{id:'c'}],[{questionId:'a'},{questionId:'c'}],2),1,'wraps');
  assert.equal(nextUnanswered([{id:'a'}],[{questionId:'a'}],0),-1);
  // The page only moves on in the success path, after submitQuizAnswer resolved.
  const start=code.indexOf('await submitQuizAnswer');
  const failure=code.slice(start,code.indexOf('await reload();',start));
  assert.match(failure,/A resposta não foi salva\./);
  assert.match(failure,/return;/);
  assert.doesNotMatch(failure,/go\(|render\(\)/,'no navigation when the save failed');
  assert.match(code,/role', 'alert'/);
  assert.match(code,/aria-live', 'polite'/);
});

test('resume uses IDs from real sessions and finds incomplete questions',()=>{
  assert.equal(firstUnanswered([{id:'a'},{id:'b'},{id:'c'}],
    [{questionId:'a'},{questionId:'c'}]),1);
  assert.equal(firstUnanswered([{id:'a'}],[{questionId:'a'}]),-1);
});

test('v2 replaces legacy only when feature flag is on and uses DOM-safe options',()=>{
  assert.match(legacy,/isFeatureEnabled\('quiz_v2'\)/);
  assert.match(code,/createQuizSession/);
  assert.match(code,/getQuizSession/);
  assert.match(code,/finishQuizSession/);
  assert.match(code,/textContent/);
  assert.doesNotMatch(code,/innerHTML/);
  assert.match(html,/\/css\/quiz-v2\.css/);
});
