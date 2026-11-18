import { createFolderIcons } from '../utils/folder-icons.js';
import '../utils/preferences.js';
import { initAuthenticatedShell, setStatus } from '../utils/shell.js';
import { listMaterials, deleteMaterial, updateMaterial } from '../api/material.api.js';
import { getCatalog, createSubject, createUnit, assignMaterial } from '../api/catalog.api.js';
import { isFeatureEnabled } from '../utils/feature-flags.js';
import { studyFor, metadataTags, saveTags } from '../utils/study-store.js';
import { materialRow, materialHref } from '../utils/library-ui.js';
import { materialState, emptyState, errorState } from '../utils/material-ui.js';
import { initLibraryViewSwitcher } from './library-views.js';

const session = await initAuthenticatedShell();
const folderIcons = createFolderIcons(session.user.id);
const query = new URLSearchParams(location.search);
const search = document.querySelector('#library-search');
const groups = document.querySelector('[data-library-groups]');
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
let libraryViews = null;
const openSubjects = new Set();
const openUnits = new Set();
window.addEventListener('folder-icons-updated',()=>{if(loaded)render();});
const editDialog = document.querySelector('#metadata-dialog');
const editForm = document.querySelector('[data-metadata-form]');
const editMessage = document.querySelector('[data-metadata-message]');
const nameField = document.querySelector('#metadata-name');
const subjectField = document.querySelector('#metadata-subject');
const subjectEditLabel = subjectField.closest('label');
const tagsField = document.querySelector('#metadata-tags');
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
  setStatus(editMessage, '');
  editDialog.showModal();
  nameField.focus();
}

function openUnitDialog(subject) {
  unitForm.reset();
  unitMessage.textContent = '';
  unitForm.querySelector('[name="subjectId"]').value = subject.id;
  document.querySelector('[data-unit-subject-name]').textContent = subject.name;
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
  element.title = 'Arraste para mover para outra pasta';
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
  if (folderName && tagList) {
    for (const tag of [...tagList.children]) {
      if (tag.textContent.toLocaleLowerCase('pt-BR') === folderName.toLocaleLowerCase('pt-BR')) tag.remove();
    }
    if (!tagList.children.length) tagList.remove();
  }
  if (standalone) {
    const icon = document.createElement('span');
    icon.className = 'library-file-icon';
    icon.textContent = '📄';
    icon.setAttribute('aria-hidden', 'true');
    item.querySelector('.material-row-heading').prepend(icon);
  }

  const actions = item.querySelector('.material-row-actions');
  const menu = document.createElement('details');
  menu.className = 'row-menu';
  const summary = document.createElement('summary');
  summary.textContent = 'Ações';
  summary.setAttribute('aria-label', `Ações para ${material.title}`);
  const options = document.createElement('div');
  options.className = 'row-menu-content';
  const organize = document.createElement('button');
  organize.type = 'button';
  organize.textContent = 'Editar título, disciplina e tags';
  organize.addEventListener('click', () => { menu.open = false; edit(material); });
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
  options.append(organize);
  if (catalogEnabled && catalog.subjects.length) {
    const move = document.createElement('button');
    move.type = 'button';
    move.textContent = 'Mover para pasta';
    move.addEventListener('click', () => { menu.open = false; openAssignDialog(material); });
    options.append(move);
  }
  if (materialState(material) === 'ready') options.append(questions);
  const generate = actions.querySelector('a[aria-label^="Gerar novas questões"]');
  if (generate) options.append(generate);
  options.append(remove);
  menu.append(summary, options);
  actions.replaceChildren(actions.querySelector('a.secondary-action'), menu);
  enableDrag(item, material);
  return item;
}

function groupMaterials(visible) {
  const groupsById = new Map();
  const groupsByName = new Map();
  const result = [];
  if (catalogEnabled) {
    for (const subject of catalog.subjects) {
      const group = { id: subject.id, name: subject.name, materials: [] };
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

function renderFolderGroups(visible, _needle) {
  const folderGroups = groupMaterials(visible);
  let groupIndex = 0;
  for (const group of folderGroups) {
    const section = document.createElement('section');
    section.className = 'library-group library-folder-group';
    const folder = document.createElement('details');
    folder.className = 'library-subject-folder';
  folder.open = openSubjects.has(String(group.id || group.name)) || hasFilters();
    folder.addEventListener('toggle', () => {
      section.classList.toggle('is-open', folder.open);
      const key = String(group.id || group.name);
      if (folder.open) openSubjects.add(key);
      else openSubjects.delete(key);
    });
    section.classList.toggle('is-open', folder.open);
    const summary = document.createElement('summary');
    summary.id = `library-group-${groupIndex++}`;
    summary.title = 'Abrir ou recolher esta disciplina';
    const icon = folderIcons.icon('subject',group.id);
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
    if (catalogEnabled && group.id) {
      const createUnitButton = document.createElement('button');
      createUnitButton.type = 'button';
      createUnitButton.className = 'catalog-add-unit';
      createUnitButton.textContent = '+ Nova unidade';
      createUnitButton.addEventListener('click', () => openUnitDialog({ id: group.id, name: group.name }));
      content.append(createUnitButton);
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
      unitSummary.title = 'Abra a unidade ou arraste uma aula para movê-la';
      const unitIcon = folderIcons.icon('unit',unit.id);
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
        for (const material of unitMaterials) unitContent.append(row(material, { folderName: group.name }));
      } else {
        unitContent.append(emptyState('Pasta vazia.', 'Arraste uma aula para cá ou use “Mover para pasta”.', { href: null, mascot: false }));
      }
      if (!unitMaterials.length && hasFilters()) continue;
      unitFolder.append(unitContent);
      enableDrop(unitFolder, group.id, unit.id);
      content.append(unitFolder);
    }

    const standalone = group.materials.filter((material) => !groupedIds.has(material.id));
    if (standalone.length) {
      const heading = document.createElement('h3');
      heading.className = 'library-standalone-heading';
      const fileIcon = document.createElement('span');
      fileIcon.textContent = '📄';
      fileIcon.setAttribute('aria-hidden', 'true');
      heading.append(fileIcon, document.createTextNode('Aulas sem unidade'));
      const list = document.createElement('div');
      list.className = 'library-standalone-list';
      for (const material of standalone) list.append(row(material, { folderName: group.name, standalone: true }));
      content.append(heading, list);
    } else if (!group.materials.length) {
      content.append(emptyState('Nenhuma aula nesta disciplina.', '', { href: null, mascot: false }));
    }

    folder.append(content);
    if (group.id) enableDrop(folder, group.id, null);
    section.append(folder);
    groups.append(section);
  }
}

function renderResources(visible) {
  const resourceGroups = libraryViews.groupsFor(visible);
  const resourceCount = resourceGroups.reduce((total, group) => total + group.items.length, 0);
  if (!resourceCount) {
    state.hidden = false;
    state.append(emptyState('Nenhum recurso encontrado.', 'Tente outra busca ou filtro.', { href: null, mascot: false }));
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
      { mascot: false, href: materials.length ? null : './nova-transcricao.html', action: 'Nova transcrição' },
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
}

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editing || !editForm.reportValidity()) return;
  const button = editForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const changes = { title: nameField.value.trim() };
    if (!catalogEnabled && (editing.subject || '') !== subjectField.value.trim())
      changes.subject = subjectField.value.trim() || null;
    const updated = await updateMaterial(editing.id, changes);
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

newSubjectButton.addEventListener('click', () => {
  subjectForm.reset();
  subjectMessage.textContent = '';
  subjectDialog.showModal();
  subjectForm.querySelector('[name="name"]').focus();
});
subjectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!subjectForm.reportValidity()) return;
  const button = subjectForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await subjectIconPicker.validate();
    const created = await createSubject(subjectForm.querySelector('[name="name"]').value.trim());
    catalog.subjects.push(created);
    try { await subjectIconPicker.commit(created.id); } catch { setStatus(viewStatus,'Pasta criada. Tente adicionar o PNG novamente mais tarde.','error'); }
    populateFilters();
    openSubjects.add(String(created.id));
    render();
    subjectDialog.close();
  } catch (error) {
    setStatus(subjectMessage, error.message || 'Não foi possível criar a disciplina.', 'error');
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
    const updated = await assignMaterial(
      assignForm.querySelector('[name="materialId"]').value,
      assignSubject.value || null,
      assignUnit.value || null,
    );
    syncMaterial(updated);
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
        await folderIcons.load(catalog);
        libraryViews = initLibraryViewSwitcher({ onChange: render });
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
