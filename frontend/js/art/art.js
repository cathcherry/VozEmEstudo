// Art renderer: draws manifest entries by id, mounts Lume (the companion) and fills
// `[data-art-slot]` hooks left by pages. Everything fails soft: an unknown id renders nothing and
// only warns on a development host. Motion lives in /css/art.css and honours reduced motion.
import { ART, ART_BASE, LUME_OUTFITS, LUME_STATES } from './manifest.js';

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);
const isDev = () => {
  try {
    return DEV_HOSTS.has(location.hostname);
  } catch {
    return false;
  }
};
function warn(message) {
  if (isDev()) console.warn(`[art] ${message}`);
}

/** The manifest entry for an id, or null (with a development warning) when it does not exist. */
export function getArt(id) {
  const entry = Object.hasOwn(ART, id) ? ART[id] : null;
  if (!entry) warn(`unknown art id "${id}"`);
  return entry;
}

export const artUrl = (entry) => new URL(entry.src, new URL(ART_BASE, location.href)).href;

/**
 * Renders one piece of art and returns the element (or null for an unknown id).
 * `size` sets the rendered width in CSS pixels (height follows the aspect ratio);
 * `decorative` hides it from assistive technology (use it when nearby text says the same);
 * `lazy: false` loads it at once (for art above the fold).
 */
export function renderArt(id, { size, decorative = false, alt, className = '', lazy = true } = {}) {
  const entry = getArt(id);
  if (!entry) return null;
  const label = alt ?? entry.alt;
  if (entry.mask) {
    const span = document.createElement('span');
    span.className = `art-icon ${className}`.trim();
    span.dataset.artId = id;
    span.style.setProperty('--art-icon', `url("${artUrl(entry)}")`);
    if (size) span.style.setProperty('--art-icon-size', `${size}px`);
    if (decorative) span.setAttribute('aria-hidden', 'true');
    else {
      span.setAttribute('role', 'img');
      span.setAttribute('aria-label', label);
    }
    return span;
  }
  const img = document.createElement('img');
  img.className = `art art-${id.split('.')[0]} ${className}`.trim();
  img.dataset.artId = id;
  img.src = artUrl(entry);
  img.width = entry.width;
  img.height = entry.height;
  img.alt = decorative ? '' : label;
  img.decoding = 'async';
  img.loading = lazy ? 'lazy' : 'eager';
  if (size) img.style.width = `${size}px`;
  return img;
}

// ---- Inline SVG (needed so CSS can animate Lume's parts) ----

const svgCache = new Map();
const UNSAFE = /^(?:script|foreignObject|iframe|object|embed|style)$/i;

/** Parses an SVG file into a sanitised element: no scripts, handlers or external links. */
function sanitise(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName !== 'svg' || doc.querySelector('parsererror')) return null;
  for (const node of [...svg.querySelectorAll('*')]) {
    if (UNSAFE.test(node.localName)) {
      node.remove();
      continue;
    }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attribute.name);
      else if (/href$/.test(name) && !value.startsWith('#')) node.removeAttribute(attribute.name);
    }
  }
  return document.importNode(svg, true);
}

async function loadSvg(entry) {
  const url = artUrl(entry);
  if (!/\.svg(?:$|\?)/i.test(entry.src)) return null;
  if (!svgCache.has(url))
    svgCache.set(
      url,
      fetch(url)
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null),
    );
  const text = await svgCache.get(url);
  return text ? sanitise(text) : null;
}

let uid = 0;
/** Ids inside an inlined SVG must stay unique on the page (gradients, clip paths, patterns). */
function scopeIds(svg) {
  const nodes = [...svg.querySelectorAll('[id]')];
  if (!nodes.length) return svg;
  uid += 1;
  const ids = new Map(nodes.map((node) => [node.id, `art${uid}-${node.id}`]));
  for (const node of nodes) node.id = ids.get(node.id);
  for (const node of svg.querySelectorAll('*'))
    for (const attribute of [...node.attributes]) {
      let value = attribute.value.replace(/url\(#([^)]+)\)/g, (match, id) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match,
      );
      if (value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  return svg;
}

// ---- Lume, the companion ----

const companions = new Set();

function imgFallback(entry, className) {
  const img = document.createElement('img');
  img.src = artUrl(entry);
  img.alt = '';
  img.className = className;
  img.width = entry.width;
  img.height = entry.height;
  return img;
}

/** Puts the outfit's layers into the state's slots, or overlays it when the art has no slots. */
async function dressUp(stage, svg, outfit) {
  if (!outfit) return;
  const entry = getArt(`character.lume.outfit.${outfit}`);
  if (!entry) return;
  const art = svg ? await loadSvg(entry) : null;
  const slots = svg ? svg.querySelectorAll('.lume-outfit-slot[data-layer]') : [];
  if (art && slots.length) {
    for (const slot of slots) {
      const layer = art.querySelector(`[data-layer="${slot.dataset.layer}"]`);
      if (layer) slot.replaceChildren(...[...layer.childNodes].map((node) => node.cloneNode(true)));
    }
    return;
  }
  stage.append(imgFallback(entry, 'lume-outfit-overlay'));
}

/**
 * Mounts Lume into `el` and returns a controller with setState/setOutfit/destroy.
 * Options: state ('idle'…), outfit (one of LUME_OUTFITS or null), size (px), decorative (default true).
 */
export function mountCompanion(
  el,
  { state = 'idle', outfit = null, size, decorative = true } = {},
) {
  if (!el) return null;
  const host = document.createElement('div');
  host.className = 'lume-companion';
  if (size) host.style.setProperty('--lume-size', `${size}px`);
  const stage = document.createElement('div');
  stage.className = 'lume-stage';
  host.append(stage);
  el.replaceChildren(host);
  let token = 0;
  const current = { state: null, outfit: null };

  async function draw(nextState, nextOutfit) {
    const entry = getArt(`character.lume.${nextState}`);
    if (!entry || !LUME_STATES.includes(nextState)) return false;
    if (nextOutfit && !LUME_OUTFITS.includes(nextOutfit)) {
      warn(`unknown Lume outfit "${nextOutfit}"`);
      nextOutfit = null;
    }
    const mine = (token += 1);
    const svg = entry.inline ? await loadSvg(entry) : null;
    if (mine !== token) return false;
    const fresh = document.createElement('div');
    fresh.className = 'lume-stage';
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      fresh.append(scopeIds(svg));
    } else fresh.append(imgFallback(entry, 'lume-art'));
    await dressUp(fresh, svg, nextOutfit);
    if (mine !== token) return false;
    host.querySelector('.lume-stage')?.replaceWith(fresh);
    host.dataset.state = nextState;
    if (nextOutfit) host.dataset.outfit = nextOutfit;
    else delete host.dataset.outfit;
    if (decorative) {
      host.setAttribute('aria-hidden', 'true');
      host.removeAttribute('role');
      host.removeAttribute('aria-label');
    } else {
      host.setAttribute('role', 'img');
      host.setAttribute('aria-label', entry.alt);
    }
    current.state = nextState;
    current.outfit = nextOutfit;
    return true;
  }

  const controller = {
    element: host,
    get state() {
      return current.state;
    },
    get outfit() {
      return current.outfit;
    },
    ready: null,
    setState(next) {
      if (!LUME_STATES.includes(next)) {
        warn(`unknown Lume state "${next}"`);
        return Promise.resolve(false);
      }
      return draw(next, current.outfit);
    },
    setOutfit(next) {
      return draw(current.state || state, next || null);
    },
    destroy() {
      companions.delete(controller);
      token += 1;
      host.remove();
    },
  };
  companions.add(controller);
  controller.ready = draw(LUME_STATES.includes(state) ? state : 'idle', outfit);
  return controller;
}

/** Changes the state of every mounted Lume (pages usually have one). */
export function setCompanionState(state) {
  return Promise.all([...companions].map((companion) => companion.setState(state)));
}
export function setCompanionOutfit(outfit) {
  return Promise.all([...companions].map((companion) => companion.setOutfit(outfit)));
}

// ---- Automatic slots: <div data-art-slot="companion" data-art-state="reading"></div>,
//      <div data-art-slot="empty" data-art-id="empty.library"></div> ----

const mounted = new WeakMap();

function mountSlot(el) {
  const slot = el.dataset.artSlot;
  const decorative = el.dataset.artDecorative !== 'false';
  if (slot === 'companion') {
    const existing = mounted.get(el);
    if (existing && existing.element.isConnected) {
      if (el.dataset.artState && el.dataset.artState !== existing.state)
        existing.setState(el.dataset.artState);
      if ((el.dataset.artOutfit || null) !== existing.outfit)
        existing.setOutfit(el.dataset.artOutfit || null);
      return existing;
    }
    const controller = mountCompanion(el, {
      state: el.dataset.artState || 'idle',
      outfit: el.dataset.artOutfit || null,
      size: Number(el.dataset.artSize) || undefined,
      decorative,
    });
    mounted.set(el, controller);
    return controller;
  }
  const id = el.dataset.artId;
  if (mounted.get(el) === id) return null;
  mounted.set(el, id);
  if (!id) {
    el.replaceChildren();
    return null;
  }
  const art = renderArt(id, { size: Number(el.dataset.artSize) || undefined, decorative });
  el.replaceChildren(...(art ? [art] : []));
  return art;
}

/** Fills every `[data-art-slot]` under `root`. Safe to call repeatedly. */
export function mountArtSlots(root = document) {
  const slots = [...root.querySelectorAll('[data-art-slot]')];
  if (root instanceof Element && root.matches('[data-art-slot]')) slots.unshift(root);
  return slots.map(mountSlot);
}

let observer = null;
function watch() {
  if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches?.('[data-art-slot]')) mountSlot(record.target);
        continue;
      }
      for (const node of record.addedNodes) if (node.nodeType === 1) mountArtSlots(node);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-art-state', 'data-art-outfit', 'data-art-id', 'data-art-slot'],
  });
}

function start() {
  mountArtSlots();
  watch();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
