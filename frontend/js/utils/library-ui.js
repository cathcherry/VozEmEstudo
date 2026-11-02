import { studyFor, listeningPercent, metadataTags } from './study-store.js';
import { statusChip, materialState } from './material-ui.js';
import { formatDate, formatDuration } from './format.js';
export const materialHref = (id) => `./material.html?id=${encodeURIComponent(id)}`;
export function playbackAtEnd(material) {
  const state = studyFor(material.id);
  return state.duration > 0 && state.position >= state.duration - .2;
}
export function tagList(material) {
  const list=document.createElement('ul'); list.className='material-tags'; list.setAttribute('aria-label','Tags');
  for (const value of metadataTags(material)) { const item=document.createElement('li'); item.textContent=value; list.append(item); }
  return list;
}
export function reviewLabel(material) {
  const state=studyFor(material.id);
  if (state.completed) return 'Revisão concluída';
  if (state.openedAt) return 'Em estudo';
  return materialState(material)==='ready' ? 'Ainda não iniciado' : 'Preparando material';
}
export function progressNode(material) {
  const box=document.createElement('div'); box.className='study-progress';
  const state=studyFor(material.id), percent=listeningPercent(material.id);
  const text=document.createElement('span'); text.textContent=state.playedAt ? `${percent}% do áudio ouvido${state.completed ? ' · revisão concluída' : ''}` : reviewLabel(material);
  if (state.playedAt) { const p=document.createElement('progress'); p.max=100; p.value=percent; p.setAttribute('aria-label',`Áudio ouvido de ${material.title}`); box.append(p); }
  box.append(text); return box;
}
export function materialRow(material,{actions=true,compact=false}={}) {
  const card=document.createElement('article'); card.className=`library-material${compact ? ' compact-material' : ''}`; card.dataset.materialId=material.id;
  const main=document.createElement('div'); main.className='library-material-main';
  const heading=document.createElement('h3'); const title=document.createElement('a'); title.href=materialHref(material.id); title.textContent=material.title; heading.append(title);
  const meta=document.createElement('p'); meta.className='material-meta';
  const audio=Array.isArray(material.audio_files) ? material.audio_files[0] : material.audio_files || material.audio;
  meta.textContent=`${formatDate(material.created_at)}${audio?.duration_ms ? ' · '+formatDuration(audio.duration_ms) : ''}`;
  const rowHeading=document.createElement('div'); rowHeading.className='material-row-heading';
  rowHeading.append(heading,statusChip(material));
  main.append(rowHeading,tagList(material),meta); card.append(main,progressNode(material));
  if (actions) {
    const links=document.createElement('div'); links.className='material-row-actions';
    const open=document.createElement('a'); open.className='secondary-action'; open.href=materialHref(material.id);
    const state=studyFor(material.id), phase=materialState(material);
    open.textContent=phase==='processing'?'Ver andamento':phase==='failed'?'Ver erro':state.completed||playbackAtEnd(material)?'Revisar':state.openedAt?'Continuar':'Abrir';
    open.setAttribute('aria-label',`${open.textContent} ${material.title}`); links.append(open);
    if (materialState(material)==='ready') { const q=document.createElement('a'); q.href=materialHref(material.id)+'#gerar-questoes'; q.textContent='Gerar questões'; q.setAttribute('aria-label',`Gerar novas questões para ${material.title}`); links.append(q); }
    card.append(links);
  }
  return card;
}
