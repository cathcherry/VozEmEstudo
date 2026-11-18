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
const drawings = {grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>'};
for (const [mode,label] of [['grid','Grade'],['list','Lista']]) {
  const button=document.createElement('button'); button.type='button'; button.title=label; button.setAttribute('aria-label',label); button.setAttribute('aria-pressed',String(mode==='grid'));
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'+drawings[mode]+'</svg>';
  button.addEventListener('click',()=>{root.dataset.libraryLayout=mode;window.dispatchEvent(new Event('library-layout-changed'));for(const item of layouts.children)item.setAttribute('aria-pressed',String(item===button));}); layouts.append(button);
}
toolbar.append(layouts);
const filter=document.createElement('button');filter.type='button';filter.className='file-filter-toggle';filter.title='Filtros';filter.setAttribute('aria-label','Filtros');filter.setAttribute('aria-expanded','false');filter.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>';
filter.addEventListener('click',()=>{panel.open=!panel.open;});panel.addEventListener('toggle',()=>filter.setAttribute('aria-expanded',String(panel.open)));toolbar.append(filter);
root.dataset.libraryLayout='grid';
const input=document.querySelector('#library-search');input.placeholder='Buscar na biblioteca';
const create=document.querySelector('[data-open-new-subject]');create.textContent='+';create.title='Nova disciplina';create.setAttribute('aria-label','Nova disciplina');
