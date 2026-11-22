import { registerCloudMerge, loadCloudState, saveCloudState } from './profile-cloud.js';
import { readProfileMedia, saveProfileMedia } from './profile-storage.js';
import { ART, ART_BASE, EMBLEM_IDS } from '../art/manifest.js';

// Folder icons of the library. The choice for each subject or unit lives in the cloud state
// 'catalog-icons' under `<kind>-<id>`:
//   true            a custom PNG (the image itself is profile media `folder-<kind>-<id>`);
//   'emblem.<name>' an illustrated discipline emblem from the art manifest (3.6);
//   'none'          a plain folder, chosen on purpose;
//   (missing)       never chosen: the emblem is inferred from the folder's name, if any.
// Nothing is migrated: older values (true / missing) keep working as before.

// Custom icons are only ever added: keep the icons saved from every device.
registerCloudMerge('catalog-icons', (remote, local) => ({ ...(remote || {}), ...(local || {}) }));

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

/** Keywords (accent-free, lower case) that suggest an emblem for a folder name. Order matters. */
const EMBLEM_HINTS = [
  ['educacao-fisica', /educacao fisica|esporte|atletism/],
  ['biologia', /biolog|genetic|celula|ecolog|zoolog/],
  ['quimica', /quimic/],
  ['fisica', /fisic|mecanica|optica|termodin/],
  ['matematica', /matemat|algebra|calculo|geometr|estatist|aritmet/],
  ['historia', /histor/],
  ['geografia', /geograf|geolog|cartograf/],
  ['literatura', /portugu|literat|redac|gramat|leitura|escrita/],
  ['idiomas', /ingles|espanhol|frances|alemao|italiano|japones|chines|coreano|idioma|english|libras/],
  ['linguas', /lingu|comunicac/],
  ['artes', /arte|desenho|pintura|design/],
  ['musica', /music|canto|instrument/],
  ['filosofia', /filosof|etica|logica/],
  ['sociologia', /sociolog|antropolog|ciencias sociais|politic/],
  ['direito', /direito|jurid|leis?\b|constituc/],
  ['saude', /medic|saude|enfermag|anatom|farmac|fisiolog|nutric|odonto/],
  ['economia', /econom|financ|contab|administr|marketing|negocio/],
  ['computacao', /comput|program|informat|software|algoritm|dados|redes/],
  ['engenharia', /engenh|eletric|eletron|robot/],
  ['psicologia', /psicolog|neuro/],
  ['astronomia', /astronom|cosmo|universo/],
  ['botanica', /botan|plant|agro|jardin/],
  ['pesquisa', /pesquis|tcc|metodolog|monografi|cientific/],
];
const plain = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The emblem id a folder name suggests ("Biologia celular" → emblem.biologia), or null. */
export function emblemFor(name) {
  const text = plain(name);
  if (!text.trim()) return null;
  const hit = EMBLEM_HINTS.find(([, pattern]) => pattern.test(text));
  return hit ? `emblem.${hit[0]}` : null;
}
const isEmblem = (value) => typeof value === 'string' && Object.hasOwn(ART, value) && value.startsWith('emblem.');
const emblemSrc = (id) => `${ART_BASE}${ART[id].src}`;

/** A visible accessible radio grid of the discipline emblems (plus "plain folder"). */
function emblemGrid(kind) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'emblem-picker';
  const legend = document.createElement('legend');
  legend.textContent = 'Emblema da pasta';
  legend.className = 'sr-only';
  const hint = document.createElement('p');
  hint.className = 'emblem-picker-hint';
  hint.id = `${kind}-emblem-hint`;
  hint.textContent = 'Use as setas para percorrer os desenhos.';
  const grid = document.createElement('div');
  grid.className = 'emblem-grid';
  grid.setAttribute('aria-describedby', hint.id);
  const option = (value, title, art) => {
    const label = document.createElement('label');
    label.className = 'emblem-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `${kind}-emblem`;
    input.value = value;
    input.className = 'emblem-radio';
    const face = document.createElement('span');
    face.className = 'emblem-face';
    face.setAttribute('aria-hidden', 'true');
    if (art) {
      const img = document.createElement('img');
      img.src = emblemSrc(art);
      img.alt = '';
      img.width = 48;
      img.height = 48;
      img.loading = 'lazy';
      img.decoding = 'async';
      face.append(img);
    } else {
      const mark = document.createElement('span');
      mark.className = 'emblem-plain';
      face.append(mark);
    }
    const name = document.createElement('span');
    name.className = 'emblem-name';
    name.textContent = title;
    label.append(input, face, name);
    return label;
  };
  grid.append(option('none', 'Pasta simples', null));
  for (const id of EMBLEM_IDS) grid.append(option(id, ART[id].title, id));
  fieldset.append(legend, hint, grid);
  return fieldset;
}

export function createFolderIcons(owner) {
  let index = {};
  let lastCatalog = null;
  const urls=new Map();
  const key=(kind,id)=>`${kind}-${id}`;
  /** The folder icon: custom PNG, a plain folder, or a folder wearing its emblem label. */
  function icon(kind,id,name) {
    const el=document.createElement('span');el.className='library-folder-icon folder-customizable';el.setAttribute('aria-hidden','true');
    const stored=id==null?undefined:index[key(kind,id)];
    const url=stored===true?urls.get(key(kind,id)):null;
    if(url){const img=document.createElement('img');img.src=url;img.alt='';img.draggable=false;el.append(img);return el;}
    const mark=document.createElement('span');mark.className='folder-mark';el.append(mark);
    const emblem=isEmblem(stored)?stored:stored===undefined?emblemFor(name):null;
    if(emblem){const img=document.createElement('img');img.className='folder-emblem';img.src=emblemSrc(emblem);img.alt='';img.draggable=false;img.dataset.emblem=emblem;mark.append(img);el.dataset.emblem=emblem;}
    return el;
  }
  async function load(catalog) {
    lastCatalog=catalog;
    index=await loadCloudState(owner,'catalog-icons',{}) || {};
    const entries=[...catalog.subjects.map(item=>['subject',item.id]),...catalog.units.map(item=>['unit',item.id])];
    await Promise.all(entries.filter(([kind,id])=>index[key(kind,id)]===true).map(async([kind,id])=>{
      const name=key(kind,id);
      try { const blob=await readProfileMedia(owner,`folder-${name}`);if(blob){if(urls.has(name))URL.revokeObjectURL(urls.get(name));urls.set(name,URL.createObjectURL(blob));} } catch { /* The default folder remains available. */ }
    }));
  }
  function picker(form,kind) {
    const details=document.createElement('details');details.className='folder-icon-options';
    const summary=document.createElement('summary');summary.textContent='Ícone da pasta';
    const emblems=emblemGrid(kind);
    const custom=document.createElement('p');custom.className='emblem-custom-heading';custom.textContent='Ou use uma imagem sua:';
    const input=document.createElement('input');input.type='file';input.accept='image/png';input.id=`${kind}-folder-png`;input.className='folder-png-input';
    const label=document.createElement('label');label.htmlFor=input.id;label.className='folder-png-label';label.textContent='Personalizado (PNG)';
    const reset=document.createElement('button');reset.type='button';reset.textContent='×';reset.className='folder-icon-reset';reset.setAttribute('aria-label','Restaurar ícone padrão');reset.hidden=true;
    const message=document.createElement('span');message.className='folder-icon-message';message.setAttribute('role','status');
    const pngPreview=document.createElement('span');pngPreview.className='folder-png-preview';pngPreview.hidden=true;
    const controls=document.createElement('div');controls.className='folder-icon-controls';controls.append(pngPreview,label,input,reset,message);details.append(summary,emblems,custom,controls);
    form.querySelector('[type="submit"]').before(details);
    const nameField=form.querySelector('[name="name"], [name="title"]');
    const radios=()=>[...emblems.querySelectorAll('input[type="radio"]')];
    let draftUrl=null,revision=0,chosen=false,currentId=null;
    const showPng=(url)=>{pngPreview.replaceChildren();pngPreview.hidden=!url;if(url){const img=document.createElement('img');img.src=url;img.alt='';pngPreview.append(img);}};
    const check=(value)=>{for(const radio of radios())radio.checked=radio.value===value;};
    // Until the person picks one, the emblem follows the name being typed ("Química" → flask).
    const suggest=()=>{if(chosen||input.files[0])return;const stored=currentId==null?undefined:index[key(kind,currentId)];if(stored!==undefined)return;check(emblemFor(nameField?.value)||'none');};
    nameField?.addEventListener('input',suggest);
    emblems.addEventListener('change',event=>{if(!event.target.matches('.emblem-radio'))return;chosen=true;if(input.files[0]){revision++;input.value='';if(draftUrl)URL.revokeObjectURL(draftUrl);draftUrl=null;reset.hidden=true;showPng(null);}});
    const clear=()=>{revision++;input.value='';if(draftUrl)URL.revokeObjectURL(draftUrl);draftUrl=null;showPng(null);message.textContent='';reset.hidden=true;details.open=false;chosen=false;currentId=null;for(const radio of radios())radio.checked=false;};
    input.addEventListener('change',async()=>{
      const token=++revision;
      try {const file=input.files[0];await validateFolderPng(file);if(token!==revision)return;
        if(draftUrl)URL.revokeObjectURL(draftUrl);draftUrl=file?URL.createObjectURL(file):null;
        if(draftUrl)for(const radio of radios())radio.checked=false;
        showPng(draftUrl);message.textContent='';reset.hidden=!file;
      }catch(error){if(token===revision)message.textContent=error.message;}
    });
    reset.addEventListener('click',clear);form.addEventListener('reset',clear);
    return {
      /** Shows the folder's current choice when the dialog opens (null id: a new folder). */
      select(id,folderName) {
        clear();currentId=id??null;
        const stored=currentId==null?undefined:index[key(kind,currentId)];
        if(stored===true){showPng(urls.get(key(kind,currentId))||null);details.open=true;return;}
        check(isEmblem(stored)||stored==='none'?stored:emblemFor(folderName)||'none');details.open=true;
      },
      validate:()=>validateFolderPng(input.files[0]),
      async commit(id) {
        const folderKey=key(kind,id);
        const file=input.files[0];
        if(file){
          await saveProfileMedia(owner,`folder-${folderKey}`,file);
          if(urls.has(folderKey))URL.revokeObjectURL(urls.get(folderKey));urls.set(folderKey,URL.createObjectURL(file));
          index[folderKey]=true;await saveCloudState(owner,'catalog-icons',index);return;
        }
        const value=radios().find(radio=>radio.checked)?.value;
        // An inferred emblem is saved only when the person picked it or it differs from the name.
        if(!value||(!chosen&&index[folderKey]===undefined&&value===(emblemFor(nameField?.value)||'none')))return;
        if(index[folderKey]===value)return;
        index[folderKey]=value;await saveCloudState(owner,'catalog-icons',index);
      },
    };
  }
  window.addEventListener('online',async()=>{if(lastCatalog){await load(lastCatalog);window.dispatchEvent(new Event('folder-icons-updated'));}});
  return {icon,load,picker};
}
