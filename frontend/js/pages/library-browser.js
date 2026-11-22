import { iconMarkup } from '../utils/icons.js';
// Presentation controls reuse the library's existing search and folder actions.
const root = document.querySelector('body[data-page="history"]');
const panel = document.querySelector('.library-filter-panel');
const search = document.querySelector('.library-search');
const surface = search.closest('.study-section');
surface.classList.add('file-browser');
const toolbar = document.createElement('div'); toolbar.className = 'file-browser-toolbar';
search.before(toolbar); toolbar.append(search);
const layouts = document.createElement('div'); layouts.className = 'file-layout-switch';
layouts.setAttribute('role','group'); layouts.setAttribute('aria-label','Visualização das pastas');
const drawings = {grid:'grid',list:'rows'};
for (const [mode,label] of [['grid','Grade'],['list','Lista']]) {
  const button=document.createElement('button'); button.type='button'; button.title=label; button.setAttribute('aria-label',label); button.setAttribute('aria-pressed',String(mode==='grid'));
  button.innerHTML=iconMarkup(drawings[mode]);
  button.addEventListener('click',()=>{root.dataset.libraryLayout=mode;window.dispatchEvent(new Event('library-layout-changed'));for(const item of layouts.children)item.setAttribute('aria-pressed',String(item===button));}); layouts.append(button);
}
toolbar.append(layouts);
const filter=document.createElement('button');filter.type='button';filter.className='file-filter-toggle';filter.title='Filtros';filter.setAttribute('aria-label','Filtros');filter.setAttribute('aria-expanded','false');filter.innerHTML=iconMarkup('filter');
filter.addEventListener('click',()=>{panel.open=!panel.open;});panel.addEventListener('toggle',()=>filter.setAttribute('aria-expanded',String(panel.open)));toolbar.append(filter);
root.dataset.libraryLayout='grid';
const input=document.querySelector('#library-search');input.placeholder='Buscar na biblioteca';
const create=document.querySelector('[data-open-new-subject]');create.textContent='+ Nova disciplina';create.title='Nova disciplina';create.removeAttribute('aria-label');create.classList.add('library-new-folder');
