import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { listMaterials } from '../api/material.api.js';
import { studyFor, listeningPercent } from '../utils/study-store.js';
import { materialHref, playbackAtEnd } from '../utils/library-ui.js';
import { formatDate, formatDuration } from '../utils/format.js';
import { materialState, emptyState, errorState } from '../utils/material-ui.js';
import { initGlobalSearch } from './global-search.js';
import { initDashboardHome } from './dashboard-home.js';
import { isFeatureEnabled, getFeatureFlags } from '../utils/feature-flags.js';
import { listAnnotations } from '../api/learning-tools.api.js';
import { initDashboardCustomize } from './dashboard-customize.js';
import { t, intlLocale } from '../i18n/i18n.js';
import * as discoveryApi from '../api/discovery.api.js';
import { initRailTabs } from './dashboard-rail-tabs.js';
import { icon as uiIcon } from '../utils/icons.js';
import { maybeOfferTour } from '../utils/guided-tour.js';

const session=await initAuthenticatedShell();
void maybeOfferTour({ user: session.user });
// Investigations summary (only when discoveries are on and the adventure layer is visible).
void (async () => {
  const box = document.querySelector('[data-desk-expedition]');
  const flags = await getFeatureFlags().catch(() => ({}));
  if (!box || !flags.discoveries) return;
  const collection = await discoveryApi.getCollection().catch(() => null);
  if (!collection) return;
  const done = collection.counts?.investigations || 0;
  const found = collection.unlocks?.length || 0;
  const total = collection.catalog?.length || 0;
  box.querySelector('[data-expedition-text]').textContent =
    `${done} ${done === 1 ? 'investigação concluída' : 'investigações concluídas'} · ${found} de ${total} itens no Gabinete`;
  box.hidden = false;
})();
initRailTabs();
// Saved layout first, so the cards appear where the person put them.
void initDashboardCustomize({ owner: session.user.id }).catch(() => { /* The default layout stays usable. */ });
// Summary cards for the study tools (each links to Revisar or Planejar).
initDashboardHome();
// Search bar: lessons, questions, transcripts and (when enabled) annotations, in tabs on this page.
const searchForm=document.querySelector('.topbar-search');
if(searchForm)initGlobalSearch({form:searchForm,main:document.querySelector('main'),heading:document.querySelector('.dashboard-heading'),
  notes:async(q)=>(await isFeatureEnabled('annotations').catch(()=>false))?listAnnotations({q,offset:0}):null,
  openNotes:(q)=>{location.href=`./revisar.html?busca=${encodeURIComponent(q)}#anotacoes`;}});
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
  const action = t(study.completed || atEnd ? 'lesson.revisit' : study.openedAt ? 'lesson.continue' : 'lesson.open');
  card.setAttribute('aria-label', t('lesson.cardLabel', { action, title: material.title }));

  const copy = document.createElement('span');
  copy.className = 'dashboard-lesson-copy';
  const title = document.createElement('strong');
  title.className = 'dashboard-lesson-title';
  title.textContent = material.title;
  const subject = document.createElement('span');
  subject.className = 'dashboard-lesson-subject';
  subject.textContent = material.subject || t('lesson.noSubject');
  copy.append(title, subject);
  if (atEnd) {
    const playbackState = document.createElement('span');
    playbackState.className = 'dashboard-lesson-subject';
    playbackState.textContent = t('lesson.atEnd');
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
    ? createdDate.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '';
  created.dataset.fullDate = fullDate;
  if (fullDate) created.setAttribute('aria-label', t('lesson.sentOn', { date: fullDate }));
  card.append(created);

  const tags = study.tags || [];
  if (tags.length) {
    const list = document.createElement('span');
    list.className = 'dashboard-lesson-topics';
    list.setAttribute('aria-label', t('lesson.topics'));
    list.textContent = tags.join(' · ');
    card.append(list);
  }

  const cue = document.createElement('span');
  cue.className = 'dashboard-lesson-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.textContent = t('lesson.cue', { action });
  card.append(cue);

  if (durationMs > 0) {
    const playback = document.createElement('div');
    playback.className = 'dashboard-lesson-playback';
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = percent;
    progress.setAttribute('aria-label', t('lesson.listenedLabel', { title: material.title, percent }));
    const duration = document.createElement('span');
    duration.className = 'dashboard-lesson-duration';
    duration.textContent = formatDuration(durationMs);
    const percentLabel = document.createElement('span');
    percentLabel.className = 'dashboard-lesson-percent';
    percentLabel.textContent = t('lesson.listened', { percent });
    const tooltip = document.createElement('span');
    tooltip.className = 'dashboard-lesson-tooltip';
    tooltip.append(percentLabel);
    if (study.playedAt) {
      const lastPlayed = document.createElement('span');
      lastPlayed.className = 'dashboard-lesson-last-played';
      lastPlayed.textContent = t('lesson.lastPlayed', { date: new Date(study.playedAt).toLocaleDateString(intlLocale()) });
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
    const active=materials.filter((m)=>studyFor(m.id).openedAt && !studyFor(m.id).completed);
    const completed=materials.filter((m)=>studyFor(m.id).completed);
    const pending=materials.filter((m)=>materialState(m)==='processing');
    overview.replaceChildren();
    for(const [value,label] of [[materials.length,t('dashboard.inLibrary',{count:materials.length})],[active.length,t('dashboard.studying')],[completed.length,t('dashboard.studied',{count:completed.length})],...(pending.length?[[pending.length,t('dashboard.processing')]]:[])]) {
      const item=document.createElement('span'), number=document.createElement('strong');
      number.textContent=value; item.append(number,' '+label); overview.append(item,' ');
    }
    continued.replaceChildren(); recent.replaceChildren();
    const last=materials.filter(m=>studyFor(m.id).openedAt).sort((a,b)=>(studyFor(b.id).playedAt||studyFor(b.id).openedAt)-(studyFor(a.id).playedAt||studyFor(a.id).openedAt)).slice(0,1);
    if (last.length) for (const material of last) {
      continued.append(dashboardLesson(material));
    } else continued.append(emptyState(t(materials.length?'dashboard.noActive':'dashboard.emptyLibrary'),t(materials.length?'dashboard.noActiveHint':'dashboard.emptyLibraryHint'),{href:materials.length?'./historico.html':'./nova-transcricao.html',action:t(materials.length?'dashboard.openLibrary':'nav.newTranscription'),mascot:materials.length?'reading':'laptop'}));
    const recentMaterials=materials.filter(material=>!last.some(item=>item.id===material.id)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,6);
    document.querySelector('[data-recent-section]').hidden=!recentMaterials.length;
    for (const material of recentMaterials) recent.append(dashboardLesson(material));
    const shelf=document.querySelector('[data-subject-list]'); shelf.replaceChildren();
    const subjects=new Map(); for(const m of materials) { const subject=m.subject||t('lesson.noSubject'); const list=subjects.get(subject)||[]; list.push(m); subjects.set(subject,list); }
    // Folder tones cycle in the same order as the Biblioteca's folders (lavender, matcha, honey, mist, rose).
    const tones=['lavender','matcha','honey','mist','rose']; let toneIndex=0;
    for(const [subject,items] of [...subjects].sort((a,b)=>a[0].localeCompare(b[0],intlLocale()))) {
      const link=document.createElement('a'); link.className='subject-folder'; link.dataset.folderTone=tones[toneIndex++%tones.length]; link.href='./historico.html?subject='+encodeURIComponent(subject);
      const icon=document.createElement('span'); icon.className='subject-folder-icon'; icon.append(uiIcon('folder',{size:18})); icon.setAttribute('aria-hidden','true');
      const copy=document.createElement('span'); const title=document.createElement('strong'); title.textContent=subject; const detail=document.createElement('small'); const reviewed=items.filter(m=>studyFor(m.id).completed).length; detail.textContent=t('dashboard.subjectLessons',{count:items.length})+(reviewed?' · '+t('dashboard.subjectStudied',{count:reviewed}):''); copy.append(title,detail); link.append(icon,copy); shelf.append(link);
    }
    if (!subjects.size) { const p=document.createElement('p'); p.className='quiet-empty'; p.textContent=t('dashboard.noSubjects'); shelf.append(p); }
    const topics=new Map();
    for(const m of materials) { const s=studyFor(m.id); if(!s.visits) continue; for(const tag of s.tags.length ? s.tags : [m.subject||t('lesson.noSubject')]) topics.set(tag,(topics.get(tag)||0)+s.visits); }
    const list=document.querySelector('[data-topic-list]'); list.replaceChildren();
    for(const [topic,visits] of [...topics].sort((a,b)=>b[1]-a[1]).slice(0,4)) { const li=document.createElement('li'), label=document.createElement('span'), count=document.createElement('small'); label.textContent=topic; count.textContent=String(visits); const unit=document.createElement('span'); unit.className='sr-only'; unit.textContent=' '+t('dashboard.visits',{count:visits}).replace(/^\S+\s/,''); count.append(unit); count.title=t('dashboard.visits',{count:visits}); li.append(label,count); list.append(li); }
    document.querySelector('[data-topics-section]').hidden = !topics.size;
  } catch(error) { overview.textContent=t('dashboard.libraryUnavailable'); continued.replaceChildren(errorState(error.message,load)); }
  finally { container.setAttribute('aria-busy','false'); }
}
load();

