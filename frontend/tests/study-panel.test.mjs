import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { StudyClock } from '../js/utils/study-clock.js';
const source=readFileSync(new URL('../js/pages/study-tracking-panel.js',import.meta.url),'utf8')
  .replace(/import \{[\s\S]*?\} from '[^']+';/gu,'').replace('export async function','async function');
test('study panel renders metrics and validates settings without breaking other dashboard content',async()=>{
  const dom=new JSDOM('<section data-study-tracking-panel hidden></section><p id="existing">Biblioteca</p>');
  const calls=[];
  const dependencies={isStudySyncEnabled:()=>true,studySync:()=>({state:()=>({message:'Sincronizado',conflicts:0}),flush:async()=>{},resolve:async()=>{}}),
    importLocalProgress:async()=>{},StudyClock,
    getStudyOverview:async()=>({weekStart:'2026-11-02',timezone:'UTC',goalMinutes:120,weekSeconds:600,completedMaterials:2,
      days:[{date:'2026-11-02',seconds:600}],activeSession:null}),
    saveStudySettings:async(body)=>{calls.push(body);},startStudySession:async()=>{},tickStudySession:async()=>{},
  };
  const factory=new Function('document','window','Option','setInterval','clearInterval',...Object.keys(dependencies),`${source};return initStudyTrackingPanel;`);
  const init=factory(dom.window.document,dom.window,dom.window.Option,()=>1,()=>{},...Object.values(dependencies));
  try {
    await init();const panel=dom.window.document.querySelector('section');
    assert.equal(panel.hidden,false);assert.match(panel.textContent,/10 min de estudo/);assert.match(panel.textContent,/Pausa de 5 minutos/);
    assert.equal(panel.querySelector('output').getAttribute('aria-live'),'off');
    assert.equal(dom.window.document.querySelector('#existing').textContent,'Biblioteca');
    const form=panel.querySelector('form');form.querySelector('[type="number"]').value='90';form.querySelector('input:not([type="number"])').value='America/Sao_Paulo';
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await new Promise((resolve)=>setImmediate(resolve));
    assert.deepEqual(calls,[{goalMinutes:90,timezone:'America/Sao_Paulo'}]);
  } finally {dom.window.close();}
});
test('tracking markers remain hidden by default and routes require explicit feature flag',()=>{
  for(const file of ['painel','material']){
    const html=readFileSync(new URL(`../pages/${file}.html`,import.meta.url),'utf8');
    assert.match(html,/data-study-tracking-panel hidden/);
  }
  const app=readFileSync(new URL('../../backend/src/app.js',import.meta.url),'utf8');
  assert.match(app,/isFeatureEnabled\('study_tracking'\).*requireAuth, studyRouter/);
});
