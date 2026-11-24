import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { selectionAnchor,focusAnnotation,readingSelectionAnchor,focusReadingAnnotation } from '../js/utils/annotation-anchor.js';
import { pendingMutation } from '../js/utils/pending-mutation.js';
import { monthRange,localDay,itemOnDay,calendarIcs } from '../js/utils/calendar-export.js';
import { renderWeek,weekStartOf,weekRange,moveEvent,addDays } from '../js/pages/calendar-week.js';
const code=(name)=>readFileSync(new URL(`../js/pages/${name}.js`,import.meta.url),'utf8').replace(/import \{[\s\S]*?\} from '[^']+';/gu,'').replace(/export /gu,'');
async function until(predicate){for(let n=0;n<30;n++){if(predicate())return;await new Promise((resolve)=>setImmediate(resolve));}assert(predicate());}
test('annotations capture a saved selection with its revision and preserve text while saving',async()=>{
  const dom=new JSDOM('<section id="panel" hidden></section><div id="segments"><article class="transcription-segment" data-segment-position="0"><textarea>Energia conservada</textarea></article></div>');let received;
  const dependencies={listAnnotations:async()=>({notes:[],total:0}),saveAnnotation:async(body)=>{received=body;return {version:1};},selectionAnchor,focusAnnotation,readingSelectionAnchor,focusReadingAnnotation,pendingMutation,isFeatureEnabled:async()=>false,createSelectionToolbar:()=>({})};
  const factory=new Function('document','Option','crypto','confirm',...Object.keys(dependencies),`${code('annotations-panel')};return initAnnotationsPanel;`);
  try{const doc=dom.window.document,context=()=>({review:{sourceRevisionId:'source-a'},transcription:{current_revision:1,transcription_segments:[{position:0,current_text:'Energia conservada'}]}});
    await factory(doc,dom.window.Option,webcrypto,()=>true,...Object.values(dependencies))({panel:doc.querySelector('#panel'),materialId:'material-a',context,segments:doc.querySelector('#segments')});
    const field=doc.querySelector('#segments textarea');field.setSelectionRange(0,7);field.dispatchEvent(new dom.window.Event('select',{bubbles:true}));
    [...doc.querySelectorAll('button')].find((b)=>b.textContent==='Usar seleção da transcrição').click();
    const form=doc.querySelector('#panel form');form.querySelector('textarea').value='Minha nota';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>Boolean(received));assert.equal(received.body.quote,'Energia');assert.equal(received.body.sourceRevisionId,'source-a');assert.equal(received.body.noteText,'Minha nota');
    assert.equal(field.value,'Energia conservada');
  }finally{dom.window.close();}
});
test('calendar renders deadlines and creates a timed event linked to the chosen task',async()=>{
  const dom=new JSDOM('<section id="panel" hidden></section>');let received;
  const dependencies={listCalendar:async(q)=>({items:[{kind:'task',id:'task-a',title:'Revisar aula',date:q.fromDay,materialId:'material-a'}],total:1}),
    saveCalendarEvent:async(body)=>{received=body;return {version:1};},monthRange,localDay,itemOnDay,calendarIcs,downloadText:()=>{},pendingMutation,toast:()=>{},renderWeek,weekStartOf,weekRange,moveEvent,addDays};
  const factory=new Function('document','Option','crypto','confirm',...Object.keys(dependencies),`${code('calendar-panel')};return initCalendarPanel;`);
  try{const doc=dom.window.document;await factory(doc,dom.window.Option,webcrypto,()=>true,...Object.values(dependencies))({panel:doc.querySelector('#panel'),materials:[{id:'material-a',title:'Aula A'}]});
    assert(doc.querySelectorAll('.study-calendar-grid button').length>=28);
    [...doc.querySelectorAll('button')].find((b)=>b.textContent==='Agendar horário para esta tarefa').click();
    assert.match(doc.querySelector('.calendar-when-summary').textContent,/das 09:00 às 10:00/);
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>Boolean(received));
    assert.equal(received.body.taskId,'task-a');assert.equal(received.body.materialId,'material-a');assert.equal(Date.parse(received.body.endsAt)-Date.parse(received.body.startsAt),3600000);
  }finally{dom.window.close();}
});
test('public copy fetch omits credentials, sends token only in POST body and renders text safely',async()=>{
  const dom=new JSDOM('<h1 data-shared-title></h1><p data-shared-status></p><div data-shared-content></div><button data-shared-print></button><button data-shared-retry></button>');let options;
  try{new Function('document','location','window','fetch',code('shared-material'))(dom.window.document,{hash:'#token='+'a'.repeat(64)},dom.window,
      async(_url,config)=>{options=config;return new Response(JSON.stringify({title:'<img src=x>',revision:1,transcript:'<script>bad</script>中文'}),{status:200});});
    await until(()=>dom.window.document.querySelector('[data-shared-content]').children.length>0);
    assert.equal(options.credentials,'omit');assert.equal(options.method,'POST');assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(dom.window.document.querySelector('img,script'),null);assert.match(dom.window.document.body.textContent,/中文/);
  }finally{dom.window.close();}
});
test('a note found in Revisar opens its lesson on the highlighted passage', () => {
  const lessonHref = new Function(`${code('annotations-panel').split('async function initAnnotationsPanel')[0]};return lessonHref;`)();
  assert.equal(lessonHref({ material_id: 'a b', quote: '' }), './material.html?id=a+b');
  const long = 'energia luminosa convertida em energia química dentro do cloroplasto durante a fase clara';
  const href = new URL(lessonHref({ material_id: 'm1', quote: long, segment_position: 3 }), 'http://x/');
  assert.equal(href.searchParams.get('trecho'), '3');
  assert(long.startsWith(href.searchParams.get('busca')), 'search term is the start of the quote');
  assert(href.searchParams.get('busca').length <= 80 && !href.searchParams.get('busca').endsWith(' '));
});
