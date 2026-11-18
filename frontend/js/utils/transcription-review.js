import { getPublicConfig } from '../api/config.js';
import {
  declareMaterialPermission,
  confirmTranscription,
  getTranscriptionVersions,
  refreshWarnings,
} from '../api/material.api.js';
import { formatDate, formatTimestamp } from './format.js';
import { setStatus } from './shell.js';

export function initTranscriptionReview({
  materialId,
  currentMaterial,
  reload,
  hasUnsavedEdits,
  saveEdits,
  onConfirmed,
  onOpen,
}) {
  let actionBusy = false,
    generationBusy = false,
    warningAttempt = null;
  const message = document.querySelector('[data-confirmation-message]');
  const confirmationButton = document.querySelector('[data-confirm-transcription]');
  const permissionButton = document.querySelector('[data-save-permission]');
  const analyzeButton = document.querySelector('[data-refresh-warnings]');
  const permissionInput = document.querySelector('#material-permission');
  function isReady() {
    return currentMaterial()?.review?.state === 'ready_to_generate' && !hasUnsavedEdits();
  }
  function sourceRevisionId() {
    if (!isReady())
      throw new Error(
        'Salve as alterações e confirme a revisão da transcrição antes de gerar materiais.',
      );
    return currentMaterial().review.sourceRevisionId;
  }
  function updateControls() {
    const review = currentMaterial()?.review;
    const locked = actionBusy || generationBusy;
    confirmationButton.textContent = isReady()
      ? 'Continuar para o resumo'
      : 'Confirmar e continuar';
    confirmationButton.disabled = locked || !review?.sourceRevisionId || review.permissionRequired;
    permissionButton.disabled = locked || !permissionInput.checked;
    analyzeButton.disabled =
      locked || !review?.sourceRevisionId || review.permissionRequired || hasUnsavedEdits();
    document
      .querySelectorAll(
        '[data-generate-summary],[data-regenerate-summary],[data-more-questions-form] [type="submit"]',
      )
      .forEach((button) => {
        button.disabled = locked || !isReady();
      });
  }
  async function action(button, callback) {
    if (button.disabled || actionBusy || generationBusy) return;
    actionBusy = true;
    updateControls();
    try {
      await callback();
      await reload();
      if (button === confirmationButton) onConfirmed?.();
    } catch (error) {
      setStatus(message, error.message, 'error');
    } finally {
      actionBusy = false;
      updateControls();
    }
  }
  document.querySelector('[data-check-transcription]').addEventListener('click', () => {
    const first = document.querySelector('.transcription-segment textarea');
    if (first) {
      onOpen?.();
      first.scrollIntoView({ block: 'center' });
      first.focus({ preventScroll: true });
    }
  });
  permissionInput.addEventListener('change', updateControls);
  permissionButton.addEventListener('click', () =>
    action(permissionButton, async () => {
      const config = await getPublicConfig({ refresh: true });
      document.querySelectorAll('[data-permission-label]').forEach((label) => {
        label.textContent = config.permissionDeclaration.text;
      });
      const shownVersion = permissionInput.dataset.declarationVersion;
      if (shownVersion !== config.permissionDeclaration.version) {
        permissionInput.checked = false;
        permissionInput.dataset.declarationVersion = config.permissionDeclaration.version;
        throw new Error('A declaração mudou. Leia o novo texto e confirme novamente.');
      }
      await declareMaterialPermission(materialId, shownVersion);
      permissionInput.checked = false;
      setStatus(
        message,
        'Declaração de permissão registrada. Agora confira e confirme a transcrição.',
        'success',
      );
    }),
  );
  confirmationButton.addEventListener('click', () =>
    action(confirmationButton, async () => {
      await saveEdits?.();
      const sourceId = currentMaterial().review.sourceRevisionId;
      await confirmTranscription(materialId, sourceId);
      setStatus(message, '', 'success');
    }),
  );
  analyzeButton.addEventListener('click', () =>
    action(analyzeButton, async () => {
      const sourceId = currentMaterial().review.sourceRevisionId;
      if (warningAttempt?.sourceId !== sourceId)
        warningAttempt = { sourceId, key: crypto.randomUUID() };
      await refreshWarnings(materialId, sourceId, warningAttempt.key);
      warningAttempt = null;
      document.querySelector('[data-warning-message]').textContent =
        'Análises atualizadas. Confira o resultado de cada uma.';
    }),
  );
  document.querySelector('[data-transcription-segments]').addEventListener('input', updateControls);

  async function showReference(warning, reference) {
    const versions = await getTranscriptionVersions(materialId);
    const version = versions.find((item) => item.id === warning.sourceRevisionId);
    const segment = version?.segments_snapshot.find((item) => item.position === reference.position);
    if (!segment || !segment.text.includes(reference.quote))
      throw new Error('Este trecho não pôde ser localizado na revisão analisada.');
    if (warning.sourceRevisionId === currentMaterial().review.sourceRevisionId) {
      const nodes = [...document.querySelectorAll('.transcription-segment')];
      const node = nodes.find(
        (item) => Number(item.dataset.segmentPosition) === reference.position,
      );
      if (node) {
        const editor = node.querySelector('textarea');
        editor.focus();
        node.scrollIntoView({ block: 'center' });
        const start = editor.value.indexOf(reference.quote);
        if (start >= 0) editor.setSelectionRange(start, start + reference.quote.length);
      }
    }
    const preview = document.querySelector('[data-warning-preview]');
    preview.hidden = false;
    document.querySelector('[data-warning-preview-title]').textContent =
      'Revisão ' +
      version.revision +
      ' · ' +
      formatTimestamp(segment.startMs) +
      '–' +
      formatTimestamp(segment.endMs);
    document.querySelector('[data-warning-preview-text]').textContent = segment.text;
    preview.focus();
    preview.scrollIntoView({ block: 'nearest' });
  }
  function renderWarnings(material) {
    const list = document.querySelector('[data-warning-list]');
    list.replaceChildren();
    const names = {
      educational: 'Adequação educacional',
      topic_alignment: 'Relação com a disciplina',
      factual_suspicion: 'Suspeita factual',
    };
    const states = {
      warning: 'Conferência sugerida',
      insufficient: 'Contexto insuficiente',
      error: 'Análise indisponível',
      no_warning: 'Nenhum indício detectado nesta análise',
    };
    const allWarnings = material.warnings || [],
      seen = new Set();
    const warnings = allWarnings
      .filter((w) => ['warning', 'insufficient'].includes(w.state))
      .filter((warning) => {
        const key = warning.sourceRevisionId + ':' + warning.type;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
    document.querySelector('[data-open-warnings]').hidden = !warnings.length;
    if (!warnings.length) {
      const note = document.createElement('p');
      note.textContent =
        'Ainda não há análises desta transcrição. Você pode solicitar os avisos acima.';
      list.append(note);
    }
    for (const warning of warnings) {
      const article = document.createElement('article'),
        heading = document.createElement('h3'),
        reason = document.createElement('p'),
        guidance = document.createElement('p'),
        meta = document.createElement('p');
      heading.textContent =
        (names[warning.type] || 'Aviso') +
        ' · ' +
        (states[warning.state] || 'Análise indisponível');
      reason.textContent = warning.explanation;
      guidance.textContent = warning.guidance;
      meta.className = 'section-description';
      meta.textContent =
        formatDate(warning.createdAt) + (warning.stale ? ' · pertence a uma revisão anterior' : '');
      article.append(heading, reason, guidance, meta);
      for (const reference of warning.segmentRefs || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-action';
        button.textContent = 'Conferir trecho · ' + formatTimestamp(reference.startMs);
        button.addEventListener('click', () =>
          showReference(warning, reference).catch((error) => {
            document.querySelector('[data-warning-message]').textContent = error.message;
          }),
        );
        article.append(button);
      }
      list.append(article);
    }
  }
  async function render(material) {
    const review = material.review;
    const permissionSection = document.querySelector('[data-material-permission]');
    permissionSection.hidden = !review?.permissionRequired;
    if (review?.permissionRequired) {
      try {
        const { permissionDeclaration } = await getPublicConfig();
        document.querySelectorAll('[data-permission-label]').forEach((label) => {
          label.textContent = permissionDeclaration.text;
        });
        permissionInput.dataset.declarationVersion = permissionDeclaration.version;
      } catch {
        message.textContent =
          'Não foi possível carregar a declaração. Recarregue antes de confirmar.';
      }
    }
    renderWarnings(material);
    updateControls();
  }
  return {
    render,
    sourceRevisionId,
    updateControls,
    setBusy: (busy) => {
      generationBusy = busy;
      updateControls();
    },
  };
}
