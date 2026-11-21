import { toast } from './toast.js';
import { initReadingRuler } from './reading-ruler.js';
import { initShortcutsHelp } from './shortcuts.js';
import { initPageReader } from './page-reader.js';

const appearance = window.VozAppearance;
let uiPreferences = appearance.loadUi();
let syncNavigation = () => {};
let focusDock = null;
let focusDockTrigger = null;
let focusDockOpen = false;
let focusDockPointerType = 'mouse';
let focusDockWasOpenBeforePointer = false;
function clearActiveProfile() {
  appearance.storage.set('voz-active-theme-profile', '');
  document.documentElement.dataset.profile = '';
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
    const name = uiPreferences.focusMode ? 'Sair do modo foco' : 'Modo foco';
    b.setAttribute('aria-pressed', String(uiPreferences.focusMode));
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-keyshortcuts', 'Alt+F');
    b.dataset.tooltip = name;
    b.removeAttribute('title');
    const label = b.querySelector('[data-focus-toggle-label]');
    if (label) label.textContent = 'Modo foco';
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
  syncFocusDock();
  syncScreenReaderToggle();
}
function saveUi(next) {
  // Saved themes store everything except focus mode, so toggling focus keeps the theme active.
  // Focus mode and read-aloud choices are not part of a theme, so they never deselect one.
  const notTheme = ['focusMode', 'readAloud', 'speechRate', 'screenReaderMode', 'density'];
  const changesTheme = Object.keys(appearance.defaults).some(
    (key) => !notTheme.includes(key) && next[key] !== uiPreferences[key],
  );
  uiPreferences = appearance.normalizeUi(next);
  if (changesTheme) clearActiveProfile();
  const saved = appearance.storage.set('audioestudo-ui-preferences', JSON.stringify(uiPreferences));
  appearance.applyUi(uiPreferences);
  updateControls();
  return saved;
}
/** The visible control already reflects the change; only a failed save needs a message. */
function updateUiPreference(key, value) {
  if (!(key in appearance.defaults)) return;
  if (!saveUi({ ...uiPreferences, [key]: value }))
    showToast('Aplicado, mas não foi possível salvar neste navegador.', 'error');
}
function showToast(message, type = 'info') {
  toast(message, { type });
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
      // In focus mode the sidebar opens temporarily as an overlay and is not persisted.
      if (!uiPreferences.focusMode)
        appearance.storage.set('voz-sidebar-collapsed', String(collapsed));
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
/** Dock is the navigation in focus mode (auto-hidden) or when chosen in Aparência (pinned). */
const dockEnabled = () => uiPreferences.focusMode || uiPreferences.navigation === 'dock';
const dockPinned = () => !uiPreferences.focusMode && uiPreferences.navigation === 'dock';
function setFocusDockOpen(open) {
  if (!focusDock || !focusDockTrigger) return;
  focusDockOpen = Boolean((open || dockPinned()) && dockEnabled());
  focusDock.dataset.open = String(focusDockOpen);
  focusDock.inert = !focusDockOpen;
  focusDockTrigger.setAttribute('aria-expanded', String(focusDockOpen));
}
function syncFocusDock() {
  if (!focusDock || !focusDockTrigger) return;
  const enabled = dockEnabled();
  focusDock.hidden = !enabled;
  focusDockTrigger.hidden = !enabled || dockPinned();
  setFocusDockOpen(false);
}
function initializeFocusDock() {
  if (!document.body.classList.contains('app-page')) return;
  const iconMarkup = {
    dashboard: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    review:
      '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v11"/><path d="m7 13 2 2 4-4"/>',
    plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 15h3M8 18h6"/>',
    transcription: '<path d="M12 3v18M7 7v10M2 10v4M17 7v10M22 10v4"/>',
    library: '<path d="M4 4h4v16H4zM11 4h4v16h-4zM18 4l4 15-4 1-4-15z"/>',
    appearance: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z"/>',
    reading: '<path d="M3 20 10 4l7 16M6 14h8M20 4v16"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
  };
  const links = [
    ['Início', './painel.html', 'dashboard'],
    ['Nova transcrição', './nova-transcricao.html', 'transcription'],
    ['Biblioteca', './historico.html', 'library'],
    ['Revisar', './revisar.html', 'review'],
    ['Planejar', './planejar.html', 'plan'],
    ['Configurações', './configuracoes.html', 'appearance'],
  ];
  focusDockTrigger = document.createElement('button');
  focusDockTrigger.type = 'button';
  focusDockTrigger.className = 'focus-dock-trigger';
  focusDockTrigger.setAttribute('aria-label', 'Mostrar navegação do modo foco');
  focusDockTrigger.setAttribute('aria-controls', 'focus-dock');
  focusDockTrigger.setAttribute('aria-expanded', 'false');
  focusDock = document.createElement('nav');
  focusDock.id = 'focus-dock';
  focusDock.className = 'focus-dock';
  focusDock.setAttribute('aria-label', 'Navegação no modo foco');
  for (const [label, href, iconName] of links) {
    const link = document.createElement('a');
    link.href = href;
    link.className = 'focus-dock-link';
    if (iconName === 'review' || iconName === 'plan') link.dataset.navFeature = iconName;
    link.setAttribute('aria-label', label);
    const path = location.pathname.split('/').at(-1) || 'painel.html';
    if (
      path === href.slice(2) ||
      (href === './configuracoes.html' &&
        ['aparencia.html', 'leitura.html', 'ajuda.html', 'privacidade.html'].includes(path))
    ) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.innerHTML = iconMarkup[iconName];
    const text = document.createElement('span');
    text.textContent = label;
    link.append(icon, text);
    focusDock.append(link);
  }
  document.body.append(focusDockTrigger, focusDock);
  focusDock.inert = true;
  focusDockTrigger.addEventListener('pointerdown', (event) => {
    focusDockPointerType = event.pointerType;
    focusDockWasOpenBeforePointer = focusDockOpen;
  });
  focusDockTrigger.addEventListener('click', () => {
    if (focusDockPointerType === 'touch') setFocusDockOpen(!focusDockWasOpenBeforePointer);
    else setFocusDockOpen(true);
    setTimeout(() => {
      focusDockPointerType = 'mouse';
    }, 0);
  });
  focusDockTrigger.addEventListener('focus', () => {
    if (focusDockPointerType !== 'touch') setFocusDockOpen(true);
  });
  focusDockTrigger.addEventListener('focusout', (event) => {
    if (!focusDock.contains(event.relatedTarget)) setFocusDockOpen(false);
  });
  focusDock.addEventListener('pointerenter', () => setFocusDockOpen(true));
  focusDock.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && window.innerHeight - event.clientY > 28)
      setFocusDockOpen(false);
  });
  focusDock.addEventListener('focusout', (event) => {
    if (!focusDock.contains(event.relatedTarget) && event.relatedTarget !== focusDockTrigger)
      setFocusDockOpen(false);
  });
  document.addEventListener('pointermove', (event) => {
    if (!uiPreferences.focusMode || event.pointerType === 'touch') return;
    // Only the centred handle area reveals the dock, so controls along the bottom stay usable.
    const nearBottom =
      window.innerHeight - event.clientY <= 28 &&
      Math.abs(event.clientX - window.innerWidth / 2) <= 180;
    if (nearBottom || focusDock.matches(':hover')) setFocusDockOpen(true);
    else if (!focusDock.contains(document.activeElement)) setFocusDockOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && focusDockOpen && !dockPinned()) {
      setFocusDockOpen(false);
      focusDockTrigger.focus();
    }
  });
  syncFocusDock();
}
/**
 * Screen-reader mode is offered as the second skip link of every page (first Tab), so people who
 * need it do not have to find it inside the settings. The page reader exists only for "Em todo o
 * site"; CSS hides it otherwise.
 */
function initializeAccessibilityEntryPoints() {
  initPageReader();
  const skip = document.querySelector('.skip-link');
  if (!skip || document.querySelector('[data-screen-reader-toggle]')) return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'skip-link screen-reader-toggle';
  toggle.dataset.screenReaderToggle = '';
  skip.after(toggle);
  toggle.addEventListener('click', () => {
    const next = !uiPreferences.screenReaderMode;
    updateUiPreference('screenReaderMode', next);
    showToast(
      next ? 'Modo para leitores de tela ativado.' : 'Modo para leitores de tela desativado.',
    );
    toggle.focus();
  });
  syncScreenReaderToggle();
}
function syncScreenReaderToggle() {
  const toggle = document.querySelector('[data-screen-reader-toggle]');
  if (!toggle) return;
  toggle.textContent = uiPreferences.screenReaderMode
    ? 'Desativar modo para leitores de tela'
    : 'Ativar modo para leitores de tela';
  toggle.setAttribute('aria-pressed', String(uiPreferences.screenReaderMode));
}
function initialize() {
  initializeNavigation();
  if (document.body.classList.contains('app-page')) {
    initReadingRuler();
    initShortcutsHelp();
  }
  initializeFocusDock();
  initializeAccessibilityEntryPoints();
  document.querySelectorAll('[data-open-dialog]').forEach((button) =>
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.openDialog);
      if (dialog?.showModal) dialog.showModal();
    }),
  );
  document
    .querySelectorAll('[data-close-dialog]')
    .forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
  document.querySelectorAll('.settings-dialog').forEach((dialog) =>
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    }),
  );
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
    showToast('Preferências de leitura restauradas.');
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
    const contrastNote = document.querySelector('[data-contrast-note]');
    if (contrastNote) contrastNote.textContent = '';
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
    showToast(message);
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
      if (b.dataset.backgroundPreset) background.value = b.dataset.backgroundPreset;
      if (b.dataset.textPreset) text.value = b.dataset.textPreset;
      if (b.dataset.fontPreset) font.value = b.dataset.fontPreset;
      updatePreview();
    }),
  );
  document.querySelector('#apply-custom-color')?.addEventListener('click', () => {
    const settings = readForm();
    const corrected = appearance.readable(settings.text, settings.background);
    const contrastAdjusted = corrected !== settings.text;
    if (contrastAdjusted) {
      const accepted = window.confirm(
        'O contraste entre o texto e o fundo pode ficar baixo. Quer que eu ajuste a cor do texto automaticamente?',
      );
      if (!accepted) {
        showToast('Ajuste a cor do texto para melhorar o contraste.');
        return;
      }
      settings.text = corrected;
      text.value = corrected;
      updatePreview();
    }
    appearance.saveAppearance(settings);
    notify(contrastAdjusted ? 'Aparência aplicada com contraste ajustado.' : 'Aparência aplicada.');
    document.querySelector('#custom-appearance-dialog')?.close();
  });
  document.querySelector('#reset-brand-theme')?.addEventListener('click', () => {
    appearance.saveAppearance({ ...appearance.loadAppearance(), theme: 'paper' });
    notify('Tema Claro restaurado.');
  });
  const list = document.querySelector('[data-saved-theme-list]'),
    form = document.querySelector('[data-save-theme-form]'),
    message = document.querySelector('[data-saved-theme-message]');
  const kindNames = { light: 'Claro', dark: 'Escuro', focus: 'Personalizado' };
  function profileStatus(value) {
    if (message) message.textContent = '';
    if (value) showToast(value);
  }
  function renderProfiles(focusId) {
    if (!list) return;
    list.replaceChildren();
    const profiles = appearance.loadProfiles();
    if (!profiles.length) {
      const empty = document.createElement('p');
      empty.className = 'saved-theme-empty';
      empty.textContent = 'Ainda sem temas salvos.';
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
      summary.textContent = `${kindNames[profile.kind] || 'Personalizado'} · ${profile.ui.focusMode ? 'modo foco ativo' : 'navegação completa'}`;
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
        focusMode: uiPreferences.focusMode,
      });
      populateColors();
      markTheme();
      renderProfiles();
      document.querySelector('#theme-profile-name').value =
        `Modo ${kindNames[kind].toLowerCase()} personalizado`;
      document.querySelector('#theme-profile-kind').value = kind;
      profileStatus(`Modo ${kindNames[kind].toLowerCase()} aplicado. Dê um nome e salve.`);
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
      document.querySelector('#saved-themes-dialog')?.close();
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
