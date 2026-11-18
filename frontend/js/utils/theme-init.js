/* Carregado no head, antes do CSS e de qualquer módulo assíncrono. */
(() => {
  const root = document.documentElement;
  const defaults = Object.freeze({
    focusMode: false,
    lowStimulation: false,
    reducedMotion: false,
    highContrast: false,
    readableFont: false,
    textSize: 'default',
    readingSpacing: 'comfortable',
  });
  const allowedThemes = ['paper', 'gabriela', 'forest', 'wine', 'night', 'custom', 'contrast-light', 'contrast-dark', 'soft', 'ocean'];
  const fonts = [
    "Inter, 'Segoe UI', Arial, sans-serif",
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "'Trebuchet MS', 'Arial Rounded MT Bold', Arial, sans-serif",
    "Georgia, 'Times New Roman', serif",
    "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
    'Verdana, Arial, sans-serif',
    'Tahoma, Geneva, sans-serif',
    'Arial, Helvetica, sans-serif',
    "'Courier New', monospace",
    "Consolas, 'Courier New', monospace",
  ];
  const storage = {
    get(key, fallback) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
  function loadUi() {
    let saved = {};
    try {
      saved = JSON.parse(storage.get('audioestudo-ui-preferences', '{}')) || {};
    } catch {
      /* Missing or invalid local preferences retain the safe initial defaults. */
    }
    const prefs = { ...defaults };
    for (const key of Object.keys(defaults))
      if (typeof defaults[key] === 'boolean') prefs[key] = saved[key] === true;
    if (['small', 'default', 'medium', 'large', 'extra-large', 'maximum'].includes(saved.textSize))
      prefs.textSize = saved.textSize;
    if (['compact', 'comfortable', 'wide'].includes(saved.readingSpacing))
      prefs.readingSpacing = saved.readingSpacing;
    return prefs;
  }
  function applyUi(prefs) {
    for (const key of Object.keys(defaults)) root.dataset[key] = String(prefs[key]);
    let focusExpanded = false;
    try {
      focusExpanded = sessionStorage.getItem('voz-focus-sidebar-expanded') === 'true';
    } catch {
      /* Missing or invalid local preferences retain the safe initial defaults. */
    }
    root.dataset.sidebarCollapsed = String(
      prefs.focusMode ? !focusExpanded : storage.get('voz-sidebar-collapsed', 'false') === 'true',
    );
  }
  const validHex = (value, fallback) => (/^#[\da-f]{6}$/i.test(value) ? value : fallback);
  function mix(first, second, amount) {
    const channel = (i) =>
      Math.round(
        parseInt(first.slice(i, i + 2), 16) * (1 - amount) +
          parseInt(second.slice(i, i + 2), 16) * amount,
      )
        .toString(16)
        .padStart(2, '0');
    return `#${channel(1)}${channel(3)}${channel(5)}`;
  }
  function luminance(hex) {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function onColor(color) {
    return contrast(color, '#ffffff') >= contrast(color, '#171b24') ? '#ffffff' : '#171b24';
  }
  function readable(color, background, minimum = 4.5) {
    if (contrast(color, background) >= minimum) return color;
    const target = onColor(background);
    for (let a = 0.05; a <= 1; a += 0.05) {
      const candidate = mix(color, target, a);
      if (contrast(candidate, background) >= minimum) return candidate;
    }
    return target;
  }
  function loadAppearance() {
    const saved = storage.get('audioestudo-theme', 'paper');
    const font = storage.get('audioestudo-custom-font', fonts[0]);
    return {
      theme: allowedThemes.includes(saved)
        ? saved
        : 'paper',
      accent: validHex(storage.get('audioestudo-custom-color', '#4f8ef7'), '#4f8ef7'),
      background: validHex(storage.get('audioestudo-custom-background', '#fffbf6'), '#fffbf6'),
      text: validHex(storage.get('audioestudo-custom-text', '#5a3b2e'), '#5a3b2e'),
      font: fonts.includes(font) ? font : fonts[0],
    };
  }
  function applyAppearance(settings) {
    root.dataset.theme = settings.theme;
    const dark = luminance(settings.background) < 0.2;
    const surface = mix(settings.background, dark ? '#ffffff' : '#000000', dark ? 0.055 : 0.015);
    const text = readable(settings.text, surface);
    const props = {
      accent: settings.accent,
      contrast: onColor(settings.accent),
      background: settings.background,
      surface,
      'surface-alt': mix(settings.background, dark ? '#ffffff' : '#000000', dark ? 0.1 : 0.035),
      text,
      muted: readable(mix(text, surface, 0.22), surface),
      border: mix(surface, text, 0.24),
      link: readable(settings.accent, surface),
      'font-family': settings.font,
    };
    for (const [key, value] of Object.entries(props))
      root.style.setProperty(`--custom-${key}`, value);
    if (settings.theme === 'custom') root.style.colorScheme = dark ? 'dark' : 'light';
    else root.style.removeProperty('color-scheme');
    const background =
      {
        paper: '#f8f9fb',
        gabriela: '#fbf8ff',
        forest: '#f7f7f1',
        wine: '#f8f3f4',
        night: '#151a21',
        'contrast-light': '#ffffff',
        'contrast-dark': '#090909',
        soft: '#fff4d9',
        ocean: '#e7f7f7',
      }[settings.theme] || settings.background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  }
  function saveAppearance(settings) {
    storage.set('voz-active-theme-profile', '');
    root.dataset.profile = '';
    storage.set('audioestudo-theme', settings.theme);
    for (const [field, key] of Object.entries({
      accent: 'color',
      background: 'background',
      text: 'text',
      font: 'font',
    }))
      storage.set(`audioestudo-custom-${key}`, settings[field]);
    applyAppearance(settings);
  }
  let user = storage.get('voz-preferences-owner', '');
  function setUser(id) {
    if (user !== id) {
      root.dataset.profile = '';
      storage.set('voz-active-theme-profile', '');
    }
    user = String(id || '');
    storage.set('voz-preferences-owner', user);
    window.dispatchEvent(new Event('voz-user-change'));
  }
  function normalizeUi(value = {}) {
    const result = { ...defaults };
    for (const key of Object.keys(defaults))
      if (typeof defaults[key] === 'boolean') result[key] = value[key] === true;
    if (['small', 'default', 'medium', 'large', 'extra-large', 'maximum'].includes(value.textSize))
      result.textSize = value.textSize;
    if (['compact', 'comfortable', 'wide'].includes(value.readingSpacing))
      result.readingSpacing = value.readingSpacing;
    return result;
  }
  function normalizeAppearance(value = {}) {
    return {
      theme: allowedThemes.includes(value.theme)
        ? value.theme
        : 'paper',
      accent: validHex(value.accent, '#3265bd'),
      background: validHex(value.background, '#f8f9fb'),
      text: validHex(value.text, '#273142'),
      font: fonts.includes(value.font) ? value.font : fonts[0],
    };
  }
  const profilesKey = () => `voz-theme-profiles-v1:${user || 'device'}`;
  function loadProfiles() {
    try {
      const saved = JSON.parse(storage.get(profilesKey(), '[]'));
      if (!Array.isArray(saved)) return [];
      return saved
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .slice(0, 12)
        .map((p) => ({
          id: p.id.slice(0, 100),
          name: p.name.slice(0, 40),
          kind: ['light', 'dark', 'focus'].includes(p.kind) ? p.kind : 'light',
          appearance: normalizeAppearance(p.appearance),
          ui: normalizeUi(p.ui),
        }));
    } catch {
      return [];
    }
  }
  function saveProfile(name, kind, id) {
    const list = loadProfiles();
    const index = list.findIndex((p) => p.id === id);
    if (index < 0 && list.length >= 12)
      throw new Error('Você pode salvar até 12 temas. Exclua um tema para criar outro.');
    const profile = {
      id: index >= 0 ? id : crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: String(name || '')
        .trim()
        .slice(0, 40),
      kind: ['light', 'dark', 'focus'].includes(kind) ? kind : 'light',
      appearance: loadAppearance(),
      ui: { ...loadUi(), focusMode: false },
    };
    if (!profile.name) throw new Error('Dê um nome ao seu tema.');
    if (
      index < 0 &&
      list.some(
        (p) => p.name.toLocaleLowerCase('pt-BR') === profile.name.toLocaleLowerCase('pt-BR'),
      )
    )
      throw new Error('Você já tem um tema com esse nome. Escolha outro nome ou use Atualizar.');
    if (index >= 0) list[index] = profile;
    else list.push(profile);
    if (!storage.set(profilesKey(), JSON.stringify(list)))
      throw new Error('Não foi possível salvar o tema no armazenamento deste navegador.');
    storage.set('voz-active-theme-profile', profile.id);
    root.dataset.profile = profile.id;
    return profile;
  }
  function applyProfile(id) {
    const profile = loadProfiles().find((p) => p.id === id);
    if (!profile) return;
    try {
      sessionStorage.removeItem('voz-focus-sidebar-expanded');
    } catch {
      /* Missing or invalid local preferences retain the safe initial defaults. */
    }
    saveAppearance(profile.appearance);
    storage.set('audioestudo-ui-preferences', JSON.stringify(profile.ui));
    applyUi(profile.ui);
    storage.set('voz-active-theme-profile', profile.id);
    root.dataset.profile = profile.id;
    window.dispatchEvent(new Event('voz-preferences-change'));
  }
  function removeProfile(id) {
    if (!storage.set(profilesKey(), JSON.stringify(loadProfiles().filter((p) => p.id !== id))))
      throw new Error('Não foi possível excluir o tema.');
    if (root.dataset.profile === id) {
      root.dataset.profile = '';
      storage.set('voz-active-theme-profile', '');
    }
  }
  window.VozAppearance = {
    defaults,
    fonts,
    storage,
    loadUi,
    applyUi,
    loadAppearance,
    applyAppearance,
    saveAppearance,
    mix,
    contrast,
    onColor,
    readable,
    setUser,
    loadProfiles,
    saveProfile,
    applyProfile,
    removeProfile,
  };
  // Converte escolhas feitas no painel experimental para os controles permanentes.
  // Executa uma única vez, sem apagar outras preferências e sem depender do Supabase.
  function migrateLegacyAccessibility() {
    const raw = storage.get('voz-accessibility-test-v1', '');
    if (!raw || storage.get('voz-accessibility-merged-v1', '') === 'true') return;
    try {
      const legacy = JSON.parse(raw);
      if (!legacy || typeof legacy !== 'object') return;
      const prefs = JSON.parse(storage.get('audioestudo-ui-preferences', '{}')) || {};
      if (legacy.large === true && (!prefs.textSize || prefs.textSize === 'default'))
        prefs.textSize = 'large';
      if (legacy.spaced === true && (!prefs.readingSpacing || prefs.readingSpacing === 'comfortable'))
        prefs.readingSpacing = 'wide';
      if (legacy.motion === true) prefs.reducedMotion = true;
      storage.set('audioestudo-ui-preferences', JSON.stringify(prefs));
      if (['contrast-light', 'contrast-dark', 'soft'].includes(legacy.preset))
        storage.set('audioestudo-theme', legacy.preset);
      storage.set('voz-accessibility-merged-v1', 'true');
    } catch {
      // Uma configuração antiga inválida não deve impedir o acesso ao sistema.
    }
  }
  migrateLegacyAccessibility();
  applyAppearance(loadAppearance());
  applyUi(loadUi());
  root.dataset.profile = storage.get('voz-active-theme-profile', '');
  const file = location.pathname.split('/').pop();
  const aliases =
    file === 'conta.html'
      ? { '#aparencia': './aparencia.html', '#foco': './aparencia.html#reading-settings' }
      : file === 'index.html'
        ? { '#nova-transcricao': './nova-transcricao.html', '#historico': './historico.html' }
        : {};
  if (aliases[location.hash]) {
    root.style.visibility = 'hidden';
    location.replace(aliases[location.hash]);
  }
})();
