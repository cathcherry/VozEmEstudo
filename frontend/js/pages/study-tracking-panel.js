import { isStudySyncEnabled,studySync,importLocalProgress } from '../utils/study-sync.js';
import { StudyClock } from '../utils/study-clock.js';
import { getStudyOverview,saveStudySettings,startStudySession,tickStudySession } from '../api/study.api.js';
import { toast } from '../utils/toast.js';

// Focus timer and weekly study time. One card starts and pauses a session with a single button;
// the week card shows minutes per day against the goal. Goal, time zone and synchronization live
// in a settings dialog so they never compete with studying. Short feedback goes to toasts.
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal=(name,detail)=>{try{const view=document.defaultView;if(view?.CustomEvent)document.dispatchEvent(new view.CustomEvent(`voz:${name}`,{detail}));}catch{/* optional */}};
// Toasts when available (the panel test evaluates this file without the toast module).
const say=(text,type='info')=>{if(text&&typeof toast==='function')toast(text,{type});};
const clockLabel=(seconds)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const MODES=[['pomodoro','Foco de 25 minutos','Foco'],['break','Pausa de 5 minutos','Pausa'],['reading','Estudo livre','Livre']];
const NINO_FOCUS='/assets/brand/avatars/reading.png?v=nino-20261118';
const NINO_REST='/assets/brand/avatars/rest.png?v=nino-20261118';
const SVG='http://www.w3.org/2000/svg';
const locale=()=>globalThis.VOZ_LOCALE||'pt-BR';

export async function initStudyTrackingPanel({materials=[],materialId=null}={}) {
  const panel=document.querySelector('[data-study-tracking-panel]');
  if(!panel||!isStudySyncEnabled()) return;
  panel.hidden=false;panel.replaceChildren();panel.classList.add('focus-panel');

  // ---------- Focus card ------------------------------------------------------------------
  const focus=make('section',null,'focus-card');focus.setAttribute('aria-labelledby','focus-heading');
  const heading=make('h2','Sessão de foco');heading.id='focus-heading';heading.className='focus-heading';
  const modes=make('div',null,'focus-modes');modes.setAttribute('role','radiogroup');modes.setAttribute('aria-label','Tipo de sessão');
  const modeButtons=new Map();
  for(const [value,label,short] of MODES){
    const button=make('button',null,'focus-mode');button.type='button';button.dataset.mode=value;
    button.setAttribute('role','radio');button.setAttribute('aria-label',label);
    button.append(make('span',short,'focus-mode-short'),make('span',label,'focus-mode-long'));
    modes.append(button);modeButtons.set(value,button);
  }
  // Ring: progress of the current session; Nino walks along it.
  const dial=make('div',null,'focus-dial');
  const svg=document.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 120 120');svg.setAttribute('aria-hidden','true');svg.classList.add('focus-ring');
  for(const name of ['focus-ring-track','focus-ring-fill']){const circle=document.createElementNS(SVG,'circle');circle.setAttribute('cx','60');circle.setAttribute('cy','60');circle.setAttribute('r','54');circle.setAttribute('pathLength','100');circle.classList.add(name);svg.append(circle);}
  const walker=make('span',null,'focus-walker');walker.setAttribute('aria-hidden','true');
  const nino=make('img',null,'focus-nino');nino.alt='';nino.width=44;nino.height=44;nino.src=NINO_FOCUS;walker.append(nino);
  const timer=make('output','25:00','focus-time');timer.setAttribute('aria-label','Tempo da sessão');timer.setAttribute('aria-live','off');
  const caption=make('span','Foco de 25 minutos','focus-caption');
  const face=make('div',null,'focus-face');face.append(timer,caption);
  dial.append(svg,walker,face);
  const cycles=make('p',null,'focus-cycles');cycles.setAttribute('aria-label','Focos concluídos nesta visita');
  const controls=make('div',null,'study-timer-controls focus-controls');
  const primary=make('button','Iniciar foco','primary-action focus-primary');primary.type='button';
  controls.append(primary);
  const hint=make('p','Sair desta aba pausa a contagem; nada se perde.','focus-hint');hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
  focus.append(heading,modes,dial,cycles,controls,hint);

  // ---------- Week card -------------------------------------------------------------------
  const week=make('section',null,'week-card');week.setAttribute('aria-labelledby','week-heading');
  const weekHead=make('div',null,'week-head');
  const weekTitle=make('h2','Sua semana');weekTitle.id='week-heading';
  const gear=make('button',null,'icon-action week-settings');gear.type='button';gear.setAttribute('aria-haspopup','dialog');
  gear.setAttribute('aria-label','Ajustar meta, fuso e sincronização');gear.title='Ajustar meta, fuso e sincronização';
  gear.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  weekHead.append(weekTitle,gear);
  const metrics=make('div',null,'study-metrics');metrics.setAttribute('aria-live','polite');
  week.append(weekHead,metrics);

  // ---------- Settings dialog (goal, time zone, synchronization) ---------------------------
  const dialog=make('dialog',null,'settings-dialog app-dialog focus-settings-dialog');dialog.setAttribute('aria-labelledby','focus-settings-title');
  const dialogHead=make('div',null,'focus-settings-head');
  const dialogTitle=make('h2','Meta e sincronização');dialogTitle.id='focus-settings-title';
  const close=make('button','×','dialog-close');close.type='button';close.setAttribute('aria-label','Fechar');close.addEventListener('click',()=>dialog.close());
  dialogHead.append(dialogTitle,close);
  const settings=make('form',null,'study-settings');
  const goalLabel=make('label','Meta semanal em minutos (0 desativa)');const goal=make('input');goal.type='number';goal.min='0';goal.max='10080';goal.required=true;goal.step='1';goalLabel.append(goal);
  const zoneLabel=make('label','Fuso horário');const zone=make('input');zone.required=true;zone.maxLength=100;zoneLabel.append(zone);
  const useZone=make('button','Usar fuso deste aparelho','text-action');useZone.type='button';useZone.addEventListener('click',()=>{zone.value=Intl.DateTimeFormat().resolvedOptions().timeZone;});
  const save=make('button','Salvar meta e fuso','primary-action');save.type='submit';
  const settingsActions=make('div',null,'form-actions');settingsActions.append(useZone,save);
  settings.append(goalLabel,zoneLabel,settingsActions);
  const syncSection=make('section',null,'focus-sync');syncSection.append(make('h3','Sincronização deste navegador'));
  const syncStatus=make('p',null,'focus-sync-status');syncStatus.setAttribute('role','status');syncStatus.setAttribute('aria-live','polite');
  const syncActions=make('div',null,'focus-sync-actions');
  const retry=make('button','Sincronizar agora','secondary-action');retry.type='button';
  retry.addEventListener('click',()=>{void studySync()?.flush(true);});
  syncActions.append(retry);
  const conflicts=make('div',null,'focus-sync-actions');conflicts.hidden=true;
  for(const [local,text] of [[false,'Usar versão da conta em conflitos'],[true,'Manter versão deste navegador em conflitos']]) {
    const button=make('button',text,'secondary-action');button.type='button';button.addEventListener('click',()=>{
      if(!confirm(`${text}? A escolha será aplicada às aulas com conflito.`))return;
      button.disabled=true;void studySync().resolve(local).then(()=>{say('Conflitos resolvidos. Recarregue a aula para usar a posição escolhida.','success');})
        .catch((error)=>{say(error.message,'error');}).finally(()=>{button.disabled=false;});
    });conflicts.append(button);
  }
  if(materials.length) {
    const importButton=make('button','Importar andamento local sem registro na conta','text-action');importButton.type='button';
    importButton.addEventListener('click',()=>{
      importButton.disabled=true;void importLocalProgress(materials).catch(notice).finally(()=>{importButton.disabled=false;});
    });syncActions.append(importButton);
  }
  syncSection.append(syncStatus,syncActions,conflicts);
  dialog.append(dialogHead,settings,syncSection);
  dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>gear.focus());
  gear.addEventListener('click',()=>{dialog.showModal();goal.focus();});
  // A conflict needs a decision: the dialog opens by itself.
  const showSync=(event)=>{syncStatus.textContent=event.detail.message;conflicts.hidden=!event.detail.conflicts;
    week.classList.toggle('has-conflict',Boolean(event.detail.conflicts));
    if(event.detail.conflicts&&!dialog.open&&typeof dialog.showModal==='function')dialog.showModal();};
  window.addEventListener('study-sync-status',showSync);showSync({detail:studySync().state()});

  const layout=make('div',null,'focus-layout');layout.append(focus,week);
  panel.append(layout,dialog);

  // ---------- Clock -----------------------------------------------------------------------
  let selected='pomodoro',completed=0,lastMode=null,lastSessionMarker='',lastMessage='';
  const renderCycles=()=>{cycles.replaceChildren();for(let i=0;i<4;i+=1){const dot=make('span',null,'focus-cycle'+(i<completed%4||(completed&&completed%4===0)?' is-done':''));dot.setAttribute('aria-hidden','true');cycles.append(dot);}
    cycles.append(make('span',completed?`${completed} ${completed===1?'foco concluído':'focos concluídos'}`:'Nenhum foco concluído ainda','focus-cycles-text'));};
  const clock=new StudyClock({api:{start:startStudySession,tick:tickStudySession},materialId,uuid:()=>crypto.randomUUID(),
    onChange:(state)=>{
      // A finished focus switches the clock to a break: count it.
      if(lastMode==='pomodoro'&&state.mode==='break'&&!state.running){completed+=1;renderCycles();say('Foco concluído! Que tal uma pausa de 5 minutos?','success');}
      // Follow the clock when it changes mode by itself (focus → break → focus) or is running.
      if(lastMode!==null&&state.mode!==lastMode)selected=state.mode;
      if(state.running)selected=state.mode;
      lastMode=state.mode;
      for(const [value,button] of modeButtons){const on=value===(state.running?state.mode:selected);button.setAttribute('aria-checked',String(on));button.tabIndex=on?0:-1;button.disabled=state.running||state.busy;}
      const current=state.running?state.mode:selected;
      const seconds=current===state.mode?(current==='reading'?state.elapsed:Math.ceil(state.remaining)):(current==='break'?300:current==='pomodoro'?1500:0);
      timer.textContent=clockLabel(seconds);
      const total=current==='break'?300:1500;
      const progress=current==='reading'?((state.elapsed%3600)/3600):(1-(current===state.mode?state.remaining:total)/total);
      panel.style.setProperty('--focus-progress',String(Math.max(0,Math.min(1,progress))));
      caption.textContent=MODES.find(([value])=>value===current)[1];
      panel.dataset.focusState=state.running?'running':state.busy?'busy':'idle';panel.dataset.focusMode=current;
      nino.src=current==='break'?NINO_REST:NINO_FOCUS;
      primary.disabled=state.busy;
      primary.textContent=state.running?'Pausar':(state.elapsed>0||(current!=='reading'&&state.remaining<total))&&current===state.mode?'Retomar':current==='break'?'Iniciar pausa':current==='reading'?'Iniciar estudo livre':'Iniciar foco';
      primary.setAttribute('aria-pressed',String(state.running));
      // Messages that describe the state stay in the card; failures also become a toast.
      if(state.message&&state.message!==lastMessage){lastMessage=state.message;hint.textContent=state.message;}
      signal('study-clock',{mode:state.mode,elapsed:state.elapsed,remaining:state.remaining,running:state.running,busy:state.busy,session:state.session?{id:state.session.id}:null});
      const marker=state.session?`${state.session.id}:${state.session.last_sequence}`:'';
      if(marker!==lastSessionMarker){lastSessionMarker=marker;void refresh();}
    },
  });
  function notice(error){const text=error?.message||'Não foi possível confirmar a sessão.';hint.textContent=text;say(text,'error');}
  const select=(value)=>{if(clock.running||clock.busy)return;selected=value;clock.emit(clock.message);};
  for(const [value,button] of modeButtons){
    button.addEventListener('click',()=>select(value));
    button.addEventListener('keydown',(event)=>{
      const order=MODES.map(([mode])=>mode);const index=order.indexOf(value);
      const next={ArrowRight:index+1,ArrowDown:index+1,ArrowLeft:index-1,ArrowUp:index-1}[event.key];
      if(next===undefined)return;event.preventDefault();
      const target=order[(next+order.length)%order.length];select(target);modeButtons.get(target).focus();
    });
  }
  primary.addEventListener('click',()=>{
    if(clock.running)void clock.pause().then(refresh).catch(notice);
    else void clock.start(selected).catch(notice);
  });

  // ---------- Week metrics ----------------------------------------------------------------
  let initial=true,refreshing=false,again=false;
  // A refresh asked for while one runs (e.g. after pausing or saving the goal) runs right after it.
  async function refresh() {
    if(refreshing){again=true;return;}refreshing=true;
    try {
      const data=await getStudyOverview();
      const minutes=Math.floor(Number(data.weekSeconds)/60);
      const goalMinutes=Number(data.goalMinutes)||0;
      metrics.replaceChildren();
      const total=make('p',null,'week-total');
      total.append(make('strong',String(minutes)),make('span',goalMinutes?` de ${goalMinutes} min de estudo nesta semana`:' min de estudo nesta semana'));
      metrics.append(total);
      if(goalMinutes){
        const bar=make('progress',null,'week-goal');bar.max=goalMinutes;bar.value=Math.min(minutes,goalMinutes);
        bar.setAttribute('aria-label',`Meta semanal: ${minutes} de ${goalMinutes} minutos`);metrics.append(bar);
        if(minutes>=goalMinutes)metrics.append(make('p','Meta da semana alcançada. 🎉','week-goal-done'));
      }
      const studiedDays=data.days.filter((day)=>Number(day.seconds)>0).length;
      const most=Math.max(1,...data.days.map((day)=>Number(day.seconds)||0));
      const list=make('ol',null,'study-day-list week-columns');list.setAttribute('aria-label','Minutos por dia');
      const today=new Date();const todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      for(const day of data.days){
        const date=new Date(day.date+'T00:00:00');const value=Math.floor(Number(day.seconds)/60);
        const item=make('li',null,day.date===todayKey?'is-today':'');
        item.setAttribute('aria-label',`${date.toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'numeric'})}: ${value} min`);
        const column=make('span',null,'study-day-bar');column.setAttribute('aria-hidden','true');column.style.setProperty('--fill',String(Math.round(((Number(day.seconds)||0)/most)*100)));
        if(!value)column.classList.add('is-empty');
        item.append(make('span',value?String(value):'','week-value'),column,make('span',date.toLocaleDateString(locale(),{weekday:'short'}).replace(/\.$/u,''),'week-day'));
        list.append(item);
      }
      metrics.append(list);
      metrics.append(make('p',`${studiedDays} de 7 dias com estudo · ${data.completedMaterials} ${Number(data.completedMaterials)===1?'aula concluída':'aulas concluídas'}`,'week-note'));
      signal('study-overview',data);
      if(initial){goal.value=data.goalMinutes;zone.value=data.timezone;initial=false;}
      if(data.activeSession&&!clock.session) {
        const box=make('div',null,'week-alert');
        box.append(make('p','Há uma sessão aberta em outro aparelho ou aba.'));
        const end=make('button','Encerrar sessão ativa em outro aparelho ou aba','secondary-action');end.type='button';
        end.addEventListener('click',()=>{
          if(!confirm('Encerrar a sessão de estudo aberta em outro aparelho ou aba? O tempo já registrado é mantido.'))return;
          end.disabled=true;void tickStudySession(data.activeSession.id,{sequence:data.activeSession.last_sequence+1,active:false,close:true})
            .then(refresh).catch(notice).finally(()=>{end.disabled=false;});
        });box.append(end);metrics.append(box);
      }
    } catch(error){metrics.replaceChildren(make('p',error.message||'Indicadores indisponíveis.','week-note'));signal('study-overview',{error:error.message||'Indicadores indisponíveis.'});}
    finally{refreshing=false;if(again){again=false;void refresh();}}
  }
  settings.addEventListener('submit',(event)=>{
    event.preventDefault();if(!settings.reportValidity())return;save.disabled=true;
    void saveStudySettings({goalMinutes:Number(goal.value),timezone:zone.value.trim()}).then(()=>{say('Meta e fuso salvos na conta.','success');if(dialog.open)dialog.close();return refresh();})
      .catch(notice).finally(()=>{save.disabled=false;});
  });
  document.addEventListener('voz:tracking-command',(event)=>{
    const action=event.detail?.action;
    if(action==='start'&&!clock.running)void clock.start(selected).catch(notice);
    else if(action==='pause'&&clock.running)void clock.pause().then(refresh).catch(notice);
  });
  renderCycles();clock.emit('Sair desta aba pausa a contagem; nada se perde.');
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
