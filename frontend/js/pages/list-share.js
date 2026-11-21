import {
  createQuestionListShare,
  listQuestionListShares,
  revokeQuestionListShare,
} from '../api/material.api.js';
import { randomShareToken, REVOKE_QUESTION } from './sharing-panel.js';
import { pendingMutation } from '../utils/pending-mutation.js';

const make = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const when = (value) => new Date(value).toLocaleString((globalThis.VOZ_LOCALE || 'pt-BR'));

/** Questões tab → list menu → "Compartilhar": revocable, expiring read-only worksheet links. */
export function initListShare({ materialId }) {
  const dialog = document.querySelector('[data-list-share-dialog]');
  const form = dialog.querySelector('[data-list-share-form]');
  const message = dialog.querySelector('[data-list-share-message]');
  const result = dialog.querySelector('[data-list-share-result]');
  const list = dialog.querySelector('[data-list-share-list]');
  let batchId = null,
    identity = null;
  const create = pendingMutation(
    (body) => createQuestionListShare(materialId, batchId, body),
    () => crypto.randomUUID(),
  );

  async function load() {
    list.replaceChildren();
    try {
      const { shares } = await listQuestionListShares(materialId, batchId);
      if (shares.length) list.append(make('strong', 'Links desta lista'));
      for (const share of shares) {
        const active = !share.revoked_at && Date.parse(share.expires_at) > Date.now();
        const row = make(
          'p',
          `${share.revoked_at ? 'Revogado' : active ? 'Disponível' : 'Expirado'} · expira em ${when(share.expires_at)}`,
        );
        if (active) {
          const revoke = make('button', 'Revogar');
          revoke.type = 'button';
          revoke.className = 'text-action';
          revoke.addEventListener('click', () => {
            if (!confirm(REVOKE_QUESTION)) return;
            revoke.disabled = true;
            void revokeQuestionListShare(materialId, batchId, share.id)
              .then(() => {
                message.textContent = 'Link revogado. Novos acessos são recusados.';
                return load();
              })
              .catch((error) => {
                message.textContent = error.message;
                revoke.disabled = false;
              });
          });
          row.append(revoke);
        }
        list.append(row);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    message.textContent = '';
    void create({ ...identity, days: Number(form.elements.days.value) })
      .then((row) => {
        const url = new URL('./compartilhado.html', location.href);
        url.hash = `tipo=lista&token=${identity.token}`;
        const label = make('label', 'Link criado (copie agora; ele não é guardado)');
        const field = make('input');
        field.readOnly = true;
        field.value = url.href;
        label.append(field);
        const copy = make('button', 'Copiar link');
        copy.type = 'button';
        copy.className = 'secondary-action';
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(url.href).then(
            () => (message.textContent = 'Link copiado.'),
            () => field.select(),
          );
        });
        result.replaceChildren(
          label,
          copy,
          make(
            'p',
            `Expira em ${when(row.expiresAt)}. A cópia não acompanha alterações futuras da lista.`,
          ),
        );
        identity = { id: crypto.randomUUID(), token: randomShareToken() };
        field.focus();
        field.select();
        return load();
      })
      .catch((error) => {
        message.textContent = error.message;
      })
      .finally(() => {
        button.disabled = false;
      });
  });

  return {
    open(batch, name) {
      batchId = batch.id;
      identity = { id: crypto.randomUUID(), token: randomShareToken() };
      dialog.querySelector('#list-share-title').textContent = `Compartilhar — ${name}`;
      message.textContent = '';
      result.replaceChildren();
      dialog.showModal();
      void load();
    },
  };
}
