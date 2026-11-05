import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningToolsService } from '../src/services/learning-tools.service.js';
import { validateAnnotation,validateCalendarEvent,validateCalendarQuery,validateShare } from '../src/validators/learning-tools.validator.js';
import { hashShareToken } from '../src/repositories/learning-tools.repository.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('learning tools always derive owner from the authenticated caller',async()=>{
  const calls=[];const names=['listNotes','saveNote','calendarFeed','saveCalendar','createShare','listShares','revokeShare'];
  const store=Object.fromEntries(names.map((name)=>[name,async(...args)=>{calls.push([name,...args]);return {};} ]));
  const service=buildLearningToolsService(store,async(user,material)=>{assert.equal(user,'owner');assert.equal(material,id);});
  await service.notes('owner',{});await service.saveNote('owner',{id,materialId:id,version:0,requestId:id,body:{sourceRevisionId:id,noteText:'Nota'}});
  await service.calendar('owner',{from:'2026-11-01T00:00:00Z',to:'2026-12-01T00:00:00Z',fromDay:'2026-11-01',toDay:'2026-12-01'});
  await service.saveEvent('owner',{id,version:0,requestId:id,body:{title:'Estudo',startsAt:'2026-11-05T10:00:00Z',endsAt:'2026-11-05T11:00:00Z'}});
  await service.createShare('owner',id,{id,requestId:id,token:'a'.repeat(64),sourceRevisionId:id,includeTranscript:true,includeSummary:false,days:7});await service.shares('owner',id,{});await service.revoke('owner',id,id);
  assert(calls.every((call)=>call[1]==='owner'));
});
test('notes, calendar and shares reject forged owner/content and invalid limits',()=>{
  assert.throws(()=>validateAnnotation({id,materialId:id,version:0,requestId:id,body:{sourceRevisionId:id,noteText:''}}));
  assert.throws(()=>validateAnnotation({id,materialId:id,version:1,requestId:id,body:{quote:'trocar a referência'}}));
  assert.throws(()=>validateCalendarEvent({id,version:0,requestId:id,body:{title:'X',startsAt:'2026-11-05T12:00:00Z',endsAt:'2026-11-05T10:00:00Z'}}));
  assert.throws(()=>validateCalendarQuery({from:'2026-01-01T00:00:00Z',to:'2027-01-01T00:00:00Z',fromDay:'2026-01-01',toDay:'2027-01-01'}));
  assert.throws(()=>validateShare({id,requestId:id,token:'a'.repeat(64),sourceRevisionId:id,includeTranscript:true,includeSummary:false,days:90}));
  assert.throws(()=>validateShare({id,requestId:id,token:'a'.repeat(64),sourceRevisionId:id,includeTranscript:true,includeSummary:false,days:7,snapshot:{secret:'injetar'}}));
});
test('public sharing hashes tokens and returns a generic unavailable response',async()=>{
  const raw='a'.repeat(64);assert.match(hashShareToken(raw),/^[0-9a-f]{64}$/);assert.notEqual(hashShareToken(raw),raw);
  const service=buildLearningToolsService({resolveShare:async()=>null});await assert.rejects(service.publicShare({token:raw}),(e)=>e.status===404&&e.code==='SHARE_UNAVAILABLE');
  await assert.rejects(service.publicShare({token:'short'}));
});
