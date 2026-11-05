/* Preferências locais experimentais, sem alterar o schema do Supabase. */
(() => {
  const key = 'voz-accessibility-test-v1';
  const presets = ['default', 'contrast-light', 'contrast-dark', 'soft'];
  const defaults = { preset: 'default', large: false, spaced: false, motion: false };
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    if (presets.includes(saved.preset)) settings.preset = saved.preset;
    for (const field of ['large', 'spaced', 'motion']) settings[field] = saved[field] === true;
  } catch { /* Preferências locais opcionais. */ }
  const root = document.documentElement;
  const apply = () => {
    root.dataset.accessPreset = settings.preset;
    root.dataset.accessLarge = String(settings.large);
    root.dataset.accessSpaced = String(settings.spaced);
    root.dataset.accessMotion = String(settings.motion);
  };
  apply();
  const start = () => {
    const host = document.querySelector('main') || document.body;
    const panel = document.createElement('details');
    panel.className = 'accessibility-controls';
    panel.innerHTML = `<summary>Opções de acessibilidade (teste)</summary>
      <div class="accessibility-options">
        <label for="access-preset">Apresentação
          <select id="access-preset">
            <option value="default">Tema atual</option>
            <option value="contrast-light">Alto contraste claro</option>
            <option value="contrast-dark">Alto contraste escuro</option>
            <option value="soft">Fundo suave</option>
          </select>
        </label>
        <label><input type="checkbox" data-access-key="large"> Texto maior</label>
        <label><input type="checkbox" data-access-key="spaced"> Leitura espaçada</label>
        <label><input type="checkbox" data-access-key="motion"> Movimento reduzido</label>
        <button type="button" data-access-reset>Restaurar opções</button>
      </div>
      <p class="accessibility-note" role="status" aria-live="polite">Preferências deste navegador. Ainda não equivalem à conformidade WCAG.</p>`;
    host.prepend(panel);
    const select = panel.querySelector('#access-preset');
    const note = panel.querySelector('[role="status"]');
    const sync = () => {
      select.value = settings.preset;
      panel.querySelectorAll('[data-access-key]').forEach(input => { input.checked = settings[input.dataset.accessKey]; });
    };
    const save = () => {
      apply();
      try { localStorage.setItem(key, JSON.stringify(settings)); note.textContent = 'Preferências aplicadas e salvas neste navegador.'; }
      catch { note.textContent = 'Preferências aplicadas, mas não puderam ser salvas.'; }
    };
    select.addEventListener('change', () => { settings.preset = select.value; save(); });
    panel.querySelectorAll('[data-access-key]').forEach(input => input.addEventListener('change', () => {
      settings[input.dataset.accessKey] = input.checked; save();
    }));
    panel.querySelector('[data-access-reset]').addEventListener('click', () => { settings = { ...defaults }; sync(); save(); });
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
