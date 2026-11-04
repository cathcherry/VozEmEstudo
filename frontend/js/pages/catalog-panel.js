import { isFeatureEnabled } from '../utils/feature-flags.js';
import { setStatus } from '../utils/shell.js';
import { getCatalog, createSubject, createUnit, assignMaterial } from '../api/catalog.api.js';

function option(value, label) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
}

function fillSelect(select, items, firstLabel) {
  const selected = select.value;
  select.replaceChildren(option('', firstLabel));
  for (const item of items) select.append(option(item.id, item.name || item.title));
  if ([...select.options].some((item) => item.value === selected)) select.value = selected;
}

export async function initCatalogPanel({ onAssigned }) {
  const panel = document.querySelector('[data-catalog-panel]');
  if (!panel || !(await isFeatureEnabled('catalog_units'))) return null;

  panel.hidden = false;
  const status = panel.querySelector('[data-catalog-status]');
  const subjectForm = panel.querySelector('[data-catalog-subject-form]');
  const unitForm = panel.querySelector('[data-catalog-unit-form]');
  const assignmentForm = panel.querySelector('[data-catalog-assignment-form]');
  const subjectChoice = assignmentForm.querySelector('[data-catalog-assign-subject]');
  const unitChoice = assignmentForm.querySelector('[data-catalog-assign-unit]');
  const materialChoice = assignmentForm.querySelector('[data-catalog-assign-material]');
  const parentChoice = unitForm.querySelector('[data-catalog-unit-subject]');
  let catalog = { subjects: [], units: [] };
  let materials = [];

  function populateUnits() {
    const units = catalog.units.filter((unit) => unit.subject_id === subjectChoice.value);
    fillSelect(unitChoice, units, 'Sem unidade');
  }

  function populate() {
    fillSelect(parentChoice, catalog.subjects, 'Selecione uma disciplina');
    fillSelect(subjectChoice, catalog.subjects, 'Sem disciplina');
    fillSelect(materialChoice, materials.map((material) => ({
      id: material.id,
      title: material.title,
    })), 'Selecione uma aula');
    populateUnits();
  }

  function setSelectedMaterial() {
    const material = materials.find((item) => item.id === materialChoice.value);
    subjectChoice.value = material?.subject_id || '';
    populateUnits();
    unitChoice.value = material?.unit_id || '';
  }

  async function refresh() {
    catalog = await getCatalog();
    populate();
  }

  function setMaterials(next) {
    materials = next;
    populate();
    setSelectedMaterial();
  }

  async function submit(form, operation, confirmation) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setStatus(status, '');
    try {
      await operation();
      setStatus(status, confirmation, 'success');
    } catch (error) {
      setStatus(status, error.message || 'Não foi possível salvar a organização.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  subjectForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!subjectForm.reportValidity()) return;
    const input = subjectForm.querySelector('[name="name"]');
    void submit(
      subjectForm,
      async () => {
        await createSubject(input.value);
        input.value = '';
        await refresh();
      },
      'Disciplina criada.',
    );
  });

  unitForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!unitForm.reportValidity()) return;
    const title = unitForm.querySelector('[name="title"]');
    const subjectId = parentChoice.value;
    if (!subjectId) {
      setStatus(status, 'Escolha uma disciplina para criar a unidade.', 'error');
      return;
    }
    void submit(
      unitForm,
      async () => {
        await createUnit(subjectId, title.value);
        title.value = '';
        await refresh();
      },
      'Unidade criada.',
    );
  });

  assignmentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!assignmentForm.reportValidity() || !materialChoice.value) return;
    void submit(
      assignmentForm,
      async () => {
        const updated = await assignMaterial(
          materialChoice.value,
          subjectChoice.value || null,
          unitChoice.value || null,
        );
        onAssigned(updated);
      },
      'Aula organizada.',
    );
  });

  materialChoice.addEventListener('change', setSelectedMaterial);
  subjectChoice.addEventListener('change', () => {
    populateUnits();
    unitChoice.value = '';
  });

  try {
    await refresh();
  } catch (error) {
    setStatus(status, error.message || 'O catálogo não está disponível.', 'error');
    for (const button of panel.querySelectorAll('[type="submit"]')) button.disabled = true;
  }

  return {
    setMaterials,
    unitLabelForMaterial(material) {
      const unit = catalog.units.find((item) => item.id === material.unit_id);
      if (!unit) return 'Sem unidade';
      const subject = catalog.subjects.find((item) => item.id === unit.subject_id);
      return subject ? `${subject.name} · ${unit.title}` : unit.title;
    },
  };
}
