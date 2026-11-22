import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import { getCatalog, createSubject, createUnit, assignMaterial } from '../api/catalog.api.js';
import { materialHref } from '../utils/library-ui.js';
import { icon as uiIcon } from '../utils/icons.js';

const NO_UNIT = '__no_unit__';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function folderIcon() {
  const icon = node('span', 'folder-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.append(uiIcon('folder', { size: 18 }));
  return icon;
}

function enableDrop(target, subjectId, unitId, onMove) {
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
    const id = event.dataTransfer?.getData('text/plain');
    if (id) void onMove(id, subjectId, unitId);
  });
}

export async function initCatalogPanel({ onAssigned }) {
  const panel = document.querySelector('[data-catalog-panel]');
  if (!panel || !(await isFeatureEnabled('catalog_units'))) return null;

  panel.hidden = false;
  const status = panel.querySelector('[data-catalog-status]');
  const subjectForm = panel.querySelector('[data-catalog-subject-form]');
  const subjectInput = subjectForm.querySelector('[name="name"]');
  const subjectList = panel.querySelector('[data-catalog-subject-list]');
  const emptyList = panel.querySelector('[data-catalog-empty]');
  const placeholder = panel.querySelector('[data-catalog-placeholder]');
  const subjectView = panel.querySelector('[data-catalog-subject-view]');
  const subjectTitle = panel.querySelector('[data-catalog-active-subject-name]');
  const noUnits = panel.querySelector('[data-catalog-no-units]');
  const newUnitButton = panel.querySelector('[data-catalog-new-unit]');
  const unitList = panel.querySelector('[data-catalog-unit-list]');
  const unitForm = panel.querySelector('[data-catalog-unit-form]');
  const unitInput = unitForm.querySelector('[name="title"]');
  const unitView = panel.querySelector('[data-catalog-unit-view]');
  const unitTitle = panel.querySelector('[data-catalog-active-unit-name]');
  const unitParent = panel.querySelector('[data-catalog-unit-parent]');
  const unitCount = panel.querySelector('[data-catalog-unit-count]');
  const assignedLessons = panel.querySelector('[data-catalog-assigned-lessons]');
  const lessonSearch = panel.querySelector('[data-catalog-lesson-search]');
  const lessonResults = panel.querySelector('[data-catalog-lesson-results]');
  let catalog = { subjects: [], units: [] };
  let materials = [];
  let activeSubjectId = null;
  let activeUnitKey = null;

  const getSubject = (id = activeSubjectId) => catalog.subjects.find((item) => item.id === id);
  const subjectMaterials = (subjectId) => materials.filter((item) => item.subject_id === subjectId);
  const unitsFor = (subjectId) => catalog.units.filter((item) => item.subject_id === subjectId);

  function beginDrag(element, material) {
    element.draggable = true;
    element.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', material.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      element.classList.add('is-dragging');
    });
    element.addEventListener('dragend', () => element.classList.remove('is-dragging'));
  }

  async function moveMaterial(materialId, subjectId, unitId) {
    try {
      const updated = await assignMaterial(materialId, subjectId, unitId);
      onAssigned(updated);
      setStatus(status, 'Aula organizada na pasta.', 'success');
    } catch (error) {
      setStatus(status, error.message || 'Não foi possível mover esta aula.', 'error');
    }
  }

  function renderSubjects() {
    subjectList.replaceChildren();
    emptyList.hidden = catalog.subjects.length > 0;
    for (const subject of catalog.subjects) {
      const count = subjectMaterials(subject.id).length;
      const button = node('button', 'catalog-folder-button');
      button.type = 'button';
      button.setAttribute('aria-current', subject.id === activeSubjectId ? 'true' : 'false');
      button.append(folderIcon(), node('span', 'catalog-folder-label', subject.name), node('span', 'catalog-folder-count', String(count)));
      button.addEventListener('click', () => {
        activeSubjectId = subject.id;
        activeUnitKey = null;
        lessonSearch.value = '';
        render();
      });
      enableDrop(button, subject.id, null, moveMaterial);
      subjectList.append(button);
    }
  }

  function currentUnit() {
    if (activeUnitKey === NO_UNIT) return null;
    return catalog.units.find((item) => item.id === activeUnitKey) || null;
  }

  function renderUnits() {
    const subject = getSubject();
    if (!subject) return;
    const units = unitsFor(subject.id);
    const looseCount = subjectMaterials(subject.id).filter((item) => !item.unit_id).length;
    noUnits.hidden = units.length > 0 || looseCount > 0;
    newUnitButton.textContent = units.length ? 'Nova unidade' : 'Criar primeira unidade';
    unitList.replaceChildren();

    if (looseCount) {
      const loose = node('button', 'catalog-folder-button catalog-loose-folder');
      loose.type = 'button';
      loose.setAttribute('aria-current', activeUnitKey === NO_UNIT ? 'true' : 'false');
      loose.append(folderIcon(), node('span', 'catalog-folder-label', 'Sem unidade'), node('span', 'catalog-folder-count', String(looseCount)));
      loose.addEventListener('click', () => { activeUnitKey = NO_UNIT; render(); });
      enableDrop(loose, subject.id, null, moveMaterial);
      unitList.append(loose);
    }

    for (const unit of units) {
      const count = materials.filter((item) => item.unit_id === unit.id).length;
      const button = node('button', 'catalog-folder-button catalog-unit-button');
      button.type = 'button';
      button.setAttribute('aria-current', unit.id === activeUnitKey ? 'true' : 'false');
      button.append(folderIcon(), node('span', 'catalog-folder-label', unit.title), node('span', 'catalog-folder-count', String(count)));
      button.addEventListener('click', () => { activeUnitKey = unit.id; lessonSearch.value = ''; render(); });
      enableDrop(button, subject.id, unit.id, moveMaterial);
      unitList.append(button);
    }

  }

  function unitMaterial(material) {
    const row = node('div', 'catalog-lesson-row');
    const link = node('a', '', material.title);
    link.href = materialHref(material.id);
    const handle = node('span', 'catalog-drag-handle', 'Arraste');
    handle.setAttribute('aria-hidden', 'true');
    row.append(folderIcon(), link, handle);
    beginDrag(row, material);
    enableDrop(row, activeSubjectId, activeUnitKey === NO_UNIT ? null : activeUnitKey, moveMaterial);
    return row;
  }

  function renderUnitView() {
    const subject = getSubject();
    const unit = currentUnit();
    if (!subject || activeUnitKey === null) return;
    const assigned = materials.filter((item) => item.subject_id === subject.id &&
      (activeUnitKey === NO_UNIT ? !item.unit_id : item.unit_id === unit?.id));
    unitTitle.textContent = unit?.title || 'Aulas sem unidade';
    unitParent.textContent = subject.name;
    unitCount.textContent = `${assigned.length} ${assigned.length === 1 ? 'aula' : 'aulas'}`;
    assignedLessons.replaceChildren();
    if (!assigned.length) {
      assignedLessons.append(node('p', 'catalog-empty', 'Esta pasta está vazia. Pesquise uma aula abaixo ou arraste uma para cá.'));
    } else {
      for (const material of assigned) assignedLessons.append(unitMaterial(material));
    }
    enableDrop(assignedLessons, subject.id, unit?.id || null, moveMaterial);
    renderLessonResults();
  }

  function renderLessonResults() {
    const subject = getSubject();
    const unit = currentUnit();
    if (!subject || activeUnitKey === null) return;
    const needle = lessonSearch.value.trim().toLocaleLowerCase('pt-BR');
    const current = (item) => item.subject_id === subject.id &&
      (activeUnitKey === NO_UNIT ? !item.unit_id : item.unit_id === unit?.id);
    const matches = materials.filter((item) => !current(item) && (
      needle ? item.title.toLocaleLowerCase('pt-BR').includes(needle) : !item.subject_id
    )).slice(0, 12);
    lessonResults.replaceChildren();
    if (!matches.length) {
      lessonResults.append(node('p', 'catalog-empty', needle
        ? 'Nenhuma aula encontrada com esse título.'
        : 'Digite o título de uma aula para encontrá-la.'));
      return;
    }
    for (const material of matches) {
      const row = node('div', 'catalog-lesson-result');
      row.append(folderIcon(), node('span', 'catalog-lesson-title', material.title));
      const button = node('button', 'text-action', material.subject_id ? 'Mover para cá' : 'Adicionar');
      button.type = 'button';
      button.addEventListener('click', () => void moveMaterial(material.id, subject.id, unit?.id || null));
      row.append(button);
      beginDrag(row, material);
      lessonResults.append(row);
    }
  }

  function render() {
    renderSubjects();
    const subject = getSubject();
    placeholder.hidden = Boolean(subject);
    subjectView.hidden = !subject;
    unitView.hidden = !subject || activeUnitKey === null;
    if (!subject) return;
    subjectTitle.textContent = subject.name;
    renderUnits();
    renderUnitView();
  }

  async function refresh() {
    catalog = await getCatalog();
    render();
  }

  function setMaterials(next) {
    materials = next;
    render();
  }

  subjectForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!subjectForm.reportValidity()) return;
    const button = subjectForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const subject = await createSubject(subjectInput.value.trim());
      catalog.subjects.push(subject);
      subjectInput.value = '';
      activeSubjectId = subject.id;
      activeUnitKey = null;
      render();
      setStatus(status, 'Disciplina criada. Agora crie uma unidade dentro dela.', 'success');
    } catch (error) {
      setStatus(status, error.message || 'Não foi possível criar a disciplina.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  panel.querySelector('[data-catalog-new-unit]').addEventListener('click', () => {
    unitForm.hidden = false;
    unitInput.focus();
  });
  panel.querySelector('[data-catalog-cancel-unit]').addEventListener('click', () => {
    unitForm.reset();
    unitForm.hidden = true;
  });
  unitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!unitForm.reportValidity() || !activeSubjectId) return;
    const button = unitForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const unit = await createUnit(activeSubjectId, unitInput.value.trim());
      catalog.units.push(unit);
      activeUnitKey = unit.id;
      unitForm.reset();
      unitForm.hidden = true;
      render();
      setStatus(status, 'Unidade criada. Arraste aulas para a pasta ou pesquise pelo título.', 'success');
    } catch (error) {
      setStatus(status, error.message || 'Não foi possível criar a unidade.', 'error');
    } finally {
      button.disabled = false;
    }
  });
  lessonSearch.addEventListener('input', renderLessonResults);

  try {
    await refresh();
  } catch (error) {
    setStatus(status, error.message || 'O catálogo não está disponível.', 'error');
    subjectForm.querySelector('[type="submit"]').disabled = true;
  }

  return {
    setMaterials,
    unitLabelForMaterial(material) {
      const unit = catalog.units.find((item) => item.id === material.unit_id);
      if (!unit) return 'Sem unidade';
      const subject = getSubject(unit.subject_id);
      return subject ? `${subject.name} · ${unit.title}` : unit.title;
    },
  };
}
