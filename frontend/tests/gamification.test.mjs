import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMilestones, milestones, orderedMilestones, unlockedAvatars } from '../js/utils/gamification.js';

test('existing study facts unlock exactly the eligible badges', () => {
  const state=evaluateMilestones({aulas:8,revisoes:0,questoes:5,minutos:0},{},'2026-11-18T12:00:00Z');
  assert.deepEqual(Object.keys(state.unlocked),['first-class','library-5','answer-1']);
  assert.equal(state.xp,65);
  assert.equal(state.level,1);
});
test('reloading never awards XP twice or changes acquisition dates', () => {
  const facts={aulas:10,revisoes:5,questoes:10,minutos:10};
  const state=evaluateMilestones(facts,{},'2026-11-18T12:00:00Z');
  assert.deepEqual(evaluateMilestones(facts,state,'2026-11-19T12:00:00Z'),state);
});
test('removing material does not revoke earned milestones or XP', () => {
  const state=evaluateMilestones({aulas:25,revisoes:20,questoes:100,minutos:60});
  assert.equal(Object.keys(state.unlocked).length,milestones.length);
  assert.deepEqual(evaluateMilestones({aulas:0,revisoes:0,questoes:0,minutos:0},state),state);
});
test('progress below a threshold does not grant its reward', () => {
  const state=evaluateMilestones({aulas:0,revisoes:0,questoes:0,minutos:9.99});
  assert.equal(state.xp,0);
  assert.equal(state.unlocked['listen-10'],undefined);
});

test('earned milestones appear in acquisition order before locked ones', () => {
  const state={unlocked:{'answer-100':'2026-11-01T12:00:00Z','first-class':'2026-11-02T12:00:00Z'}};
  assert.deepEqual(orderedMilestones(state).slice(0,2).map(badge=>badge.id),['answer-100','first-class']);
  assert.equal(orderedMilestones(state).length,milestones.length);
});
test('avatar rewards require an earned milestone; default avatar remains available', () => {
  assert.deepEqual([...unlockedAvatars({})],['reading']);
  const unlocked=unlockedAvatars({unlocked:{'first-class':'2026-11-18','answer-1':'2026-11-18'}});
  assert(unlocked.has('curious'));
  assert(unlocked.has('happy'));
  assert(!unlocked.has('glasses'));
});
