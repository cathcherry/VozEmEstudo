import { ninoNote } from '../utils/material-ui.js';
import { listCalendar,saveCalendarEvent } from '../api/learning-tools.api.js';
import { monthRange,localDay,itemOnDay,calendarIcs } from '../utils/calendar-export.js';
import { downloadText } from '../utils/study-export.js';
import { pendingMutation } from '../utils/pending-mutation.js';
import { toast } from '../utils/toast.js';
import { renderWeek,weekStartOf,weekRange,moveEvent,addDays } from './calendar-week.js';
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal=(name,detail)=>{try{const view=document.defaultView;if(view?.CustomEvent)document.dispatchEvent(new view.CustomEvent(`voz:${name}`,{detail}));}catch{/* optional */}};
const localInput=(date)=>`${localDay(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
function utcInput(value){const date=new Date(value);if(!Number.isFinite(date.getTime())||localInput(date)!==value)throw new Error('Confira o horário no fuso deste aparelho.');return date.toISOString();}
export async function initCalendarPanel({panel,materials=[]}){
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale=()=>globalThis.VOZ_LOCALE||'pt-BR';
  panel.hidden=false;panel.replaceChildren(make('h2','Calendário de estudos'));
  // Header: month navigation on the left, the one main action on the right.
  const controls=make('div');controls.className='calendar-toolbar';
  const nav=make('div');nav.className='calendar-month-nav';
  const prev=make('button','‹'),next=make('button','›'),today=make('button','Hoje');prev.type=next.type=today.type='button';
  prev.className=next.className='calendar-step';prev.setAttribute('aria-label','Mês anterior');next.setAttribute('aria-label','Próximo mês');today.className='text-action';
  const title=make('h3');title.className='calendar-month-title';title.setAttribute('aria-live','polite');
  // The month input keeps the state (and lets the keyboard type a month); the arrows move it.
  const monthLabel=make('label'),month=make('input');monthLabel.className='sr-only';monthLabel.append('Mês',month);month.type='month';month.min='1970-01';month.max='2100-12';month.value=localDay(new Date()).slice(0,7);
  nav.append(prev,title,next,today,monthLabel);
  const actions=make('div');actions.className='calendar-actions';
  const composeButton=make('button','Agendar estudo'),exportButton=make('button','Baixar calendário ICS');composeButton.type=exportButton.type='button';
  composeButton.className='primary-action calendar-compose-button';composeButton.setAttribute('aria-haspopup','dialog');exportButton.className='secondary-action';
  exportButton.title='Baixa um arquivo .ics do mês. Não envia convites nem altera outros calendários.';
  // Month or week view (remembered on this device only).
  const views=make('div');views.className='calendar-views';views.setAttribute('role','group');views.setAttribute('aria-label','Visualização');
  const monthView=make('button','Mês'),weekView=make('button','Semana');monthView.type=weekView.type='button';monthView.className=weekView.className='calendar-view';views.append(monthView,weekView);
  let view='month';try{if(localStorage.getItem('voz-calendar-view')==='week')view='week';}catch{/* storage blocked */}
  let weekStart=weekStartOf(new Date());
  actions.append(views,exportButton,composeButton);controls.append(nav,actions);
  // Short confirmations and errors in a small banner that clears itself.
  const status=make('p');status.className='calendar-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let statusTimer;const say=(text,{keep=false}={})=>{clearTimeout(statusTimer);status.textContent=text;if(text&&!keep)statusTimer=setTimeout(()=>{status.textContent='';},7000);};
  const layout=make('div');layout.className='calendar-layout';
  const monthBox=make('div');monthBox.className='calendar-month';
  const grid=make('div');grid.className='study-calendar-grid';grid.setAttribute('role','group');grid.setAttribute('aria-label','Dias do mês');
  // Legend for the day marks (shape and words, not colour alone) and the time zone.
  const note=make('div');note.className='calendar-note';
  const legend=make('p');legend.className='calendar-legend';
  for(const [kind,text] of [['is-event','Estudo agendado'],['is-task','Prazo de tarefa']]){const entry=make('span'),mark=make('i');mark.className=kind;mark.setAttribute('aria-hidden','true');entry.append(mark,text);legend.append(entry);}
  note.append(legend,make('p',`Horários no fuso deste aparelho (${zone}).`));
  monthBox.append(grid,note);
  const agenda=make('div');agenda.className='calendar-agenda';
  layout.append(monthBox,agenda);
  const weekBox=make('div');weekBox.className='calendar-week-box';weekBox.hidden=true;
  panel.append(controls,status,layout,weekBox);
  // Scheduling happens in a dialog opened by "Agendar estudo", a day's entry or a task.
  const compose=make('dialog');compose.className='app-dialog calendar-compose';compose.setAttribute('aria-labelledby','calendar-compose-title');
  const composeTitle=make('h2','Agendar estudo');composeTitle.id='calendar-compose-title';
  const close=make('button','×');close.type='button';close.className='dialog-close calendar-compose-close';close.setAttribute('aria-label','Fechar');
  compose.append(close,composeTitle);
  const form=make('form');form.className='calendar-event-form';
  // What, when (day, start, duration), the lesson it is for and notes; a live summary says the
  // resulting slot in words before saving.
  const fields={};
  const titleLabel=make('label','O que você vai estudar?');titleLabel.className='calendar-field-wide';fields.title=make('input');fields.title.type='text';fields.title.required=true;fields.title.maxLength=200;fields.title.autocomplete='off';fields.title.placeholder='Ex.: Revisar os slides do TCC';titleLabel.append(fields.title);
  const whenSet=make('fieldset');whenSet.className='calendar-when calendar-field-wide';whenSet.append(make('legend','Quando'));
  const whenRow=make('div');whenRow.className='calendar-when-row';
  for(const [name,label,type] of [['date','Dia','date'],['time','Horário','time']]){const wrap=make('label',label),input=make('input');input.type=type;input.required=true;wrap.append(input);whenRow.append(wrap);fields[name]=input;}
  const durationLabel=make('label','Duração'),duration=make('select');
  const DURATIONS=[[25,'25 min'],[30,'30 min'],[45,'45 min'],[60,'1 h'],[90,'1 h 30 min'],[120,'2 h'],[180,'3 h']];
  const durationText=(minutes)=>{const h=Math.floor(minutes/60),m=minutes%60;return h&&m?`${h} h ${m} min`:h?`${h} h`:`${m} min`;};
  const setDurations=(extra)=>{duration.replaceChildren();const list=[...DURATIONS];if(extra&&!list.some(([v])=>v===extra))list.push([extra,durationText(extra)]);list.sort((a,b)=>a[0]-b[0]);for(const [value,label] of list)duration.append(new Option(label,String(value)));};
  setDurations();durationLabel.append(duration);whenRow.append(durationLabel);fields.duration=duration;
  const summary=make('p');summary.className='calendar-when-summary';summary.setAttribute('aria-live','polite');
  whenSet.append(whenRow,summary);
  const materialLabel=make('label','Aula vinculada (opcional)'),material=make('select');materialLabel.className='calendar-field-wide';material.append(new Option('Sem aula',''));for(const item of materials)material.append(new Option(item.title,item.id));materialLabel.append(material);
  const descLabel=make('label','Anotações (opcional)'),description=make('textarea');descLabel.className='calendar-field-wide';description.maxLength=3000;description.rows=2;description.placeholder='O que revisar, material para levar…';descLabel.append(description);
  form.append(titleLabel,whenSet,materialLabel,descLabel);
  const taskLabel=make('p'),unlink=make('button','Desvincular tarefa');taskLabel.className='calendar-task-link';unlink.type='button';unlink.className='text-action';unlink.hidden=true;
  const zoneHint=make('p',`Horários no fuso deste aparelho (${zone}).`);zoneHint.className='calendar-field-wide app-dialog-hint';
  const formError=make('p');formError.className='calendar-form-error calendar-field-wide';formError.setAttribute('role','alert');
  const submit=make('button','Agendar'),cancel=make('button','Cancelar');submit.type='submit';cancel.type='button';submit.className='primary-action';cancel.className='secondary-action';
  const formActions=make('div');formActions.className='form-actions calendar-field-wide';formActions.append(cancel,submit);
  form.append(taskLabel,unlink,zoneHint,formError,formActions);compose.append(form);panel.append(compose);
  const startValue=()=>`${fields.date.value}T${fields.time.value}`;
  const durationMinutes=()=>Number(duration.value)||60;
  function setWhen(start,end){fields.date.value=localDay(start);fields.time.value=localInput(start).slice(11);const length=Math.max(5,Math.round((end-start)/60000));setDurations(length);duration.value=String(length);updateSummary();}
  function updateSummary(){
    if(!fields.date.value||!fields.time.value){summary.textContent='';return;}
    const start=new Date(startValue());if(!Number.isFinite(start.getTime())){summary.textContent='';return;}
    const end=new Date(start.getTime()+durationMinutes()*60000);
    const day=start.toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'long'});
    const time=(d)=>d.toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'});
    summary.textContent=`${day}, das ${time(start)} às ${time(end)}${localDay(start)===localDay(end)?'':' do dia seguinte'}.`;
  }
  for(const input of [fields.date,fields.time,duration])input.addEventListener('input',updateSummary);duration.addEventListener('change',updateSummary);
  let items=[],selectedDay='',editing=null,taskId=null,draftId=crypto.randomUUID(),offset=0,total=0,loading=0,opener=null;
  const more=make('button','Carregar mais registros do mês');more.type='button';more.className='secondary-action calendar-more';agenda.after(more);
  const mutate=pendingMutation(saveCalendarEvent,()=>crypto.randomUUID());
  function reset(){editing=null;taskId=null;draftId=crypto.randomUUID();form.reset();taskLabel.textContent='';unlink.hidden=true;submit.textContent='Agendar';composeTitle.textContent='Agendar estudo';formError.textContent='';setDurations();duration.value='60';summary.textContent='';}
  function openCompose(from,focus=fields.title){opener=from||document.activeElement;formError.textContent='';if(!compose.open&&typeof compose.showModal==='function')compose.showModal();focus.focus();}
  function closeCompose(){if(compose.open)compose.close();}
  compose.addEventListener('close',()=>{const target=opener?.isConnected?opener:composeButton;opener=null;setTimeout(()=>target.focus(),0);});
  compose.addEventListener('click',(event)=>{if(event.target===compose)closeCompose();});
  close.addEventListener('click',closeCompose);
  cancel.addEventListener('click',()=>{reset();closeCompose();});unlink.addEventListener('click',()=>{taskId=null;taskLabel.textContent='';unlink.hidden=true;});
  // A new entry starts on the chosen day (or today) at the next full hour, one hour long.
  function startDraft(){const base=selectedDay?new Date(selectedDay+'T09:00'):new Date();if(!selectedDay){base.setMinutes(0,0,0);base.setHours(base.getHours()+1);}
    setWhen(base,new Date(base.getTime()+3600000));}
  composeButton.addEventListener('click',()=>{reset();startDraft();openCompose(composeButton);});
  function edit(item,from){reset();editing=item;fields.title.value=item.title;description.value=item.description||'';setWhen(new Date(item.startsAt),new Date(item.endsAt));material.value=item.materialId||'';taskId=item.taskId||null;taskLabel.textContent=taskId?'Horário vinculado a uma tarefa.':'';unlink.hidden=!taskId;submit.textContent='Salvar alterações';composeTitle.textContent='Editar estudo agendado';openCompose(from);}
  const todayKey=()=>localDay(new Date());
  // A small calendar leaf: weekday, day number and month (the full date is the accessible text).
  function dayTile(node,date){node.replaceChildren();const full=make('span',date.toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'long'}));full.className='sr-only';node.append(full);
    for(const [part,options] of [['calendar-leaf-weekday',{weekday:'short'}],['calendar-leaf-day',{day:'numeric'}],['calendar-leaf-month',{month:'short'}]]){const span=make('span',date.toLocaleDateString(locale(),options).replace('.',''));span.className=part;span.setAttribute('aria-hidden','true');node.append(span);}
    if(localDay(date)===todayKey())node.classList.add('is-today');}
  function render(){
    grid.replaceChildren();const [year,m]=month.value.split('-').map(Number);const count=new Date(year,m,0).getDate();
    title.textContent=new Date(year,m-1,1).toLocaleDateString(locale(),{month:'long',year:'numeric'});
    for(const day of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']){const label=make('span',day);label.setAttribute('aria-hidden','true');grid.append(label);}
    for(let day=1;day<=count;day++){
      const key=`${month.value}-${String(day).padStart(2,'0')}`,matches=items.filter((item)=>itemOnDay(item,key));
      const button=make('button');button.type='button';button.append(make('span',String(day)));
      if(matches.length){const dots=make('span');dots.className='calendar-dots';dots.setAttribute('aria-hidden','true');for(const item of matches.slice(0,3)){const dot=make('i');dot.className=item.kind==='task'?'is-task':'is-event';dots.append(dot);}button.append(dots);button.classList.add('has-items');}
      if(key===todayKey())button.classList.add('is-today');
      button.setAttribute('aria-label',`${key}: ${matches.length} registros carregados`);button.setAttribute('aria-pressed',String(selectedDay===key));
      if(day===1)button.style.gridColumnStart=String(((new Date(year,m-1,1).getDay()+6)%7)+1);
      button.addEventListener('click',()=>{selectedDay=selectedDay===key?'':key;render();grid.querySelector('[aria-pressed="true"]')?.focus()||button.focus();});grid.append(button);
    }
    const head=make('div');head.className='calendar-agenda-head';
    head.append(make('h3',selectedDay?`Agenda de ${new Date(selectedDay+'T00:00:00').toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'long'})}`:'Agenda do mês'));
    if(selectedDay){const all=make('button','Mostrar mês todo');all.type='button';all.className='text-action';all.addEventListener('click',()=>{selectedDay='';render();});head.append(all);}
    agenda.replaceChildren(head);
    const visible=selectedDay?items.filter((item)=>itemOnDay(item,selectedDay)):items;
    if(!visible.length)agenda.append(ninoNote(selectedDay?'Que tal reservar um horário curto para estudar neste dia?':'Reserve um horário para estudar e ele aparece aqui, junto com os prazos das tarefas.','rest',{className:'calendar-empty',title:selectedDay?'Nenhum estudo agendado neste dia.':'Nenhum estudo agendado.',artId:'empty.planner',action:{label:'Agendar estudo',onClick:(button)=>{reset();startDraft();openCompose(button);}}}));
    const list=make('ul');list.className='calendar-entries';
    for(const item of visible){
      const card=make('li');card.className='calendar-entry'+(item.kind==='task'?' is-task':'');
      const when=make('p');when.className='calendar-entry-when';const body=make('div');body.className='calendar-entry-body';body.append(make('h4',item.title));
      const tools=make('div');tools.className='calendar-entry-actions';
      if(item.kind==='task'){
        dayTile(when,new Date(item.date+'T00:00:00'));
        const kind=make('p','Prazo de tarefa · dia inteiro');kind.className='calendar-entry-time is-task';body.append(kind);const schedule=make('button','Agendar horário para esta tarefa');schedule.type='button';schedule.className='text-action';
        schedule.addEventListener('click',()=>{reset();fields.title.value=item.title;taskId=item.id;material.value=item.materialId||'';taskLabel.textContent=`Tarefa: ${item.title}`;unlink.hidden=false;setWhen(new Date(item.date+'T09:00'),new Date(item.date+'T10:00'));openCompose(schedule,fields.time);});tools.append(schedule);
      }else{
        const start=new Date(item.startsAt),end=new Date(item.endsAt);
        dayTile(when,start);
        const range=make('p',`${start.toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'})} – ${end.toLocaleString(locale(),localDay(start)===localDay(end)?{hour:'2-digit',minute:'2-digit'}:{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`);range.className='calendar-entry-time';body.append(range);if(item.description){const notes=make('p',item.description);notes.className='calendar-entry-notes';body.append(notes);}
        const change=make('button','Editar'),remove=make('button','Remover');change.type=remove.type='button';change.setAttribute('aria-label',`Editar ${item.title}`);remove.setAttribute('aria-label',`Remover ${item.title} do calendário`);change.className=remove.className='text-action';change.addEventListener('click',()=>edit(item,change));
        const archive=pendingMutation(saveCalendarEvent,()=>crypto.randomUUID());remove.addEventListener('click',()=>{if(!confirm('Remover este horário do calendário?'))return;remove.disabled=true;void archive({id:item.id,version:item.version,body:{deleted:true}}).then(()=>{signal('calendar',{changed:true});toast('Estudo removido do calendário.',{type:'success'});return load(true);}).catch((e)=>{say(e.message,{keep:true});remove.disabled=false;});});tools.append(change,remove);
      }
      if(item.materialId){const lesson=materials.find((entry)=>entry.id===item.materialId);const link=make('a',lesson?`Aula: ${lesson.title}`:'Abrir aula');link.href=`./material.html?id=${encodeURIComponent(item.materialId)}`;tools.append(link);}
      body.append(tools);card.append(when,body);list.append(card);
    }
    if(visible.length)agenda.append(list);
    more.hidden=offset>=total;
  }
  async function loadWeek(){
    const version=++loading;
    try{const range=weekRange(weekStart);const all=[];let start=0,count=0;
      do{const page=await listCalendar({...range,offset:start});all.push(...page.items);count=page.total;if(!page.items.length)break;start+=page.items.length;}while(start<count);
      if(version!==loading)return;items=all;offset=total=0;renderWeekView();
    }catch(error){if(version===loading){items=[];renderWeekView();say(error.message,{keep:true});}}
  }
  function renderWeekView(){
    const end=addDays(weekStart,6);
    title.textContent=`${weekStart.toLocaleDateString(locale(),{day:'numeric',month:'short'})} – ${end.toLocaleDateString(locale(),{day:'numeric',month:'short',year:'numeric'})}`;
    renderWeek(weekBox,{items,weekStart,locale:locale(),
      onEdit:(item,from)=>edit(item,from),
      onCompose:(day,from)=>{reset();selectedDay=day;startDraft();openCompose(from);},
      onMove:(item,minutes,from)=>{
        const moved=moveEvent(item,minutes);
        void mutate({id:item.id,version:item.version,body:{title:item.title,description:item.description||'',...moved,materialId:item.materialId||null,taskId:item.taskId||null}})
          .then(()=>{signal('calendar',{changed:true});return loadWeek();})
          .then(()=>{toast(`Horário movido para ${new Date(moved.startsAt).toLocaleString(locale(),{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}.`,{type:'success'});
            const again=[...weekBox.querySelectorAll('.week-move summary')].find((node)=>node.getAttribute('aria-label')===`Mover ${item.title}`);(again||from)?.focus?.();})
          .catch((e)=>say(e.message,{keep:true}));
      }});
  }
  function applyView(){
    const week=view==='week';layout.hidden=week;more.hidden=week||offset>=total;weekBox.hidden=!week;
    monthView.setAttribute('aria-pressed',String(!week));weekView.setAttribute('aria-pressed',String(week));
    prev.setAttribute('aria-label',week?'Semana anterior':'Mês anterior');next.setAttribute('aria-label',week?'Próxima semana':'Próximo mês');
    exportButton.hidden=week;
  }
  const setView=(choice)=>{view=choice;try{localStorage.setItem('voz-calendar-view',choice);}catch{/* storage blocked */}applyView();void load(true);};
  monthView.addEventListener('click',()=>setView('month'));weekView.addEventListener('click',()=>setView('week'));
  async function load(resetList=false){
    if(view==='week')return loadWeek();
    const version=++loading;more.disabled=true;
    try{const query={...monthRange(month.value),offset:resetList?0:offset};const page=await listCalendar(query);if(version!==loading)return;
      if(resetList){items=[];offset=0;}items.push(...page.items);offset+=page.items.length;total=page.total;render();if(items.length<total)say(`${items.length} de ${total} registros carregados.`,{keep:true});
    }catch(error){if(version===loading){items=[];offset=total=0;render();say(error.message,{keep:true});}}
    finally{if(version===loading)more.disabled=false;}
  }
  form.addEventListener('submit',(event)=>{
    event.preventDefault();if(!form.reportValidity())return;
    try{const sameStart=editing&&localInput(new Date(editing.startsAt))===startValue();
      const startsAt=sameStart?editing.startsAt:utcInput(startValue());
      const sameLength=editing&&Date.parse(editing.endsAt)-Date.parse(editing.startsAt)===durationMinutes()*60000;
      const endsAt=sameStart&&sameLength?editing.endsAt:new Date(Date.parse(startsAt)+durationMinutes()*60000).toISOString();
      const wasEditing=Boolean(editing);
      submit.disabled=true;void mutate({id:editing?.id||draftId,version:editing?.version||0,body:{title:fields.title.value,description:description.value,startsAt,endsAt,materialId:material.value||null,taskId}})
        .then(()=>{reset();closeCompose();signal('calendar',{changed:true});return load(true);})
        .then(()=>{toast(wasEditing?'Estudo agendado atualizado.':`Estudo agendado para ${new Date(startsAt).toLocaleString(locale(),{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}.`,{type:'success'});}).catch((e)=>{formError.textContent=e.message;}).finally(()=>{submit.disabled=false;});
    }catch(error){formError.textContent=error.message;}
  });
  month.addEventListener('change',()=>{selectedDay='';void load(true);});more.addEventListener('click',()=>{void load();});
  const shift=(delta)=>{const [y,mo]=month.value.split('-').map(Number);const d=new Date(y,mo-1+delta,1);month.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;selectedDay='';void load(true);};
  const step=(delta)=>{if(view==='week'){weekStart=addDays(weekStart,7*delta);void loadWeek();}else shift(delta);};
  prev.addEventListener('click',()=>step(-1));next.addEventListener('click',()=>step(1));
  today.addEventListener('click',()=>{weekStart=weekStartOf(new Date());month.value=localDay(new Date()).slice(0,7);selectedDay=view==='week'?'':localDay(new Date());void load(true);});
  exportButton.addEventListener('click',()=>{
    const selected=month.value;exportButton.disabled=true;
    void (async()=>{const allItems=[];let start=0,count;const range=monthRange(selected);do{const page=await listCalendar({...range,offset:start});allItems.push(...page.items);count=page.total;if(!page.items.length&&start<count)throw new Error('Não foi possível completar o calendário.');start+=page.items.length;}while(start<count);
      downloadText(calendarIcs(allItems),`calendario_${selected}.ics`,'text/calendar;charset=utf-8');toast('Arquivo ICS preparado com o mês completo.',{type:'success'});
    })().catch((error)=>{say(error.message,{keep:true});}).finally(()=>{exportButton.disabled=false;});
  });
  document.addEventListener('voz:calendar-command',(event)=>{if(event.detail?.action==='compose'){reset();startDraft();openCompose(composeButton);}});
  applyView();
  await load(true);
}
