import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyService } from '../src/services/study.service.js';
import { validateProgress,validateSession,validateTick,validateStudySettings } from '../src/validators/study.validator.js';
import { assertStudyDb } from '../src/repositories/study.repository.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('study service always derives owner from authenticated context',async()=>{
  const calls=[];
  const service=buildStudyService(Object.fromEntries(['listProgress','saveProgress','startSession','tickSession','saveSettings','overview'].map((name)=>[name,async(...args)=>{calls.push([name,...args]);return {};}])));
  await service.list('owner',{offset:'200'});
  await service.save('owner',id,{version:0,requestId:id,patch:{position:12,completed:true}});
  await service.start('owner',{sessionId:id,materialId:id,kind:'pomodoro'});
  await service.tick('owner',id,{sequence:1,active:true,close:false});
  await service.settings('owner',{goalMinutes:180,timezone:'America/Sao_Paulo'});
  await service.overview('owner');
  assert(calls.every((call)=>call[1]==='owner'));assert.equal(calls[0][2],200);
});
test('study validators reject forged duration, owners, timestamps and invalid ranges',()=>{
  const body={version:0,requestId:id,patch:{position:1}};
  for(const invalid of [{...body,userId:id},{...body,version:-1},{...body,patch:{duration:100}},
    {...body,patch:{position:Infinity}},{...body,patch:{intervals:[[5,2]]}},{...body,patch:{playbackRate:99}}])
    assert.throws(()=>validateProgress(invalid));
  assert.throws(()=>validateTick({sequence:1,active:true,close:false,seconds:1000}));
  assert.throws(()=>validateTick({sequence:0,active:true,close:false}));
  assert.throws(()=>validateSession({sessionId:id,kind:'break'}));
  assert.throws(()=>validateStudySettings({goalMinutes:10081,timezone:'UTC'}));
  assert.throws(()=>validateStudySettings({goalMinutes:90,timezone:'Invalid/Zone'}));
  assert.deepEqual(validateSession({sessionId:id,kind:'reading'}),{sessionId:id,kind:'reading',materialId:null});
});
test('conflicts and missing schema give actionable safe errors',()=>{
  assert.throws(()=>assertStudyDb({message:'STUDY_PROGRESS_CONFLICT'}),(e)=>e.status===409);
  assert.throws(()=>assertStudyDb({message:'STUDY_SESSION_ACTIVE'}),(e)=>e.status===409);
  assert.throws(()=>assertStudyDb({message:'STUDY_NOT_FOUND'}),(e)=>e.status===404);
  assert.throws(()=>assertStudyDb({code:'PGRST202'}),(e)=>e.code==='STUDY_SCHEMA_REQUIRED'&&e.status===503);
});
