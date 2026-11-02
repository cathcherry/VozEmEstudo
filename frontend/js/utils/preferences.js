const appearance = window.VozAppearance;
let uiPreferences = appearance.loadUi();
let syncNavigation = () => {};
function clearActiveProfile() {
  appearance.storage.set('voz-active-theme-profile', '');
  document.documentElement.dataset.profile = '';
}
function resetFocusNavigation() {
  try {
    sessionStorage.removeItem('voz-focus-sidebar-expanded');
  } catch {
    /* Unavailable session storage leaves navigation usable with in-memory preferences. */
  }
}
function updateControls() {
  document.querySelectorAll('[data-ui-setting]').forEach((c) => {
    const key = c.dataset.uiSetting;
    if (key in uiPreferences) {
      if (c.type === 'checkbox') c.checked = uiPreferences[key];
      else c.value = uiPreferences[key];
    }
  });
  document.querySelectorAll('[data-focus-toggle]').forEach((b) => {
    const name = uiPreferences.focusMode ? 'Sair do foco' : 'Modo foco';
    b.setAttribute('aria-pressed', String(uiPreferences.focusMode));
    b.setAttribute('aria-label', name);
    b.title = `${name} (Alt + F)`;
    const label = b.querySelector('[data-focus-toggle-label]');
    if (label) label.textContent = name;
  });
  document.querySelectorAll('[data-focus-reading-tools]').forEach((n) => {
    n.hidden = !uiPreferences.focusMode;
  });
  document
    .querySelectorAll('[data-theme-profile]')
    .forEach((row) =>
      row
        .querySelector('[aria-pressed]')
        ?.setAttribute(
          'aria-pressed',
          String(row.dataset.themeProfile === document.documentElement.dataset.profile),
        ),
    );
  syncNavigation();
}
function saveUi(next) {
  if (uiPreferences.focusMode !== next.focusMode) resetFocusNavigation();
  uiPreferences = next;
  clearActiveProfile();
  const saved = appearance.storage.set('audioestudo-ui-preferences', JSON.stringify(uiPreferences));
  appearance.applyUi(uiPreferences);
  updateControls();
  return saved;
}
function updateUiPreference(key, value) {
  if (!(key in appearance.defaults)) return;
  const saved = saveUi({ ...uiPreferences, [key]: value });
  const message = document.querySelector('#personalization-message');
  if (message)
    message.textContent = saved
      ? 'Preferência aplicada e salva neste navegador.'
      : 'Preferência aplicada. Não foi possível salvá-la neste navegador.';
}
function markTheme() {
  const current = appearance.loadAppearance().theme;
  document.querySelectorAll('[data-theme-option]').forEach((b) => {
    const selected = b.dataset.themeOption === current;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
    const mark = b.querySelector('.selection-mark');
    if (mark) mark.textContent = selected ? '✓' : '';
  });
  document.querySelector('[data-custom-theme]')?.classList.toggle('selected', current === 'custom');
}
function initializeNavigation() {
  const root = document.documentElement,
    nav = document.querySelector('#navigation'),
    toggle = document.querySelector('[data-menu-toggle]');
  if (!nav || !toggle) return;
  const mobile = matchMedia('(max-width: 900px)'),
    close = document.querySelector('[data-sidebar-close]'),
    backdrop = document.querySelector('[data-menu-backdrop]');
  const outside = [
    ...document.querySelectorAll('body > header, body > main, body > footer, body > .skip-link'),
  ];
  nav.querySelectorAll('nav a').forEach((link) => {
    const label = link.textContent.trim();
    link.setAttribute('aria-label', label);
    link.title = label;
  });
  if (backdrop) {
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-hidden', 'true');
  }
  function closeMenu(restore = true) {
    const wasOpen = document.body.classList.contains('navigation-open');
    document.body.classList.remove('navigation-open');
    outside.forEach((n) => {
      n.inert = false;
    });
    nav.removeAttribute('role');
    nav.removeAttribute('aria-modal');
    if (mobile.matches) {
      nav.inert = true;
      nav.setAttribute('aria-hidden', 'true');
    } else {
      nav.inert = false;
      nav.removeAttribute('aria-hidden');
    }
    syncNavigation();
    if (wasOpen && restore) toggle.focus();
  }
  syncNavigation = () => {
    const collapsed = root.dataset.sidebarCollapsed === 'true',
      opened = document.body.classList.contains('navigation-open');
    const label = mobile.matches
      ? opened
        ? 'Fechar menu'
        : 'Abrir menu'
      : collapsed
        ? 'Expandir barra lateral'
        : 'Recolher barra lateral';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.setAttribute('aria-expanded', String(mobile.matches ? opened : !collapsed));
    if (!mobile.matches) {
      nav.inert = false;
      nav.removeAttribute('aria-hidden');
    } else if (!opened) {
      nav.inert = true;
      nav.setAttribute('aria-hidden', 'true');
    }
  };
  toggle.addEventListener('click', () => {
    if (mobile.matches) {
      if (document.body.classList.contains('navigation-open')) {
        closeMenu();
        return;
      }
      document.body.classList.add('navigation-open');
      nav.inert = false;
      nav.removeAttribute('aria-hidden');
      nav.setAttribute('role', 'dialog');
      nav.setAttribute('aria-modal', 'true');
      outside.forEach((n) => {
        n.inert = true;
      });
      syncNavigation();
      close?.focus();
    } else {
      const collapsed = root.dataset.sidebarCollapsed !== 'true';
      root.dataset.sidebarCollapsed = String(collapsed);
      if (uiPreferences.focusMode) {
        try {
          sessionStorage.setItem('voz-focus-sidebar-expanded', String(!collapsed));
        } catch {
          /* Unavailable session storage leaves navigation usable with in-memory preferences. */
        }
      } else appearance.storage.set('voz-sidebar-collapsed', String(collapsed));
      syncNavigation();
    }
  });
  close?.addEventListener('click', () => closeMenu());
  backdrop?.addEventListener('click', () => closeMenu());
  document.addEventListener('keydown', (event) => {
    if (!mobile.matches || !document.body.classList.contains('navigation-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
    if (event.key === 'Tab') {
      const controls = [...nav.querySelectorAll('a[href],button:not(:disabled)')].filter(
        (n) => n.getClientRects().length,
      );
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  mobile.addEventListener('change', () => closeMenu(false));
  syncNavigation();
  const header = document.querySelector('.app-topbar');
  if (header && window.ResizeObserver)
    new ResizeObserver(() =>
      root.style.setProperty(
        '--topbar-height',
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      ),
    ).observe(header);
  const tabs = document.querySelector('.material-tabs');
  if (tabs && window.ResizeObserver)
    new ResizeObserver(() =>
      root.style.setProperty(
        '--material-tabs-height',
        `${Math.ceil(tabs.getBoundingClientRect().height)}px`,
      ),
    ).observe(tabs);
}
function initialize() {
  initializeNavigation();
  updateControls();
  markTheme();
  document
    .querySelectorAll('[data-focus-toggle]')
    .forEach((b) =>
      b.addEventListener('click', () => updateUiPreference('focusMode', !uiPreferences.focusMode)),
    );
  const sizes = ['small', 'default', 'medium', 'large', 'extra-large', 'maximum'];
  document.querySelectorAll('[data-focus-size]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = sizes.indexOf(uiPreferences.textSize);
      updateUiPreference(
        'textSize',
        sizes[
          b.dataset.focusSize === 'up' ? Math.min(sizes.length - 1, i + 1) : Math.max(0, i - 1)
        ],
      );
    }),
  );
  document
    .querySelectorAll('[data-ui-setting]')
    .forEach((c) =>
      c.addEventListener('change', () =>
        updateUiPreference(c.dataset.uiSetting, c.type === 'checkbox' ? c.checked : c.value),
      ),
    );
  document.querySelector('#reset-personalization')?.addEventListener('click', () => {
    saveUi({ ...appearance.defaults });
    document.querySelector('#personalization-message').textContent = 'Preferências restauradas.';
  });
  document.addEventListener('keydown', (event) => {
    const editing = event.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.toLowerCase() === 'f' &&
      !editing &&
      document.body.classList.contains('app-page')
    ) {
      event.preventDefault();
      updateUiPreference('focusMode', !uiPreferences.focusMode);
    }
  });
  const color = document.querySelector('#custom-color'),
    background = document.querySelector('#custom-background-color'),
    text = document.querySelector('#custom-text-color'),
    font = document.querySelector('#custom-font-family'),
    preview = document.querySelector('.custom-theme-preview');
  const readForm = () => ({
    theme: 'custom',
    accent: color.value,
    background: background.value,
    text: text.value,
    font: font.value,
  });
  function updatePreview() {
    if (!preview) return;
    const s = readForm(),
      corrected = appearance.readable(s.text, s.background);
    for (const [key, value] of Object.entries({
      background: s.background,
      text: corrected,
      accent: s.accent,
      'button-text': appearance.onColor(s.accent),
      border: appearance.mix(s.background, corrected, 0.24),
      font: s.font,
    }))
      preview.style.setProperty(`--preview-${key}`, value);
    document.querySelector('#custom-color-value').textContent = s.accent.toUpperCase();
    document.querySelector('#custom-background-color-value').textContent =
      s.background.toUpperCase();
    document.querySelector('#custom-text-color-value').textContent = s.text.toUpperCase();
    document.querySelector('[data-contrast-note]').textContent =
      corrected !== s.text
        ? 'O texto será ajustado automaticamente para manter o contraste com o fundo.'
        : 'As cores escolhidas permitem uma leitura confortável.';
  }
  function populateColors() {
    if (!color) return;
    const s = appearance.loadAppearance();
    color.value = s.accent;
    background.value = s.background;
    text.value = s.text;
    font.value = s.font;
    updatePreview();
  }
  function notify(message) {
    const node = document.querySelector('#theme-message');
    if (node) node.textContent = message;
    markTheme();
    renderProfiles();
  }
  populateColors();
  [color, background, text, font].forEach((c) => c?.addEventListener('input', updatePreview));
  document.querySelectorAll('[data-theme-option]').forEach((b) =>
    b.addEventListener('click', () => {
      appearance.saveAppearance({ ...appearance.loadAppearance(), theme: b.dataset.themeOption });
      notify(`Tema ${b.querySelector('strong').textContent} aplicado e salvo.`);
    }),
  );
  document.querySelectorAll('[data-accent-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      color.value = b.dataset.accentPreset;
      updatePreview();
    }),
  );
  document.querySelector('#apply-custom-color')?.addEventListener('click', () => {
    appearance.saveAppearance(readForm());
    notify('Tema personalizado aplicado. Você pode dar um nome e salvá-lo em Meus temas.');
  });
  document.querySelector('#reset-brand-theme')?.addEventListener('click', () => {
    appearance.saveAppearance({ ...appearance.loadAppearance(), theme: 'paper' });
    notify('Tema Voz em Estudo restaurado.');
  });
  const list = document.querySelector('[data-saved-theme-list]'),
    form = document.querySelector('[data-save-theme-form]'),
    message = document.querySelector('[data-saved-theme-message]');
  const kindNames = { light: 'Claro', dark: 'Escuro', focus: 'Foco' };
  function profileStatus(value) {
    if (message) message.textContent = value;
  }
  function renderProfiles(focusId) {
    if (!list) return;
    list.replaceChildren();
    const profiles = appearance.loadProfiles();
    if (!profiles.length) {
      const empty = document.createElement('p');
      empty.className = 'plain-note';
      empty.textContent = 'Você ainda não salvou temas. Escolha uma aparência e dê um nome a ela.';
      list.append(empty);
      return;
    }
    for (const profile of profiles) {
      const row = document.createElement('article');
      row.className = 'saved-theme-row';
      row.dataset.themeProfile = profile.id;
      const description = document.createElement('div'),
        title = document.createElement('h3'),
        summary = document.createElement('p');
      title.textContent = profile.name;
      summary.textContent = `${kindNames[profile.kind]} · ${profile.ui.focusMode ? 'modo foco ativo' : 'navegação completa'}`;
      description.append(title, summary);
      const actions = document.createElement('div');
      actions.className = 'saved-theme-actions';
      function button(buttonText, label, action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'secondary-action';
        b.textContent = buttonText;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', action);
        actions.append(b);
        return b;
      }
      const apply = button('Aplicar', `Aplicar tema ${profile.name}`, () => {
        appearance.applyProfile(profile.id);
        profileStatus(`Tema ${profile.name} aplicado.`);
        document.querySelector(`[data-theme-profile="${CSS.escape(profile.id)}"] button`)?.focus();
      });
      apply.setAttribute(
        'aria-pressed',
        String(document.documentElement.dataset.profile === profile.id),
      );
      button('Atualizar', `Atualizar tema ${profile.name} com as preferências atuais`, () => {
        try {
          appearance.saveProfile(profile.name, profile.kind, profile.id);
          profileStatus(`Tema ${profile.name} atualizado com as preferências atuais.`);
          renderProfiles(profile.id);
        } catch (e) {
          profileStatus(e.message);
        }
      });
      button('Excluir', `Excluir tema ${profile.name}`, () => {
        try {
          appearance.removeProfile(profile.id);
          profileStatus(`Tema ${profile.name} excluído.`);
          renderProfiles();
          form.querySelector('input').focus();
        } catch (e) {
          profileStatus(e.message);
        }
      });
      row.append(description, actions);
      list.append(row);
    }
    if (focusId)
      list.querySelector(`[data-theme-profile="${CSS.escape(focusId)}"] button`)?.focus();
  }
  document.querySelectorAll('[data-profile-template]').forEach((b) =>
    b.addEventListener('click', () => {
      const kind = b.dataset.profileTemplate,
        dark = kind === 'dark';
      appearance.saveAppearance({
        theme: 'custom',
        accent: dark ? '#84b8ff' : '#3265bd',
        background: dark ? '#151a21' : '#f8f9fb',
        text: dark ? '#edf1f7' : '#273142',
        font: appearance.loadAppearance().font,
      });
      saveUi({
        ...uiPreferences,
        focusMode: kind === 'focus',
        lowStimulation: kind === 'focus',
        reducedMotion: kind === 'focus',
      });
      populateColors();
      markTheme();
      renderProfiles();
      document.querySelector('#theme-profile-name').value =
        `Modo ${kindNames[kind].toLowerCase()} personalizado`;
      document.querySelector('#theme-profile-kind').value = kind;
      profileStatus(
        `Modo ${kindNames[kind].toLowerCase()} aplicado. Ajuste as preferências e salve com um nome.`,
      );
    }),
  );
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    try {
      const profile = appearance.saveProfile(
        form.querySelector('input').value,
        form.querySelector('select').value,
      );
      profileStatus(`Tema ${profile.name} salvo.`);
      renderProfiles();
    } catch (e) {
      profileStatus(e.message);
    }
  });
  renderProfiles();
  function refresh() {
    appearance.applyAppearance(appearance.loadAppearance());
    uiPreferences = appearance.loadUi();
    appearance.applyUi(uiPreferences);
    updateControls();
    markTheme();
    populateColors();
    renderProfiles();
  }
  window.addEventListener('voz-user-change', () => renderProfiles());
  window.addEventListener('voz-preferences-change', refresh);
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key.startsWith('audioestudo-') || event.key.startsWith('voz-'))
      refresh();
  });
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
