import { enhanceCard } from '../utils/card-layout.js';
import { loadCloudState, saveCloudState, registerCloudMerge, cachedCloudState } from '../utils/profile-cloud.js';
import { PROFILE_LAYOUT_KEY, PROFILE_SECTIONS, BLOCK_SIZES, DATA_BLOCKS, normalizeProfileLayout, newDataBlock, duplicateBlock, moveBlock as movedBlocks, renderDataBlock } from './profile-editor.js';
import { getFeatureFlags } from '../utils/feature-flags.js';
import { milestones, evaluateMilestones, orderedMilestones, unlockedAvatars, mergeMilestoneStates } from '../utils/gamification.js';
import { widgetDocument, blockTemplates, templateFields, compileTemplate } from '../utils/profile-widgets.js';
import '../utils/preferences.js';
import { initAuthenticatedShell, updateUserIdentity, setStatus } from '../utils/shell.js';
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
let editingBlockId = null;
let cardCleanups = [];
let activeTemplate = null;
let blockMode = "template";

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

function safeEmbedUrl(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Cole um link válido do YouTube ou Spotify.');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com') {
    const videoId = host === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1];
    if (!videoId || !/^[\w-]{6,20}$/.test(videoId))
      throw new Error('Esse link do YouTube não contém um vídeo válido.');
    return `https://www.youtube-nocookie.com/embed/${videoId}`;
  }
  if (host === 'open.spotify.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed') parts.shift();
    if (!['track', 'album', 'playlist', 'episode', 'show'].includes(parts[0]) || !parts[1])
      throw new Error('Use um link de música, álbum, playlist, episódio ou programa do Spotify.');
    return `https://open.spotify.com/embed/${parts[0]}/${encodeURIComponent(parts[1])}`;
  }
  throw new Error('Por enquanto, os embeds aceitam links do YouTube e Spotify.');
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
    card.className = `profile-block profile-block-${block.type}${block.hidden ? ' is-hidden-block' : ''}`;
    card.dataset.customBlock = block.id;
    const heading = document.createElement('div');
    heading.className = 'profile-block-heading';
    const title = document.createElement('h3');
    title.textContent = block.title;
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
    if (block.type !== 'data') action('Editar', () => openBlockEditor(block));
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
      renderProfileBlocks();
      announce(`${block.title} removido.`);
      document.querySelector('[data-block-open]')?.focus();
    });
    heading.append(handle, title, actions);
    card.append(heading);
    if (block.templateId === 'checklist') {
      const items = String(block.templateValues?.items || '').split('\n').filter(item => item.trim()).slice(0,30);
      const list = document.createElement('div'); list.className='profile-checklist';
      for (const [itemIndex,text] of items.entries()) {
        const label=document.createElement('label');
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=Boolean(block.checkedItems?.[itemIndex]);
        const caption=document.createElement('span');caption.textContent=text;
        checkbox.addEventListener('change',()=>{
          const current=loadBlocks();const item=current.find(candidate=>candidate.id===block.id);
          if(item) { item.checkedItems={...item.checkedItems,[itemIndex]:checkbox.checked};saveBlocks(current); }
        });label.append(checkbox,caption);list.append(label);
      }
      card.append(list);
    } else if (block.type === 'widget') {
      const frame = document.createElement('iframe');
      frame.title = block.title;
      frame.setAttribute('sandbox', '');
      frame.referrerPolicy = 'no-referrer';
      frame.srcdoc = widgetDocument(block.content, block.css);
      frame.className = 'profile-widget-frame';
      card.append(frame);
    } else if (block.type === 'code') {
      const code = document.createElement('pre');
      const codeText = document.createElement('code');
      codeText.textContent = block.content;
      code.append(codeText);
      card.append(code);
    } else if (block.type === 'data') {
      const slot = document.createElement('div');
      slot.className = 'profile-data-slot';
      slot.setAttribute('aria-busy', 'true');
      slot.textContent = 'Carregando…';
      card.append(slot);
      void renderDataBlock(block.source).then((node) => { slot.replaceChildren(node); slot.setAttribute('aria-busy', 'false'); });
    } else if (block.type === 'embed') {
      const frame = document.createElement('iframe');
      frame.src = block.url;
      frame.title = block.title;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.sandbox = 'allow-scripts allow-same-origin allow-presentation';
      card.append(frame);
    } else {
      const text = document.createElement('p');
      text.textContent = block.content;
      card.append(text);
    }
    const body=document.createElement('div');body.className='profile-card-body';
    for(const child of [...card.children].filter(el=>el!==heading))body.append(child);
    card.append(body);container.append(card);
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

function openBlockEditor(block = null) {
  editingBlockId = block?.id || null;
  const dialog = document.querySelector('#block-dialog');
  const title = dialog.querySelector('#block-title');
  const kind = dialog.querySelector('#block-kind');
  const content = dialog.querySelector('#block-content');
  const url = dialog.querySelector('#block-url');
  title.value = block?.title || '';
  kind.value = block?.type || 'text';
  content.value = block?.content || '';
  dialog.querySelector('#block-css').value = block?.css || '';
  url.value = block?.url || '';
  dialog.querySelector('#block-dialog-title').textContent = block ? 'Editar bloco' : 'Adicionar ao perfil';
  dialog.querySelector('[type="submit"]').textContent = block ? 'Salvar bloco' : 'Adicionar bloco';
  const legacy = !block?.templateId && block ? Object.entries(blockTemplates).find(([,t]) => t.content === block.content && t.type === block.type)?.[0] : null;
  activeTemplate = block?.templateId || legacy || (!block ? 'notes' : null);
  blockMode = activeTemplate ? 'template' : block?.type === 'embed' ? 'embed' : 'raw';
  renderTemplateFields(block?.templateValues || {});
  syncBlockFields();
  dialog.showModal();
}

function syncBlockFields() {
  const type = document.querySelector('#block-kind').value;
  const isTemplate = blockMode === 'template';
  const isEmbed = type === 'embed';
  document.querySelector('[data-block-content-label]').firstChild.textContent = type === 'widget' ? 'HTML' : 'Texto ou código';
  document.querySelector('[data-block-content-label]').hidden = isEmbed || isTemplate;
  document.querySelector('[data-block-url-label]').hidden = !isEmbed;
  document.querySelector('[data-block-css-label]').hidden = type !== 'widget' || isTemplate;
  document.querySelector('#block-content').required = !isEmbed && !isTemplate;
  document.querySelector('#block-url').required = isEmbed;
  document.querySelector('[data-widget-preview-button]').hidden = type !== 'widget';
  document.querySelector('[data-widget-preview]').replaceChildren();
  document.querySelector('.block-templates').hidden = !isTemplate;
  document.querySelector('[data-template-fields]').hidden = !isTemplate;
  document.querySelector('[data-block-kind-label]').hidden = blockMode !== 'raw';
  // "Seus dados": choosing a source adds the block at once; the other fields do not apply.
  const isData = blockMode === 'data';
  document.querySelector('[data-block-data-sources]').hidden = !isData;
  document.querySelector('#block-title').closest('label').hidden = isData;
  document.querySelector('#block-title').required = !isData;
  document.querySelector('#block-dialog .form-actions').hidden = isData;
  if (isData) {
    for (const selector of ['[data-block-content-label]', '[data-block-url-label]', '[data-block-css-label]', '[data-widget-preview-button]', '.block-templates', '[data-template-fields]', '[data-block-kind-label]']) document.querySelector(selector).hidden = true;
    document.querySelector('#block-content').required = false;
    document.querySelector('#block-url').required = false;
  }
  for (const button of document.querySelectorAll('[data-block-mode]')) button.setAttribute('aria-pressed', String(button.dataset.blockMode === blockMode));
  for (const button of document.querySelectorAll('[data-template]')) button.setAttribute('aria-pressed', String(button.dataset.template === activeTemplate));
  document.querySelector('#block-content').placeholder = type === 'widget'
    ? 'Cole o HTML aqui'
    : 'Escreva seu texto ou código';
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

const blockForm = document.querySelector('[data-block-form]');
document.querySelector('[data-widget-preview-button]').addEventListener('click', () => {
  const frame = document.createElement('iframe');
  frame.title = 'Prévia do widget';
  frame.sandbox = '';
  const compiled = blockMode === 'template' ? compileTemplate(activeTemplate, readTemplateFields()) : null;
  frame.srcdoc = widgetDocument(compiled?.content ?? document.querySelector('#block-content').value, compiled?.css ?? document.querySelector('#block-css').value);
  document.querySelector('[data-widget-preview]').replaceChildren(frame);
});
document.querySelector('#block-kind').addEventListener('change', syncBlockFields);
blockForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = document.querySelector('#block-title').value.trim();
  const type = document.querySelector('#block-kind').value;
  const content = document.querySelector('#block-content').value.trim();
  const status = document.querySelector('[data-block-message]');
  try {
    const blocks = loadBlocks();
    const current = blocks.find((block) => block.id === editingBlockId);
    const block = {
      id: editingBlockId || crypto.randomUUID(),
      title,
      type,
      content: type === 'embed' ? '' : content,
      ...(type === 'widget' ? { css: document.querySelector('#block-css').value.slice(0, 50000) } : {}),
      ...(blockMode === 'template' ? compileTemplate(activeTemplate, readTemplateFields()) : { templateId:null, templateValues:null }),
      ...(type === 'embed' && blockMode !== 'template' ? { url: safeEmbedUrl(document.querySelector('#block-url').value) } : {}),
    };
    if (block.templateId === 'checklist' && current?.templateValues?.items !== block.templateValues?.items) block.checkedItems = {};
    if (current) Object.assign(current, block);
    else blocks.push(block);
    saveBlocks(blocks);
    renderProfileBlocks();
    blockForm.reset();
    syncBlockFields();
    editingBlockId = null;
    document.querySelector('#block-dialog').close();
    setStatus(status, 'Bloco salvo.', 'success');
  } catch (error) {
    setStatus(status, error.message || 'Não foi possível salvar o bloco.', 'error');
  }
});

document.querySelector('.profile-content-section [data-block-open]').addEventListener('click', () => openBlockEditor());
document.querySelector('[data-block-open-bar]')?.addEventListener('click', () => openBlockEditor());
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

function readTemplateFields() {
  return Object.fromEntries([...document.querySelectorAll('[data-template-field]')].map(input => [input.dataset.templateField, input.value]));
}
function renderTemplateFields(values = {}) {
  const container = document.querySelector('[data-template-fields]');
  container.replaceChildren();
  if (!activeTemplate) return;
  for (const [key, title, fallback] of templateFields[activeTemplate]) {
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('textarea');
    input.dataset.templateField = key;
    input.rows = key === 'items' || key === 'text' ? 4 : 2;
    input.maxLength = 2000;
    input.value = values[key] ?? fallback;
    label.append(input); container.append(label);
  }
}
for (const button of document.querySelectorAll('[data-template]')) {
  button.addEventListener('click', () => {
    activeTemplate = button.dataset.template;
    blockMode = 'template';
    document.querySelector('#block-kind').value = blockTemplates[activeTemplate].type;
    document.querySelector('#block-title').value = blockTemplates[activeTemplate].title;
    renderTemplateFields(); syncBlockFields();
  });
}
for (const button of document.querySelectorAll('[data-block-mode]')) {
  button.addEventListener('click', () => {
    const next = button.dataset.blockMode;
    if (blockMode === 'template' && next === 'raw') {
      const compiled = compileTemplate(activeTemplate || 'notes', readTemplateFields());
      document.querySelector('#block-content').value = compiled.content;
      document.querySelector('#block-css').value = compiled.css;
      document.querySelector('#block-kind').value = compiled.type;
    }
    blockMode = next;
    if (next === 'embed') document.querySelector('#block-kind').value = 'embed';
    else if (next === 'raw' && document.querySelector('#block-kind').value === 'embed') document.querySelector('#block-kind').value = 'widget';
    else if (next === 'template') { activeTemplate ||= 'notes'; document.querySelector('#block-kind').value = blockTemplates[activeTemplate].type; renderTemplateFields(); }
    syncBlockFields();
  });
}
