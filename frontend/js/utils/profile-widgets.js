// Legacy HTML/CSS cards (and the retired decorative 3D / quote templates, saved as HTML): rendered
// read-only in an iframe with sandbox="" and this document's own CSP. New cards of this kind can
// no longer be created (3.7, see profile-cards.js); this only keeps existing ones visible.
// Widgets have an opaque origin, no scripts, network, forms or parent access.
export function widgetDocument(source, css = '') {
  const doc = new DOMParser().parseFromString(String(source).slice(0, 30000), 'text/html');
  const sheet = doc.createElement('style');
  sheet.textContent = String(css).slice(0, 50000).replace(/<\/style/gi, '');
  doc.head.append(sheet);
  const allowed = new Set('HTML HEAD BODY STYLE TITLE DIV SPAN P H1 H2 H3 H4 STRONG EM B I SMALL BR HR UL OL LI LABEL INPUT BUTTON DETAILS SUMMARY SECTION ARTICLE HEADER FOOTER BLOCKQUOTE PRE CODE PROGRESS'.split(' '));
  for (const el of [...doc.querySelectorAll('*')]) {
    if (!allowed.has(el.tagName)) { el.remove(); continue; }
    for (const attr of [...el.attributes]) {
      if (!['class', 'id', 'style', 'type', 'checked', 'open', 'value', 'max', 'min', 'placeholder', 'for', 'aria-label', 'tabindex'].includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'text', 'range', 'number'].includes(el.type)) el.type = 'text';
  }
  const prefs = window.VozAppearance?.loadUi?.() || {};
  const calm = prefs.reducedMotion || prefs.lowStimulation || prefs.focusMode;
  const stopMotion = '* ,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;transform:none!important}.stage .prompt{display:none}.stage .reveal{opacity:1}';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{font:16px/1.5 system-ui;margin:24px;color:#25314a;background:#fff}*{box-sizing:border-box}input,button{font:inherit}label{display:block;margin:10px 0}input:checked+span{text-decoration:line-through;opacity:.5}</style>${doc.head.innerHTML}<style>@media(prefers-reduced-motion:reduce){${stopMotion}}${calm ? stopMotion : ''}</style></head><body>${doc.body.innerHTML}</body></html>`;
}
