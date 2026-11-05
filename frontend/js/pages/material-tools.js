import { isFeatureEnabled } from '../utils/feature-flags.js';
import { initAnnotationsPanel } from './annotations-panel.js';
import { initSharingPanel } from './sharing-panel.js';
import { listAnnotations } from '../api/learning-tools.api.js';
import { exportDocument,exportText,downloadText,printStudyDocument } from '../utils/study-export.js';
export async function initMaterialTools({materialId,context,segments}){
  const root=document.querySelector('[data-material-tools]');root.hidden=false;
  const form=document.createElement('div');form.className='learning-tools-controls';
  const heading=document.createElement('h2');heading.textContent='Exportar textos salvos';root.append(heading,form);
  const options={};for(const [key,label,checked] of [['transcript','Transcrição',true],['summary','Resumo',true],['notes','Minhas anotações',false]]){
    const wrap=document.createElement('label'),field=document.createElement('input');field.type='checkbox';field.checked=checked;wrap.append(field,' '+label);form.append(wrap);options[key]=field;
  }
  const notesEnabled=await isFeatureEnabled('annotations').catch(()=>false);options.notes.disabled=!notesEnabled;
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
  for(const [format,label] of [['txt','Baixar TXT'],['md','Baixar Markdown'],['pdf','Imprimir / salvar PDF']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;form.append(button);
    button.addEventListener('click',()=>{
      const popup=format==='pdf'?window.open('','_blank'):null;button.disabled=true;
      void (async()=>{const notes=[];let offset=0,total;
        if(options.notes.checked&&notesEnabled)do{const page=await listAnnotations({materialId,offset});notes.push(...page.notes);total=page.total;if(!page.notes.length&&offset<total)throw new Error('Não foi possível completar a exportação das anotações.');offset+=page.limit;}while(offset<total);
        const data=exportDocument(context(),{transcript:options.transcript.checked,summary:options.summary.checked,notes});
        if(!data.sections.length)throw new Error('Selecione pelo menos um texto disponível para exportar.');
        if(format==='pdf')printStudyDocument(data,popup);else downloadText(exportText(data,format==='md'),`voz-em-estudo.${format}`);
        status.textContent=format==='pdf'?'Na janela de impressão, escolha Salvar como PDF.':'Arquivo preparado com os textos salvos e suas revisões.';
      })().catch((error)=>{popup?.close();status.textContent=error.message;}).finally(()=>{button.disabled=false;});
    });
  }
  const note=document.createElement('p');note.textContent='A exportação usa as versões salvas. Alterações ainda não salvas nos campos de edição não entram no arquivo.';root.append(note);
  const results=await Promise.allSettled([
    notesEnabled?initAnnotationsPanel({panel:document.querySelector('[data-annotations-panel]'),materialId,context,segments}):Promise.resolve(),
    (async()=>{if(await isFeatureEnabled('sharing'))await initSharingPanel({panel:document.querySelector('[data-sharing-panel]'),materialId,context});})(),
  ]);
  if(results.some((r)=>r.status==='rejected'))status.textContent='Algumas ferramentas estão indisponíveis. A exportação dos textos continua disponível.';
}
