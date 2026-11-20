import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { listMaterials } from '../api/material.api.js';
import { studyFor, listeningPercent } from '../utils/study-store.js';
import { materialHref, playbackAtEnd } from '../utils/library-ui.js';
import { formatDate, formatDuration } from '../utils/format.js';
import { materialState, emptyState, errorState } from '../utils/material-ui.js';
import { initPlanningPanel } from './planning-panel.js';
import { initFlashcardsPanel } from './flashcards-panel.js';
import { initStudyTrackingPanel } from './study-tracking-panel.js';
import { initDashboardTools } from './dashboard-tools.js';
import { initGlobalSearch } from './global-search.js';
import { initDashboardHome } from './dashboard-home.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { listAnnotations } from '../api/learning-tools.api.js';

const session=await initAuthenticatedShell();
// Widgets listen to the study tools, so they must be ready before any tool starts loading.
const home=initDashboardHome();
// Search bar: lessons, questions, transcripts and (when enabled) annotations, in tabs on this page.
const searchForm=document.querySelector('.topbar-search');
if(searchForm)initGlobalSearch({form:searchForm,main:document.querySelector('main'),heading:document.querySelector('.dashboard-heading'),
  notes:async(q)=>(await isFeatureEnabled('annotations').catch(()=>false))?listAnnotations({q,offset:0}):null,
  openNotes:(q)=>{home.openWorkspace('notes');document.dispatchEvent(new CustomEvent('voz:notes-command',{detail:{action:'search',q}}));}});
let planningInitialized = false;
let flashcardsInitialized = false;
let trackingInitialized = false;
let dashboardToolsInitialized=false;
const name=session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
document.querySelector('[data-first-name]').textContent=name ? ', '+name.trim().split(/\s+/)[0] : '';
const container=document.querySelector('[data-dashboard-data]'), overview=document.querySelector('[data-overview]');
const continued=document.querySelector('[data-continue-list]'), recent=document.querySelector('[data-recent-list]');
function dashboardLesson(material) {
  const study = studyFor(material.id);
  const audio = Array.isArray(material.audio_files) ? material.audio_files[0] : material.audio_files || material.audio;
  const durationMs = Number(audio?.duration_ms || study.duration * 1000 || 0);
  const percent = listeningPercent(material.id);
  const card = document.createElement('a');
  card.className = 'dashboard-lesson-card';
  card.href = materialHref(material.id);
  card.dataset.materialId = material.id;
  const atEnd = playbackAtEnd(material);
  const action = study.completed || atEnd ? 'Revisar' : study.openedAt ? 'Continuar' : 'Abrir';
  card.setAttribute('aria-label', `${action} ${material.title}`);

  const copy = document.createElement('span');
  copy.className = 'dashboard-lesson-copy';
  const title = document.createElement('strong');
  title.className = 'dashboard-lesson-title';
  title.textContent = material.title;
  const subject = document.createElement('span');
  subject.className = 'dashboard-lesson-subject';
  subject.textContent = material.subject || 'Sem disciplina';
  copy.append(title, subject);
  if (atEnd) {
    const playbackState = document.createElement('span');
    playbackState.className = 'dashboard-lesson-subject';
    playbackState.textContent = 'No fim do áudio';
    copy.append(playbackState);
  }
  card.append(copy);

  const created = document.createElement('time');
  created.className = 'dashboard-lesson-date';
  const createdDate = material.created_at ? new Date(material.created_at) : null;
  const validCreatedDate = createdDate && !Number.isNaN(createdDate.getTime());
  const fullDate = validCreatedDate ? formatDate(material.created_at) : '';
  created.dateTime = validCreatedDate ? createdDate.toISOString() : '';
  created.textContent = validCreatedDate
    ? createdDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '';
  created.dataset.fullDate = fullDate;
  if (fullDate) created.setAttribute('aria-label', `Enviada em ${fullDate}`);
  card.append(created);

  const tags = study.tags || [];
  if (tags.length) {
    const list = document.createElement('span');
    list.className = 'dashboard-lesson-topics';
    list.setAttribute('aria-label', 'Assuntos');
    list.textContent = tags.join(' · ');
    card.append(list);
  }

  const cue = document.createElement('span');
  cue.className = 'dashboard-lesson-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.textContent = `${action} aula →`;
  card.append(cue);

  if (durationMs > 0) {
    const playback = document.createElement('div');
    playback.className = 'dashboard-lesson-playback';
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = percent;
    progress.setAttribute('aria-label', `Áudio ouvido de ${material.title}: ${percent}%`);
    const duration = document.createElement('span');
    duration.className = 'dashboard-lesson-duration';
    duration.textContent = formatDuration(durationMs);
    const percentLabel = document.createElement('span');
    percentLabel.className = 'dashboard-lesson-percent';
    percentLabel.textContent = `${percent}% ouvido`;
    const tooltip = document.createElement('span');
    tooltip.className = 'dashboard-lesson-tooltip';
    tooltip.append(percentLabel);
    if (study.playedAt) {
      const lastPlayed = document.createElement('span');
      lastPlayed.className = 'dashboard-lesson-last-played';
      lastPlayed.textContent = `Última reprodução: ${new Date(study.playedAt).toLocaleDateString('pt-BR')}`;
      tooltip.append(lastPlayed);
    }
    playback.addEventListener('pointermove', (event) => {
      const bounds = playback.getBoundingClientRect();
      const halfTooltip = tooltip.offsetWidth / 2;
      const x = Math.min(
        Math.max(event.clientX - bounds.left, halfTooltip + 8),
        bounds.width - halfTooltip - 8,
      );
      playback.style.setProperty('--dashboard-tooltip-x', `${x}px`);
    });
    playback.addEventListener('pointerleave', () => {
      playback.style.removeProperty('--dashboard-tooltip-x');
    });
    playback.append(progress, duration, tooltip);
    card.append(playback);
  }
  return card;
}
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
      continued.append(dashboardLesson(material));
    } else continued.append(emptyState(materials.length?'Nenhuma aula em andamento.':'Sua Biblioteca está vazia.',materials.length?'Acesse a Biblioteca para escolher uma aula.':'Envie uma aula para começar.',{href:materials.length?'./historico.html':'./nova-transcricao.html',action:materials.length?'Abrir Biblioteca':'Nova transcrição',mascot:materials.length?'reading':'laptop'}));
    const recentMaterials=materials.filter(material=>!last.some(item=>item.id===material.id)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,4);
    document.querySelector('[data-recent-section]').hidden=!recentMaterials.length;
    for (const material of recentMaterials) recent.append(dashboardLesson(material));
    const shelf=document.querySelector('[data-subject-list]'); shelf.replaceChildren();
    const subjects=new Map(); for(const m of materials) { const subject=m.subject||'Sem disciplina'; const list=subjects.get(subject)||[]; list.push(m); subjects.set(subject,list); }
    for(const [subject,items] of [...subjects].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'))) {
      const link=document.createElement('a'); link.className='subject-folder'; link.href='./historico.html?subject='+encodeURIComponent(subject);
      const icon=document.createElement('span'); icon.className='subject-folder-icon'; icon.textContent='📁'; icon.setAttribute('aria-hidden','true');
      const copy=document.createElement('span'); const title=document.createElement('strong'); title.textContent=subject; const detail=document.createElement('small'); const reviewed=items.filter(m=>studyFor(m.id).completed).length; detail.textContent=`${items.length} ${items.length===1?'aula':'aulas'}${reviewed?' · '+reviewed+' '+(reviewed===1?'revisão concluída':'revisões concluídas'):''}`; copy.append(title,detail); link.append(icon,copy); shelf.append(link);
    }
    if (!subjects.size) { const p=document.createElement('p'); p.className='quiet-empty'; p.textContent='Nenhuma disciplina atribuída.'; shelf.append(p); }
    const topics=new Map();
    for(const m of materials) { const s=studyFor(m.id); if(!s.visits) continue; for(const tag of s.tags.length ? s.tags : [m.subject||'Sem disciplina']) topics.set(tag,(topics.get(tag)||0)+s.visits); }
    const list=document.querySelector('[data-topic-list]'); list.replaceChildren();
    for(const [topic,visits] of [...topics].sort((a,b)=>b[1]-a[1]).slice(0,4)) { const li=document.createElement('li'), label=document.createElement('span'), count=document.createElement('small'); label.textContent=topic; count.textContent=`${visits} ${visits===1?'acesso':'acessos'}`; li.append(label,count); list.append(li); }
    document.querySelector('[data-topics-section]').hidden = !topics.size;
  } catch(error) { overview.textContent='Biblioteca indisponível no momento.'; continued.replaceChildren(errorState(error.message,load)); }
  finally { container.setAttribute('aria-busy','false'); }
}
load();

