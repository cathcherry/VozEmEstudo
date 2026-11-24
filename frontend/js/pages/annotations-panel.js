import { ninoNote } from '../utils/material-ui.js';
import { listAnnotations,saveAnnotation } from '../api/learning-tools.api.js';
import { selectionAnchor,focusAnnotation,readingSelectionAnchor,focusReadingAnnotation } from '../utils/annotation-anchor.js';
import { pendingMutation } from '../utils/pending-mutation.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { createSelectionToolbar } from './selection-toolbar.js';
import { icon } from '../utils/icons.js';
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
// A button with an icon before its label (compact panel).
const iconButton=(name,text,className)=>{const node=make('button');node.type='button';if(className)node.className=className;node.append(icon(name,{size:16}),make('span',text));return node;};
// Tells the dashboard summary what changed. Inline (no import) so panel tests can evaluate this file.
const signal=(name,detail)=>{try{const view=document.defaultView;if(view?.CustomEvent)document.dispatchEvent(new view.CustomEvent(`voz:${name}`,{detail}));}catch{/* optional */}};
/** Lesson link for a note: with a highlight, the lesson opens on that passage (searched and bolded). */
export function lessonHref(note){
  const params=new URLSearchParams({id:note.material_id});
  const quote=String(note.quote||'').split('\n')[0].trim();
  if(quote){params.set('busca',quote.length>80?quote.slice(0,80).replace(/\s+\S*$/,''):quote);if(Number.isInteger(note.segment_position))params.set('trecho',String(note.segment_position));}
  return `./material.html?${params}`;
}
// multiSegment/notebook: Notes 3.0 (FEATURE_NOTEBOOKS): selections may cross segments, and each
// highlight can be cited in the lesson notebook.
export async function initAnnotationsPanel({panel,materialId,context,segments,materials=[],multiSegment=false,notebook=false}){
  // With the lesson notebook, the notebook is where you write; this panel becomes the compact list
  // of the lesson's highlights below it ("Destaques da aula"), with a loose note folded away.
  const compact=Boolean(materialId&&notebook);
  const heading=make('h2',compact?'Destaques da aula':materialId?'Anotações e destaques':'Buscar nas suas anotações');
  panel.hidden=false;panel.replaceChildren();
  // Compact: one header row (title, search, "Nova anotação"); no instructions on screen.
  const head=compact?make('div'):null,tools=compact?make('div'):null;
  if(compact){panel.classList.add('annotations-compact');head.className='annotations-head';tools.className='annotations-tools';head.append(heading,tools);panel.append(head);}else panel.append(heading);
  const status=make('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let selectedField=null,anchor=null,draftId=crypto.randomUUID(),offset=0,version=0,total=0,pageSize=50;
  const source=()=>context?.();
  const selectionError=(error)=>error==='multi'?'Por enquanto, destaque dentro de um único trecho.':error==='long'?'Selecione até 1.000 caracteres para destacar.':'Selecione um trecho do texto da transcrição.';
  if(materialId){
    segments.addEventListener('select',(event)=>{if(event.target.tagName==='TEXTAREA')selectedField=event.target;});
    // Only stored anchor fields; a range adds where it ends (Notes 3.0).
    const anchorFrom=(selection)=>({segmentPosition:selection.segmentPosition,startOffset:selection.startOffset,endOffset:selection.endOffset,quote:selection.quote,
      ...(selection.endSegmentPosition!==undefined&&selection.endSegmentPosition!==selection.segmentPosition?{endSegmentPosition:selection.endSegmentPosition}:{})});
    const save=pendingMutation(saveAnnotation,()=>crypto.randomUUID());
    const form=make('form'),textLabel=make('label',compact?'Nova anotação':'Sua anotação'),text=make('textarea');text.maxLength=5000;text.rows=3;textLabel.append(text);
    const colorLabel=make('label',compact?'Cor':'Cor do destaque'),color=make('select');for(const value of ['yellow','green','blue'])color.append(new Option({yellow:'Amarelo',green:'Verde',blue:'Azul'}[value],value));colorLabel.append(color);
    const capture=make('button','Usar seleção da transcrição'),clear=make('button','Remover seleção'),preview=make('p');capture.type=clear.type='button';
    // Compact: the quote being annotated shows above the text, with an × to drop it.
    const quoted=compact?make('div'):null;
    if(compact){textLabel.className='annotation-new-label';textLabel.firstChild.replaceWith(Object.assign(make('span','Nova anotação'),{className:'sr-only'}));text.placeholder='Escreva sua anotação';preview.className='annotation-new-quote';clear.replaceChildren(icon('close',{size:16}));clear.className='icon-only';clear.setAttribute('aria-label','Remover trecho');quoted.className='annotation-new-quoted';quoted.hidden=true;quoted.append(preview,clear);}
    const quoteText=(revision,quote)=>compact?quote:`Destaque da revisão ${revision}: ${quote}`;
    const showQuote=()=>{if(quoted)quoted.hidden=!preview.textContent;};
    capture.addEventListener('click',()=>{
      if(segments.closest('[data-mode]')?.dataset.mode==='reading'){
        const result=readingSelectionAnchor(segments,undefined,{multi:multiSegment});
        if(result.error){status.textContent=selectionError(result.error);return;}
        anchor={...anchorFrom(result),sourceRevisionId:source().review.sourceRevisionId};
        preview.textContent=quoteText(source().transcription.current_revision,result.quote);showQuote();return;
      }
      const article=selectedField?.closest('.transcription-segment'),position=Number(article?.dataset.segmentPosition);
      const segment=source()?.transcription?.transcription_segments.find((s)=>s.position===position);
      if(!selectedField?.isConnected||!segment||selectedField.value!==segment.current_text){status.textContent='Selecione um trecho da transcrição salva. Salve alterações antes de destacar.';return;}
      const selection=selectionAnchor(selectedField,position);
      if(!selection||selection.quote.length>1000){status.textContent='Selecione de 1 a 1.000 caracteres para destacar.';return;}
      anchor={...selection,sourceRevisionId:source().review.sourceRevisionId};preview.textContent=quoteText(source().transcription.current_revision,selection.quote);showQuote();
    });
    clear.addEventListener('click',()=>{anchor=null;preview.textContent='';showQuote();if(compact)text.focus();});
    // Floating toolbar over a selection in the reading view (selection-toolbar.js): highlight now,
    // write a note about it, or start an investigation from it (discoveries, confirmed lessons).
    const reading=()=>segments.closest('[data-mode]')?.dataset.mode==='reading';
    let discoveries=false;void isFeatureEnabled('discoveries').then((on)=>{discoveries=Boolean(on);}).catch(()=>{});
    const confirmed=()=>source()?.review?.state==='ready_to_generate';
    const highlight=(pending)=>{
      const material=source();if(!material?.review?.sourceRevisionId)return;
      const body={sourceRevisionId:material.review.sourceRevisionId,...anchorFrom(pending),noteText:'',color:'yellow'};
      globalThis.getSelection()?.removeAllRanges();
      void save({id:crypto.randomUUID(),materialId,version:0,body}).then(()=>{status.textContent='Destaque salvo.';signal('notes-changed',{materialId});return load(0);}).catch((error)=>{status.textContent=error.message;});
    };
    const annotate=(pending)=>{
      const material=source();if(!material?.review?.sourceRevisionId)return;
      anchor={...anchorFrom(pending),sourceRevisionId:material.review.sourceRevisionId};
      preview.textContent=quoteText(material.transcription.current_revision,pending.quote);showQuote();
      if(compact)setNewOpen(true);
      signal('open-notes',{});
      setTimeout(()=>text.focus(),0);
    };
    // Notebook on: the selection becomes a highlight and is cited in the notebook at the caret,
    // keeping its revision, passage and time (an annotation_ref block).
    const cite=(pending)=>{
      const material=source();if(!material?.review?.sourceRevisionId)return;
      const body={sourceRevisionId:material.review.sourceRevisionId,...anchorFrom(pending),noteText:'',color:'yellow'};const id=crypto.randomUUID();
      globalThis.getSelection()?.removeAllRanges();
      void save({id,materialId,version:0,body}).then(()=>{
        const note={id,material_id:materialId,source_revision_id:body.sourceRevisionId,source_revision:material.transcription?.current_revision,segment_position:body.segmentPosition,end_segment_position:body.endSegmentPosition??body.segmentPosition,start_offset:body.startOffset,end_offset:body.endOffset,quote:body.quote,note_text:'',color:'yellow',version:1};
        signal('notebook-cite',{note});signal('notes-changed',{materialId});status.textContent='Trecho citado no caderno da aula.';return load(0);
      }).catch((error)=>{status.textContent=error.message;});
    };
    const investigateHref=(pending)=>{
      const params=new URLSearchParams({aula:materialId});
      const quote=String(pending.quote||'').replace(/\s+/g,' ').trim();
      if(quote)params.set('trecho',[...quote].slice(0,240).join(''));
      return `./investigar.html?${params}`;
    };
    createSelectionToolbar({
      container:segments,
      isActive:reading,
      resolve:()=>readingSelectionAnchor(segments,undefined,{multi:multiSegment}),
      errorText:selectionError,
      actions:[
        {id:'highlight',label:'Destacar',run:highlight},
        ...(notebook?[{id:'cite',label:'Citar no caderno',run:cite}]:[]),
        {id:'note',label:'Anotar',run:annotate},
        {id:'investigate',label:'Investigar',available:()=>discoveries&&confirmed(),href:investigateHref},
      ],
    });
    const submit=make('button',compact?'Salvar':'Salvar anotação');submit.type='submit';
    // Compact: a "Nova anotação" button in the header opens a small form (also opened by "Anotar").
    let setNewOpen=()=>{};
    if(compact){
      const add=iconButton('note','Nova anotação','annotations-add'),cancel=make('button','Cancelar'),actions=make('div');
      form.id='annotation-new-form';form.className='annotation-new';form.hidden=true;add.setAttribute('aria-controls',form.id);add.setAttribute('aria-expanded','false');
      cancel.type='button';actions.className='annotation-new-actions';colorLabel.className='annotation-color';
      actions.append(colorLabel,cancel,submit);
      setNewOpen=(open)=>{form.hidden=!open;add.setAttribute('aria-expanded',String(open));if(open)setTimeout(()=>text.focus(),0);};
      add.addEventListener('click',()=>setNewOpen(form.hidden));
      cancel.addEventListener('click',()=>{form.reset();anchor=null;preview.textContent='';showQuote();setNewOpen(false);add.focus();});
      form.append(quoted,textLabel,actions);tools.append(add);panel.append(form);
    }else{form.append(textLabel,colorLabel,capture,clear,preview,submit);panel.append(form);}
    form.addEventListener('submit',(event)=>{
      event.preventDefault();const material=source();if(!material?.review?.sourceRevisionId){status.textContent='A transcrição ainda não está disponível.';return;}
      if(!text.value.trim()&&!anchor){status.textContent='Escreva uma anotação ou selecione um destaque.';return;}
      submit.disabled=true;
      void save({id:draftId,materialId,version:0,body:{sourceRevisionId:material.review.sourceRevisionId,...(anchor||{}),noteText:text.value,color:color.value}})
        .then(()=>{draftId=crypto.randomUUID();form.reset();anchor=null;preview.textContent='';showQuote();if(compact)setNewOpen(false);status.textContent='Anotação salva.';return load(0);})
        .catch((error)=>{status.textContent=error.message;}).finally(()=>{submit.disabled=false;});
    });
  }
  const searchForm=make('form'),label=make('label',compact?'':'Pesquisar texto e destaques'),search=make('input');search.type='search';search.maxLength=200;label.append(search);
  const find=make('button','Buscar');find.type='submit';searchForm.append(label,find);
  if(compact){
    // Compact: one search field with an icon button; Enter searches too.
    searchForm.className='annotations-search';searchForm.setAttribute('role','search');label.className='annotations-search-field';
    search.placeholder='Buscar';search.setAttribute('aria-label','Buscar nos destaques');
    find.replaceChildren(icon('search',{size:16}));find.className='icon-only';find.setAttribute('aria-label','Buscar');
    tools.prepend(searchForm);panel.append(status);
  }else panel.append(searchForm,status);
  const list=make('div'),nav=make('nav'),previous=make('button','Anotações anteriores'),next=make('button','Próximas anotações'),count=make('span');previous.type=next.type='button';nav.setAttribute('aria-label','Páginas das anotações');nav.append(previous,count,next);panel.append(list,nav);
  const titles=new Map(materials.map((item)=>[item.id,item.title]));
  async function load(nextOffset=offset){
    const request=++version;find.disabled=previous.disabled=next.disabled=true;
    try{
      const result=await listAnnotations({materialId,q:search.value.trim(),offset:nextOffset});if(request!==version)return;
      offset=nextOffset;total=result.total;pageSize=Number(result.limit)||pageSize;list.replaceChildren();
      if(!materialId&&!search.value.trim())signal('notes',{total});
      if(!result.notes.length)list.append(ninoNote(search.value.trim()?(compact?'Nada encontrado.':'Nenhuma anotação encontrada.'):(compact?'Nenhum destaque ainda.':'Nenhuma anotação ainda.'),search.value.trim()?'curious':'rest'));
      for(const note of result.notes){
        const card=make('article');card.className=`annotation-card annotation-${note.color}`;
        const range=Number.isInteger(note.end_segment_position)&&note.end_segment_position>note.segment_position;
        if(compact){
          // Compact: the quote and the note; the revision only when it is not the current one.
          const current=source()?.transcription?.current_revision;
          if(current!==undefined&&note.source_revision!==current){const older=make('p','Versão anterior da transcrição');older.className='annotation-older';card.append(older);}
          if(note.quote)card.append(make('blockquote',note.quote));
          if(range)card.classList.add('annotation-range');
        }else{
          card.append(make('h3',`Revisão ${note.source_revision}${materialId?'':' · '+(titles.get(note.material_id)||'Aula')}`));
          if(note.quote)card.append(make('blockquote',note.quote));
          if(range){card.classList.add('annotation-range');card.append(make('p',`Abrange ${note.end_segment_position-note.segment_position+1} trechos da transcrição`));}
        }
        if(!materialId){const link=make('a',note.quote?'Abrir no trecho da aula':'Abrir aula');link.href=lessonHref(note);card.append(make('p',note.note_text),link);}
        else{
          const editLabel=make('label','Editar anotação'),edit=make('textarea');edit.value=note.note_text;edit.maxLength=5000;editLabel.append(edit);
          if(compact&&note.note_text){const shown=make('p',note.note_text);shown.className='annotation-note';card.append(shown);}
          const save=make('button',compact?'Salvar':'Salvar edição'),remove=make('button',compact?'Excluir':'Excluir anotação');save.type=remove.type='button';
          const mutate=pendingMutation(saveAnnotation,()=>crypto.randomUUID());
          const update=(body,done)=>{save.disabled=remove.disabled=true;void mutate({id:note.id,materialId,version:note.version,body}).then(()=>{status.textContent=done;return load();}).catch((e)=>{status.textContent=e.message;}).finally(()=>{save.disabled=remove.disabled=false;});};
          save.addEventListener('click',()=>{if(!edit.value.trim()&&!note.quote){status.textContent='Escreva a anotação ou exclua-a.';edit.focus();return;}update({noteText:edit.value},'Edição salva.');});
          remove.addEventListener('click',()=>{if(confirm('Excluir esta anotação? Ela deixa de aparecer nesta aula e nas buscas.'))update({deleted:true},'Anotação excluída.');});
          // Compact: one row of icon actions; "Editar"/"Comentar" opens the text below the row.
          const row=compact?make('div'):card;let editing=null;
          if(compact){row.className='annotation-actions';editing=make('div');editing.className='annotation-edit';editing.hidden=true;editing.id=`annotation-edit-${note.id}`;
            editLabel.className='annotation-edit-label';editLabel.firstChild.replaceWith(Object.assign(make('span','Editar anotação'),{className:'sr-only'}));const editActions=make('div');editActions.className='annotation-edit-actions';remove.className='annotation-remove';editActions.append(save,remove);editing.append(editLabel,editActions);}
          else card.append(editLabel,save,remove);
          if(notebook&&note.source_revision_id){const cite=compact?iconButton('quote','Citar no caderno'):make('button','Citar no caderno');cite.type='button';cite.addEventListener('click',()=>signal('notebook-cite',{note}));row.append(cite);}
          if(note.quote){
            const locate=compact?iconButton('highlight','Ir ao destaque'):make('button','Ir ao destaque');locate.type='button';
            locate.addEventListener('click',()=>{
              signal('open-transcript',{});
              const revision=source()?.transcription?.current_revision;
              const found=segments.closest('[data-mode]')?.dataset.mode==='reading'?focusReadingAnnotation(note,segments,revision):focusAnnotation(note,segments,revision);
              if(!found)status.textContent='Este trecho mudou na transcrição. O texto destacado continua no cartão.';
            });
            row.append(locate);
            // Timestamp of the passage: listen to it in the player.
            const segment=source()?.transcription?.transcription_segments?.find((item)=>item.position===note.segment_position);
            const stamp=[...segments.querySelectorAll('.transcription-segment')].find((item)=>Number(item.dataset.segmentPosition)===note.segment_position)?.querySelector('.segment-timestamp');
            if(segment&&stamp&&note.source_revision===source()?.transcription?.current_revision){
              const at=Math.floor(Number(segment.start_ms)/1000);
              const listenText=`Ouvir ${String(Math.floor(at/60)).padStart(2,'0')}:${String(at%60).padStart(2,'0')}`;
              const listen=compact?iconButton('listen',listenText):make('button',listenText);listen.type='button';listen.classList.add('annotation-listen');
              listen.disabled=stamp.disabled;listen.addEventListener('click',()=>stamp.click());row.append(listen);
            }
          }
          if(compact){
            const toggle=iconButton('edit',note.note_text?'Editar':'Comentar','annotation-edit-toggle');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',editing.id);
            toggle.addEventListener('click',()=>{editing.hidden=!editing.hidden;toggle.setAttribute('aria-expanded',String(!editing.hidden));if(!editing.hidden)edit.focus();});
            row.append(toggle);card.append(row,editing);
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
