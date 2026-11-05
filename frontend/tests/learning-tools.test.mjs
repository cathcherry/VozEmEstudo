import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { exportDocument,exportText,printStudyDocument } from '../js/utils/study-export.js';
import { calendarIcs,foldIcsLine,monthRange,itemOnDay } from '../js/utils/calendar-export.js';
import { selectionAnchor,focusAnnotation } from '../js/utils/annotation-anchor.js';
import { pendingMutation } from '../js/utils/pending-mutation.js';

test('ICS keeps timed events in UTC, deadlines as dates and escapes injected component lines',()=>{
  const ics=calendarIcs([
    {kind:'event',id:'one',title:'Aula, revisão;\r\nBEGIN:VEVENT',description:'linha 1\nlinha 2',startsAt:'2026-11-05T10:00:00-03:00',endsAt:'2026-11-05T11:00:00-03:00'},
    {kind:'task',id:'two',title:'Prazo',date:'2026-11-30'},
  ],new Date('2026-11-04T12:00:00Z'));
  assert.match(ics,/DTSTART:20261105T130000Z/);assert.match(ics,/DTSTART;VALUE=DATE:20261130/);assert.match(ics,/DTEND;VALUE=DATE:20261201/);
  assert.equal(ics.split('\r\n').filter((line)=>line==='BEGIN:VEVENT').length,2);
  assert(ics.includes('Aula\\, revisão\\;\\nBEGIN:VEVENT'));assert(ics.endsWith('END:VCALENDAR\r\n'));
});
test('ICS folds UTF-8 without splitting Unicode code points and preserves complete text',()=>{
  const original='SUMMARY:'+'汉字🧠á'.repeat(100),folded=foldIcsLine(original);
  for(const line of folded.split('\r\n'))assert(new TextEncoder().encode(line).length<=75);
  assert.equal(folded.replace(/\r\n /g,''),original);
});
test('calendar handles month bounds, invalid months and events spanning midnight',()=>{
  const range=monthRange('2026-11');assert.equal(range.fromDay,'2026-11-01');assert.equal(range.toDay,'2026-12-01');
  assert.throws(()=>monthRange('2026-13'));assert.throws(()=>monthRange('bad'));
  const item={kind:'event',startsAt:new Date('2026-11-05T23:30:00').toISOString(),endsAt:new Date('2026-11-06T01:00:00').toISOString()};
  assert(itemOnDay(item,'2026-11-05'));assert(itemOnDay(item,'2026-11-06'));assert(!itemOnDay(item,'2026-11-07'));
});
test('exports identify transcript/summary/annotation revisions instead of merging their provenance',()=>{
  const doc=exportDocument({title:'Aula',subject:'Física',transcription:{current_revision:5,current_text:'Texto salvo'},
    summaries:[{is_current:true,version:2,source_transcription_revision:3,text:'Resumo antigo'}]},
    {notes:[{source_revision:1,quote:'Energia',note_text:'Revisar'}]});
  const text=exportText(doc,true);assert.match(text,/revisão 5/);assert.match(text,/fonte: revisão 3/);assert.match(text,/Revisão 1/);assert.match(text,/Texto salvo/);
});
test('print/PDF layout renders all supplied text as text, without interpreting HTML',async()=>{
  const dom=new JSDOM('<html><head></head><body></body></html>');let prints=0;
  try{const popup={document:dom.window.document,print:()=>{prints++;},opener:{}};
    printStudyDocument({title:'<img src=x onerror=alert(1)>',subject:'Tema',sections:[{heading:'Texto',text:'<script>alert(1)</script>\n中文'}]},popup);
    await Promise.resolve();assert.equal(prints,1);assert.equal(popup.opener,null);assert.equal(dom.window.document.querySelector('img,script'),null);
    assert.match(dom.window.document.body.textContent,/中文/);
  }finally{dom.window.close();}
});
test('highlight offsets count code points and restore the correct browser selection',()=>{
  const dom=new JSDOM('<div id="segments"><article class="transcription-segment" data-segment-position="0"><textarea></textarea></article></div>');
  try{const field=dom.window.document.querySelector('textarea');field.value='🧠 Energia';field.setSelectionRange(3,10);
    const anchor=selectionAnchor(field,0);assert.equal(anchor.startOffset,2);assert.equal(anchor.quote,'Energia');
    const note={source_revision:1,segment_position:0,start_offset:2,end_offset:9,quote:'Energia'};
    assert(focusAnnotation(note,dom.window.document.querySelector('#segments'),1));assert.equal(field.selectionStart,3);assert.equal(field.selectionEnd,10);
    assert.equal(focusAnnotation(note,dom.window.document.querySelector('#segments'),2),false);
  }finally{dom.window.close();}
});
test('an uncertain mutation preserves its body and identity until acknowledged',async()=>{
  let calls=0;const requests=[];const save=pendingMutation(async(body)=>{requests.push(structuredClone(body));if(++calls===1)throw new Error('offline');return {saved:true};},()=>`request-${calls}`);
  await assert.rejects(save({id:'note',body:{noteText:'Original'}}),/offline/);
  await assert.rejects(save({id:'note',body:{noteText:'Mudou'}}),/Confirme primeiro/);
  await save({id:'note',body:{noteText:'Original'}});assert.deepEqual(requests[0],requests[1]);
});
