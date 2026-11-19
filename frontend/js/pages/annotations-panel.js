import { ninoNote } from '../utils/material-ui.js';
import { listAnnotations,saveAnnotation } from '../api/learning-tools.api.js';
import { selectionAnchor,focusAnnotation } from '../utils/annotation-anchor.js';
import { pendingMutation } from '../utils/pending-mutation.js';
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export async function initAnnotationsPanel({panel,materialId,context,segments,materials=[]}){
  panel.hidden=false;panel.replaceChildren(make('h2',materialId?'Anotações e destaques':'Buscar nas suas anotações'));
  const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let selectedField=null,anchor=null,draftId=crypto.randomUUID(),offset=0,version=0,total=0;
  const source=()=>context?.();
  if(materialId){
    segments.addEventListener('select',(event)=>{if(event.target.tagName==='TEXTAREA')selectedField=event.target;});
    const form=make('form'),textLabel=make('label','Sua anotação'),text=make('textarea');text.maxLength=5000;text.rows=3;textLabel.append(text);
    const colorLabel=make('label','Cor do destaque'),color=make('select');for(const value of ['yellow','green','blue'])color.append(new Option({yellow:'Amarelo',green:'Verde',blue:'Azul'}[value],value));colorLabel.append(color);
    const capture=make('button','Usar seleção da transcrição'),clear=make('button','Remover seleção'),preview=make('p');capture.type=clear.type='button';
    capture.addEventListener('click',()=>{
      const article=selectedField?.closest('.transcription-segment'),position=Number(article?.dataset.segmentPosition);
      const segment=source()?.transcription?.transcription_segments.find((s)=>s.position===position);
      if(!selectedField?.isConnected||!segment||selectedField.value!==segment.current_text){status.textContent='Selecione um trecho da transcrição salva. Salve alterações antes de destacar.';return;}
      const selection=selectionAnchor(selectedField,position);
      if(!selection||selection.quote.length>1000){status.textContent='Selecione de 1 a 1.000 caracteres para destacar.';return;}
      anchor={...selection,sourceRevisionId:source().review.sourceRevisionId};preview.textContent=`Destaque da revisão ${source().transcription.current_revision}: ${selection.quote}`;
    });
    clear.addEventListener('click',()=>{anchor=null;preview.textContent='';});
    const submit=make('button','Salvar anotação');submit.type='submit';
    const save=pendingMutation(saveAnnotation,()=>crypto.randomUUID());
    form.append(textLabel,colorLabel,capture,clear,preview,submit);panel.append(form);
    form.addEventListener('submit',(event)=>{
      event.preventDefault();const material=source();if(!material?.review?.sourceRevisionId){status.textContent='A transcrição ainda não está disponível.';return;}
      if(!text.value.trim()&&!anchor){status.textContent='Escreva uma anotação ou selecione um destaque.';return;}
      submit.disabled=true;
      void save({id:draftId,materialId,version:0,body:{sourceRevisionId:material.review.sourceRevisionId,...(anchor||{}),noteText:text.value,color:color.value}})
        .then(()=>{draftId=crypto.randomUUID();form.reset();anchor=null;preview.textContent='';status.textContent='Anotação salva na conta.';return load(0);})
        .catch((error)=>{status.textContent=error.message;}).finally(()=>{submit.disabled=false;});
    });
  }
  const searchForm=make('form'),label=make('label','Pesquisar texto e destaques'),search=make('input');search.type='search';search.maxLength=200;label.append(search);
  const find=make('button','Buscar');find.type='submit';searchForm.append(label,find);panel.append(searchForm,status);
  const list=make('div'),nav=make('nav'),previous=make('button','Anotações anteriores'),next=make('button','Próximas anotações'),count=make('span');previous.type=next.type='button';nav.setAttribute('aria-label','Páginas das anotações');nav.append(previous,count,next);panel.append(list,nav);
  const titles=new Map(materials.map((item)=>[item.id,item.title]));
  async function load(nextOffset=offset){
    const request=++version;find.disabled=previous.disabled=next.disabled=true;
    try{
      const result=await listAnnotations({materialId,q:search.value.trim(),offset:nextOffset});if(request!==version)return;
      offset=nextOffset;total=result.total;list.replaceChildren();
      if(!result.notes.length)list.append(ninoNote(search.value.trim()?'Nenhuma anotação encontrada.':'Nenhuma anotação ainda.',search.value.trim()?'curious':'rest'));
      for(const note of result.notes){
        const card=make('article');card.className=`annotation-card annotation-${note.color}`;
        card.append(make('h3',`Revisão ${note.source_revision}${materialId?'':' · '+(titles.get(note.material_id)||'Aula')}`));
        if(note.quote)card.append(make('blockquote',note.quote));
        if(!materialId){const link=make('a','Abrir aula');link.href=`./material.html?id=${encodeURIComponent(note.material_id)}`;card.append(make('p',note.note_text),link);}
        else{
          const editLabel=make('label','Editar anotação'),edit=make('textarea');edit.value=note.note_text;edit.maxLength=5000;editLabel.append(edit);
          const save=make('button','Salvar edição'),remove=make('button','Arquivar anotação');save.type=remove.type='button';
          const mutate=pendingMutation(saveAnnotation,()=>crypto.randomUUID());
          const update=(body)=>{save.disabled=remove.disabled=true;void mutate({id:note.id,materialId,version:note.version,body}).then(()=>load()).catch((e)=>{status.textContent=e.message;}).finally(()=>{save.disabled=remove.disabled=false;});};
          save.addEventListener('click',()=>update({noteText:edit.value}));
          remove.addEventListener('click',()=>{if(confirm('Arquivar esta anotação?'))update({deleted:true});});card.append(editLabel,save,remove);
          if(note.quote){const locate=make('button','Ir ao destaque');locate.type='button';locate.addEventListener('click',()=>{if(!focusAnnotation(note,segments,source()?.transcription?.current_revision))status.textContent='Este destaque pertence a outra revisão ou o trecho foi editado. O texto original está preservado acima.';});card.append(locate);}
        }list.append(card);
      }
      count.textContent=`${result.notes.length?offset+1:0}–${offset+result.notes.length} de ${total}`;
    }catch(error){if(request===version){list.replaceChildren();status.textContent=error.message;}}
    finally{if(request===version){find.disabled=false;previous.disabled=offset===0;next.disabled=offset+50>=total;}}
  }
  searchForm.addEventListener('submit',(e)=>{e.preventDefault();void load(0);});previous.addEventListener('click',()=>{void load(Math.max(0,offset-50));});next.addEventListener('click',()=>{void load(offset+50);});
  await load(0);
}
