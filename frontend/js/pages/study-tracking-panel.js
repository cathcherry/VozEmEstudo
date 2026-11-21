import { isStudySyncEnabled,studySync,importLocalProgress } from '../utils/study-sync.js';
import { StudyClock } from '../utils/study-clock.js';
import { getStudyOverview,saveStudySettings,startStudySession,tickStudySession } from '../api/study.api.js';

const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal=(name,detail)=>{try{const view=document.defaultView;if(view?.CustomEvent)document.dispatchEvent(new view.CustomEvent(`voz:${name}`,{detail}));}catch{/* optional */}};
const disclosure=(title)=>{const node=make('details');node.className='study-disclosure';node.append(make('summary',title));return node;};
const clockLabel=(seconds)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export async function initStudyTrackingPanel({materials=[],materialId=null}={}) {
  const panel=document.querySelector('[data-study-tracking-panel]');
  if(!panel||!isStudySyncEnabled()) return;
  panel.hidden=false;panel.replaceChildren();
  panel.append(make('h2','Tempo e progresso de estudo'),make('p','Inicie uma sessão para registrar tempo na conta. A contagem pausa ao sair desta aba. Minutos de estudo e trecho ouvido são indicadores diferentes.'));
  const timerArea=make('div');timerArea.className='study-timer-controls';
  const modeLabel=make('label','Tipo de sessão');const mode=make('select');
  for(const [value,text] of [['reading','Estudo livre'],['pomodoro','Foco de 25 minutos'],['break','Pausa de 5 minutos']])mode.append(new Option(text,value));
  modeLabel.append(mode);
  const timer=make('output','00:00');timer.setAttribute('aria-label','Tempo da sessão');timer.setAttribute('aria-live','off');
  const start=make('button','Iniciar / retomar');start.type='button';
  const pause=make('button','Pausar');pause.type='button';pause.disabled=true;
  const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let lastSessionMarker='';
  const clock=new StudyClock({api:{start:startStudySession,tick:tickStudySession},materialId,uuid:()=>crypto.randomUUID(),
    onChange:(state)=>{
      mode.value=state.mode;mode.disabled=state.running||state.busy;
      timer.textContent=clockLabel(state.mode==='reading'?state.elapsed:Math.ceil(state.remaining));
      start.disabled=state.running||state.busy;pause.disabled=!state.running||state.busy;
      if(status.textContent!==state.message)status.textContent=state.message;
      signal('study-clock',{mode:state.mode,elapsed:state.elapsed,remaining:state.remaining,running:state.running,busy:state.busy,session:state.session?{id:state.session.id}:null});
      const marker=state.session?`${state.session.id}:${state.session.last_sequence}`:'';
      if(marker!==lastSessionMarker){lastSessionMarker=marker;void refresh();}
    },
  });
  const notice=(error)=>{status.textContent=error.message||'Não foi possível confirmar a sessão.';};
  start.addEventListener('click',()=>{void clock.start(mode.value).catch(notice);});
  pause.addEventListener('click',()=>{void clock.pause().then(refresh).catch(notice);});
  timerArea.append(modeLabel,timer,start,pause);panel.append(timerArea,status);
  const syncStatus=make('p');syncStatus.setAttribute('role','status');syncStatus.setAttribute('aria-live','polite');
  const retry=make('button','Sincronizar agora');retry.type='button';
  retry.addEventListener('click',()=>{void studySync()?.flush(true);});
  const conflicts=make('div');conflicts.hidden=true;
  for(const [local,text] of [[false,'Usar versão da conta em conflitos'],[true,'Manter versão deste navegador em conflitos']]) {
    const button=make('button',text);button.type='button';button.addEventListener('click',()=>{
      if(!confirm(`${text}? A escolha será aplicada às aulas com conflito.`))return;
      button.disabled=true;void studySync().resolve(local).then(()=>{syncStatus.textContent='Conflitos resolvidos. Recarregue a aula para usar a posição escolhida.';})
        .catch((error)=>{syncStatus.textContent=error.message;}).finally(()=>{button.disabled=false;});
    });conflicts.append(button);
  }
  // Synchronization tools are rarely needed: folded away, and opened by themselves on a conflict.
  const syncTools=disclosure('Sincronização e andamento deste navegador');syncTools.classList.add('study-sync-tools');
  const showSync=(event)=>{syncStatus.textContent=event.detail.message;conflicts.hidden=!event.detail.conflicts;if(event.detail.conflicts)syncTools.open=true;};
  window.addEventListener('study-sync-status',showSync);
  syncTools.append(retry,conflicts);showSync({detail:studySync().state()});
  if(materials.length) {
    const importButton=make('button','Importar andamento local sem registro na conta');importButton.type='button';
    importButton.addEventListener('click',()=>{
      importButton.disabled=true;void importLocalProgress(materials).catch(notice).finally(()=>{importButton.disabled=false;});
    });syncTools.append(importButton);
  }
  const metrics=make('section');metrics.setAttribute('aria-label','Indicadores semanais');
  const settings=make('form');settings.className='study-settings';
  const goalLabel=make('label','Meta semanal em minutos (0 desativa)');const goal=make('input');goal.type='number';goal.min='0';goal.max='10080';goal.required=true;goal.step='1';goalLabel.append(goal);
  const zoneLabel=make('label','Fuso horário');const zone=make('input');zone.required=true;zone.maxLength=100;zoneLabel.append(zone);
  const save=make('button','Salvar meta e fuso');save.type='submit';
  const useZone=make('button','Usar fuso deste aparelho');useZone.type='button';useZone.addEventListener('click',()=>{zone.value=Intl.DateTimeFormat().resolvedOptions().timeZone;});
  settings.append(goalLabel,zoneLabel,useZone,save);
  let initial=true,refreshing=false,again=false;
  // A refresh asked for while one runs (e.g. after pausing or saving the goal) runs right after it.
  async function refresh() {
    if(refreshing){again=true;return;}refreshing=true;
    try {
      const data=await getStudyOverview();metrics.replaceChildren(make('h3',`Semana iniciada em ${data.weekStart} · ${data.timezone}`));
      const minutes=Math.floor(Number(data.weekSeconds)/60);
      metrics.append(make('p',`${minutes} min de estudo registrados · meta: ${data.goalMinutes?data.goalMinutes+' min':'desativada'} · ${data.completedMaterials} revisões marcadas como concluídas na conta`));
      const list=make('ul');list.className='study-day-list';
      const most=Math.max(1,...data.days.map((day)=>Number(day.seconds)||0));
      for(const day of data.days){
        const item=make('li'),label=make('span',`${new Date(day.date+'T00:00:00').toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'})}`),bar=make('span'),value=make('span',`${Math.floor(Number(day.seconds)/60)} min`);
        bar.className='study-day-bar';bar.setAttribute('aria-hidden','true');bar.style.setProperty('--fill',String(Math.round(((Number(day.seconds)||0)/most)*100)));
        item.append(label,bar,value);list.append(item);
      }
      metrics.append(list);
      signal('study-overview',data);
      if(initial){goal.value=data.goalMinutes;zone.value=data.timezone;initial=false;}
      if(data.activeSession&&!clock.session) {
        const close=make('button','Encerrar sessão ativa em outro aparelho ou aba');close.type='button';
        close.addEventListener('click',()=>{
          if(!confirm('Encerrar a sessão de estudo aberta em outro aparelho ou aba? O tempo já registrado é mantido.'))return;
          close.disabled=true;void tickStudySession(data.activeSession.id,{sequence:data.activeSession.last_sequence+1,active:false,close:true})
            .then(refresh).catch(notice).finally(()=>{close.disabled=false;});
        });metrics.append(close);
      }
    } catch(error){metrics.replaceChildren(make('p',error.message||'Indicadores indisponíveis.'));signal('study-overview',{error:error.message||'Indicadores indisponíveis.'});}
    finally{refreshing=false;if(again){again=false;void refresh();}}
  }
  settings.addEventListener('submit',(event)=>{
    event.preventDefault();if(!settings.reportValidity())return;save.disabled=true;
    void saveStudySettings({goalMinutes:Number(goal.value),timezone:zone.value.trim()}).then(()=>{status.textContent='Meta e fuso salvos na conta.';return refresh();})
      .catch(notice).finally(()=>{save.disabled=false;});
  });
  const reload=make('button','Atualizar indicadores');reload.type='button';reload.addEventListener('click',()=>{void refresh();});
  const goalTools=disclosure('Meta semanal e fuso horário');goalTools.append(settings);
  metrics.className='study-metrics';
  panel.append(metrics,reload,syncStatus,goalTools,syncTools);
  document.addEventListener('voz:tracking-command',(event)=>{
    const action=event.detail?.action;
    if(action==='start'&&!clock.running)void clock.start(mode.value).catch(notice);
    else if(action==='pause'&&clock.running)void clock.pause().then(refresh).catch(notice);
  });
  let pump;
  const startPump=()=>{clearInterval(pump);pump=setInterval(()=>{void clock.pump().catch(notice);},1000);};
  startPump();
  const hidden=()=>{if(clock.running&&document.visibilityState!=='visible')void clock.pause(false).catch(notice);};
  const blur=()=>{if(clock.running)void clock.pause(false).catch(notice);};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);
  window.addEventListener('pagehide',()=>{
    clearInterval(pump);if(clock.running)void clock.pause(false).catch(()=>{});
  });
  window.addEventListener('pageshow',(event)=>{if(event.persisted){startPump();void refresh();}});
  await refresh();
}
