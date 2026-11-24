import { enhanceCard } from '../utils/card-layout.js';
import { loadCloudState, saveCloudState, registerCloudMerge, cachedCloudState } from '../utils/profile-cloud.js';
import { PROFILE_LAYOUT_KEY, PROFILE_SECTIONS, BLOCK_SIZES, DATA_BLOCKS, normalizeProfileLayout, newDataBlock, duplicateBlock, moveBlock as movedBlocks, renderDataBlock } from './profile-editor.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { milestones, evaluateMilestones, orderedMilestones, unlockedAvatars, mergeMilestoneStates } from '../utils/gamification.js';
import { widgetDocument } from '../utils/profile-widgets.js';
import { cardTemplateOf, isLegacyCard, legacyPlainText, normalizeTone, toggleChecklistItem } from '../utils/profile-cards.js';
import { htmlToText, renderCardBody } from '../utils/profile-card-view.js';
import { createCardEditor } from './profile-card-editor.js';
import { toast } from '../utils/toast.js';
import '../utils/preferences.js';
import { initAuthenticatedShell, updateUserIdentity, setStatus } from '../utils/shell.js';
import { publicTestingEnabled } from '../utils/public-testing.js';
import { updateProfile } from '../api/auth.api.js';
import { avatars, getAvatar } from '../utils/avatars.js';
import { listMaterials } from '../api/material.api.js';
import { studyFor } from '../utils/study-store.js';
import {
  profileBlocksKey,
  readProfileMedia,
  removeProfileMedia,
  saveProfileMedia,
} from '../utils/profile-storage.js';

// Milestones reached on another device are kept; the state is cosmetic (see gamification.js).
registerCloudMerge('milestones', mergeMilestoneStates);

const session = await initAuthenticatedShell();
const userId = session.user.id;
// Public testing program (flag only): "Conta de participante" with the account's limits.
void publicTestingEnabled().then(async (on) => {
  if (!on) return;
  const { mountTestingAccount } = await import('./testing-account.js');
  await mountTestingAccount(document.querySelector('.account-profile-hero'));
}).catch(() => { /* optional section */ });
window.addEventListener('profile-sync-status', (event) => { const node=document.querySelector('[data-profile-sync]'); if(node) node.textContent=event.detail === 'Salvo na conta' ? '' : event.detail; });
const syncedBlocks = await loadCloudState(userId,'profile-blocks',loadBlocks());
if (Array.isArray(syncedBlocks)) localStorage.setItem(profileBlocksKey(userId),JSON.stringify(syncedBlocks));
let gameState = await loadCloudState(userId,'milestones',{}) || {};
// Viewing mode by default; "Personalizar perfil" turns on the editing tools.
let editing = false;
let profileLayout = normalizeProfileLayout(cachedCloudState(userId, PROFILE_LAYOUT_KEY));
const profileStatus = document.querySelector('[data-profile-edit-status]');
function announce(text) { if (profileStatus) profileStatus.textContent = text; }
function applySections() {
  for (const section of PROFILE_SECTIONS) {
    const node = document.querySelector(section.selector);
    if (!node) continue;
    const hidden = profileLayout.hiddenSections.includes(section.id);
    node.classList.toggle('is-hidden-section', hidden);
    node.toggleAttribute('data-user-hidden', hidden && !editing);
    let toggle = node.querySelector(':scope > [data-section-toggle], .section-heading [data-section-toggle], h2 + [data-section-toggle]');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'profile-section-toggle';
      toggle.dataset.sectionToggle = section.id;
      toggle.addEventListener('click', () => {
        const hide = !profileLayout.hiddenSections.includes(section.id);
        profileLayout = normalizeProfileLayout({ hiddenSections: hide ? [...profileLayout.hiddenSections, section.id] : profileLayout.hiddenSections.filter((id) => id !== section.id) });
        void saveCloudState(userId, PROFILE_LAYOUT_KEY, profileLayout);
        applySections();
        announce(hide ? `${section.label} oculto no seu perfil.` : `${section.label} voltou ao seu perfil.`);
        toggle.focus();
      });
      node.prepend(toggle);
    }
    toggle.hidden = !editing;
    toggle.textContent = hidden ? `Mostrar ${section.label}` : `Ocultar ${section.label}`;
    toggle.setAttribute('aria-pressed', String(hidden));
  }
}
applySections();
void loadCloudState(userId, PROFILE_LAYOUT_KEY, null).then((remote) => {
  if (remote) { profileLayout = normalizeProfileLayout(remote); applySections(); }
});
let milestoneFilter = 'all';
const form = document.querySelector('[data-account-form]');
const message = document.querySelector('[data-account-message]');
const name = document.querySelector('#display-name');
const email = document.querySelector('#email');
const institution = document.querySelector('#institution');
const course = document.querySelector('#course');
const goal = document.querySelector('#study-goal');
const bio = document.querySelector('#profile-bio');
const avatarInput = document.querySelector('#profile-avatar-file');
const coverInput = document.querySelector('#profile-cover-file');
const metadata = session.user.user_metadata || {};
let avatarDraft = null;
let coverDraft = null;
let removeAvatar = false;
let removeCover = false;
let avatarObjectUrl = null;
let coverObjectUrl = null;
let cardCleanups = [];

name.value = metadata.display_name || metadata.full_name || metadata.name || '';
email.value = session.user.email || '';
institution.value = metadata.institution || '';
course.value = metadata.course || '';
goal.value = metadata.study_goal || '';
bio.value = metadata.bio || '';
renderIdentity(session.user);

function setImagePreview(blob, slot) {
  const selector = slot === 'avatar' ? '[data-profile-avatar]' : '[data-profile-cover]';
  const url = blob ? URL.createObjectURL(blob) : null;
  if (slot === 'avatar') {
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = url;
  } else {
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = url;
  }
  if (slot === 'avatar') {
    const image = document.querySelector(selector);
    image.src = url || getAvatar(metadata.mascot_avatar).src;
    image.alt = url ? 'Foto de perfil' : `${getAvatar(metadata.mascot_avatar).label}, avatar do perfil`;
    return;
  }
  const cover = document.querySelector(selector);
  cover.style.backgroundImage = url ? `linear-gradient(90deg, rgb(20 32 50 / 12%), rgb(20 32 50 / 4%)), url("${url}")` : '';
  cover.classList.toggle('has-custom-cover', Boolean(url));
}

async function loadMedia() {
  try {
    const [avatar, cover] = await Promise.all([
      readProfileMedia(userId, 'avatar'),
      readProfileMedia(userId, 'cover'),
    ]);
    setImagePreview(avatar, 'avatar');
    setImagePreview(cover, 'cover');
  } catch {
    setStatus(message, 'Não foi possível carregar suas imagens locais neste navegador.', 'error');
  }
}

function renderIdentity(user) {
  const userMetadata = user.user_metadata || {};
  document.querySelector('[data-profile-name]').textContent =
    userMetadata.display_name || userMetadata.full_name || userMetadata.name || 'Seu perfil';
  Object.assign(metadata,userMetadata);
  renderAboutBlock(userMetadata);
}

function loadBlocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(profileBlocksKey(userId)) || '[]');
    return Array.isArray(saved) ? saved.filter((block) => block && typeof block.id === 'string') : [];
  } catch {
    return [];
  }
}

function saveBlocks(blocks) {
  localStorage.setItem(profileBlocksKey(userId), JSON.stringify(blocks));
  void saveCloudState(userId,'profile-blocks',blocks);
}

function renderAboutBlock(userMetadata) {
  const container = document.querySelector('[data-profile-about]');
  const existing = container.querySelector('[data-about-block]');
  existing?.remove();
  const content = [
    ['Instituição', userMetadata.institution],
    ['Curso', userMetadata.course],
    ['Agora estou estudando', userMetadata.study_goal],
    ['Apresentação', userMetadata.bio],
  ].filter(([, value]) => String(value || '').trim());
  if (!content.length) { container.closest('section').hidden=true; return; }
  container.closest('section').hidden=false;
  const card = document.createElement('article');
  card.className = 'profile-block profile-about-block';
  card.dataset.aboutBlock = '';
  for (const [label, value] of content) {
    const row = document.createElement('div');
    row.className = 'profile-about-row';
    const heading = document.createElement('h4');
    heading.textContent = label;
    const text = document.createElement('p');
    text.textContent = value;
    row.append(heading, text);
    card.append(row);
  }
  container.prepend(card);
}

// Images of image/GIF cards: one object URL per stored slot for the page's lifetime.
const mediaUrls = new Map();
function cardMedia(slot) {
  if (!/^card-[\w-]{1,64}$/.test(String(slot || ''))) return Promise.resolve(null);
  if (!mediaUrls.has(slot))
    mediaUrls.set(slot, readProfileMedia(userId, slot).then((blob) => (blob ? URL.createObjectURL(blob) : null)).catch(() => null));
  return mediaUrls.get(slot);
}
async function saveCardMedia(slot, blob) {
  await saveProfileMedia(userId, slot, blob);
  mediaUrls.set(slot, Promise.resolve(URL.createObjectURL(blob)));
}
/** An image is removed only when no card uses it any more (a duplicate shares its image). */
function releaseCardMedia(slot) {
  if (!slot || loadBlocks().some((block) => block.media === slot)) return;
  const url = mediaUrls.get(slot);
  mediaUrls.delete(slot);
  void url?.then((value) => value && URL.revokeObjectURL(value));
  void removeProfileMedia(userId, slot).catch(() => {});
}

function renderProfileBlocks() {
  cardCleanups.forEach(cleanup=>cleanup()); cardCleanups=[];
  const container = document.querySelector('[data-profile-blocks]');
  for (const node of container.querySelectorAll('[data-custom-block]')) node.remove();
  const blocks = loadBlocks();
  const shown = editing ? blocks : blocks.filter((block) => !block.hidden);
  for (const block of shown) {
    const position = blocks.findIndex((item) => item.id === block.id);
    const card = document.createElement('article');
    const kind = cardTemplateOf(block);
    const legacy = isLegacyCard(block);
    const tone = normalizeTone(block.tone);
    card.className = `profile-block profile-block-${block.type} card-kind-${kind || 'legacy'}${tone ? ` card-tone-${tone}` : ''}${block.hidden ? ' is-hidden-block' : ''}`;
    card.dataset.customBlock = block.id;
    const heading = document.createElement('div');
    heading.className = 'profile-block-heading';
    const title = document.createElement('h3');
    title.textContent = block.title;
    title.setAttribute('translate', 'no');
    if (block.hidden) {
      const badge = document.createElement('span');
      badge.className = 'profile-hidden-badge';
      badge.textContent = 'Oculto';
      title.append(' ', badge);
    }
    const actions = document.createElement('details');
    actions.className = 'profile-block-actions';
    const toggle = document.createElement('summary');
    toggle.textContent = '\u22ef';
    toggle.setAttribute('aria-label', 'Opções de ' + block.title);
    const menu = document.createElement('div');
    menu.className = 'block-action-menu';
    actions.append(toggle, menu);
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'block-drag-handle';
    handle.textContent = '\u283f';
    handle.setAttribute('aria-label', 'Arrastar ' + block.title + '. Use Alt e as setas para reordenar.');
    handle.addEventListener('keydown', (event) => {
      if(event.repeat) return;
      if (event.altKey && !event.repeat && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); moveBlock(loadBlocks().findIndex(item=>item.id===block.id), event.key === 'ArrowUp' ? -1 : 1);
        document.querySelector('[data-custom-block="' + block.id + '"] .block-drag-handle')?.focus();
      }
    });
    const action = (label, run, options = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-action';
      button.textContent = label;
      if (options.pressed !== undefined) button.setAttribute('aria-pressed', String(options.pressed));
      if (options.disabled) button.disabled = true;
      button.addEventListener('click', () => { actions.open = false; run(); });
      menu.append(button);
      return button;
    };
    // Every arrangement has a keyboard path here (drag and resize remain for pointers).
    const update = (blocksNext, notice, focusId = block.id) => {
      saveBlocks(blocksNext); renderProfileBlocks(); announce(notice);
      document.querySelector(`[data-custom-block="${CSS.escape(focusId)}"] summary`)?.focus();
    };
    if (legacy) {
      // Retired kinds (3D, HTML/CSS, code) stay as they are; their text can seed a new card.
      action('Copiar como texto', () => cardEditor.openText(`${block.title} (texto)`.slice(0, 80), legacyPlainText(block, htmlToText)));
    } else if (block.type !== 'data') action('Editar', () => cardEditor.open(block));
    action('Duplicar', () => {
      const next = duplicateBlock(loadBlocks(), block.id);
      const copy = next[next.findIndex((item) => item.id === block.id) + 1];
      update(next, `Cópia de ${block.title} criada.`, copy.id);
    });
    action(block.hidden ? 'Mostrar no perfil' : 'Ocultar do perfil', () => {
      update(loadBlocks().map((item) => item.id === block.id ? { ...item, hidden: !block.hidden } : item),
        block.hidden ? `${block.title} voltou ao perfil.` : `${block.title} oculto. Ele continua aqui no modo de edição.`);
    });
    action('Mover para cima', () => update(movedBlocks(loadBlocks(), block.id, -1), `${block.title} movido para cima.`), { disabled: position <= 0 });
    action('Mover para baixo', () => update(movedBlocks(loadBlocks(), block.id, 1), `${block.title} movido para baixo.`), { disabled: position >= blocks.length - 1 });
    const sizes = document.createElement('div');
    sizes.className = 'block-size-options';
    sizes.setAttribute('role', 'group');
    sizes.setAttribute('aria-label', 'Largura de ' + block.title);
    menu.append(sizes);
    for (const [label, columns] of BLOCK_SIZES) {
      const button = action(label, () => update(loadBlocks().map((item) => item.id === block.id ? { ...item, layout: { ...item.layout, columns } } : item), `${block.title}: largura ${label.toLowerCase()}.`), { pressed: (block.layout?.columns || 4) === columns });
      sizes.append(button);
    }
    action('Remover', () => {
      if (!confirm(`Remover o bloco "${block.title}"? Esta ação não pode ser desfeita.`)) return;
      saveBlocks(loadBlocks().filter((item) => item.id !== block.id));
      releaseCardMedia(block.media);
      renderProfileBlocks();
      announce(`${block.title} removido.`);
      document.querySelector('[data-block-open]')?.focus();
    });
    heading.append(handle, title, actions);
    card.append(heading);
    if (block.type === 'data') {
      const slot = document.createElement('div');
      slot.className = 'profile-data-slot';
      slot.setAttribute('aria-busy', 'true');
      slot.textContent = 'Carregando…';
      card.append(slot);
      void renderDataBlock(block.source).then((node) => { slot.replaceChildren(node); slot.setAttribute('aria-busy', 'false'); });
    } else {
      card.append(renderCardBody(block, {
        loadMedia: cardMedia,
        onToggle: (index, done) => {
          saveBlocks(toggleChecklistItem(loadBlocks(), block.id, index, done));
          announce(done ? 'Passo marcado como feito.' : 'Passo desmarcado.');
        },
      }));
    }
    if (legacy && editing) {
      const note = document.createElement('p');
      note.className = 'card-legacy-note';
      note.textContent = 'Formato antigo: continua no seu perfil, mas não pode mais ser editado. Use “Copiar como texto” no menu para reaproveitar o conteúdo.';
      card.append(note);
    }
    const body=document.createElement('div');body.className='profile-card-body';
    if (block.type !== 'data') body.setAttribute('translate', 'no');
    for(const child of [...card.children].filter(el=>el!==heading && !el.classList.contains('card-legacy-note')))body.append(child);
    const legacyNote = card.querySelector(':scope > .card-legacy-note');
    if (legacyNote) card.insertBefore(body, legacyNote);
    if (!legacyNote) card.append(body);
    container.append(card);
    cardCleanups.push(enhanceCard(card,block,{
      saveLayout(layout){const items=loadBlocks();const item=items.find(candidate=>candidate.id===block.id);if(item){item.layout=layout;saveBlocks(items);}},
      saveOrder(ids){const items=loadBlocks();saveBlocks(ids.map(id=>items.find(item=>item.id===id)).filter(Boolean));}
    }));
  }
  document.querySelector('[data-profile-empty]').hidden = shown.length > 0 || container.querySelector('[data-about-block]');
  // In viewing mode an empty "Meus cards" section is not shown at all.
  document.querySelector('.profile-content-section').toggleAttribute('data-user-hidden', !editing && !shown.length);
}

function setEditing(next) {
  editing = next;
  document.body.toggleAttribute('data-profile-editing', editing);
  const toggle = document.querySelector('[data-profile-edit-toggle]');
  toggle?.setAttribute('aria-pressed', String(editing));
  if (toggle) toggle.querySelector('span').textContent = editing ? 'Concluir edição' : 'Personalizar perfil';
  document.querySelector('[data-profile-edit-bar]').hidden = !editing;
  renderProfileBlocks();
  applySections();
  announce(editing ? 'Modo de edição: reorganize, oculte ou adicione blocos. As mudanças são salvas na hora.' : 'Edição concluída.');
}
{
  // Enabled only now: before the page script is ready, a click would do nothing.
  const toggle = document.querySelector('[data-profile-edit-toggle]');
  toggle?.addEventListener('click', () => setEditing(!editing));
  if (toggle) toggle.disabled = false;
}
document.querySelector('[data-profile-edit-done]')?.addEventListener('click', () => {
  setEditing(false);
  document.querySelector('[data-profile-edit-toggle]')?.focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && editing && !document.querySelector('dialog[open]')) {
    setEditing(false);
    document.querySelector('[data-profile-edit-toggle]')?.focus();
  }
});
document.querySelector('[data-profile-show-all]')?.addEventListener('click', () => {
  saveBlocks(loadBlocks().map((block) => ({ ...block, hidden: false })));
  profileLayout = normalizeProfileLayout({ hiddenSections: [] });
  void saveCloudState(userId, PROFILE_LAYOUT_KEY, profileLayout);
  renderProfileBlocks(); applySections();
  announce('Todos os blocos e seções voltaram a aparecer.');
});

function moveBlock(index, direction) {
  const blocks = loadBlocks();
  const target = index + direction;
  if (target < 0 || target >= blocks.length) return;
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  saveBlocks(blocks);
  renderProfileBlocks();
}

function renderAchievements(materials, reviewed, answered, minutes = 0) {
  const next = evaluateMilestones({aulas:materials,revisoes:reviewed,questoes:answered,minutos:minutes},gameState);
  if (JSON.stringify(next) !== JSON.stringify(gameState)) void saveCloudState(userId,'milestones',next);
  gameState = next;
  renderMilestoneCards();
  renderAvatarPicker();
  const level = document.querySelector('[data-profile-level]');
  level.replaceChildren();
  const emblem = document.createElement('span'); emblem.className='journey-emblem'; emblem.textContent=String(next.level); emblem.setAttribute('aria-hidden','true');
  const title = document.createElement('strong'); title.textContent = 'Nível ' + next.level;
  const caption = document.createElement('p'); caption.textContent = next.xp + ' XP · ' + Object.keys(next.unlocked).filter(id => milestones.some(b => b.id===id)).length + '/' + milestones.length + ' conquistas';
  const progress = document.createElement('progress'); progress.max=100; progress.value=next.xp%100; progress.setAttribute('aria-label','Progresso para o próximo nível');
  const hint = document.createElement('p'); hint.textContent = (100-next.xp%100) + ' XP para o próximo nível';
  const copy=document.createElement('div');copy.className='journey-copy';copy.append(title,caption);
  const banner=document.createElement('div');banner.className='journey-banner';banner.append(emblem,copy);
  // Provisional: computed in this browser from local study data; the server does not verify it.
  const note = document.createElement('p'); note.className = 'journey-note';
  note.textContent = 'Pontos e conquistas são calculados neste navegador a partir do seu uso e servem como incentivo; ainda não são verificados pelo servidor.';
  level.append(banner,progress,hint,note);
}
function renderMilestoneCards() {
  const container = document.querySelector('[data-achievements]'); container.replaceChildren();
  for (const badge of orderedMilestones(gameState)) {
    const earned = Boolean(gameState.unlocked?.[badge.id]);
    if ((milestoneFilter==='earned' && !earned)||(milestoneFilter==='progress' && earned)) continue;
    const value = Math.min(badge.target,gameState.best?.[badge.metric] || 0);
    const card = document.createElement('button'); card.type='button'; card.className='achievement-card milestone-card';
    card.classList.toggle('is-locked',!earned);
    const img=document.createElement('img'); img.src=getAvatar(badge.avatar).src; img.alt=''; img.width=48; img.height=48;
    const copy=document.createElement('div');
    const title=document.createElement('strong');title.textContent=badge.title;
    const labels={aulas:'aulas',revisoes:'revisões',questoes:'questões',minutos:'minutos'};
    const detail=document.createElement('span');detail.textContent=earned ? 'Conquistada · '+badge.xp+' XP' : Math.floor(value)+' / '+badge.target+' '+labels[badge.metric];
    const progress=document.createElement('progress');progress.max=badge.target;progress.value=value;progress.setAttribute('aria-label','Progresso de '+badge.title);
    copy.append(title,detail,progress);card.append(img,copy);card.addEventListener('click',()=>openMilestone(badge));container.append(card);
  }
  if (!container.children.length) { const empty=document.createElement('p');empty.textContent='As próximas conquistas aparecem aqui conforme você estuda.';container.append(empty); }
}
function openMilestone(badge) {
  document.querySelector('#milestone-dialog-title').textContent=badge.title;
  const container=document.querySelector('[data-milestone-detail]');container.replaceChildren();
  const avatar=getAvatar(badge.avatar);
  const image=document.createElement('img');image.src=avatar.src;image.alt=avatar.label;image.width=120;image.height=120;
  const date=gameState.unlocked?.[badge.id];
  const visual=document.createElement('div');visual.className='milestone-reward';visual.classList.toggle('is-locked',!date);visual.append(image);
  const label=document.createElement('span');label.className='milestone-state';label.textContent=date ? 'Conquistada' : 'Em progresso';visual.append(label);
  const info=document.createElement('div');info.className='milestone-info';
  const reward=document.createElement('h3');reward.textContent=avatar.label;
  const subtitle=document.createElement('p');subtitle.textContent=date ? 'Avatar desbloqueado' : 'Recompensa de perfil';
  const metrics=document.createElement('div');metrics.className='milestone-metrics';
  const metricName=(badge.target===1 ? {aulas:'aula',revisoes:'revisão',questoes:'questão',minutos:'minuto ouvido'} : {aulas:'aulas',revisoes:'revisões',questoes:'questões',minutos:'minutos ouvidos'})[badge.metric];
  const target=document.createElement('span');target.textContent=badge.target+' '+metricName;
  const xp=document.createElement('strong');xp.textContent='+'+badge.xp+' XP';metrics.append(target,xp);
  const progress=document.createElement('progress');progress.max=badge.target;progress.value=Math.min(badge.target,gameState.best?.[badge.metric]||0);progress.setAttribute('aria-label','Progresso do marco');
  const status=document.createElement('p');status.className='milestone-date';status.textContent=date ? 'Conquistada em '+new Date(date).toLocaleDateString((globalThis.VOZ_LOCALE || 'pt-BR')) : Math.floor(progress.value)+' de '+badge.target+' '+metricName;
  const link=document.createElement('a');link.className='primary-action';link.href='./historico.html';link.textContent='Ir para a Biblioteca';
  info.append(subtitle,reward,metrics,progress,status);
  if (date) {
    const equip=document.createElement('button');equip.type='button';equip.className='primary-action';equip.textContent=metadata.mascot_avatar===avatar.id ? 'Usar este avatar novamente' : 'Usar como foto';
    equip.addEventListener('click',async()=>{
      equip.disabled=true;
      try { await equipAvatar(avatar.id);equip.textContent='Avatar aplicado'; }
      catch { equip.textContent='Tentar novamente'; }
      finally { equip.disabled=false; }
    });info.append(equip);
  } else info.append(link);
  container.replaceChildren(visual,info);document.querySelector('#milestone-dialog').showModal();
}

async function equipAvatar(id) {
  if (!unlockedAvatars(gameState).has(id)) return;
  const user=await updateProfile({...metadata,mascot_avatar:id});
  await removeProfileMedia(userId,'avatar');
  avatarDraft=null;removeAvatar=false;avatarInput.value='';
  renderIdentity(user);setImagePreview(null,'avatar');updateUserIdentity(user);renderAvatarPicker();
}
function renderAvatarPicker() {
  const container=document.querySelector('[data-earned-avatars]');container.replaceChildren();
  const unlocked=unlockedAvatars(gameState);
  for (const avatar of avatars) {
    const button=document.createElement('button');button.type='button';button.className='earned-avatar';button.disabled=!unlocked.has(avatar.id);
    button.setAttribute('aria-label',avatar.label+(button.disabled ? ' · bloqueado' : ''));
    button.setAttribute('aria-pressed',String(metadata.mascot_avatar===avatar.id));
    const image=document.createElement('img');image.src=avatar.src;image.alt='';image.width=56;image.height=56;
    const text=document.createElement('span');text.textContent=avatar.label;
    const state=document.createElement('small');state.textContent=button.disabled ? 'Bloqueado' : 'Disponível';
    button.append(image,text,state);button.addEventListener('click',async()=>{
      button.disabled=true;
      try { await equipAvatar(avatar.id); } catch { setStatus(message,'Não foi possível aplicar o avatar. Tente novamente.','error');button.disabled=false; }
    });container.append(button);
  }
}
for (const button of document.querySelectorAll('[data-milestone-filter]')) button.addEventListener('click',()=>{
  milestoneFilter=button.dataset.milestoneFilter;
  for (const item of document.querySelectorAll('[data-milestone-filter]')) item.setAttribute('aria-pressed',String(item===button));
  renderMilestoneCards();
});

async function renderStudySummary() {
  try {
    const materials = await listMaterials();
    const reviewed = materials.filter((material) => studyFor(material.id).completed).length;
    const answered = materials.reduce((total, material) => total + Object.keys(studyFor(material.id).answers || {}).length, 0);
    const stats = [
      ['Aulas', materials.length],
      ['Revisões', reviewed],
      ['Questões', answered],
    ];
    const summary = document.querySelector('[data-profile-study-summary]');
    summary.replaceChildren();
    for (const [label, value] of stats) {
      const card = document.createElement('div');
      card.className = 'profile-stat';
      const number = document.createElement('strong');
      number.textContent = String(value);
      const caption = document.createElement('span');
      caption.textContent = label;
      card.append(number, caption);
      summary.append(card);
    }
    const minutes=materials.reduce((total,material)=> total + (studyFor(material.id).intervals || []).reduce((sum,[start,end])=>sum+Math.max(0,end-start),0),0)/60;
    renderAchievements(materials.length, reviewed, answered, minutes);
  } catch {
    document.querySelector('[data-profile-study-summary]').textContent = 'Estatísticas indisponíveis agora.';
    renderAchievements(0, 0, 0);
  }
}

function validateImage(file) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) throw new Error('Escolha uma imagem PNG, JPG, WebP ou GIF.');
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 8 MB.');
}

document.querySelector('#profile-edit-dialog').addEventListener('close', () => {
  if (avatarDraft || coverDraft || removeAvatar || removeCover) {
    avatarDraft = coverDraft = null;
    removeAvatar = removeCover = false;
    avatarInput.value = coverInput.value = '';
    loadMedia();
  }
});
avatarInput.addEventListener('change', () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  try {
    validateImage(file);
    avatarDraft = file;
    removeAvatar = false;
    setImagePreview(file, 'avatar');
  } catch (error) {
    avatarInput.value = '';
    setStatus(message, error.message, 'error');
  }
});
coverInput.addEventListener('change', () => {
  const file = coverInput.files?.[0];
  if (!file) return;
  try {
    validateImage(file);
    coverDraft = file;
    removeCover = false;
    setImagePreview(file, 'cover');
  } catch (error) {
    coverInput.value = '';
    setStatus(message, error.message, 'error');
  }
});
document.querySelector('[data-clear-avatar]').addEventListener('click', () => {
  avatarDraft = null;
  removeAvatar = true;
  avatarInput.value = '';
  setImagePreview(null, 'avatar');
});
document.querySelector('[data-clear-cover]').addEventListener('click', () => {
  coverDraft = null;
  removeCover = true;
  coverInput.value = '';
  setImagePreview(null, 'cover');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const saveButton = form.querySelector('[type="submit"]');
  saveButton.disabled = true;
  setStatus(message, 'Salvando perfil…');
  try {
    const updatedUser = await updateProfile({
      display_name: name.value.trim(),
      mascot_avatar: metadata.mascot_avatar,
      institution: institution.value.trim(),
      course: course.value.trim(),
      study_goal: goal.value.trim(),
      bio: bio.value.trim(),
    });
    if (avatarDraft) await saveProfileMedia(userId, 'avatar', avatarDraft);
    else if (removeAvatar) await removeProfileMedia(userId, 'avatar');
    if (coverDraft) await saveProfileMedia(userId, 'cover', coverDraft);
    else if (removeCover) await removeProfileMedia(userId, 'cover');
    avatarDraft = coverDraft = null;
    removeAvatar = removeCover = false;
    renderIdentity(updatedUser);
    updateUserIdentity(updatedUser);
    setStatus(message, 'Perfil atualizado.', 'success');
    document.querySelector('#profile-edit-dialog').close();
  } catch (error) {
    setStatus(message, error.message || 'Não foi possível salvar seu perfil.', 'error');
  } finally {
    saveButton.disabled = false;
  }
});

const cardEditor = createCardEditor({
  loadBlocks,
  saveBlocks,
  loadMedia: cardMedia,
  saveMedia: saveCardMedia,
  afterSave(block, previous) {
    if (previous?.media && previous.media !== block.media) releaseCardMedia(previous.media);
    renderProfileBlocks();
    announce(previous ? `${block.title} atualizado.` : `${block.title} adicionado ao perfil.`);
    toast(previous ? 'Card salvo.' : 'Card adicionado ao perfil.', { type: 'success' });
    document.querySelector(`[data-custom-block="${CSS.escape(block.id)}"] summary`)?.focus();
  },
});

document.querySelector('.profile-content-section [data-block-open]').addEventListener('click', () => cardEditor.open());
document.querySelector('[data-block-open-bar]')?.addEventListener('click', () => cardEditor.open());
// Data sources for "Seus dados" (a tool switched off on this server is offered but disabled).
void getFeatureFlags().catch(() => ({})).then((flags) => {
  const host = document.querySelector('[data-block-data-sources]');
  for (const [source, spec] of Object.entries(DATA_BLOCKS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-data-source';
    button.dataset.dataSource = source;
    const label = document.createElement('strong');
    label.textContent = spec.title;
    const detail = document.createElement('span');
    detail.textContent = spec.flag && !flags[spec.flag] ? 'Recurso desligado neste servidor' : spec.description;
    button.append(label, detail);
    button.disabled = Boolean(spec.flag && !flags[spec.flag]);
    button.addEventListener('click', () => {
      const block = newDataBlock(source);
      saveBlocks([...loadBlocks(), block]);
      renderProfileBlocks();
      document.querySelector('#block-dialog').close();
      announce(`${spec.title} adicionado ao perfil.`);
      document.querySelector(`[data-custom-block="${CSS.escape(block.id)}"] summary`)?.focus();
    });
    host.append(button);
  }
});
renderProfileBlocks();
renderStudySummary();
loadMedia();
window.addEventListener('online', () => { void loadMedia(); updateUserIdentity(session.user); });
new MutationObserver(() => {
  for (const block of loadBlocks().filter((item) => item.type === 'widget')) {
    const frame = [...document.querySelectorAll('[data-custom-block]')]
      .find((card) => card.dataset.customBlock === block.id)?.querySelector('iframe');
    if (frame) frame.srcdoc = widgetDocument(block.content, block.css);
  }
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-reduced-motion', 'data-low-stimulation', 'data-focus-mode'],
});
