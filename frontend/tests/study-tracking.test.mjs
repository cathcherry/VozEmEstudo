import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudySync,progressPatch } from '../js/utils/study-sync-core.js';
import { StudyClock } from '../js/utils/study-clock.js';

const material='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row=(version=1)=>({material_id:material,version,position_seconds:12,duration_seconds:100,
  playback_rate:2,completed:false,intervals:[[0,10]],updated_at:'2026-11-04T12:00:00Z'});
function syncHarness(overrides={}) {
  const data=new Map(),calls=[],applied=[],status=[];let serial=0;
  const storage={getItem:(key)=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const api={list:async()=>({progress:[row()],total:1,limit:200}),save:async(id,wire)=>{
    calls.push({id,wire:structuredClone(wire)});return row(wire.version+1);
  },...overrides.api};
  const config={userId:'owner-a',api,storage,apply:(...args)=>applied.push(args),uuid:()=>`request-${++serial}`,onStatus:(s)=>status.push(s),...overrides};
  config.api=api;
  return {sync:buildStudySync(config),config,storage,data,calls,applied,status};
}
test('cloud hydration paginates and does not invent local visits or study time',async()=>{
  const offsets=[];
  const h=syncHarness({api:{list:async(offset)=>{offsets.push(offset);return offset===0?
    {progress:[row()],total:201,limit:200}:{progress:[{...row(),material_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}],total:201,limit:200};}}});
  await h.sync.load();assert.deepEqual(offsets,[0,200]);
  assert.equal(h.applied[0][1].position,12);assert.equal(h.applied[0][1].playbackRate,2);
  assert(!Object.hasOwn(h.applied[0][1],'visits'));assert(!Object.hasOwn(h.applied[0][1],'studySeconds'));
});
test('uncertain progress retry preserves request ID, version and body, including across reload',async()=>{
  let attempts=0;const requests=[];
  const h=syncHarness({api:{save:async(id,wire)=>{
    requests.push(structuredClone(wire));if(++attempts===1)throw new Error('offline');return row(2);
  }}});
  await h.sync.load();h.sync.enqueue(material,{position:20,duration:100,playbackRate:1,completed:true,intervals:[[0,20]]});
  await h.sync.flush(true);assert.equal(h.sync.state().pending,1);
  const reloaded=buildStudySync(h.config);await reloaded.load();await reloaded.flush(true);
  assert.deepEqual(requests[0],requests[1]);assert.equal(reloaded.state().pending,0);
});
test('edits made during an in-flight save are sent next with the new server version',async()=>{
  let release;let first=true;
  const h=syncHarness({api:{save:async(id,wire)=>{
    h.calls.push(structuredClone(wire));if(first){first=false;await new Promise((resolve)=>{release=resolve;});}return row(wire.version+1);
  }}});
  await h.sync.load();h.sync.enqueue(material,{position:20,duration:100});
  const saving=h.sync.flush(true);await Promise.resolve();
  h.sync.enqueue(material,{position:30,duration:100});release();await saving;
  assert.equal(h.calls.length,2);assert.equal(h.calls[0].version,1);assert.equal(h.calls[1].version,2);
  assert.equal(h.calls[1].patch.position,30);assert.notEqual(h.calls[0].requestId,h.calls[1].requestId);
});
test('remote conflicts pause writes until explicit resolution and do not discard local legacy state',async()=>{
  const h=syncHarness({readLocal:()=>({position:40,duration:100,completed:true,intervals:[]})});
  await h.sync.load();assert.equal(h.sync.state().conflicts,1);assert.equal(h.applied.length,0);
  await h.sync.flush(true);assert.equal(h.calls.length,0);
  await h.sync.resolve(true);assert.equal(h.calls[0].wire.patch.position,40);
  assert.equal(h.sync.state().conflicts,0);
});
test('a version conflict can explicitly choose the account copy without replaying an old write',async()=>{
  const h=syncHarness({api:{save:async()=>{throw Object.assign(new Error('conflict'),{status:409});}}});
  await h.sync.load();h.sync.enqueue(material,{position:99,duration:100});await h.sync.flush(true);
  assert.equal(h.sync.state().conflicts,1);
  await h.sync.resolve(false);assert.equal(h.sync.state().pending,0);
  assert.equal(h.applied.at(-1)[1].position,12);
});
test('outbox is scoped to the signed-in account and sync patches exclude unrelated local fields',()=>{
  const h=syncHarness();h.sync.enqueue(material,{position:5,duration:100,visits:99,tags:['private'],answers:{x:true},intervals:[[0,5]]});
  const other=buildStudySync({...h.config,userId:'owner-b'});assert.equal(other.state().pending,0);
  assert.deepEqual(Object.keys(progressPatch({})).sort(),['completed','intervals','playbackRate','position']);
});

function clockHarness(overrides={}) {
  let time=0,visible=true,count=0;
  const calls=[],states=[];
  const api={start:async(body)=>{calls.push(['start',structuredClone(body)]);return {id:body.sessionId,last_sequence:0,ended_at:null};},
    tick:async(id,body)=>{calls.push(['tick',id,structuredClone(body)]);return {id,last_sequence:body.sequence,ended_at:body.close?'closed':null};},...overrides};
  const clock=new StudyClock({api,materialId:material,uuid:()=>`session-${++count}`,now:()=>time,visible:()=>visible,onChange:(s)=>states.push(s.message)});
  return {clock,calls,states,advance:async(ms)=>{time+=ms;await clock.pump();},hide:()=>{visible=false;}};
}
test('clock sends server heartbeats, pauses on hidden tab and never sends claimed seconds',async()=>{
  const h=clockHarness();await h.clock.start('reading');
  for(let n=0;n<15;n++)await h.advance(1000);
  assert.equal(h.calls[1][2].sequence,1);assert.equal(h.calls[1][2].active,true);
  assert(!Object.hasOwn(h.calls[1][2],'seconds'));
  h.hide();await h.advance(1000);assert.equal(h.clock.running,false);
  assert.deepEqual(h.calls.at(-1)[2],{sequence:2,active:false,close:true});
});
test('sleep or suspended browser does not turn a long wall-clock gap into study time',async()=>{
  const h=clockHarness();await h.clock.start();await h.advance(120000);
  assert.equal(h.clock.elapsed,0);assert.equal(h.clock.running,false);
  assert.equal(h.calls.at(-1)[2].active,false);
});
test('Pomodoro focus switches to an explicit break; breaks create no server sessions or credits',async()=>{
  const h=clockHarness();await h.clock.start('pomodoro');
  for(let n=0;n<1500;n++)await h.advance(1000);
  assert.equal(h.clock.mode,'break');assert.equal(h.clock.running,false);assert.equal(h.clock.remaining,300);
  const before=h.calls.length;await h.clock.start('break');for(let n=0;n<300;n++)await h.advance(1000);
  assert.equal(h.calls.length,before);assert.equal(h.clock.mode,'pomodoro');assert.equal(h.clock.running,false);
});
test('uncertain heartbeat is reconciled using the same sequence before another session starts',async()=>{
  const wires=[];let fail=true;
  const h=clockHarness({tick:async(id,body)=>{wires.push(structuredClone(body));if(fail){fail=false;throw new Error('offline');}return {id,last_sequence:body.sequence,ended_at:body.close?'closed':null};}});
  await h.clock.start();for(let n=0;n<14;n++)await h.advance(1000);
  await assert.rejects(h.advance(1000),/offline/);assert.equal(h.clock.running,false);
  await h.clock.start();assert.deepEqual(wires[0],wires[1]);
  assert.equal(wires[2].close,true);assert.equal(h.clock.running,true);
});
test('lost start response is retried with identical session ID and closed before changing modes',async()=>{
  const starts=[];let fail=true;
  const h=clockHarness({start:async(body)=>{starts.push(structuredClone(body));if(fail){fail=false;throw new Error('offline');}return {id:body.sessionId,last_sequence:0,ended_at:null};}});
  await assert.rejects(h.clock.start('reading'),/offline/);await h.clock.start('pomodoro');
  assert.deepEqual(starts[0],starts[1]);assert.equal(starts[2].kind,'pomodoro');
  assert.notEqual(starts[0].sessionId,starts[2].sessionId);
});
