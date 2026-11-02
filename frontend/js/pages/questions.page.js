import '../utils/preferences.js';
import { initAuthenticatedShell } from '../utils/shell.js';
import { listMaterials, generateQuestions } from '../api/material.api.js';

await initAuthenticatedShell();
const form = document.querySelector('[data-generate-questions-form]');
const materialSelect = document.querySelector('#question-material');
const countSelect = document.querySelector('#question-count');
const message = document.querySelector('[data-question-generation-message]');
const submitButton = form.querySelector('[type="submit"]');
submitButton.disabled = true;

try {
  const materials = await listMaterials();
  materialSelect.innerHTML = '<option value="">Selecione um material</option>';
  const available = materials.filter((m) => ['PRONTO', 'PARCIAL'].includes(m.status));
  available.forEach((m) => {
    const option = document.createElement('option');
    option.value = m.id;
    option.textContent = `${m.title}${m.subject ? ` — ${m.subject}` : ''}`;
    materialSelect.appendChild(option);
  });
  const requested = new URLSearchParams(location.search).get('material');
  if (requested) materialSelect.value = requested;
  submitButton.disabled = !available.length;
  if (!available.length) message.textContent = 'Nenhuma aula pronta para gerar questões. Envie e transcreva uma aula primeiro.';
} catch (error) {
  message.textContent = error.message;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  try {
    submitButton.disabled = true;
    message.textContent = 'Criando tarefa de geração...';
    const job = await generateQuestions(materialSelect.value, Number(countSelect.value));
    location.href = `./material.html?id=${encodeURIComponent(materialSelect.value)}&job=${encodeURIComponent(job.jobId)}`;
  } catch (error) {
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});
