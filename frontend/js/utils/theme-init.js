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
    readingWidth: 'comfortable',
    readingFont: 'default',
    readingRuler: 'off',
    navigation: 'sidebar',
    // Read-aloud buttons (browser voices) and their speed.
    // 'icons': discreet speakers where reading helps; 'everywhere': also a page reader in the
    // header of every page; 'off': no read-aloud buttons.
    readAloud: 'icons',
    speechRate: 'normal',
    // Minimal presentation for screen-reader users: no decoration, animation or own TTS.
    screenReaderMode: false,
    // Card spacing in study pages: 'comfortable' (default) or 'compact' (more on screen).
    density: 'comfortable',
    // Interface language only (menus, buttons, messages); never lesson content.
    language: 'pt-BR',
    // Personalização 3.0: a declarative wallpaper behind the pages (CSS patterns drawn from the
    // theme's own colours; no uploaded CSS or scripts), per-page overrides, and solid or
    // translucent "glass" cards. Decoration only: content stays on readable surfaces.
    wallpaper: 'none',
    surfaces: 'solid',
    // Flashcards 3.0: how review cards look. Appearance only — never the card's content, source
    // or review history; changing it never asks the server or the AI for anything.
    cardTemplate: 'classic',
  });
  const NAVIGATIONS = ['sidebar', 'dock'];
  const WALLPAPERS = ['none', 'dots', 'grid', 'clouds', 'desktop', 'meadow', 'stars'];
  const SURFACES = ['solid', 'glass'];
  const CARD_TEMPLATES = ['classic', 'notebook', 'sticky', 'window', 'polaroid'];
  // Pages that may have their own wallpaper (file name → key).
  const WALLPAPER_PAGES = {
    'painel.html': 'dashboard',
    'historico.html': 'library',
    'material.html': 'material',
    'revisar.html': 'review',
    'planejar.html': 'plan',
    'focar.html': 'focus',
  };
  const DENSITIES = ['comfortable', 'compact'];
  const LANGUAGES = ['pt-BR', 'en', 'es', 'zh-CN'];
  const READ_ALOUD = ['off', 'icons', 'everywhere'];
  const SPEECH_RATES = ['slow', 'normal', 'fast', 'faster'];
  const RULERS = ['off', 'ruler', 'focus'];
  // Reading fonts: bundled OFL fonts plus a plain system option. "readableFont" is kept only as
  // a derived flag for older saved preferences and themes.
  const READING_FONTS = ['default', 'readable', 'atkinson', 'lexend', 'opendyslexic'];
  const TEXT_SIZES = ['small', 'default', 'medium', 'large', 'extra-large', 'maximum'];
  const SPACINGS = ['compact', 'comfortable', 'wide'];
  const WIDTHS = ['narrow', 'comfortable', 'wide'];
  // Keys mirrored to the account. A local write marks them dirty so a later cloud pull
  // never overwrites a change the server has not received yet.
  const SYNCED_KEYS = [
    'audioestudo-theme',
    'audioestudo-custom-color',
    'audioestudo-custom-background',
    'audioestudo-custom-text',
    'audioestudo-custom-font',
    'audioestudo-ui-preferences',
    'voz-caption-preferences',
  ];
  const allowedThemes = [
    'paper',
    'gabriela',
    'forest',
    'wine',
    'night',
    'custom',
    'contrast-light',
    'contrast-dark',
    'soft',
    'ocean',
    'matcha',
    'desktop',
    'planner',
  ];
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
        if (SYNCED_KEYS.includes(key) || key.startsWith('voz-theme-profiles-v1:'))
          localStorage.setItem('voz-preferences-dirty', 'true');
        // Signed out: this is a choice for the device (login page, before any account), kept
        // apart so that signing out of an account brings it back (see preference-cloud.js).
        if (SYNCED_KEYS.includes(key) && !localStorage.getItem('voz-preferences-owner')) {
          const device = JSON.parse(localStorage.getItem('voz-preferences-device') || '{}');
          device[key] = value;
          localStorage.setItem('voz-preferences-device', JSON.stringify(device));
        }
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
    return normalizeUi(saved);
  }
  function applyUi(prefs) {
    for (const key of Object.keys(defaults)) root.dataset[key] = String(prefs[key]);
    const page = WALLPAPER_PAGES[location.pathname.split('/').pop()] || '';
    root.dataset.wallpaper = (page && prefs.pageWallpapers?.[page]) || prefs.wallpaper;
    root.lang = prefs.language;
    // Dates and times in the interface language (a language change reloads the page).
    globalThis.VOZ_LOCALE = prefs.language;
    // Bottom dock navigation: always in focus mode (auto-hidden), or chosen as the normal
    // navigation in Aparência (always visible). The sidebar is not shown in either case.
    root.dataset.navDock = String(prefs.focusMode || prefs.navigation === 'dock');
    root.dataset.sidebarCollapsed = String(
      prefs.focusMode || storage.get('voz-sidebar-collapsed', 'false') === 'true',
    );
  }
  // One set of custom-theme defaults (the "Claro" palette) for first use and saved profiles.
  const CUSTOM = Object.freeze({ accent: '#3156d8', background: '#f5f8ff', text: '#17243d' });
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
      theme: allowedThemes.includes(saved) ? saved : 'paper',
      accent: validHex(storage.get('audioestudo-custom-color', CUSTOM.accent), CUSTOM.accent),
      background: validHex(
        storage.get('audioestudo-custom-background', CUSTOM.background),
        CUSTOM.background,
      ),
      text: validHex(storage.get('audioestudo-custom-text', CUSTOM.text), CUSTOM.text),
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
        matcha: '#f3f6ea',
        desktop: '#e9f1fb',
        planner: '#fbf6e6',
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
      if (typeof defaults[key] === 'boolean') result[key] = value?.[key] === true;
    if (TEXT_SIZES.includes(value?.textSize)) result.textSize = value.textSize;
    if (SPACINGS.includes(value?.readingSpacing)) result.readingSpacing = value.readingSpacing;
    if (WIDTHS.includes(value?.readingWidth)) result.readingWidth = value.readingWidth;
    if (RULERS.includes(value?.readingRuler)) result.readingRuler = value.readingRuler;
    if (NAVIGATIONS.includes(value?.navigation)) result.navigation = value.navigation;
    if (DENSITIES.includes(value?.density)) result.density = value.density;
    if (WALLPAPERS.includes(value?.wallpaper)) result.wallpaper = value.wallpaper;
    if (SURFACES.includes(value?.surfaces)) result.surfaces = value.surfaces;
    if (CARD_TEMPLATES.includes(value?.cardTemplate)) result.cardTemplate = value.cardTemplate;
    // Focar: block durations follow the account to every device (minutes; same limits as
    // utils/focus-session.js normalizeSettings).
    if (value?.focusSettings && typeof value.focusSettings === 'object') {
      const clamp = (n, min, max, fallback) => {
        const v = Math.round(Number(n));
        return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
      };
      const f = value.focusSettings;
      result.focusSettings = {
        focus: clamp(f.focus, 5, 120, 25),
        short: clamp(f.short, 1, 30, 5),
        long: clamp(f.long, 5, 60, 15),
        longEvery: clamp(f.longEvery, 2, 8, 4),
        autoStart: f.autoStart === true,
        sound: f.sound !== false,
      };
    }
    // Per-set card template (ids are opaque strings, kept short).
    result.setTemplates = {};
    for (const [id, template] of Object.entries(value?.setTemplates || {}).slice(0, 200))
      if (/^[\w-]{1,64}$/.test(id) && CARD_TEMPLATES.includes(template)) result.setTemplates[id] = template;
    // Per-page wallpapers: only known pages and known wallpapers survive.
    result.pageWallpapers = {};
    for (const [page, wallpaper] of Object.entries(value?.pageWallpapers || {}))
      if (Object.values(WALLPAPER_PAGES).includes(page) && WALLPAPERS.includes(wallpaper))
        result.pageWallpapers[page] = wallpaper;
    if (LANGUAGES.includes(value?.language)) result.language = value.language;
    if (READ_ALOUD.includes(value?.readAloud)) result.readAloud = value.readAloud;
    else if (value?.readAloud === 'on') result.readAloud = 'icons';
    if (SPEECH_RATES.includes(value?.speechRate)) result.speechRate = value.speechRate;
    if (READING_FONTS.includes(value?.readingFont)) result.readingFont = value.readingFont;
    else if (value?.readableFont === true) result.readingFont = 'readable';
    result.readableFont = result.readingFont !== 'default';
    return result;
  }
  function normalizeAppearance(value = {}) {
    return {
      theme: allowedThemes.includes(value.theme) ? value.theme : 'paper',
      accent: validHex(value.accent, CUSTOM.accent),
      background: validHex(value.background, CUSTOM.background),
      text: validHex(value.text, CUSTOM.text),
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
    saveAppearance(profile.appearance);
    // Read-aloud choices and card density belong to the person, not to the theme: keep them.
    const current = loadUi();
    const ui = normalizeUi({
      ...profile.ui,
      readAloud: current.readAloud,
      speechRate: current.speechRate,
      screenReaderMode: current.screenReaderMode,
      density: current.density,
      language: current.language,
    });
    storage.set('audioestudo-ui-preferences', JSON.stringify(ui));
    applyUi(ui);
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
    syncedKeys: SYNCED_KEYS,
    normalizeUi,
    textSizes: TEXT_SIZES,
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
      if (
        legacy.spaced === true &&
        (!prefs.readingSpacing || prefs.readingSpacing === 'comfortable')
      )
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
  // Another interface language: keep the page hidden for a moment until it is translated, so
  // Portuguese does not flash first (js/i18n/boot.js removes the mark; 1.5 s safety limit).
  if (root.dataset.language && root.dataset.language !== 'pt-BR') {
    root.setAttribute('data-i18n-pending', '');
    const style = document.createElement('style');
    style.textContent = 'html[data-i18n-pending] body{visibility:hidden}';
    document.head.append(style);
    setTimeout(() => root.removeAttribute('data-i18n-pending'), 1500);
  }
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
