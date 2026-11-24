import { isStudySyncEnabled,studySync,importLocalProgress } from '../utils/study-sync.js';
import { getFocusSession } from '../utils/focus-host.js';
import { getStudyOverview,saveStudySettings,tickStudySession } from '../api/study.api.js';
import { toast } from '../utils/toast.js';

// Focus timer and weekly study time. The timer is the account's single focus session
// (utils/focus-session.js); since 3.6 it is shown and run only on Focar (`timer: true`). Planejar
// uses the week alone (`timer: false`) and links to Focar; other pages show a top-bar indicator.
// One card starts and pauses it with a single button;
// the week card shows minutes per day against the goal. Goal, time zone and synchronization live
// in a settings dialog so they never compete with studying. Short feedback goes to toasts.
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal=(name,detail)=>{try{const view=document.defaultView;if(view?.CustomEvent)document.dispatchEvent(new view.CustomEvent(`voz:${name}`,{detail}));}catch{/* optional */}};
// Toasts when available (the panel test evaluates this file without the toast module).
const say=(text,type='info')=>{if(text&&typeof toast==='function')toast(text,{type});};
const clockLabel=(value)=>{const seconds=Math.max(0,Math.round(value||0));const h=Math.floor(seconds/3600);return `${h?`${h}:`:''}${String(Math.floor((seconds%3600)/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};
const MODES=[['pomodoro','Foco','Foco'],['short','Pausa curta','Pausa'],['long','Pausa longa','Longa'],['reading','Estudo livre','Livre']];
const MODE_NAMES={pomodoro:'Foco',short:'Pausa',long:'Pausa longa',reading:'Estudo livre'};
const NINO_FOCUS='/assets/brand/avatars/reading.png?v=nino-20261118';
const NINO_REST='/assets/brand/avatars/rest.png?v=nino-20261118';
const SVG='http://www.w3.org/2000/svg';
const locale=()=>globalThis.VOZ_LOCALE||'pt-BR';

export async function initStudyTrackingPanel({materials=[],materialId=null,timer:withTimer=true}={}) {
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
  const cycles=make('p',null,'focus-cycles');
  const controls=make('div',null,'study-timer-controls focus-controls');
  const primary=make('button','Iniciar foco','primary-action focus-primary');primary.type='button';
  const stopButton=make('button','Encerrar bloco','text-action focus-stop');stopButton.type='button';stopButton.hidden=true;
  controls.append(primary,stopButton);
  // Only says something when it matters (paused, stopped while away, an error); how the timer
  // works between pages is explained in Ajuda.
  const hint=make('p','','focus-hint');hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
  // The lesson the next block counts for (opened before coming to Focar).
  const lessonLine=make('p',null,'focus-lesson');lessonLine.hidden=true;
  focus.append(heading,modes,dial,lessonLine,cycles,controls,hint);

  // ---------- Week card -------------------------------------------------------------------
  const week=make('section',null,'week-card');week.setAttribute('aria-labelledby','week-heading');
  const weekHead=make('div',null,'week-head');
  const weekTitle=make('h2','Sua semana');weekTitle.id='week-heading';
  const gear=make('button',null,'icon-action week-settings');gear.type='button';gear.setAttribute('aria-haspopup','dialog');
  gear.setAttribute('aria-label','Ajustes do foco, meta e sincronização');gear.title='Ajustes do foco, meta e sincronização';
  // Sprite icon written out (tests evaluate this file without imports); name from utils/icons.js.
  gear.innerHTML='<svg class="ui-icon" width="20" height="20" focusable="false" aria-hidden="true" data-icon="settings"><use href="/assets/icons/sprite.svg#i-settings"/></svg>';
  weekHead.append(weekTitle,gear);
  const metrics=make('div',null,'study-metrics');metrics.setAttribute('aria-live','polite');
  week.append(weekHead,metrics);

  // ---------- Settings dialog (goal, time zone, synchronization) ---------------------------
  const dialog=make('dialog',null,'settings-dialog app-dialog focus-settings-dialog');dialog.setAttribute('aria-labelledby','focus-settings-title');
  const dialogHead=make('div',null,'focus-settings-head');
  const dialogTitle=make('h2','Ajustes do foco');dialogTitle.id='focus-settings-title';
  const close=make('button','×','dialog-close');close.type='button';close.setAttribute('aria-label','Fechar');close.addEventListener('click',()=>dialog.close());
  dialogHead.append(dialogTitle,close);
  const settings=make('form',null,'study-settings');
  const goalLabel=make('label','Meta semanal em minutos (0 desativa)');const goal=make('input');goal.type='number';goal.min='0';goal.max='10080';goal.required=true;goal.step='1';goalLabel.append(goal);
  const zoneLabel=make('label','Fuso horário');const zone=make('input');zone.required=true;zone.maxLength=100;zoneLabel.append(zone);
  const useZone=make('button','Usar fuso deste aparelho','text-action');useZone.type='button';useZone.addEventListener('click',()=>{zone.value=Intl.DateTimeFormat().resolvedOptions().timeZone;});
  const save=make('button','Salvar ajustes','primary-action');save.type='submit';
  const settingsActions=make('div',null,'form-actions');settingsActions.append(useZone,save);
  // Block durations belong to this account's focus session (kept in this browser).
  const blocks=make('fieldset',null,'focus-blocks');blocks.append(make('legend','Blocos'));
  const durations={};
  for(const [name,label,min,max] of [['focus','Foco (min)',5,120],['short','Pausa curta (min)',1,30],['long','Pausa longa (min)',5,60],['longEvery','Pausa longa a cada (focos)',2,8]]){
    const field=make('label',label);const input=make('input');input.type='number';input.min=String(min);input.max=String(max);input.step='1';input.required=true;field.append(input);blocks.append(field);durations[name]=input;
  }
  const autoLabel=make('label',null,'focus-check');const autoStart=make('input');autoStart.type='checkbox';autoLabel.append(autoStart,make('span','Começar o próximo bloco sozinho'));
  const soundLabel=make('label',null,'focus-check');const sound=make('input');sound.type='checkbox';soundLabel.append(sound,make('span','Som ao terminar um bloco'));
  const notifyLabel=make('label',null,'focus-check');const notify=make('input');notify.type='checkbox';notifyLabel.append(notify,make('span','Notificação do sistema quando a página estiver em segundo plano'));
  notifyLabel.hidden=!('Notification' in (document.defaultView||{}));
  // Asking for permission happens only when the student turns the option on.
  notify.addEventListener('change',()=>{const N=document.defaultView?.Notification;if(notify.checked&&N&&N.permission==='default')void N.requestPermission().then((result)=>{if(result!=='granted')notify.checked=false;});else if(notify.checked&&N?.permission==='denied'){notify.checked=false;say('O navegador bloqueou as notificações deste site. Libere nas configurações do navegador.','error');}});
  blocks.append(autoLabel,soundLabel,notifyLabel);
  settings.append(blocks,goalLabel,zoneLabel,settingsActions);
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
  gear.addEventListener('click',()=>{fillDurations();dialog.showModal();durations.focus.focus();});
  // A conflict needs a decision: the dialog opens by itself.
  const showSync=(event)=>{syncStatus.textContent=event.detail.message;conflicts.hidden=!event.detail.conflicts;
    week.classList.toggle('has-conflict',Boolean(event.detail.conflicts));
    if(event.detail.conflicts&&!dialog.open&&typeof dialog.showModal==='function')dialog.showModal();};
  window.addEventListener('study-sync-status',showSync);showSync({detail:studySync().state()});

  let focusLink=null;
  const layout=make('div',null,'focus-layout');
  if(withTimer)layout.append(focus,week);
  else{
    // Planejar: the week and its analysis; the timer itself is on Focar.
    layout.classList.add('is-week-only');
    const open=make('a','Iniciar foco','secondary-action week-focus-link');open.href='./focar.html?iniciar=foco';open.dataset.focusLink='';
    focusLink=open;
    weekHead.insertBefore(open,gear);
    layout.append(week);
  }
  panel.append(layout,dialog);

  // ---------- Clock: a view of the shared focus session -------------------------------------
  const session=await getFocusSession();
  if(materialId)session.setMaterial(materialId);
  let lastServer='',lastStatus='';
  const fillDurations=()=>{const current=session.state().settings;for(const name of Object.keys(durations))durations[name].value=String(current[name]);autoStart.checked=current.autoStart;sound.checked=current.sound;notify.checked=Boolean(current.notify);};
  fillDurations();
  function render(state){
    if(focusLink){const active=state.status!=='idle';focusLink.textContent=active?'Abrir Focar':'Iniciar foco';focusLink.href=active?'./focar.html':'./focar.html?iniciar=foco';}
    lessonLine.hidden=!(state.materialTitle&&(state.mode==='pomodoro'||state.mode==='reading'));
    lessonLine.textContent=lessonLine.hidden?'':`Aula: ${state.materialTitle}`;
    for(const [value,button] of modeButtons){const on=value===state.mode;button.setAttribute('aria-checked',String(on));button.tabIndex=on?0:-1;button.disabled=state.status==='running'||state.busy;}
    timer.textContent=clockLabel(state.remaining??state.elapsed);
    const progress=state.planned===null?((state.elapsed%3600)/3600):(1-(state.remaining??0)/(state.planned||1));
    panel.style.setProperty('--focus-progress',String(Math.max(0,Math.min(1,progress))));
    caption.textContent=state.mode==='reading'?'Estudo livre':`${MODE_NAMES[state.mode]} de ${Math.round((state.planned||0)/60)} minutos`;
    panel.dataset.focusState=state.busy?'busy':state.status==='running'?'running':'idle';panel.dataset.focusMode=state.mode;
    nino.src=state.mode==='pomodoro'||state.mode==='reading'?NINO_FOCUS:NINO_REST;
    const running=state.status==='running';
    primary.disabled=state.busy;
    primary.textContent=running?'Pausar':state.status==='paused'?'Retomar':state.mode==='reading'?'Iniciar estudo livre':state.mode==='pomodoro'?'Iniciar foco':'Iniciar pausa';
    primary.setAttribute('aria-pressed',String(running));
    stopButton.hidden=state.status==='idle';
    // Cycle dots: focus blocks done since the last long break.
    cycles.replaceChildren();
    const every=state.settings.longEvery,done=state.cycle%every;
    for(let i=0;i<every;i+=1){const dot=make('span',null,'focus-cycle'+(i<done?' is-done':''));dot.setAttribute('aria-hidden','true');cycles.append(dot);}
    cycles.append(make('span',state.completedToday?`${state.completedToday} ${state.completedToday===1?'foco concluído hoje':'focos concluídos hoje'}`:'Nenhum foco concluído ainda','focus-cycles-text'));
    hint.textContent=state.error||(state.notice?.kind==='stopped_away'?'O cronômetro parou porque nenhuma página ficou aberta e visível.':state.status==='paused'?'Bloco pausado. Retome quando quiser.':'');
    signal('study-clock',{mode:state.mode,elapsed:state.elapsed,remaining:state.remaining,running,busy:state.busy,session:state.server?{id:state.server.id}:null});
    // Credited time changes when a server session closes: refresh the week.
    const marker=state.server?.id||'';
    if((marker!==lastServer&&!marker)||(lastStatus==='running'&&state.status!=='running'))void refresh();
    lastServer=marker;lastStatus=state.status;
  }
  function notice(error){const text=error?.message||'Não foi possível confirmar a sessão.';hint.textContent=text;say(text,'error');}
  const select=(value)=>{const state=session.state();if(state.status==='running'||state.busy)return;void session.setMode(value);};
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
    const state=session.state();
    if(state.status==='running')void session.pause().catch(notice);
    else void session.start({materialId:materialId??undefined}).catch(notice);
  });
  stopButton.addEventListener('click',()=>void session.stop().catch(notice));
  if(withTimer)document.addEventListener('voz:focus-notice',(event)=>{
    const kind=event.detail?.kind;
    if(kind==='pomodoro_done')say('Foco concluído! Hora de uma pausa.','success');
    else if(kind==='short_done'||kind==='long_done')say('Pausa concluída. Pronto para outro foco?','info');
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
      if(data.activeSession&&data.activeSession.id!==session.state().server?.id) {
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
    session.updateSettings({focus:durations.focus.value,short:durations.short.value,long:durations.long.value,longEvery:durations.longEvery.value,autoStart:autoStart.checked,sound:sound.checked,notify:notify.checked});
    void saveStudySettings({goalMinutes:Number(goal.value),timezone:zone.value.trim()}).then(()=>{say('Ajustes salvos.','success');if(dialog.open)dialog.close();return refresh();})
      .catch(notice).finally(()=>{save.disabled=false;});
  });
  session.subscribe(render);
  window.addEventListener('pageshow',(event)=>{if(event.persisted)void refresh();});
  await refresh();
}
