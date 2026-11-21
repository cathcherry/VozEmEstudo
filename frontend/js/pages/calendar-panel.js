import { ninoNote } from '../utils/material-ui.js';
import { listCalendar,saveCalendarEvent } from '../api/learning-tools.api.js';
import { monthRange,localDay,itemOnDay,calendarIcs } from '../utils/calendar-export.js';
import { downloadText } from '../utils/study-export.js';
import { pendingMutation } from '../utils/pending-mutation.js';
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
  actions.append(exportButton,composeButton);controls.append(nav,actions);
  // Short confirmations and errors in a small banner that clears itself.
  const status=make('p');status.className='calendar-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let statusTimer;const say=(text,{keep=false}={})=>{clearTimeout(statusTimer);status.textContent=text;if(text&&!keep)statusTimer=setTimeout(()=>{status.textContent='';},7000);};
  const layout=make('div');layout.className='calendar-layout';
  const monthBox=make('div');monthBox.className='calendar-month';
  const grid=make('div');grid.className='study-calendar-grid';grid.setAttribute('role','group');grid.setAttribute('aria-label','Dias do mês');
  const note=make('p',`Horários no fuso deste aparelho (${zone}). Prazos de tarefas aparecem como dia inteiro.`);note.className='calendar-note';
  monthBox.append(grid,note);
  const agenda=make('div');agenda.className='calendar-agenda';
  layout.append(monthBox,agenda);
  panel.append(controls,status,layout);
  // Scheduling happens in a dialog opened by "Agendar estudo", a day's entry or a task.
  const compose=make('dialog');compose.className='app-dialog calendar-compose';compose.setAttribute('aria-labelledby','calendar-compose-title');
  const composeTitle=make('h2','Agendar estudo');composeTitle.id='calendar-compose-title';
  const close=make('button','×');close.type='button';close.className='dialog-close calendar-compose-close';close.setAttribute('aria-label','Fechar');
  compose.append(close,composeTitle);
  const form=make('form');form.className='calendar-event-form';
  const fields={};for(const [name,label,type] of [['title','Título','text'],['startsAt','Início','datetime-local'],['endsAt','Fim','datetime-local']]){
    const wrap=make('label',label),input=make('input');input.type=type;input.required=true;if(name==='title')input.maxLength=200;wrap.append(input);form.append(wrap);fields[name]=input;
    if(name==='title')wrap.className='calendar-field-wide';
  }
  const descLabel=make('label','Descrição (opcional)'),description=make('textarea');descLabel.className='calendar-field-wide';description.maxLength=3000;description.rows=2;descLabel.append(description);form.append(descLabel);
  const materialLabel=make('label','Aula (opcional)'),material=make('select');materialLabel.className='calendar-field-wide';material.append(new Option('Sem aula',''));for(const item of materials)material.append(new Option(item.title,item.id));materialLabel.append(material);form.append(materialLabel);
  const taskLabel=make('p'),unlink=make('button','Desvincular tarefa');taskLabel.className='calendar-task-link';unlink.type='button';unlink.className='text-action';unlink.hidden=true;
  const zoneHint=make('p',`Fuso deste aparelho: ${zone}.`);zoneHint.className='calendar-field-wide app-dialog-hint';
  const formError=make('p');formError.className='calendar-form-error calendar-field-wide';formError.setAttribute('role','alert');
  const submit=make('button','Salvar horário'),cancel=make('button','Cancelar');submit.type='submit';cancel.type='button';submit.className='primary-action';cancel.className='secondary-action';
  const formActions=make('div');formActions.className='form-actions calendar-field-wide';formActions.append(cancel,submit);
  form.append(taskLabel,unlink,zoneHint,formError,formActions);compose.append(form);panel.append(compose);
  let items=[],selectedDay='',editing=null,taskId=null,draftId=crypto.randomUUID(),offset=0,total=0,loading=0,opener=null;
  const more=make('button','Carregar mais registros do mês');more.type='button';more.className='secondary-action calendar-more';agenda.after(more);
  const mutate=pendingMutation(saveCalendarEvent,()=>crypto.randomUUID());
  function reset(){editing=null;taskId=null;draftId=crypto.randomUUID();form.reset();taskLabel.textContent='';unlink.hidden=true;submit.textContent='Salvar horário';composeTitle.textContent='Agendar estudo';formError.textContent='';}
  function openCompose(from,focus=fields.title){opener=from||document.activeElement;formError.textContent='';if(!compose.open&&typeof compose.showModal==='function')compose.showModal();focus.focus();}
  function closeCompose(){if(compose.open)compose.close();}
  compose.addEventListener('close',()=>{const target=opener?.isConnected?opener:composeButton;opener=null;setTimeout(()=>target.focus(),0);});
  compose.addEventListener('click',(event)=>{if(event.target===compose)closeCompose();});
  close.addEventListener('click',closeCompose);
  cancel.addEventListener('click',()=>{reset();closeCompose();});unlink.addEventListener('click',()=>{taskId=null;taskLabel.textContent='';unlink.hidden=true;});
  // A new entry starts on the chosen day (or today) at the next full hour, one hour long.
  function startDraft(){const base=selectedDay?new Date(selectedDay+'T09:00'):new Date();if(!selectedDay){base.setMinutes(0,0,0);base.setHours(base.getHours()+1);}
    const end=new Date(base.getTime()+3600000);fields.startsAt.value=localInput(base);fields.endsAt.value=localInput(end);}
  composeButton.addEventListener('click',()=>{reset();startDraft();openCompose(composeButton);});
  function edit(item,from){reset();editing=item;fields.title.value=item.title;description.value=item.description||'';fields.startsAt.value=localInput(new Date(item.startsAt));fields.endsAt.value=localInput(new Date(item.endsAt));material.value=item.materialId||'';taskId=item.taskId||null;taskLabel.textContent=taskId?'Horário vinculado a uma tarefa.':'';unlink.hidden=!taskId;submit.textContent='Salvar edição';composeTitle.textContent='Editar horário';openCompose(from);}
  const todayKey=()=>localDay(new Date());
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
    if(!visible.length)agenda.append(ninoNote(selectedDay?'Nada marcado neste dia. Que tal reservar um horário curto?':'Nenhum horário ou prazo neste mês ainda.','rest',{className:'calendar-empty',action:{label:'Agendar estudo',onClick:(button)=>{reset();startDraft();openCompose(button);}}}));
    const list=make('ul');list.className='calendar-entries';
    for(const item of visible){
      const card=make('li');card.className='calendar-entry'+(item.kind==='task'?' is-task':'');
      const when=make('p');when.className='calendar-entry-when';const body=make('div');body.className='calendar-entry-body';body.append(make('h4',item.title));
      const tools=make('div');tools.className='calendar-entry-actions';
      if(item.kind==='task'){
        when.textContent=new Date(item.date+'T00:00:00').toLocaleDateString(locale(),{weekday:'short',day:'2-digit',month:'2-digit'});
        body.append(make('p','Prazo de tarefa'));const schedule=make('button','Agendar horário para esta tarefa');schedule.type='button';schedule.className='text-action';
        schedule.addEventListener('click',()=>{reset();fields.title.value=item.title;taskId=item.id;material.value=item.materialId||'';taskLabel.textContent=`Tarefa: ${item.title}`;unlink.hidden=false;fields.startsAt.value=item.date+'T09:00';fields.endsAt.value=item.date+'T10:00';openCompose(schedule,fields.startsAt);});tools.append(schedule);
      }else{
        const start=new Date(item.startsAt),end=new Date(item.endsAt);
        when.textContent=start.toLocaleDateString(locale(),{weekday:'short',day:'2-digit',month:'2-digit'});
        body.append(make('p',`${start.toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'})} – ${end.toLocaleString(locale(),localDay(start)===localDay(end)?{hour:'2-digit',minute:'2-digit'}:{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`));if(item.description)body.append(make('p',item.description));
        const change=make('button','Editar horário'),remove=make('button','Remover horário');change.type=remove.type='button';change.className=remove.className='text-action';change.addEventListener('click',()=>edit(item,change));
        const archive=pendingMutation(saveCalendarEvent,()=>crypto.randomUUID());remove.addEventListener('click',()=>{if(!confirm('Remover este horário do calendário?'))return;remove.disabled=true;void archive({id:item.id,version:item.version,body:{deleted:true}}).then(()=>{signal('calendar',{changed:true});say('Horário removido.');return load(true);}).catch((e)=>{say(e.message,{keep:true});remove.disabled=false;});});tools.append(change,remove);
      }
      if(item.materialId){const link=make('a','Abrir aula');link.href=`./material.html?id=${encodeURIComponent(item.materialId)}`;tools.append(link);}
      body.append(tools);card.append(when,body);list.append(card);
    }
    if(visible.length)agenda.append(list);
    more.hidden=offset>=total;
  }
  async function load(resetList=false){
    const version=++loading;more.disabled=true;
    try{const query={...monthRange(month.value),offset:resetList?0:offset};const page=await listCalendar(query);if(version!==loading)return;
      if(resetList){items=[];offset=0;}items.push(...page.items);offset+=page.items.length;total=page.total;render();if(items.length<total)say(`${items.length} de ${total} registros carregados.`,{keep:true});
    }catch(error){if(version===loading){items=[];offset=total=0;render();say(error.message,{keep:true});}}
    finally{if(version===loading)more.disabled=false;}
  }
  form.addEventListener('submit',(event)=>{
    event.preventDefault();if(!form.reportValidity())return;
    try{const startsAt=editing&&localInput(new Date(editing.startsAt))===fields.startsAt.value?editing.startsAt:utcInput(fields.startsAt.value);
      const endsAt=editing&&localInput(new Date(editing.endsAt))===fields.endsAt.value?editing.endsAt:utcInput(fields.endsAt.value);
      submit.disabled=true;void mutate({id:editing?.id||draftId,version:editing?.version||0,body:{title:fields.title.value,description:description.value,startsAt,endsAt,materialId:material.value||null,taskId}})
        .then(()=>{reset();closeCompose();signal('calendar',{changed:true});return load(true);})
        // The reload reports the month's count; keep the confirmation in front of it.
        .then(()=>{say(`Horário salvo na conta. ${status.textContent}`.trim());}).catch((e)=>{formError.textContent=e.message;}).finally(()=>{submit.disabled=false;});
    }catch(error){formError.textContent=error.message;}
  });
  month.addEventListener('change',()=>{selectedDay='';void load(true);});more.addEventListener('click',()=>{void load();});
  const shift=(delta)=>{const [y,mo]=month.value.split('-').map(Number);const d=new Date(y,mo-1+delta,1);month.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;selectedDay='';void load(true);};
  prev.addEventListener('click',()=>shift(-1));next.addEventListener('click',()=>shift(1));
  today.addEventListener('click',()=>{month.value=localDay(new Date()).slice(0,7);selectedDay=localDay(new Date());void load(true);});
  exportButton.addEventListener('click',()=>{
    const selected=month.value;exportButton.disabled=true;
    void (async()=>{const allItems=[];let start=0,count;const range=monthRange(selected);do{const page=await listCalendar({...range,offset:start});allItems.push(...page.items);count=page.total;if(!page.items.length&&start<count)throw new Error('Não foi possível completar o calendário.');start+=page.items.length;}while(start<count);
      downloadText(calendarIcs(allItems),`calendario_${selected}.ics`,'text/calendar;charset=utf-8');say('Arquivo ICS preparado com o mês completo.');
    })().catch((error)=>{say(error.message,{keep:true});}).finally(()=>{exportButton.disabled=false;});
  });
  document.addEventListener('voz:calendar-command',(event)=>{if(event.detail?.action==='compose'){reset();startDraft();openCompose(composeButton);}});
  await load(true);
}
