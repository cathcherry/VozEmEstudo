import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { listMaterials, deleteMaterial, updateMaterial } from '../api/material.api.js';
import { studyFor, metadataTags, saveTags } from '../utils/study-store.js';
import { materialRow, materialHref } from '../utils/library-ui.js';
import { materialState, emptyState, errorState } from '../utils/material-ui.js';
import { initCatalogPanel } from './catalog-panel.js';

await initAuthenticatedShell();
const query=new URLSearchParams(location.search);
const search=document.querySelector('#library-search'), groups=document.querySelector('[data-library-groups]'), state=document.querySelector('[data-library-state]'), container=document.querySelector('[data-library-data]'), count=document.querySelector('[data-library-count]'), loading=document.querySelector('[data-library-loading]');
const controls=Object.fromEntries(['subject','tag','status','study','group','order'].map(key=>[key,document.querySelector('#library-'+key)]));
search.value=query.get('q')||''; if(['active','completed','new'].includes(query.get('study'))) controls.study.value=query.get('study');
let materials=[], loaded=false, editing=null, announceTimer, returnFocus=null;
let catalogPanel=null, catalogInitialized=false;
const dialog=document.querySelector('#metadata-dialog'), form=document.querySelector('[data-metadata-form]'), message=document.querySelector('[data-metadata-message]');
const nameField=document.querySelector('#metadata-name'), subjectField=document.querySelector('#metadata-subject'), tagsField=document.querySelector('#metadata-tags');
function fillOptions(control,values) { const previous=control.value; control.querySelectorAll('option:not(:first-child)').forEach(x=>x.remove()); for(const value of values) { const option=document.createElement('option'); option.value=value; option.textContent=value; control.append(option); } if([...control.options].some(o=>o.value===previous)) control.value=previous; }
function populateFilters() {
  fillOptions(controls.subject,[...new Set(materials.map(m=>m.subject||'Sem disciplina'))].sort((a,b)=>a.localeCompare(b,'pt-BR')));
  fillOptions(controls.tag,[...new Set(materials.flatMap(metadataTags))].sort((a,b)=>a.localeCompare(b,'pt-BR')));
  const suggestions=document.querySelector('#subject-suggestions'); suggestions.replaceChildren(); for(const value of [...new Set(materials.map(m=>m.subject).filter(Boolean))]) { const o=document.createElement('option'); o.value=value; suggestions.append(o); }
}
function clear() { search.value=''; for(const key of ['subject','tag','status','study']) controls[key].value='all'; render(); search.focus(); }
function edit(material) { returnFocus=document.activeElement; editing=material; nameField.value=material.title; subjectField.value=material.subject||''; tagsField.value=studyFor(material.id).tags.join(', '); setStatus(message,''); dialog.showModal(); nameField.focus(); }
function row(material) {
  const item=materialRow(material), actions=item.querySelector('.material-row-actions');
  const menu=document.createElement('details'); menu.className='row-menu';
  const summary=document.createElement('summary'); summary.textContent='Mais'; summary.setAttribute('aria-label',`Mais ações para ${material.title}`);
  const options=document.createElement('div'); options.className='row-menu-content';
  const organize=document.createElement('button'); organize.type='button'; organize.textContent='Editar disciplina e tags'; organize.addEventListener('click',()=>{menu.open=false;edit(material);});
  const questions=document.createElement('a'); questions.href=materialHref(material.id)+'#questoes'; questions.textContent='Ver questões';
  const remove=document.createElement('button'); remove.type='button'; remove.className='delete-button'; remove.textContent='Excluir material';
  remove.addEventListener('click',async()=>{if(!confirm(`Excluir “${material.title}” e todos os materiais derivados?`))return; remove.disabled=true; try { await deleteMaterial(material.id); materials=materials.filter(m=>m.id!==material.id); catalogPanel?.setMaterials(materials); populateFilters(); render(); }catch(e){setStatus(count,e.message,'error');remove.disabled=false;}});
  options.append(organize); if(materialState(material)==='ready')options.append(questions); options.append(remove); menu.append(summary,options); actions.append(menu); return item;
}
function render() {
  if(!loaded)return;
  const needle=search.value.trim().toLocaleLowerCase('pt-BR');
  const visible=materials.filter(m=>{
    const tags=metadataTags(m), s=studyFor(m.id), phase=s.completed?'completed':s.openedAt?'active':'new';
    return `${m.title} ${tags.join(' ')}`.toLocaleLowerCase('pt-BR').includes(needle)
      && (controls.subject.value==='all'||(m.subject||'Sem disciplina')===controls.subject.value)
      && (controls.tag.value==='all'||tags.includes(controls.tag.value))
      && (controls.status.value==='all'||materialState(m)===controls.status.value)
      && (controls.study.value==='all'||phase===controls.study.value);
  }).sort((a,b)=>controls.order.value==='title'?a.title.localeCompare(b.title,'pt-BR'):controls.order.value==='opened'?(studyFor(b.id).openedAt||0)-(studyFor(a.id).openedAt||0):new Date(b.created_at)-new Date(a.created_at));
  clearTimeout(announceTimer); announceTimer=setTimeout(()=>{count.textContent=`${visible.length} ${visible.length===1?'aula':'aulas'}${visible.length!==materials.length?' de '+materials.length:''}`;},180);
  groups.replaceChildren(); state.replaceChildren(); state.hidden=Boolean(visible.length);
  if(!visible.length) {
    const card=emptyState(materials.length?'Nenhum material encontrado.':'Você ainda não enviou uma aula.',materials.length?'Tente outro título, disciplina ou tag.':'Suas aulas aparecerão aqui depois do envio.',{mascot:false,href:materials.length?null:'./nova-transcricao.html'});
    if(materials.length) {const button=document.createElement('button');button.className='secondary-action';button.type='button';button.textContent='Limpar busca e filtros';button.addEventListener('click',clear);card.querySelector('div').append(button);}
    state.append(card); return;
  }
  const mapping=new Map();
  for(const material of visible) {
    const keys=controls.group.value==='tags'?metadataTags(material):controls.group.value==='subject'?[material.subject||'Sem disciplina']:controls.group.value==='unit' && catalogPanel?[catalogPanel.unitLabelForMaterial(material)]:['Todas as aulas'];
    for(const key of keys) { const list=mapping.get(key)||[];list.push(material);mapping.set(key,list); }
  }
  let groupIndex=0;
  for(const [label,items] of mapping) {
    const section=document.createElement('section'); section.className='library-group'; const heading=document.createElement('h2'); heading.id='library-group-'+groupIndex++; section.setAttribute('aria-labelledby',heading.id); heading.textContent=label;
    const small=document.createElement('small');small.textContent=`${items.length} ${items.length===1?'aula':'aulas'}`;heading.append(' ',small);section.append(heading);
    for(const material of items)section.append(row(material));groups.append(section);
  }
}
form.addEventListener('submit',async(event)=>{
  event.preventDefault();if(!editing||!form.reportValidity())return;const button=form.querySelector('[type="submit"]');button.disabled=true;
  try {
    const changes = { title: nameField.value.trim() };
    if ((editing.subject || '') !== subjectField.value.trim()) {
      changes.subject = subjectField.value.trim() || null;
    }
    const updated=await updateMaterial(editing.id,changes);
    const persisted=saveTags(editing.id,tagsField.value);
    materials=materials.map(m=>m.id===editing.id?{...m,...updated,title:nameField.value.trim(),subject:subjectField.value.trim()||null}:m);
    catalogPanel?.setMaterials(materials);populateFilters();render();dialog.close();count.textContent=persisted?'Organização salva.':'Título e disciplina salvos. O armazenamento deste navegador não permitiu salvar as tags.';
  }catch(e){setStatus(message,e.message,'error');}finally{button.disabled=false;}
});
dialog.addEventListener('close',()=>{ if(returnFocus?.isConnected)returnFocus.focus(); else search.focus({preventScroll:true}); });
document.querySelector('[data-close-metadata]').addEventListener('click',()=>dialog.close());
search.addEventListener('input',render); Object.values(controls).forEach(c=>c.addEventListener('change',render)); document.querySelector('[data-clear-filters]').addEventListener('click',clear);
document.querySelector('[data-library-search]').addEventListener('submit',e=>{e.preventDefault();render();});
async function load() {
  loaded=false;container.setAttribute('aria-busy','true');loading.hidden=false;groups.replaceChildren();state.hidden=true;
  try {materials=await listMaterials();loaded=true;
    if (!catalogInitialized) {
      catalogInitialized = true;
      try {
        catalogPanel = await initCatalogPanel({
          onAssigned(updated) {
            materials = materials.map((m) => m.id === updated.id ? { ...m, ...updated } : m);
            catalogPanel?.setMaterials(materials);
            populateFilters(); render();
          },
        });
        if (catalogPanel) {
          const option = document.createElement('option');
          option.value = 'unit'; option.textContent = 'Unidade';
          controls.group.append(option);
        }
      } catch (error) {
        const catalogNotice = document.querySelector('[data-catalog-status]');
        setStatus(catalogNotice, error.message || 'Não foi possível carregar o catálogo.', 'error');
      }
    }
    catalogPanel?.setMaterials(materials);
    populateFilters();if(query.has('subject')&&[...controls.subject.options].some(o=>o.value===query.get('subject')))controls.subject.value=query.get('subject');render(); const target=materials.find(m=>m.id===query.get('edit'));if(target)edit(target);}
  catch(e){count.textContent='Biblioteca indisponível no momento.';state.hidden=false;state.replaceChildren(errorState(e.message,load));}
  finally{loading.hidden=true;container.setAttribute('aria-busy','false');}
}
load();
