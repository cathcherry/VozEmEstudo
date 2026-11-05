import { isFeatureEnabled } from './feature-flags.js';
import { setStudyObserver,applyRemoteStudy,studyFor } from './study-store.js';
import { listStudyProgress,saveStudyProgress } from '../api/study.api.js';
import { buildStudySync } from './study-sync-core.js';
let sync=null, enabled=false, activeOwner='', timer;
export const isStudySyncEnabled=()=>enabled;
export const studySync=()=>sync;
export async function initStudySync(userId) {
  if(activeOwner===userId) return;
  sync?.stop();activeOwner=userId;clearInterval(timer);sync=null;enabled=false;
  if(!(await isFeatureEnabled('study_tracking'))) return;
  enabled=true;
  sync=buildStudySync({userId,api:{list:listStudyProgress,save:saveStudyProgress},storage:localStorage,
    apply:(id,patch)=>{if(activeOwner===userId)applyRemoteStudy(id,patch);},readLocal:studyFor,uuid:()=>crypto.randomUUID(),
    onStatus:(state)=>{if(activeOwner===userId)window.dispatchEvent(new CustomEvent('study-sync-status',{detail:state}));},
  });
  try { await sync.load(); } catch { sync.state('Não foi possível carregar o andamento da conta. O histórico local foi preservado.'); }
  setStudyObserver((id,patch,snapshot)=>{
    if(['position','playbackRate','completed','intervals'].some((field)=>Object.hasOwn(patch,field))) sync.enqueue(id,snapshot);
  });
  timer=setInterval(()=>{ if(document.visibilityState==='visible'&&navigator.onLine) void sync.flush(); },10000);
  window.addEventListener('online',()=>{ void sync?.flush(true); });
  window.addEventListener('pagehide',()=>{ void sync?.flush(true); });
  void sync.flush();
}
export function importLocalProgress(materials) {
  if(!sync) return;
  for(const material of materials) {
    const state=studyFor(material.id);
    if(!sync.hasRemote(material.id)&&(state.openedAt||state.position||state.completed)) sync.enqueue(material.id,state);
  }
  return sync.flush(true);
}
