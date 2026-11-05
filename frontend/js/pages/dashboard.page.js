import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { listMaterials } from '../api/material.api.js';
import { studyFor } from '../utils/study-store.js';
import { materialRow, playbackAtEnd } from '../utils/library-ui.js';
import { formatDuration } from '../utils/format.js';
import { materialState, emptyState, errorState } from '../utils/material-ui.js';
import { initPlanningPanel } from './planning-panel.js';
import { initFlashcardsPanel } from './flashcards-panel.js';
import { initStudyTrackingPanel } from './study-tracking-panel.js';
import { initDashboardTools } from './dashboard-tools.js';

const session=await initAuthenticatedShell();
let planningInitialized = false;
let flashcardsInitialized = false;
let trackingInitialized = false;
let dashboardToolsInitialized=false;
const name=session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
document.querySelector('[data-first-name]').textContent=name ? ', '+name.trim().split(/\s+/)[0] : '';
const container=document.querySelector('[data-dashboard-data]'), overview=document.querySelector('[data-overview]');
const continued=document.querySelector('[data-continue-list]'), recent=document.querySelector('[data-recent-list]');
async function load() {
  container.setAttribute('aria-busy','true');
  try {
    const materials=await listMaterials();
    if(!dashboardToolsInitialized){dashboardToolsInitialized=true;void initDashboardTools({materials});}
    if(!trackingInitialized) {
      trackingInitialized=true;
      void initStudyTrackingPanel({materials}).catch((error)=>{
        const panel=document.querySelector('[data-study-tracking-panel]');
        if(panel&&!panel.hidden)panel.textContent=error.message||'Progresso indisponível.';
      });
    }
    // E13 is entirely optional: failing to load cards must not break the dashboard.
    if (!flashcardsInitialized) {
      flashcardsInitialized = true;
      void initFlashcardsPanel({ materials }).catch((error) => {
        const notice = document.querySelector('[data-flashcard-review-status]');
        if (notice) notice.textContent = error.message || 'Flashcards indisponíveis.';
      });
    }

    // Optional module: a planning failure must never break the existing dashboard.
    if (!planningInitialized) {
      planningInitialized = true;
      try { await initPlanningPanel({ materials }); }
      catch (error) {
        const notice = document.querySelector('[data-planning-status]');
        if (notice) notice.textContent = error.message || 'Planejamento indisponível.';
      }
    }
    const active=materials.filter((m)=>studyFor(m.id).openedAt && !studyFor(m.id).completed);
    const completed=materials.filter((m)=>studyFor(m.id).completed);
    const pending=materials.filter((m)=>materialState(m)==='processing');
    overview.replaceChildren();
    for(const [value,label] of [[materials.length,`${materials.length===1?'aula':'aulas'} no acervo`],[active.length,'em estudo'],[completed.length,completed.length===1?'revisão concluída':'revisões concluídas'],...(pending.length?[[pending.length,'em processamento']]:[])]) {
      const item=document.createElement('span'), number=document.createElement('strong');
      number.textContent=value; item.append(number,' '+label); overview.append(item,' ');
    }
    continued.replaceChildren(); recent.replaceChildren();
    const last=materials.filter(m=>studyFor(m.id).openedAt).sort((a,b)=>(studyFor(b.id).playedAt||studyFor(b.id).openedAt)-(studyFor(a.id).playedAt||studyFor(a.id).openedAt)).slice(0,1);
    if (last.length) for (const material of last) {
      const row=materialRow(material,{compact:true});
      const s=studyFor(material.id);
      const note=document.createElement('p'); note.className='last-access-note';
      note.textContent=s.playedAt ? `Última reprodução: ${new Date(s.playedAt).toLocaleDateString('pt-BR')}${playbackAtEnd(material)?' · No fim do áudio':s.position>0?' · Retomar em '+formatDuration(s.position*1000):''}` : 'Último acesso: '+new Date(s.openedAt).toLocaleDateString('pt-BR');
      row.querySelector('.library-material-main').append(note); continued.append(row);
    } else continued.append(emptyState(materials.length?'Escolha uma aula para começar.':'Sua Biblioteca está pronta para começar.',materials.length?'Seu próximo acesso aparecerá aqui, com o andamento do estudo.':'Envie sua primeira aula para reunir transcrição, resumo e questões.',{href:materials.length?'./historico.html':'./nova-transcricao.html',action:materials.length?'Abrir Biblioteca':'Nova transcrição',mascot:false}));
    const recentMaterials=materials.filter(material=>!last.some(item=>item.id===material.id)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,3);
    document.querySelector('[data-recent-section]').hidden=!recentMaterials.length;
    for (const material of recentMaterials) recent.append(materialRow(material,{compact:true}));
    const shelf=document.querySelector('[data-subject-list]'); shelf.replaceChildren();
    const subjects=new Map(); for(const m of materials) { const subject=m.subject||'Sem disciplina'; const list=subjects.get(subject)||[]; list.push(m); subjects.set(subject,list); }
    for(const [subject,items] of [...subjects].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'))) {
      const link=document.createElement('a'); link.className='subject-folder'; link.href='./historico.html?subject='+encodeURIComponent(subject);
      const icon=document.createElement('span'); icon.className='subject-folder-icon'; icon.textContent='▱'; icon.setAttribute('aria-hidden','true');
      const copy=document.createElement('span'); const title=document.createElement('strong'); title.textContent=subject; const detail=document.createElement('small'); const reviewed=items.filter(m=>studyFor(m.id).completed).length; detail.textContent=`${items.length} ${items.length===1?'aula':'aulas'}${reviewed?' · '+reviewed+' '+(reviewed===1?'revisão concluída':'revisões concluídas'):''}`; copy.append(title,detail); link.append(icon,copy); shelf.append(link);
    }
    if (!subjects.size) { const p=document.createElement('p'); p.className='quiet-empty'; p.textContent='As disciplinas das suas aulas aparecem aqui.'; shelf.append(p); }
    const topics=new Map();
    for(const m of materials) { const s=studyFor(m.id); if(!s.visits) continue; for(const tag of s.tags.length ? s.tags : [m.subject||'Sem disciplina']) topics.set(tag,(topics.get(tag)||0)+s.visits); }
    const list=document.querySelector('[data-topic-list]'); list.replaceChildren();
    for(const [topic,visits] of [...topics].sort((a,b)=>b[1]-a[1]).slice(0,4)) { const li=document.createElement('li'), label=document.createElement('span'), count=document.createElement('small'); label.textContent=topic; count.textContent=`${visits} ${visits===1?'acesso':'acessos'}`; li.append(label,count); list.append(li); }
    if(!topics.size) { const li=document.createElement('li'); li.className='quiet-empty'; li.textContent='Abra uma aula para começar seu histórico de estudo.'; list.append(li); }
  } catch(error) { overview.textContent='Biblioteca indisponível no momento.'; continued.replaceChildren(errorState(error.message,load)); }
  finally { container.setAttribute('aria-busy','false'); }
}
load();

