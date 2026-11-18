import { loadCloudState, saveCloudState } from './profile-cloud.js';
import { readProfileMedia, saveProfileMedia } from './profile-storage.js';

export async function validateFolderPng(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) throw new Error('Escolha um PNG de até 8 MB.');
  const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length!==8 || signature.some((byte,i)=>bytes[i]!==byte)) throw new Error('Escolha uma imagem PNG.');
  if (typeof createImageBitmap === 'function') {
    try { const image=await createImageBitmap(file);image.close(); }
    catch { throw new Error('Não foi possível abrir este PNG. Escolha outra imagem.'); }
  }
}

export function createFolderIcons(owner) {
  let index = {};
  let lastCatalog = null;
  const urls=new Map();
  const key=(kind,id)=>`${kind}-${id}`;
  function icon(kind,id) {
    const el=document.createElement('span');el.className='library-folder-icon folder-customizable';el.setAttribute('aria-hidden','true');
    const url=urls.get(key(kind,id));
    if(url){const img=document.createElement('img');img.src=url;img.alt='';img.draggable=false;el.append(img);}
    else {const mark=document.createElement('span');mark.className='folder-mark';el.append(mark);}
    return el;
  }
  async function load(catalog) {
    lastCatalog=catalog;
    index=await loadCloudState(owner,'catalog-icons',{}) || {};
    const entries=[...catalog.subjects.map(item=>['subject',item.id]),...catalog.units.map(item=>['unit',item.id])];
    await Promise.all(entries.filter(([kind,id])=>index[key(kind,id)]).map(async([kind,id])=>{
      const name=key(kind,id);
      try { const blob=await readProfileMedia(owner,`folder-${name}`);if(blob){if(urls.has(name))URL.revokeObjectURL(urls.get(name));urls.set(name,URL.createObjectURL(blob));} } catch { /* The default folder remains available. */ }
    }));
  }
  function picker(form,kind) {
    const details=document.createElement('details');details.className='folder-icon-options';
    const summary=document.createElement('summary');summary.append(icon());
    const name=document.createElement('span');name.textContent='Ícone';summary.append(name);
    const input=document.createElement('input');input.type='file';input.accept='image/png';input.id=`${kind}-folder-png`;input.className='folder-png-input';
    const label=document.createElement('label');label.htmlFor=input.id;label.className='folder-png-label';label.textContent='Personalizado (PNG)';
    const reset=document.createElement('button');reset.type='button';reset.textContent='×';reset.className='folder-icon-reset';reset.setAttribute('aria-label','Restaurar ícone padrão');reset.hidden=true;
    const message=document.createElement('span');message.className='folder-icon-message';message.setAttribute('role','status');
    const controls=document.createElement('div');controls.className='folder-icon-controls';controls.append(label,input,reset,message);details.append(summary,controls);
    form.querySelector('[type="submit"]').before(details);
    let draftUrl=null,revision=0;
    const clear=()=>{revision++;input.value='';if(draftUrl)URL.revokeObjectURL(draftUrl);draftUrl=null;summary.firstChild.replaceWith(icon());message.textContent='';reset.hidden=true;details.open=false;};
    input.addEventListener('change',async()=>{
      const token=++revision;
      try {const file=input.files[0];await validateFolderPng(file);if(token!==revision)return;
        if(draftUrl)URL.revokeObjectURL(draftUrl);draftUrl=file?URL.createObjectURL(file):null;
        const preview=icon();if(draftUrl){const img=document.createElement('img');img.src=draftUrl;img.alt='';preview.replaceChildren(img);}
        summary.firstChild.replaceWith(preview);message.textContent='';reset.hidden=!file;
      }catch(error){if(token===revision)message.textContent=error.message;}
    });
    reset.addEventListener('click',clear);form.addEventListener('reset',clear);
    return {
      validate:()=>validateFolderPng(input.files[0]),
      async commit(id) {
        const file=input.files[0];if(!file)return;
        const name=key(kind,id);
        await saveProfileMedia(owner,`folder-${name}`,file);
        if(urls.has(name))URL.revokeObjectURL(urls.get(name));urls.set(name,URL.createObjectURL(file));
        index[name]=true;await saveCloudState(owner,'catalog-icons',index);
      },
    };
  }
  window.addEventListener('online',async()=>{if(lastCatalog){await load(lastCatalog);window.dispatchEvent(new Event('folder-icons-updated'));}});
  return {icon,load,picker};
}
