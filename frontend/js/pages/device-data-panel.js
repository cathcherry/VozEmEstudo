// Configurações › Sincronização e dados neste navegador: an honest synchronization state (from
// the actual pending changes and the last result), "Sincronizar agora", and removing this
// account's copies from the browser. Unsynchronized changes are never deleted without an
// explicit second confirmation.
import { retryCloudState, stopCloudWrites } from '../utils/profile-cloud.js';
import { stopStudySync } from '../utils/study-sync.js';
import { setStudyUser } from '../utils/study-store.js';
import { pendingAccountChanges, removeAccountLocalData } from '../utils/local-account-data.js';
import { releaseAccountPreferences } from '../utils/preference-cloud.js';
import { signOut } from '../api/auth.api.js';

const describe = (items) =>
  items
    .map((item) =>
      item.kind === 'study'
        ? `${item.count} ${item.count === 1 ? 'atualização de estudo' : 'atualizações de estudo'}`
        : item.kind === 'media'
          ? 'uma imagem do perfil'
          : item.kind === 'notebook'
            ? 'um caderno de aula'
            : {
              preferences: 'preferências',
              'dashboard-layout': 'layout do Início',
              'profile-blocks': 'blocos do perfil',
              'profile-layout': 'seções do perfil',
              'study-history': 'histórico de estudo',
              milestones: 'marcos de estudo',
              'catalog-icons': 'ícones de pastas',
              'focus-history': 'blocos de foco',
              'question-reports': 'questões marcadas',
            }[item.key] || 'dados do perfil',
    )
    .join(', ');

export function initDeviceDataPanel({ owner }) {
  const panel = document.querySelector('[data-sync-panel]');
  if (!panel) return;
  const state = panel.querySelector('[data-sync-state]');
  const detail = panel.querySelector('[data-sync-detail]');
  const syncNow = panel.querySelector('[data-sync-now]');
  const dialog = panel.querySelector('[data-clear-device-dialog]');
  const warning = dialog.querySelector('[data-clear-device-warning]');
  const syncFirst = dialog.querySelector('[data-clear-device-sync]');
  const confirmButton = dialog.querySelector('[data-clear-device-confirm]');
  const dialogStatus = dialog.querySelector('[data-clear-device-status]');
  let syncing = false;
  let failed = false;

  function render() {
    const pending = pendingAccountChanges(owner);
    panel.dataset.state = syncing
      ? 'syncing'
      : pending.length
        ? navigator.onLine
          ? 'pending'
          : 'offline'
        : 'saved';
    if (syncing) state.textContent = 'Sincronizando…';
    else if (!pending.length) state.textContent = 'Tudo salvo na sua conta.';
    else if (!navigator.onLine)
      state.textContent =
        'Sem conexão: as mudanças estão salvas neste navegador e serão enviadas quando a conexão voltar.';
    else if (failed)
      state.textContent = 'A sincronização falhou. As mudanças continuam salvas neste navegador.';
    else state.textContent = 'Há mudanças salvas só neste navegador, aguardando sincronização.';
    detail.textContent = pending.length ? `Pendente: ${describe(pending)}.` : '';
    syncNow.hidden = !pending.length;
    syncNow.disabled = syncing || !navigator.onLine;
  }
  async function synchronize() {
    syncing = true;
    render();
    try {
      await retryCloudState(owner);
    } finally {
      syncing = false;
      failed = pendingAccountChanges(owner).length > 0;
      render();
    }
  }
  syncNow.addEventListener('click', () => void synchronize());
  window.addEventListener('voz-sync-state', (event) => {
    if (event.detail?.state === 'pending') failed = true;
    if (event.detail?.state === 'saved') failed = false;
    render();
  });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);

  function openDialog() {
    const pending = pendingAccountChanges(owner);
    warning.hidden = !pending.length;
    syncFirst.hidden = !pending.length || !navigator.onLine;
    warning.textContent = pending.length
      ? `Atenção: ainda não foram enviados para a conta: ${describe(pending)}. Se apagar agora, essas mudanças serão perdidas.`
      : '';
    confirmButton.textContent = pending.length ? 'Apagar mesmo assim e sair' : 'Apagar e sair';
    dialogStatus.textContent = '';
    dialog.showModal();
    (pending.length && navigator.onLine ? syncFirst : confirmButton).focus();
  }
  panel.querySelector('[data-clear-device]').addEventListener('click', openDialog);
  syncFirst.addEventListener('click', async () => {
    syncFirst.disabled = true;
    dialogStatus.textContent = 'Sincronizando…';
    await synchronize();
    syncFirst.disabled = false;
    dialog.close();
    openDialog();
    dialog.querySelector('[data-clear-device-status]').textContent = pendingAccountChanges(owner)
      .length
      ? 'Ainda há mudanças pendentes.'
      : 'Tudo foi enviado para a conta. Agora é seguro apagar.';
  });
  confirmButton.addEventListener('click', async () => {
    confirmButton.disabled = true;
    dialogStatus.textContent = 'Apagando…';
    try {
      const discardPending = pendingAccountChanges(owner).length > 0;
      // From here on nothing writes this account's data again (not even on page unload).
      stopCloudWrites(owner);
      stopStudySync();
      setStudyUser(null);
      // The shared look and language go back to the device's before this account's data goes.
      releaseAccountPreferences({ notify: false });
      await removeAccountLocalData(owner, { discardPending });
      await signOut().catch(() => {});
      // A synchronization that was already running may have written a copy again meanwhile.
      await removeAccountLocalData(owner, { discardPending: true });
      location.href = './login.html';
    } catch (error) {
      dialogStatus.textContent =
        error.message || 'Não foi possível apagar os dados deste navegador.';
      confirmButton.disabled = false;
    }
  });
  render();
}
