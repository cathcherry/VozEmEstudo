import '../utils/preferences.js';
import { initAuthenticatedShell, updateUserIdentity, setStatus } from '../utils/shell.js';
import { updateProfile } from '../api/auth.api.js';
import { avatars, getAvatar } from '../utils/avatars.js';
import { listMaterials } from '../api/material.api.js';
import { studyFor } from '../utils/study-store.js';
const session=await initAuthenticatedShell();
const form=document.querySelector('[data-account-form]'), button=form.querySelector('[type="submit"]'), message=document.querySelector('[data-account-message]');
const name=document.querySelector('#display-name'), email=document.querySelector('#email'), institution=document.querySelector('#institution'), course=document.querySelector('#course'), goal=document.querySelector('#study-goal'), bio=document.querySelector('#profile-bio');
const metadata=session.user.user_metadata||{};
name.value=metadata.display_name||metadata.full_name||metadata.name||'';email.value=session.user.email||'';
institution.value=metadata.institution||'';course.value=metadata.course||'';goal.value=metadata.study_goal||'';bio.value=metadata.bio||'';
name.disabled=false;button.disabled=false;setStatus(message,'');
const picker=document.querySelector('[data-avatar-options]');
for(const avatar of avatars) {
  const label=document.createElement('label');label.className='avatar-choice';
  const radio=document.createElement('input');radio.type='radio';radio.name='mascot-avatar';radio.value=avatar.id;radio.checked=avatar.id===getAvatar(metadata.mascot_avatar).id;
  const content=document.createElement('span');const img=document.createElement('img');img.src=avatar.src;img.alt='';img.width=76;img.height=76;img.loading='lazy';const text=document.createElement('span');text.textContent=avatar.label;content.append(img,text);label.append(radio,content);picker.append(label);
  radio.addEventListener('change',()=>previewAvatar(avatar.id));
}
function previewAvatar(id) { const avatar=getAvatar(id), img=document.querySelector('[data-profile-avatar]');img.src=avatar.src;img.alt=avatar.label+', avatar do perfil'; }
function summary(user) {
  document.querySelector('[data-profile-name]').textContent=user.user_metadata?.display_name||user.user_metadata?.full_name||user.user_metadata?.name||'Seu perfil';
  document.querySelector('[data-profile-email]').textContent=user.email||'';
  document.querySelector('[data-profile-created]').textContent=user.created_at?new Date(user.created_at).toLocaleDateString('pt-BR'):'Não informado';
  const names={email:'E-mail e senha',google:'Google',github:'GitHub'};
  const providers=user.app_metadata?.providers||user.identities?.map(i=>i.provider)||['email'];
  document.querySelector('[data-profile-provider]').textContent=[...new Set(providers)].map(p=>names[p]||p).join(', ');
  previewAvatar(user.user_metadata?.mascot_avatar);
}
summary(session.user);
form.addEventListener('submit',async(event)=>{
  event.preventDefault();if(!form.reportValidity())return;button.disabled=true;
  try {
    setStatus(message,'Salvando perfil…');
    const user=await updateProfile({display_name:name.value.trim(),mascot_avatar:form.querySelector('[name="mascot-avatar"]:checked').value,institution:institution.value.trim(),course:course.value.trim(),study_goal:goal.value.trim(),bio:bio.value.trim()});
    updateUserIdentity(user);summary(user);setStatus(message,'Perfil salvo.','success');
  }catch(e){setStatus(message,e.message||'Não foi possível salvar seu perfil.','error');}finally{button.disabled=false;}
});
listMaterials().then(materials=>{
  const dl=document.createElement('dl');dl.className='profile-study-summary';
  const reviewed=materials.filter(m=>studyFor(m.id).completed).length;
  const answered=materials.reduce((n,m)=>n+Object.keys(studyFor(m.id).answers||{}).length,0);
  for(const [label,value]of [['Aulas no acervo',materials.length],['Revisões concluídas',reviewed],['Questões respondidas neste navegador',answered]]){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);row.append(dt,dd);dl.append(row);}
  document.querySelector('[data-profile-study-summary]').append(dl);
}).catch(()=>{});
