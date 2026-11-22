import { createFolderIcons } from '../utils/folder-icons.js';
import { icon as uiIcon, iconMarkup } from '../utils/icons.js';
import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { listMaterials, deleteMaterial, updateMaterial } from '../api/material.api.js';
import { getCatalog, getLibraryResources, createSubject, updateSubject, deleteSubject, createUnit, assignMaterial } from '../api/catalog.api.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { studyFor, metadataTags, saveTags, listeningPercent } from '../utils/study-store.js';
import { formatDate, formatDuration } from '../utils/format.js';
import { materialRow, materialHref } from '../utils/library-ui.js';
import { materialState, emptyState, errorState } from '../utils/material-ui.js';
import { initLibraryViewSwitcher } from './library-views.js';
import { folderButton as multiLessonFolderButton, selectionButton as multiLessonSelectionButton, unitsButton as multiLessonUnitsButton } from './multi-lesson-entry.js';

const session = await initAuthenticatedShell();
const folderIcons = createFolderIcons(session.user.id);
const query = new URLSearchParams(location.search);
const search = document.querySelector('#library-search');
const groups = document.querySelector('[data-library-groups]');
document.addEventListener('click',event=>{for(const menu of document.querySelectorAll('.row-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const menu of document.querySelectorAll('.row-menu[open]')){menu.open=false;menu.querySelector('summary').focus();}});
const state = document.querySelector('[data-library-state]');
const container = document.querySelector('[data-library-data]');
const count = document.querySelector('[data-library-count]');
const loading = document.querySelector('[data-library-loading]');
const viewStatus = document.querySelector('[data-library-view-status]');
const folderToolbar = document.querySelector('[data-library-folder-toolbar]');
const newSubjectButton = document.querySelector('[data-open-new-subject]');
const controls = Object.fromEntries(
  ['subject', 'tag', 'status', 'study', 'order'].map((key) => [
    key,
    document.querySelector('#library-' + key),
  ]),
);
search.value = query.get('q') || '';
if (['active', 'completed', 'new'].includes(query.get('study'))) controls.study.value = query.get('study');

let materials = [];
let loaded = false;
let editing = null;
let announceTimer;
let returnFocus = null;
let catalogEnabled = false;
let catalog = { subjects: [], units: [] };
let libraryViews;
let treeResources = {};
window.addEventListener('library-layout-changed',()=>{if(loaded)render();});
const openSubjects = new Set();
const openUnits = new Set();
window.addEventListener('folder-icons-updated',()=>{if(loaded)render();});
const editDialog = document.querySelector('#metadata-dialog');
/**
 * Dialogs opened from a ⋯ menu: the item that opened them is hidden when the menu closes, so the
 * browser cannot return focus to it. Send focus back to the menu button instead.
 */
function returnFocusOnClose(dialog, target) {
  dialog.addEventListener('close', () => {
    const element = typeof target === 'function' ? target() : target;
    if (element?.isConnected) element.focus();
  }, { once: true });
}
/** The ⋯ button of a subject, found again after the list is re-rendered. */
const subjectMenuButton = (id) => document.querySelector(`.subject-menu[data-subject-id="${CSS.escape(String(id))}"] > summary`);
const editForm = document.querySelector('[data-metadata-form]');
const editMessage = document.querySelector('[data-metadata-message]');
const nameField = document.querySelector('#metadata-name');
const subjectField = document.querySelector('#metadata-subject');
const subjectEditLabel = subjectField.closest('label');
const tagsField = document.querySelector('#metadata-tags');
const folderGroup = document.querySelector('[data-metadata-folder]');
const folderField = document.querySelector('#metadata-folder');
const unitField = document.querySelector('#metadata-unit');
function populateOrganizeUnits() {
  const subject = catalog.subjects.find((item) => item.id === folderField.value);
  unitField.disabled = !subject;
  fillOptions(
    unitField,
    catalog.units.filter((unit) => unit.subject_id === subject?.id).map((unit) => ({ value: unit.id, label: unit.title })),
    'Sem unidade',
  );
}
folderField.addEventListener('change', populateOrganizeUnits);
const subjectDialog = document.querySelector('[data-subject-dialog]');
const subjectForm = document.querySelector('[data-subject-form]');
const subjectMessage = document.querySelector('[data-subject-message]');
const unitDialog = document.querySelector('[data-unit-dialog]');
const unitForm = document.querySelector('[data-unit-form]');
const unitMessage = document.querySelector('[data-unit-message]');
const subjectIconPicker=folderIcons.picker(subjectForm,'subject');
const unitIconPicker=folderIcons.picker(unitForm,'unit');
const assignDialog = document.querySelector('[data-assign-dialog]');
const assignForm = document.querySelector('[data-assign-form]');
const assignMessage = document.querySelector('[data-assign-message]');
const assignSubject = document.querySelector('#assign-subject');
const assignUnit = document.querySelector('#assign-unit');

function fillOptions(control, values, firstLabel) {
  const previous = control.value;
  control.replaceChildren(new Option(firstLabel, 'all'));
  for (const item of values) control.append(new Option(item.label, item.value));
  if ([...control.options].some((option) => option.value === previous)) control.value = previous;
}

function populateFilters() {
  const subjects = new Set(materials.map((material) => material.subject || 'Sem disciplina'));
  if (catalogEnabled) for (const subject of catalog.subjects) subjects.add(subject.name);
  fillOptions(
    controls.subject,
    [...subjects].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((name) => ({ value: name, label: name })),
    'Todas as disciplinas',
  );
  fillOptions(
    controls.tag,
    [...new Set(materials.flatMap(metadataTags))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((name) => ({ value: name, label: name })),
    'Todas as tags',
  );
  const suggestions = document.querySelector('#subject-suggestions');
  suggestions.replaceChildren();
  for (const value of [...new Set(materials.map((material) => material.subject).filter(Boolean))]) {
    const option = document.createElement('option');
    option.value = value;
    suggestions.append(option);
  }
}

function hasFilters() {
  return Boolean(search.value.trim()) || ['subject', 'tag', 'status', 'study'].some((key) => controls[key].value !== 'all');
}

function clear() {
  search.value = '';
  for (const key of ['subject', 'tag', 'status', 'study']) controls[key].value = 'all';
  render();
  search.focus();
}

function edit(material) {
  returnFocus = document.activeElement;
  editing = material;
  nameField.value = material.title;
  subjectField.value = material.subject || '';
  subjectEditLabel.hidden = catalogEnabled;
  tagsField.value = studyFor(material.id).tags.join(', ');
  // With folders enabled, discipline and unit are chosen from the catalog in the same dialog.
  folderGroup.hidden = !catalogEnabled || !catalog.subjects.length;
  if (!folderGroup.hidden) {
    fillOptions(folderField, catalog.subjects.map((subject) => ({ value: subject.id, label: subject.name })), 'Sem disciplina');
    const subject = catalog.subjects.find((entry) => entry.id === material.subject_id || entry.name === material.subject);
    folderField.value = subject?.id || '';
    populateOrganizeUnits();
    unitField.value = material.unit_id || '';
  }
  setStatus(editMessage, '');
  editDialog.showModal();
  nameField.focus();
}

function openUnitDialog(subject) {
  unitForm.reset();
  unitMessage.textContent = '';
  unitForm.querySelector('[name="subjectId"]').value = subject.id;
  document.querySelector('[data-unit-subject-name]').textContent = subject.name;
  unitIconPicker.select(null, '');
  unitDialog.showModal();
  unitForm.querySelector('[name="title"]').focus();
}

function populateAssignUnits() {
  const subject = catalog.subjects.find((item) => item.id === assignSubject.value);
  assignUnit.disabled = !subject;
  fillOptions(
    assignUnit,
    catalog.units
      .filter((unit) => unit.subject_id === subject?.id)
      .map((unit) => ({ value: unit.id, label: unit.title })),
    'Sem unidade',
  );
}

function openAssignDialog(material) {
  if (!catalogEnabled || !catalog.subjects.length) return;
  assignForm.reset();
  assignMessage.textContent = '';
  assignForm.querySelector('[name="materialId"]').value = material.id;
  document.querySelector('[data-assign-material-title]').textContent = material.title;
  fillOptions(
    assignSubject,
    catalog.subjects.map((subject) => ({ value: subject.id, label: subject.name })),
    'Sem disciplina',
  );
  const subject = catalog.subjects.find((entry) => entry.id === material.subject_id || entry.name === material.subject);
  assignSubject.value = subject?.id || '';
  populateAssignUnits();
  assignUnit.value = material.unit_id || '';
  assignDialog.showModal();
}

function syncMaterial(updated) {
  materials = materials.map((material) => material.id === updated.id ? { ...material, ...updated } : material);
  populateFilters();
  render();
}

async function moveMaterial(materialId, subjectId, unitId = null) {
  try {
    const updated = await assignMaterial(materialId, subjectId, unitId || null);
    syncMaterial(updated);
    return true;
  } catch (error) {
    setStatus(count, error.message || 'Não foi possível mover esta aula.', 'error');
    return false;
  }
}

function enableDrag(element, material) {
  if (!catalogEnabled) return;
  element.draggable = true;
  element.removeAttribute('title');
  element.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/plain', material.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    element.classList.add('is-dragging');
  });
  element.addEventListener('dragend', () => element.classList.remove('is-dragging'));
}

function enableDrop(target, subjectId, unitId = null) {
  if (!catalogEnabled || !subjectId) return;
  target.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('text/plain')) return;
    event.preventDefault();
    target.classList.add('is-drop-target');
  });
  target.addEventListener('dragleave', (event) => {
    if (!target.contains(event.relatedTarget)) target.classList.remove('is-drop-target');
  });
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.classList.remove('is-drop-target');
    const materialId = event.dataTransfer?.getData('text/plain');
    if (materialId) void moveMaterial(materialId, subjectId, unitId);
  });
}

function row(material, { folderName = null, standalone = false } = {}) {
  const item = materialRow(material);
  const tagList = item.querySelector('.material-tags');
  if(tagList) for(const tag of [...tagList.children]) {
    if(/^(a\/?v|mp3|mp4|wav|m4a|ogg|webm|áudio|vídeo)$/i.test(tag.textContent.trim()))tag.remove();
  }
  if (folderName && tagList) {
    for (const tag of [...tagList.children]) {
      if (tag.textContent.toLocaleLowerCase('pt-BR') === folderName.toLocaleLowerCase('pt-BR')) tag.remove();
    }
    if (!tagList.children.length) tagList.remove();
  }
  if (standalone) {
    const icon = document.createElement('span');
    icon.className = 'library-file-icon';
    icon.append(uiIcon('document', { size: 18 }));
    item.querySelector('.material-row-heading').prepend(icon);
  }

  const actions = item.querySelector('.material-row-actions');
  const menu = document.createElement('details');
  menu.className = 'row-menu';
  const summary = document.createElement('summary');
  summary.replaceChildren(uiIcon('more', { size: 18 }));
  summary.title = 'Mais opções';
  summary.setAttribute('aria-label', `Ações para ${material.title}`);
  const options = document.createElement('div');
  options.className = 'row-menu-content';
  // Three distinct intents: open, correct the transcript text, organize metadata.
  const open = document.createElement('a');
  open.href = materialHref(material.id);
  open.textContent = 'Abrir aula';
  open.dataset.icon = 'open';
  const editTranscript = document.createElement('a');
  editTranscript.href = materialHref(material.id) + '&edit=transcricao#transcricao';
  editTranscript.textContent = 'Editar transcrição';
  editTranscript.dataset.icon = 'edit';
  const organize = document.createElement('button');
  organize.type = 'button';
  organize.textContent = 'Editar informações';
  organize.dataset.icon = 'organize';
  organize.addEventListener('click', () => { menu.open = false; returnFocusOnClose(editDialog, summary); edit(material); });
  const questions = document.createElement('a');
  questions.href = materialHref(material.id) + '#questoes';
  questions.textContent = 'Ver questões';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.textContent = 'Excluir material';
  remove.addEventListener('click', async () => {
    if (!confirm(`Excluir “${material.title}” e todos os materiais derivados?`)) return;
    remove.disabled = true;
    try {
      await deleteMaterial(material.id);
      materials = materials.filter((entry) => entry.id !== material.id);
      populateFilters();
      render();
    } catch (error) {
      setStatus(count, error.message, 'error');
      remove.disabled = false;
    }
  });
  options.append(open);
  if (materialState(material) !== 'processing') options.append(editTranscript);
  options.append(organize);
  if (catalogEnabled && catalog.subjects.length) {
    const move = document.createElement('button');
    move.type = 'button';
    move.dataset.icon = 'folder';
    move.textContent = 'Mover para pasta';
    move.addEventListener('click', () => { menu.open = false; returnFocusOnClose(assignDialog, summary); openAssignDialog(material); });
    options.append(move);
  }
  questions.dataset.icon = 'list';
  if (materialState(material) === 'ready') options.append(questions);
  const generate = actions.querySelector('a[aria-label^="Gerar novas questões"]');
  if (generate) { generate.dataset.icon = 'add'; options.append(generate); }
  remove.dataset.icon = 'remove';
  options.append(remove);
  // Shared icon set (frontend/js/utils/icons.js): menu intent -> icon name.
  const menuIcons = { open: 'open', edit: 'edit', organize: 'organize', folder: 'folder', list: 'questions', add: 'add', remove: 'remove' };
  for (const option of options.children) option.append(uiIcon(menuIcons[option.dataset.icon] || 'questions', { size: 18 }));
  menu.append(summary, options);
  menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('.row-menu[open]'))if(other!==menu)other.open=false;});
  actions.replaceChildren(actions.querySelector('a.secondary-action'), menu);
  enableDrag(item, material);
  return item;
}

/**
 * Folder colour: the subject's stored colour when it is one of the palette's, else a stable tone
 * from its place in the catalog (or its name), cycling lavender, matcha, honey, mist and rose.
 */
const FOLDER_TONES = ['lavender', 'matcha', 'honey', 'mist', 'rose'];
function folderTone(group) {
  if (FOLDER_TONES.includes(group.color)) return group.color;
  const index = catalog?.subjects?.findIndex((subject) => subject.id && subject.id === group.id) ?? -1;
  if (index >= 0) return FOLDER_TONES[index % FOLDER_TONES.length];
  // Not in the catalog (subject typed on a lesson): its place among the names, alphabetically.
  const names = [...new Set([...(catalog?.subjects || []).map((subject) => subject.name), group.name])].sort((a, b) =>
    String(a).localeCompare(String(b), 'pt-BR'),
  );
  return FOLDER_TONES[Math.max(0, names.indexOf(group.name)) % FOLDER_TONES.length];
}

function groupMaterials(visible) {
  const groupsById = new Map();
  const groupsByName = new Map();
  const result = [];
  if (catalogEnabled) {
    for (const subject of catalog.subjects) {
      const group = { id: subject.id, name: subject.name, color: subject.color_token, materials: [] };
      groupsById.set(subject.id, group);
      groupsByName.set(subject.name.toLocaleLowerCase('pt-BR'), group);
      result.push(group);
    }
  }
  for (const material of visible) {
    const name = material.subject || 'Sem disciplina';
    let group = material.subject_id ? groupsById.get(material.subject_id) : null;
    group ||= groupsByName.get(name.toLocaleLowerCase('pt-BR'));
    if (!group) {
      const key = material.subject_id || name.toLocaleLowerCase('pt-BR');
      group = groupsById.get(key);
      if (!group) {
        group = { id: material.subject_id || null, name, materials: [] };
        if (material.subject_id) groupsById.set(material.subject_id, group);
        groupsByName.set(name.toLocaleLowerCase('pt-BR'), group);
        result.push(group);
      }
    }
    group.materials.push(material);
  }
  const filtered = hasFilters();
  return result
    .filter((group) => !filtered || group.materials.length)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function lessonCountLabel(total) { return `${total} ${total === 1 ? 'aula' : 'aulas'}`; }

// List view (Finder-like): one row per lesson with an original document icon, its date,
// duration and progress; the lesson's parts (transcript, summary…) follow when known.
const DOC_ICON=iconMarkup('document');
function treeFiles(material) {
  const list=document.createElement('div');list.className='library-tree-files';list.dataset.materialId=material.id;
  const available=treeResources[material.id]||{};
  const audio=Array.isArray(material.audio_files)?material.audio_files[0]:material.audio_files||material.audio;
  const study=studyFor(material.id),percent=listeningPercent(material.id);
  const main=document.createElement('a');main.href=materialHref(material.id);main.className='library-tree-row';
  const icon=document.createElement('span');icon.className='library-doc-icon';icon.innerHTML=DOC_ICON;
  const title=document.createElement('span');title.className='library-tree-title';title.textContent=material.title;
  const date=document.createElement('small');date.className='library-tree-date';date.textContent=formatDate(material.created_at);
  const length=document.createElement('small');length.className='library-tree-length';length.textContent=audio?.duration_ms?formatDuration(audio.duration_ms):'';
  const progress=document.createElement('small');progress.className='library-tree-progress';
  progress.textContent=study.completed?'Estudada':study.playedAt?`${percent}% ouvido`:'';
  main.append(icon,title,date,length,progress);list.append(main);
  const types=[['transcription','Transcrição','#transcricao'],['summary','Resumo','#resumo'],['questions','Questões','#questoes']];
  for(const [key,label,fragment] of types)if(available[key]===true){
    const link=document.createElement('a');link.href=materialHref(material.id)+fragment;link.className='library-tree-part';
    link.textContent=label;link.setAttribute('aria-label',`${label} de ${material.title}`);list.append(link);
  }
  return list;
}
const SUBJECT_MENU_ICONS = { edit: 'edit', remove: 'remove' };
const menuIcon = (name) => uiIcon(name, { size: 18 });
/** "⋯" menu for a subject folder: Editar (rename, icon) and Remover (lessons are kept). */
function subjectMenu(group) {
  const menu = document.createElement('details');
  menu.className = 'row-menu subject-menu';
  menu.dataset.subjectMenu = '';
  menu.dataset.subjectId = String(group.id);
  const summary = document.createElement('summary');
  summary.replaceChildren(uiIcon('more', { size: 18 }));
  summary.title = 'Opções da disciplina';
  summary.setAttribute('aria-label', `Opções da disciplina ${group.name}`);
  const options = document.createElement('div');
  options.className = 'row-menu-content';
  const editOption = document.createElement('button');
  editOption.type = 'button';
  editOption.textContent = 'Editar';
  editOption.append(menuIcon(SUBJECT_MENU_ICONS.edit));
  editOption.addEventListener('click', () => {
    menu.open = false;
    returnFocusOnClose(subjectDialog, () => subjectMenuButton(group.id) || summary);
    openSubjectDialog({ id: group.id, name: group.name });
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete-button';
  remove.textContent = 'Remover';
  remove.append(menuIcon(SUBJECT_MENU_ICONS.remove));
  remove.addEventListener('click', () => {
    menu.open = false;
    void removeSubject(group, remove, summary);
  });
  options.append(editOption, remove);
  menu.append(summary, options);
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of document.querySelectorAll('.row-menu[open]')) if (other !== menu) other.open = false;
  });
  return menu;
}

async function removeSubject(group, button, menuButton) {
  const lessons = materials.filter((material) => material.subject_id === group.id).length;
  const units = catalog.units.filter((unit) => unit.subject_id === group.id).length;
  const details = [
    lessons ? `${lessonCountLabel(lessons)} não ${lessons === 1 ? 'será apagada' : 'serão apagadas'}: ${lessons === 1 ? 'ela vai' : 'elas vão'} para “Sem disciplina”.` : 'A pasta está vazia.',
    units ? `${units === 1 ? 'A unidade desta disciplina também será removida' : `As ${units} unidades desta disciplina também serão removidas`}.` : '',
  ].filter(Boolean).join(' ');
  if (!confirm(`Remover a disciplina “${group.name}”?\n\n${details}`)) {
    menuButton?.focus();
    return;
  }
  button.disabled = true;
  try {
    await deleteSubject(group.id);
    catalog.subjects = catalog.subjects.filter((subject) => subject.id !== group.id);
    catalog.units = catalog.units.filter((unit) => unit.subject_id !== group.id);
    for (const material of materials)
      if (material.subject_id === group.id) Object.assign(material, { subject: null, subject_id: null, unit_id: null });
    openSubjects.delete(String(group.id));
    populateFilters();
    const route = new URLSearchParams(location.search);
    if (route.get('folder') === String(group.id)) navigateFolder();
    else render();
    setStatus(viewStatus, lessons ? `Disciplina removida. ${lessonCountLabel(lessons)} ${lessons === 1 ? 'foi' : 'foram'} para “Sem disciplina”.` : 'Disciplina removida.', 'success');
    // The folder is gone: continue from the library's "Nova disciplina" button (or the status).
    if (!newSubjectButton.hidden) newSubjectButton.focus();
    else { viewStatus.tabIndex = -1; viewStatus.focus(); }
  } catch (error) {
    setStatus(viewStatus, error.message || 'Não foi possível remover a disciplina.', 'error');
    (subjectMenuButton(group.id) || menuButton)?.focus();
  } finally {
    button.disabled = false;
  }
}

function navigateFolder(subject = '', unit = '') {
  const url=new URL(location.href);
  for(const [key,value] of [['folder',subject],['unit',unit]]) { if(value)url.searchParams.set(key,value);else url.searchParams.delete(key); }
  history.pushState(null,'',url);render();
}
window.addEventListener('popstate',()=>{if(loaded)render();});
function renderFolderGroups(visible, _needle) {
  const folderGroups = groupMaterials(visible);
  const route=new URLSearchParams(location.search),selected=route.get('folder'),selectedUnit=route.get('unit');
  newSubjectButton.hidden = !catalogEnabled || Boolean(selected);
  const breadcrumb=document.createElement('nav');breadcrumb.className='library-breadcrumb';breadcrumb.setAttribute('aria-label','Caminho da biblioteca');
  const home=document.createElement('button');home.type='button';home.textContent='Biblioteca';home.onclick=()=>navigateFolder();breadcrumb.append(home);
  const current=folderGroups.find(group=>String(group.id||group.name)===selected);
  if(current){const parent=document.createElement('button');parent.type='button';parent.textContent=current.name;parent.onclick=()=>navigateFolder(selected);breadcrumb.append(document.createTextNode(' / '),parent);}
  const currentUnit=catalog.units.find(unit=>String(unit.id)===selectedUnit);
  if(currentUnit)breadcrumb.append(document.createTextNode(' / '+currentUnit.title));
  groups.append(breadcrumb);groups.classList.toggle('is-folder-page',Boolean(selected));
  folderToolbar.prepend(breadcrumb);
  const toolbarTitle=folderToolbar.querySelector('h2');
  breadcrumb.prepend(toolbarTitle);
  for(const old of folderToolbar.querySelectorAll('.library-breadcrumb'))if(old!==breadcrumb)old.remove();
  folderToolbar.querySelector('[data-create-unit-shortcut]')?.remove();
  folderToolbar.querySelector('[data-subject-menu]')?.remove();
  folderToolbar.querySelector('[data-multi-lesson-folder]')?.remove();
  folderToolbar.querySelector('[data-multi-lesson-units]')?.remove();
  // 3.4: several units at once, picked in the dialog (library root and subject pages).
  if (multiLessonEnabled && catalogEnabled && !selectedUnit && catalog.units.length >= 2)
    folderToolbar.append(multiLessonUnitsButton(() => ({ subjects: catalog.subjects, units: catalog.units, currentSubjectId: selected })));
  let groupIndex = 0;
  for (const group of folderGroups) {
    if(selected && String(group.id||group.name)!==selected)continue;
    const section = document.createElement('section');
    section.className = 'library-group library-folder-group';
    section.dataset.folderTone = folderTone(group);
    const folder = document.createElement('details');
    folder.className = 'library-subject-folder';
    const summary = document.createElement('summary');
    summary.id = `library-group-${groupIndex++}`;
    summary.title = 'Abrir disciplina';
    summary.addEventListener('click', event => { if(document.body.dataset.libraryLayout==='list')return;event.preventDefault(); navigateFolder(String(group.id || group.name)); });
    const icon = folderIcons.icon('subject',group.id,group.name);
    const name = document.createElement('strong');
    name.textContent = group.name;
    const total = document.createElement('span');
    total.className = 'library-folder-count';
    total.textContent = lessonCountLabel(group.materials.length);
    summary.append(icon, name, total);
    folder.append(summary);

    const content = document.createElement('div');
    content.className = 'library-folder-content';
    const units = catalogEnabled && group.id
      ? catalog.units.filter((unit) => unit.subject_id === group.id)
      : [];
    let createUnitButton;
    if (catalogEnabled && group.id && selected && !selectedUnit) {
      createUnitButton = document.createElement('button');
      createUnitButton.type = 'button';
      createUnitButton.className = 'catalog-add-unit';
      createUnitButton.textContent = '+';
      createUnitButton.title = 'Nova unidade';
      createUnitButton.setAttribute('aria-label','Nova unidade');
      createUnitButton.dataset.createUnitShortcut='';
      createUnitButton.addEventListener('click', () => openUnitDialog({ id: group.id, name: group.name }));
    }

    const groupedIds = new Set();
    for (const unit of units) {
      const unitMaterials = group.materials.filter((material) => material.unit_id === unit.id);
      for (const material of unitMaterials) groupedIds.add(material.id);
      const unitFolder = document.createElement('details');
      unitFolder.className = 'library-unit-folder';
      const unitKey = String(unit.id);
      unitFolder.open = openUnits.has(unitKey) || hasFilters();
      unitFolder.addEventListener('toggle', () => {
        if (unitFolder.open) openUnits.add(unitKey);
        else openUnits.delete(unitKey);
      });
      const unitSummary = document.createElement('summary');
      unitSummary.addEventListener('click',event=>{if(document.body.dataset.libraryLayout==='list')return;event.preventDefault();navigateFolder(String(group.id||group.name),String(unit.id));});
      unitSummary.title = 'Abra a unidade ou arraste uma aula para movê-la';
      const unitIcon = folderIcons.icon('unit',unit.id,unit.title);
      const unitName = document.createElement('strong');
      unitName.textContent = unit.title;
      const unitCount = document.createElement('span');
      unitCount.className = 'library-folder-count';
      unitCount.textContent = lessonCountLabel(unitMaterials.length);
      unitSummary.append(unitIcon, unitName, unitCount);
      unitFolder.append(unitSummary);
      const unitContent = document.createElement('div');
      unitContent.className = 'library-unit-content';
      if (unitMaterials.length) {
        for (const material of unitMaterials) unitContent.append(document.body.dataset.libraryLayout==='list'?treeFiles(material):row(material, { folderName: group.name }));
      } else {
        const empty=emptyState('Espaço para novas aulas', 'Suas aulas vão aparecer aqui.', { href: null, mascot: true });
        empty.classList.add('library-folder-empty');unitContent.append(empty);
      }
      if (!unitMaterials.length && hasFilters()) continue;
      unitFolder.append(unitContent);
      enableDrop(unitFolder, group.id, unit.id);
      if(!selectedUnit)content.append(unitFolder);
      else if(String(unit.id)===selectedUnit)content.append(unitContent);
    }

    const standalone = group.materials.filter((material) => !groupedIds.has(material.id));
    if (standalone.length && !selectedUnit) {
      const heading = document.createElement('h3');
      heading.className = 'library-standalone-heading';
      const fileIcon = uiIcon('document', { size: 18 });
      heading.append(fileIcon, document.createTextNode('Aulas sem unidade'));
      const list = document.createElement('div');
      list.className = 'library-standalone-list';
      for (const material of standalone) list.append(document.body.dataset.libraryLayout==='list'?treeFiles(material):row(material, { folderName: group.name, standalone: true }));
      content.append(list);
    } else if (!group.materials.length) {
      content.append(emptyState('Nenhuma aula nesta disciplina.', '', { href: null, mascot: 'rest' }));
    }

    if(createUnitButton)folderToolbar.append(createUnitButton);
    // Discreet "⋯" with Editar/Remover: on the card in the grid, in the toolbar on the folder page.
    const subjectActions = catalogEnabled && group.id ? subjectMenu(group) : null;
    if (subjectActions && selected) folderToolbar.append(subjectActions);
    // Milestone C: study the whole unit or subject as one integrated material.
    if (multiLessonEnabled && group.id && selected)
      folderToolbar.append(multiLessonFolderButton({ subjectId: group.id, unitId: currentUnit?.id || null, name: currentUnit?.title || group.name }));
    folder.append(content);
    if (group.id) enableDrop(folder, group.id, null);
    if(selected){section.classList.add('library-folder-page');section.append(content);}else section.append(folder);
    if (subjectActions && !selected) { section.classList.add('has-subject-menu'); section.append(subjectActions); }
    groups.append(section);
  }
}

function renderResources(visible) {
  const resourceGroups = libraryViews.groupsFor(visible);
  const resourceCount = resourceGroups.reduce((total, group) => total + group.items.length, 0);
  if (!resourceCount) {
    state.hidden = false;
    state.append(emptyState('Nenhum recurso encontrado.', 'Tente outra busca ou filtro.', { href: null, mascot: 'curious' }));
    return;
  }
  let groupIndex = 0;
  for (const group of resourceGroups) {
    const section = document.createElement('section');
    section.className = 'library-group library-resource-group';
    const heading = document.createElement('h2');
    heading.id = 'resource-group-' + groupIndex++;
    section.setAttribute('aria-labelledby', heading.id);
    heading.textContent = group.label;
    const total = document.createElement('small');
    total.textContent = `${group.items.length} ${group.items.length === 1 ? 'item' : 'itens'}`;
    heading.append(' ', total);
    section.append(heading);
    for (const resource of group.items) {
      const article = document.createElement('article');
      article.className = 'library-resource-reference';
      const link = document.createElement('a');
      link.href = resource.href;
      link.textContent = resource.title;
      const meta = document.createElement('p');
      const original = visible.find((material) => material.id === resource.materialId);
      meta.textContent = original?.subject || 'Sem disciplina';
      article.append(link, meta);
      section.append(article);
    }
    groups.append(section);
  }
}

function render() {
  if (!loaded) return;
  const needle = search.value.trim().toLocaleLowerCase('pt-BR');
  const visible = materials.filter((material) => {
    const tags = metadataTags(material);
    const study = studyFor(material.id);
    const phase = study.completed ? 'completed' : study.openedAt ? 'active' : 'new';
    const unit = catalog.units.find((entry) => entry.id === material.unit_id);
    const unitName = unit?.title || '';
    return `${material.title} ${material.subject || ''} ${unitName} ${tags.join(' ')}`.toLocaleLowerCase('pt-BR').includes(needle)
      && (controls.subject.value === 'all' || (material.subject || 'Sem disciplina') === controls.subject.value)
      && (controls.tag.value === 'all' || tags.includes(controls.tag.value))
      && (controls.status.value === 'all' || materialState(material) === controls.status.value)
      && (controls.study.value === 'all' || phase === controls.study.value);
  }).sort((a, b) => controls.order.value === 'title'
    ? a.title.localeCompare(b.title, 'pt-BR')
    : controls.order.value === 'opened'
      ? (studyFor(b.id).openedAt || 0) - (studyFor(a.id).openedAt || 0)
      : new Date(b.created_at) - new Date(a.created_at));

  const showingResources = libraryViews?.isResourceView() === true;
  folderToolbar.hidden = !catalogEnabled || showingResources;
  newSubjectButton.hidden = !catalogEnabled;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    count.textContent = `${visible.length} ${visible.length === 1 ? 'aula' : 'aulas'}${visible.length !== materials.length ? ' de ' + materials.length : ''}`;
  }, 120);

  groups.replaceChildren();
  state.replaceChildren();
  const allowEmptyFolders = catalogEnabled && !hasFilters() && !showingResources;
  if (!visible.length && !allowEmptyFolders) {
    state.hidden = false;
    const card = emptyState(
      materials.length ? 'Nenhuma aula encontrada.' : 'Nenhuma aula enviada.',
      materials.length ? 'Tente outra busca ou ajuste os filtros.' : 'Envie uma gravação para começar.',
      { mascot: materials.length ? 'curious' : 'laptop', href: materials.length ? null : './nova-transcricao.html', action: 'Nova transcrição' },
    );
    if (materials.length) {
      const button = document.createElement('button');
      button.className = 'secondary-action';
      button.type = 'button';
      button.textContent = 'Limpar busca e filtros';
      button.addEventListener('click', clear);
      card.querySelector('div').append(button);
    }
    state.append(card);
    return;
  }

  state.hidden = true;
  if (showingResources) renderResources(visible);
  else renderFolderGroups(visible, needle);
  decorateSelection();
}

// ---- Multiple selection: move several lessons at once (Biblioteca 3.0) ---------------------
const selected = new Set();
let selecting = false;
const selectionBar = document.createElement('div');
selectionBar.className = 'library-selection-bar';
selectionBar.setAttribute('role', 'region');
selectionBar.setAttribute('aria-label', 'Aulas selecionadas');
selectionBar.hidden = true;
const selectionCount = document.createElement('p');
selectionCount.setAttribute('aria-live', 'polite');
const moveSelected = document.createElement('button');
moveSelected.type = 'button';
moveSelected.className = 'primary-action';
moveSelected.textContent = 'Mover para…';
const cancelSelection = document.createElement('button');
cancelSelection.type = 'button';
cancelSelection.className = 'secondary-action';
cancelSelection.textContent = 'Cancelar';
// Milestone C: several selected lessons become one integrated material (flag multi_lesson).
let multiLessonEnabled = false;
const integrateSelected = multiLessonSelectionButton(() => materials.filter((material) => selected.has(material.id)).map((material) => material.id));
integrateSelected.hidden = true;
selectionBar.append(selectionCount, moveSelected, integrateSelected, cancelSelection);
document.body.append(selectionBar);
const selectToggle = document.createElement('button');
selectToggle.type = 'button';
selectToggle.className = 'secondary-action library-select-toggle';
selectToggle.textContent = 'Selecionar';
selectToggle.setAttribute('aria-pressed', 'false');
function setSelecting(on) {
  selecting = on;
  if (!on) selected.clear();
  selectToggle.setAttribute('aria-pressed', String(on));
  selectToggle.textContent = on ? 'Concluir seleção' : 'Selecionar';
  document.body.classList.toggle('library-selecting', on);
  render();
}
selectToggle.addEventListener('click', () => setSelecting(!selecting));
cancelSelection.addEventListener('click', () => {
  setSelecting(false);
  selectToggle.focus();
});
function updateSelectionBar() {
  selectionBar.hidden = !selecting;
  selectionCount.textContent = selected.size
    ? `${selected.size} ${selected.size === 1 ? 'aula selecionada' : 'aulas selecionadas'}`
    : 'Toque nas aulas para selecionar';
  moveSelected.disabled = !selected.size;
  integrateSelected.hidden = !multiLessonEnabled;
  integrateSelected.disabled = selected.size < 2;
}
function decorateSelection() {
  // The toggle lives in the folder toolbar, next to the path.
  if (catalogEnabled && catalog.subjects.length && folderToolbar && !folderToolbar.contains(selectToggle))
    folderToolbar.append(selectToggle);
  selectToggle.hidden = !catalogEnabled || !materials.length;
  updateSelectionBar();
  if (!selecting) return;
  for (const item of document.querySelectorAll('.library-material[data-material-id], .library-tree-files[data-material-id]')) {
    const id = item.dataset.materialId;
    if (item.querySelector(':scope > .library-select')) continue;
    const material = materials.find((entry) => entry.id === id);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'library-select';
    box.checked = selected.has(id);
    box.setAttribute('aria-label', `Selecionar ${material?.title || 'aula'}`);
    box.addEventListener('change', () => {
      if (box.checked) selected.add(id);
      else selected.delete(id);
      item.classList.toggle('is-selected', box.checked);
      updateSelectionBar();
    });
    item.classList.toggle('is-selected', box.checked);
    item.prepend(box);
  }
}
// While selecting, a click on a lesson selects it instead of opening it.
document.addEventListener(
  'click',
  (event) => {
    if (!selecting) return;
    const item = event.target.closest?.('.library-material[data-material-id], .library-tree-files[data-material-id]');
    if (!item || event.target.closest('.library-select')) return;
    const link = event.target.closest('a');
    if (!link && !event.target.closest('h3')) return;
    event.preventDefault();
    const box = item.querySelector(':scope > .library-select');
    if (box) {
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change'));
    }
  },
  true,
);
moveSelected.addEventListener('click', () => {
  const chosen = materials.filter((material) => selected.has(material.id));
  if (!chosen.length) return;
  openAssignDialog(chosen[0]);
  assignForm.querySelector('[name="materialId"]').value = chosen.map((material) => material.id).join(',');
  document.querySelector('[data-assign-material-title]').textContent =
    chosen.length === 1 ? chosen[0].title : `${chosen.length} aulas`;
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editing || !editForm.reportValidity()) return;
  const button = editForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const changes = { title: nameField.value.trim() };
    if (!catalogEnabled && (editing.subject || '') !== subjectField.value.trim())
      changes.subject = subjectField.value.trim() || null;
    let updated = await updateMaterial(editing.id, changes);
    if (!folderGroup.hidden) {
      const current = catalog.subjects.find((entry) => entry.id === editing.subject_id || entry.name === editing.subject);
      if ((current?.id || '') !== folderField.value || (editing.unit_id || '') !== unitField.value)
        updated = { ...updated, ...(await assignMaterial(editing.id, folderField.value || null, unitField.value || null)) };
    }
    const persisted = saveTags(editing.id, tagsField.value);
    materials = materials.map((material) => material.id === editing.id
      ? { ...material, ...updated, title: nameField.value.trim(), ...(changes.subject !== undefined ? { subject: changes.subject } : {}) }
      : material);
    populateFilters();
    render();
    editDialog.close();
    count.textContent = persisted ? 'Alterações salvas.' : 'Título salvo. O navegador não permitiu salvar as tags.';
  } catch (error) {
    setStatus(editMessage, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
editDialog.addEventListener('close', () => {
  if (returnFocus?.isConnected) returnFocus.focus();
  else search.focus({ preventScroll: true });
});
document.querySelector('[data-close-metadata]').addEventListener('click', () => editDialog.close());

/** Opens the subject dialog to create (no argument) or edit an existing subject. */
function openSubjectDialog(subject = null) {
  subjectForm.reset();
  subjectMessage.textContent = '';
  if (subject) subjectForm.dataset.editId = subject.id;
  else delete subjectForm.dataset.editId;
  subjectDialog.querySelector('#subject-dialog-title').textContent = subject ? 'Editar disciplina' : 'Nova disciplina';
  subjectForm.querySelector('[type="submit"]').textContent = subject ? 'Salvar' : 'Criar pasta';
  subjectForm.querySelector('[name="name"]').value = subject?.name || '';
  subjectIconPicker.select(subject?.id, subject?.name);
  subjectDialog.showModal();
  subjectForm.querySelector('[name="name"]').focus();
}
newSubjectButton.addEventListener('click', () => openSubjectDialog());
subjectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!subjectForm.reportValidity()) return;
  const button = subjectForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await subjectIconPicker.validate();
    const name = subjectForm.querySelector('[name="name"]').value.trim();
    const editId = subjectForm.dataset.editId;
    if (editId) {
      const updated = await updateSubject(editId, name);
      const entry = catalog.subjects.find((subject) => subject.id === editId);
      if (entry) entry.name = updated.name;
      for (const material of materials) if (material.subject_id === editId) material.subject = updated.name;
      try { await subjectIconPicker.commit(editId); } catch { setStatus(viewStatus,'Disciplina salva. Tente adicionar o PNG novamente mais tarde.','error'); }
      populateFilters();
      render();
      subjectDialog.close();
      return;
    }
    const created = await createSubject(name);
    catalog.subjects.push(created);
    try { await subjectIconPicker.commit(created.id); } catch { setStatus(viewStatus,'Pasta criada. Tente adicionar o PNG novamente mais tarde.','error'); }
    populateFilters();
    openSubjects.add(String(created.id));
    render();
    subjectDialog.close();
  } catch (error) {
    setStatus(subjectMessage, error.message || (subjectForm.dataset.editId ? 'Não foi possível salvar a disciplina.' : 'Não foi possível criar a disciplina.'), 'error');
  } finally {
    button.disabled = false;
  }
});
unitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!unitForm.reportValidity()) return;
  const button = unitForm.querySelector('[type="submit"]');
  const subjectId = unitForm.querySelector('[name="subjectId"]').value;
  button.disabled = true;
  try {
    await unitIconPicker.validate();
    const created = await createUnit(subjectId, unitForm.querySelector('[name="title"]').value.trim());
    catalog.units.push(created);
    try { await unitIconPicker.commit(created.id); } catch { setStatus(viewStatus,'Pasta criada. Tente adicionar o PNG novamente mais tarde.','error'); }
    openSubjects.add(String(subjectId));
    openUnits.add(String(created.id));
    render();
    unitDialog.close();
  } catch (error) {
    setStatus(unitMessage, error.message || 'Não foi possível criar a unidade.', 'error');
  } finally {
    button.disabled = false;
  }
});
assignSubject.addEventListener('change', populateAssignUnits);
assignForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!assignForm.reportValidity()) return;
  const button = assignForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    // One lesson, or several from the selection (moved one by one; a failure stops and says so).
    const ids = assignForm.querySelector('[name="materialId"]').value.split(',').filter(Boolean);
    let moved = 0;
    for (const id of ids) {
      const updated = await assignMaterial(id, assignSubject.value || null, assignUnit.value || null);
      materials = materials.map((material) => (material.id === updated.id ? { ...material, ...updated } : material));
      moved += 1;
    }
    populateFilters();
    if (ids.length > 1) {
      setStatus(count, `${moved} aulas movidas.`, 'success');
      setSelecting(false);
    } else render();
    assignDialog.close();
  } catch (error) {
    setStatus(assignMessage, error.message || 'Não foi possível mover a aula.', 'error');
  } finally {
    button.disabled = false;
  }
});

search.addEventListener('input', render);
Object.values(controls).forEach((control) => control.addEventListener('change', render));
document.querySelector('[data-clear-filters]').addEventListener('click', clear);
document.querySelector('[data-library-search]').addEventListener('submit', (event) => {
  event.preventDefault();
  render();
});

async function load() {
  loaded = false;
  container.setAttribute('aria-busy', 'true');
  loading.hidden = false;
  groups.replaceChildren();
  state.hidden = true;
  try {
    materials = await listMaterials();
    try {
      catalogEnabled = await isFeatureEnabled('catalog_units');
      if (catalogEnabled) {
        catalog = await getCatalog();
        try { treeResources=await getLibraryResources(); } catch { treeResources={}; }
        await folderIcons.load(catalog);
        libraryViews ??= initLibraryViewSwitcher({ onChange: render });
        multiLessonEnabled = await isFeatureEnabled('multi_lesson');
      }
    } catch (error) {
      catalogEnabled = false;
      catalog = { subjects: [], units: [] };
      setStatus(viewStatus, error.message || 'A organização por unidades está indisponível.', 'error');
    }
    loaded = true;
    populateFilters();
    if (query.has('subject') && [...controls.subject.options].some((option) => option.value === query.get('subject')))
      controls.subject.value = query.get('subject');
    render();
    const target = materials.find((material) => material.id === query.get('edit'));
    if (target) edit(target);
  } catch (error) {
    count.textContent = 'Biblioteca indisponível no momento.';
    state.hidden = false;
    state.replaceChildren(errorState(error.message, load));
  } finally {
    loading.hidden = true;
    container.setAttribute('aria-busy', 'false');
  }
}

load();
