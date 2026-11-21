import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createFocusSession } from '../js/utils/focus-session.js';
const source=readFileSync(new URL('../js/pages/study-tracking-panel.js',import.meta.url),'utf8')
  .replace(/import \{[\s\S]*?\} from '[^']+';/gu,'').replace('export async function','async function');
test('study panel renders metrics and validates settings without breaking other dashboard content',async()=>{
  const dom=new JSDOM('<section data-study-tracking-panel hidden></section><p id="existing">Biblioteca</p>');
  const calls=[];
  const dependencies={isStudySyncEnabled:()=>true,studySync:()=>({state:()=>({message:'Sincronizado',conflicts:0}),flush:async()=>{},resolve:async()=>{}}),
    importLocalProgress:async()=>{},
    getFocusSession:async()=>{const map=new Map();return createFocusSession({api:{start:async(b)=>({id:b.sessionId,last_sequence:0}),tick:async(id,w)=>({id,last_sequence:w.sequence})},storage:{getItem:(k)=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},key:'k',uuid:()=>'u'});},
    getStudyOverview:async()=>({weekStart:'2026-11-02',timezone:'UTC',goalMinutes:120,weekSeconds:600,completedMaterials:2,
      days:[{date:'2026-11-02',seconds:600}],activeSession:null}),
    saveStudySettings:async(body)=>{calls.push(body);},tickStudySession:async()=>{},
  };
  const factory=new Function('document','window','Option','setInterval','clearInterval',...Object.keys(dependencies),`${source};return initStudyTrackingPanel;`);
  const init=factory(dom.window.document,dom.window,dom.window.Option,()=>1,()=>{},...Object.values(dependencies));
  try {
    await init();const panel=dom.window.document.querySelector('section');
    assert.equal(panel.hidden,false);assert.match(panel.textContent,/10 de 120 min de estudo/);assert.match(panel.textContent,/Pausa curta/);assert.match(panel.textContent,/Foco de 25 minutos/);
    assert.equal(panel.querySelector('output').getAttribute('aria-live'),'off');
    // One main button; goal, time zone and sync tools wait in a dialog behind the gear.
    assert.equal(panel.querySelectorAll('.study-timer-controls button:not([hidden])').length,1);
    assert.ok(panel.querySelector('dialog form.study-settings'));
    assert.equal(panel.querySelector('[role="radiogroup"] [aria-checked="true"]').dataset.mode,'pomodoro');
    assert.equal(dom.window.document.querySelector('#existing').textContent,'Biblioteca');
    const form=panel.querySelector('form');form.querySelector('[type="number"][max="10080"]').value='90';form.querySelector('input:not([type])').value='America/Sao_Paulo';
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await new Promise((resolve)=>setImmediate(resolve));
    assert.deepEqual(calls,[{goalMinutes:90,timezone:'America/Sao_Paulo'}]);
  } finally {dom.window.close();}
});
test('tracking markers remain hidden by default and routes require explicit feature flag',()=>{
  for(const file of ['planejar','focar']){
    const html=readFileSync(new URL(`../pages/${file}.html`,import.meta.url),'utf8');
    assert.match(html,/data-study-tracking-panel hidden/);
  }
  const app=readFileSync(new URL('../../backend/src/app.js',import.meta.url),'utf8');
  assert.match(app,/isFeatureEnabled\('study_tracking'\).*requireAuth, studyRouter/);
});
