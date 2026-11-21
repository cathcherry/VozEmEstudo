import { ninoNote } from '../utils/material-ui.js';
import { listAnnotations,saveAnnotation } from '../api/learning-tools.api.js';
import { selectionAnchor,focusAnnotation,readingSelectionAnchor,focusReadingAnnotation } from '../utils/annotation-anchor.js';
import { pendingMutation } from '../utils/pending-mutation.js';
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal=(name,detail)=>{try{const view=document.defaultView;if(view?.CustomEvent)document.dispatchEvent(new view.CustomEvent(`voz:${name}`,{detail}));}catch{/* optional */}};
/** Lesson link for a note: with a highlight, the lesson opens on that passage (searched and bolded). */
export function lessonHref(note){
  const params=new URLSearchParams({id:note.material_id});
  const quote=String(note.quote||'').trim();
  if(quote){params.set('busca',quote.length>80?quote.slice(0,80).replace(/\s+\S*$/,''):quote);if(Number.isInteger(note.segment_position))params.set('trecho',String(note.segment_position));}
  return `./material.html?${params}`;
}
export async function initAnnotationsPanel({panel,materialId,context,segments,materials=[]}){
  panel.hidden=false;panel.replaceChildren(make('h2',materialId?'Anotações e destaques':'Buscar nas suas anotações'));
  const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let selectedField=null,anchor=null,draftId=crypto.randomUUID(),offset=0,version=0,total=0,pageSize=50;
  const source=()=>context?.();
  if(materialId){
    segments.addEventListener('select',(event)=>{if(event.target.tagName==='TEXTAREA')selectedField=event.target;});
    const save=pendingMutation(saveAnnotation,()=>crypto.randomUUID());
    const form=make('form'),textLabel=make('label','Sua anotação'),text=make('textarea');text.maxLength=5000;text.rows=3;textLabel.append(text);
    const colorLabel=make('label','Cor do destaque'),color=make('select');for(const value of ['yellow','green','blue'])color.append(new Option({yellow:'Amarelo',green:'Verde',blue:'Azul'}[value],value));colorLabel.append(color);
    const capture=make('button','Usar seleção da transcrição'),clear=make('button','Remover seleção'),preview=make('p');capture.type=clear.type='button';
    capture.addEventListener('click',()=>{
      if(segments.closest('[data-mode]')?.dataset.mode==='reading'){
        const result=readingSelectionAnchor(segments);
        if(result.error){status.textContent=result.error==='multi'?'Por enquanto, destaque dentro de um único trecho.':'Selecione um trecho do texto da transcrição.';return;}
        anchor={segmentPosition:result.segmentPosition,startOffset:result.startOffset,endOffset:result.endOffset,quote:result.quote,sourceRevisionId:source().review.sourceRevisionId};
        preview.textContent=`Destaque da revisão ${source().transcription.current_revision}: ${result.quote}`;return;
      }
      const article=selectedField?.closest('.transcription-segment'),position=Number(article?.dataset.segmentPosition);
      const segment=source()?.transcription?.transcription_segments.find((s)=>s.position===position);
      if(!selectedField?.isConnected||!segment||selectedField.value!==segment.current_text){status.textContent='Selecione um trecho da transcrição salva. Salve alterações antes de destacar.';return;}
      const selection=selectionAnchor(selectedField,position);
      if(!selection||selection.quote.length>1000){status.textContent='Selecione de 1 a 1.000 caracteres para destacar.';return;}
      anchor={...selection,sourceRevisionId:source().review.sourceRevisionId};preview.textContent=`Destaque da revisão ${source().transcription.current_revision}: ${selection.quote}`;
    });
    clear.addEventListener('click',()=>{anchor=null;preview.textContent='';});
    // Contextual popover over a selection in the reading view: highlight now, or comment it.
    const pop=make('div');pop.className='selection-popover';pop.hidden=true;pop.setAttribute('role','toolbar');pop.setAttribute('aria-label','Ações do trecho selecionado');
    const mark=make('button','Destacar'),comment=make('button','Comentar'),popNote=make('span');mark.type=comment.type='button';popNote.className='selection-popover-note';
    pop.append(mark,comment,popNote);document.body.append(pop);
    let pending=null;
    const reading=()=>segments.closest('[data-mode]')?.dataset.mode==='reading';
    const hidePop=()=>{pop.hidden=true;pending=null;};
    const showPop=()=>{
      if(!reading())return hidePop();
      const result=readingSelectionAnchor(segments);
      if(result.error==='empty')return hidePop();
      const rect=globalThis.getSelection().getRangeAt(0).getBoundingClientRect();
      pending=result.error?null:result;
      mark.hidden=comment.hidden=Boolean(result.error);
      popNote.textContent=result.error==='multi'?'Por enquanto, destaque dentro de um único trecho.':'';
      popNote.hidden=!result.error;
      pop.hidden=false;
      const width=pop.offsetWidth||180;
      pop.style.left=`${Math.max(8,Math.min((document.defaultView?.innerWidth||1024)-width-8,rect.left+rect.width/2-width/2))}px`;
      pop.style.top=`${Math.max(8,rect.top-pop.offsetHeight-10)}px`;
    };
    segments.addEventListener('mouseup',()=>setTimeout(showPop,0));
    segments.addEventListener('keyup',(event)=>{if(event.shiftKey)showPop();});
    document.addEventListener('mousedown',(event)=>{if(!pop.contains(event.target))hidePop();});
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape')hidePop();});
    document.defaultView?.addEventListener('scroll',hidePop,{passive:true});
    const anchorFrom=(selection)=>({segmentPosition:selection.segmentPosition,startOffset:selection.startOffset,endOffset:selection.endOffset,quote:selection.quote});
    mark.addEventListener('click',()=>{
      const material=source();if(!pending||!material?.review?.sourceRevisionId)return hidePop();
      const body={sourceRevisionId:material.review.sourceRevisionId,...anchorFrom(pending),noteText:'',color:'yellow'};
      hidePop();globalThis.getSelection()?.removeAllRanges();
      void save({id:crypto.randomUUID(),materialId,version:0,body}).then(()=>{status.textContent='Destaque salvo no caderno da aula.';signal('notes-changed',{materialId});return load(0);}).catch((error)=>{status.textContent=error.message;});
    });
    comment.addEventListener('click',()=>{
      const material=source();if(!pending||!material?.review?.sourceRevisionId)return hidePop();
      anchor={...anchorFrom(pending),sourceRevisionId:material.review.sourceRevisionId};
      preview.textContent=`Destaque da revisão ${material.transcription.current_revision}: ${pending.quote}`;
      hidePop();
      signal('open-notes',{});
      setTimeout(()=>text.focus(),0);
    });
    const submit=make('button','Salvar anotação');submit.type='submit';
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
      offset=nextOffset;total=result.total;pageSize=Number(result.limit)||pageSize;list.replaceChildren();
      if(!materialId&&!search.value.trim())signal('notes',{total});
      if(!result.notes.length)list.append(ninoNote(search.value.trim()?'Nenhuma anotação encontrada.':'Nenhuma anotação ainda.',search.value.trim()?'curious':'rest'));
      for(const note of result.notes){
        const card=make('article');card.className=`annotation-card annotation-${note.color}`;
        card.append(make('h3',`Revisão ${note.source_revision}${materialId?'':' · '+(titles.get(note.material_id)||'Aula')}`));
        if(note.quote)card.append(make('blockquote',note.quote));
        if(!materialId){const link=make('a',note.quote?'Abrir no trecho da aula':'Abrir aula');link.href=lessonHref(note);card.append(make('p',note.note_text),link);}
        else{
          const editLabel=make('label','Editar anotação'),edit=make('textarea');edit.value=note.note_text;edit.maxLength=5000;editLabel.append(edit);
          const save=make('button','Salvar edição'),remove=make('button','Excluir anotação');save.type=remove.type='button';
          const mutate=pendingMutation(saveAnnotation,()=>crypto.randomUUID());
          const update=(body,done)=>{save.disabled=remove.disabled=true;void mutate({id:note.id,materialId,version:note.version,body}).then(()=>{status.textContent=done;return load();}).catch((e)=>{status.textContent=e.message;}).finally(()=>{save.disabled=remove.disabled=false;});};
          save.addEventListener('click',()=>{if(!edit.value.trim()&&!note.quote){status.textContent='Escreva a anotação ou exclua-a.';edit.focus();return;}update({noteText:edit.value},'Edição salva na conta.');});
          remove.addEventListener('click',()=>{if(confirm('Excluir esta anotação? Ela deixa de aparecer nesta aula e nas buscas.'))update({deleted:true},'Anotação excluída.');});card.append(editLabel,save,remove);
          if(note.quote){
            const locate=make('button','Ir ao destaque');locate.type='button';
            locate.addEventListener('click',()=>{
              signal('open-transcript',{});
              const revision=source()?.transcription?.current_revision;
              const found=segments.closest('[data-mode]')?.dataset.mode==='reading'?focusReadingAnnotation(note,segments,revision):focusAnnotation(note,segments,revision);
              if(!found)status.textContent='Este destaque pertence a outra revisão ou o trecho foi editado. O texto original está preservado acima.';
            });
            card.append(locate);
            // Timestamp of the passage: listen to it in the player.
            const segment=source()?.transcription?.transcription_segments?.find((item)=>item.position===note.segment_position);
            const stamp=[...segments.querySelectorAll('.transcription-segment')].find((item)=>Number(item.dataset.segmentPosition)===note.segment_position)?.querySelector('.segment-timestamp');
            if(segment&&stamp&&note.source_revision===source()?.transcription?.current_revision){
              const at=Math.floor(Number(segment.start_ms)/1000);
              const listen=make('button',`Ouvir ${String(Math.floor(at/60)).padStart(2,'0')}:${String(at%60).padStart(2,'0')}`);listen.type='button';listen.className='annotation-listen';
              listen.disabled=stamp.disabled;listen.addEventListener('click',()=>stamp.click());card.append(listen);
            }
          }
        }list.append(card);
      }
      count.textContent=`${result.notes.length?offset+1:0}–${offset+result.notes.length} de ${total}`;
      // One page or none: the page controls only add noise.
      nav.hidden=total<=pageSize&&offset===0;
    }catch(error){if(request===version){list.replaceChildren();status.textContent=error.message;if(!materialId)signal('notes',{error:error.message||'Anotações indisponíveis.'});}}
    finally{if(request===version){find.disabled=false;previous.disabled=offset===0;next.disabled=offset+pageSize>=total;}}
  }
  searchForm.addEventListener('submit',(e)=>{e.preventDefault();void load(0);});
  if(!materialId)document.addEventListener('voz:notes-command',(event)=>{if(event.detail?.action!=='search')return;search.value=String(event.detail.q||'').slice(0,200);search.focus();void load(0);});previous.addEventListener('click',()=>{void load(Math.max(0,offset-pageSize));});next.addEventListener('click',()=>{void load(offset+pageSize);});
  await load(0);
}
