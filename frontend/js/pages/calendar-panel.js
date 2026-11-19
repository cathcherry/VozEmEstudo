import { ninoNote } from '../utils/material-ui.js';
import { listCalendar,saveCalendarEvent } from '../api/learning-tools.api.js';
import { monthRange,localDay,itemOnDay,calendarIcs } from '../utils/calendar-export.js';
import { downloadText } from '../utils/study-export.js';
import { pendingMutation } from '../utils/pending-mutation.js';
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const localInput=(date)=>`${localDay(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
function utcInput(value){const date=new Date(value);if(!Number.isFinite(date.getTime())||localInput(date)!==value)throw new Error('Confira o horário no fuso deste aparelho.');return date.toISOString();}
export async function initCalendarPanel({panel,materials=[]}){
  panel.hidden=false;panel.replaceChildren(make('h2','Calendário de estudos'),make('p',`Horários no fuso deste aparelho: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Prazos de tarefas aparecem como eventos de dia inteiro. Exportar ICS não envia convites nem altera outros calendários.`));
  const controls=make('div');controls.className='learning-tools-controls';
  const monthLabel=make('label','Mês'),month=make('input');month.type='month';month.min='1970-01';month.max='2100-12';month.value=localDay(new Date()).slice(0,7);monthLabel.append(month);
  const refresh=make('button','Atualizar calendário'),all=make('button','Mostrar mês todo'),exportButton=make('button','Baixar calendário ICS');refresh.type=all.type=exportButton.type='button';controls.append(monthLabel,refresh,all,exportButton);
  const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');const grid=make('div');grid.className='study-calendar-grid';grid.setAttribute('role','group');grid.setAttribute('aria-label','Dias do mês');const agenda=make('div');panel.append(controls,status,grid,agenda);
  const form=make('form');form.className='calendar-event-form';form.append(make('h3','Agendar estudo'));
  const fields={};for(const [name,label,type] of [['title','Título','text'],['startsAt','Início','datetime-local'],['endsAt','Fim','datetime-local']]){
    const wrap=make('label',label),input=make('input');input.type=type;input.required=true;if(name==='title')input.maxLength=200;wrap.append(input);form.append(wrap);fields[name]=input;
  }
  const descLabel=make('label','Descrição (opcional)'),description=make('textarea');description.maxLength=3000;descLabel.append(description);form.append(descLabel);
  const materialLabel=make('label','Aula (opcional)'),material=make('select');material.append(new Option('Sem aula',''));for(const item of materials)material.append(new Option(item.title,item.id));materialLabel.append(material);form.append(materialLabel);
  const taskLabel=make('p'),unlink=make('button','Desvincular tarefa');unlink.type='button';unlink.hidden=true;
  const submit=make('button','Salvar horário'),cancel=make('button','Novo horário');submit.type='submit';cancel.type='button';form.append(taskLabel,unlink,submit,cancel);panel.append(form);
  let items=[],selectedDay='',editing=null,taskId=null,draftId=crypto.randomUUID(),offset=0,total=0,loading=0;
  const more=make('button','Carregar mais registros do mês');more.type='button';panel.append(more);
  const mutate=pendingMutation(saveCalendarEvent,()=>crypto.randomUUID());
  function reset(){editing=null;taskId=null;draftId=crypto.randomUUID();form.reset();taskLabel.textContent='';unlink.hidden=true;submit.textContent='Salvar horário';}
  cancel.addEventListener('click',reset);unlink.addEventListener('click',()=>{taskId=null;taskLabel.textContent='';unlink.hidden=true;});
  function edit(item){editing=item;fields.title.value=item.title;description.value=item.description||'';fields.startsAt.value=localInput(new Date(item.startsAt));fields.endsAt.value=localInput(new Date(item.endsAt));material.value=item.materialId||'';taskId=item.taskId||null;taskLabel.textContent=taskId?'Horário vinculado a uma tarefa.':'';unlink.hidden=!taskId;submit.textContent='Salvar edição';fields.title.focus();}
  function render(){
    grid.replaceChildren();const [year,m]=month.value.split('-').map(Number);const count=new Date(year,m,0).getDate();
    for(const day of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']){const label=make('span',day);label.setAttribute('aria-hidden','true');grid.append(label);}
    for(let day=1;day<=count;day++){
      const key=`${month.value}-${String(day).padStart(2,'0')}`,matches=items.filter((item)=>itemOnDay(item,key));
      const button=make('button',`${day}${matches.length?' · '+matches.length:''}`);button.type='button';button.setAttribute('aria-label',`${key}: ${matches.length} registros carregados`);button.setAttribute('aria-pressed',String(selectedDay===key));
      if(day===1)button.style.gridColumnStart=String(((new Date(year,m-1,1).getDay()+6)%7)+1);
      button.addEventListener('click',()=>{selectedDay=key;render();});grid.append(button);
    }
    agenda.replaceChildren(make('h3',selectedDay?`Agenda de ${selectedDay}`:'Agenda do mês'));
    const visible=selectedDay?items.filter((item)=>itemOnDay(item,selectedDay)):items;
    if(!visible.length)agenda.append(ninoNote('Nenhum registro carregado para este período.','rest'));
    for(const item of visible){
      const card=make('article');card.className='calendar-entry';card.append(make('h4',item.title));
      if(item.kind==='task'){
        card.append(make('p',`Prazo de tarefa · ${item.date}`));const schedule=make('button','Agendar horário para esta tarefa');schedule.type='button';
        schedule.addEventListener('click',()=>{reset();fields.title.value=item.title;taskId=item.id;material.value=item.materialId||'';taskLabel.textContent=`Tarefa: ${item.title}`;unlink.hidden=false;fields.startsAt.value=item.date+'T09:00';fields.endsAt.value=item.date+'T10:00';fields.startsAt.focus();});card.append(schedule);
      }else{
        card.append(make('p',`${new Date(item.startsAt).toLocaleString('pt-BR')} – ${new Date(item.endsAt).toLocaleString('pt-BR')}`),make('p',item.description||''));
        const change=make('button','Editar horário'),remove=make('button','Remover horário');change.type=remove.type='button';change.addEventListener('click',()=>edit(item));
        const archive=pendingMutation(saveCalendarEvent,()=>crypto.randomUUID());remove.addEventListener('click',()=>{if(!confirm('Remover este horário do calendário?'))return;remove.disabled=true;void archive({id:item.id,version:item.version,body:{deleted:true}}).then(()=>load(true)).catch((e)=>{status.textContent=e.message;remove.disabled=false;});});card.append(change,remove);
      }
      if(item.materialId){const link=make('a','Abrir aula');link.href=`./material.html?id=${encodeURIComponent(item.materialId)}`;card.append(link);}agenda.append(card);
    }
    more.hidden=offset>=total;
  }
  async function load(resetList=false){
    const version=++loading;refresh.disabled=more.disabled=true;
    try{const query={...monthRange(month.value),offset:resetList?0:offset};const page=await listCalendar(query);if(version!==loading)return;
      if(resetList){items=[];offset=0;}items.push(...page.items);offset+=page.items.length;total=page.total;render();status.textContent=`${items.length} de ${total} registros carregados.`;
    }catch(error){if(version===loading){items=[];offset=total=0;render();status.textContent=error.message;}}
    finally{if(version===loading)refresh.disabled=more.disabled=false;}
  }
  form.addEventListener('submit',(event)=>{
    event.preventDefault();if(!form.reportValidity())return;
    try{const startsAt=editing&&localInput(new Date(editing.startsAt))===fields.startsAt.value?editing.startsAt:utcInput(fields.startsAt.value);
      const endsAt=editing&&localInput(new Date(editing.endsAt))===fields.endsAt.value?editing.endsAt:utcInput(fields.endsAt.value);
      submit.disabled=true;void mutate({id:editing?.id||draftId,version:editing?.version||0,body:{title:fields.title.value,description:description.value,startsAt,endsAt,materialId:material.value||null,taskId}})
        .then(()=>{reset();status.textContent='Horário salvo na conta.';return load(true);}).catch((e)=>{status.textContent=e.message;}).finally(()=>{submit.disabled=false;});
    }catch(error){status.textContent=error.message;}
  });
  month.addEventListener('change',()=>{selectedDay='';void load(true);});refresh.addEventListener('click',()=>{void load(true);});all.addEventListener('click',()=>{selectedDay='';render();});more.addEventListener('click',()=>{void load();});
  exportButton.addEventListener('click',()=>{
    const selected=month.value;exportButton.disabled=true;
    void (async()=>{const allItems=[];let start=0,count;const range=monthRange(selected);do{const page=await listCalendar({...range,offset:start});allItems.push(...page.items);count=page.total;if(!page.items.length&&start<count)throw new Error('Não foi possível completar o calendário.');start+=page.limit;}while(start<count);
      downloadText(calendarIcs(allItems),`calendario_${selected}.ics`,'text/calendar;charset=utf-8');status.textContent='Arquivo ICS preparado com o mês completo.';
    })().catch((error)=>{status.textContent=error.message;}).finally(()=>{exportButton.disabled=false;});
  });await load(true);
}
