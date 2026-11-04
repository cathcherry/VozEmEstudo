import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { feedbackForQuestion, quizScore, firstUnanswered } from '../js/utils/quiz-v2-view.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const code=readFileSync(resolve(root,'js/pages/quiz-v2.page.js'),'utf8');
const legacy=readFileSync(resolve(root,'js/pages/quiz.page.js'),'utf8');
const html=readFileSync(resolve(root,'pages/responder.html'),'utf8');

test('deferred feedback never guesses correctness before the server releases a key',()=>{
  assert.equal(feedbackForQuestion({selectedIndex:2},'deferred'),
    'Resposta registrada. O gabarito será apresentado ao concluir.');
  assert.match(feedbackForQuestion({selectedIndex:2,correctIndex:0,correct:false},'deferred'),
    /Resposta incorreta/);
  assert.deepEqual(quizScore([
    {correct:true},{correct:false},{selectedIndex:0},
  ]),{correct:1,total:3});
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
