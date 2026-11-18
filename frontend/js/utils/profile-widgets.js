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

// CSS tracker technique inspired by the examples supplied by the user:
// Uiverse.io / kennyotsu and 00Kubi. These are editable adaptations.
function tiltTemplate(cyber) {
  const trackers = Array.from({ length:25 }, (_, i) => `<div class="tracker tr-${i + 1}"></div>`).join('');
  const zones = Array.from({ length:25 }, (_, i) => `.tr-${i + 1}{grid-area:${Math.floor(i / 5) + 1}/${i % 5 + 1}}.tr-${i + 1}:hover~.tilt-card{transform:rotateX(${20 - Math.floor(i / 5) * 10}deg) rotateY(${(i % 5 - 2) * 5}deg)}`).join('\n');
  return {
    title: cyber ? 'Neon' : 'Aurora 3D', type:'widget',
    content:`<div class="stage" tabindex="0"><div class="canvas">${trackers}<div class="tilt-card"><div class="scan"></div><p class="prompt">Passe o mouse ✨</p><div class="reveal"><h2>${cyber ? 'IDEIAS<br>EM ÓRBITA' : 'Meu universo'}</h2><p>Um espaço para descobrir.</p></div><span class="signature">${cyber ? 'CRIAR · EXPLORAR · APRENDER' : 'um pouco de mim'}</span></div></div></div>`,
    css:`/* Adaptação inspirada em ${cyber ? '00Kubi' : 'kennyotsu'} / Uiverse.io */
body{display:grid;place-items:center;min-height:310px;background:${cyber ? '#10141f' : '#faf8ff'}}
.stage{position:relative;width:min(240px,90vw);height:280px;outline-offset:8px}
.canvas{position:absolute;inset:0;display:grid;grid-template:repeat(5,1fr)/repeat(5,1fr);perspective:800px}
.tracker{z-index:2;cursor:pointer}
.tilt-card{position:absolute;inset:0;display:grid;place-items:center;border-radius:24px;overflow:hidden;transition:transform .25s ease,filter .25s ease;background:${cyber ? 'linear-gradient(135deg,#151d2c,#202b3d)' : 'linear-gradient(43deg,#4158d0,#c850c0 55%,#ffcc70)'};color:white;box-shadow:0 16px 28px #10103028;${cyber ? 'border:1px solid #5cffe080;' : ''}}
.prompt{position:absolute;transition:opacity .2s;font-weight:600}
.reveal{opacity:0;text-align:center;transform:translateY(8px);transition:.25s;padding:20px}
.reveal h2{font-size:28px;line-height:1.2;${cyber ? 'color:#62ffda;text-shadow:0 0 18px #00ffaa80;' : ''}}
.reveal p{font-size:14px;opacity:.8}
.signature{position:absolute;bottom:22px;font-size:10px;letter-spacing:2px;opacity:.7}
.tracker:hover~.tilt-card .prompt,.stage:focus .prompt{opacity:0}
.tracker:hover~.tilt-card .reveal,.stage:focus .reveal{opacity:1;transform:none}
.stage:focus .tilt-card{filter:brightness(1.1)}
.scan{pointer-events:none;position:absolute;inset:0;background:linear-gradient(transparent,#62ffda22,transparent);${cyber ? 'animation:scan 4s linear infinite;' : 'display:none;'}}
@keyframes scan{from{translate:0 -100%}to{translate:0 100%}}
${zones}
@media(hover:none){.prompt{display:none}.reveal{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.prompt{display:none}.reveal{opacity:1;transform:none}}
`,
  };
}

export const blockTemplates = {
  aurora: tiltTemplate(false),
  cyber: tiltTemplate(true),
  notes: { title: 'Minhas notas', type: 'text', content: 'O que aprendi hoje:\n\nO que quero explorar:' },
  checklist: { title: 'Pequenos passos', type: 'widget', content: '<h3>Um passo por vez</h3>\n<label><input type="checkbox"> <span>Revisar minhas notas</span></label>\n<label><input type="checkbox"> <span>Praticar uma questão</span></label>\n<label><input type="checkbox"> <span>Fazer uma pausa</span></label>\n<style>h3{color:#6750a4}label{padding:10px;background:#f3effa;border-radius:12px}</style>' },
  quote: { title: 'Uma ideia para hoje', type: 'widget', content: '<blockquote>O importante é continuar aprendendo.</blockquote>\n<details><summary>Minha intenção</summary><p>Reservar um momento para estudar hoje.</p></details>\n<style>blockquote{margin:0 0 20px;padding:20px;border-left:4px solid #538872;background:#edf6f0;border-radius:12px}summary{cursor:pointer;color:#35654d}</style>' },
};

export const templateFields = {
  notes: [['text', 'Notas', 'O que aprendi hoje:\n\nO que quero explorar:']],
  checklist: [['items', 'Um lembrete por linha', 'Revisar minhas notas\nPraticar uma questão\nFazer uma pausa']],
  quote: [['quote', 'Citação', 'O importante é continuar aprendendo.'], ['label', 'Texto para expandir', 'Minha intenção'], ['text', 'Mensagem', 'Reservar um momento para estudar hoje.']],
  aurora: [['heading', 'Título do card', 'Meu universo'], ['text', 'Mensagem', 'Um espaço para descobrir.'], ['signature', 'Rodapé', 'um pouco de mim'], ['prompt', 'Convite', 'Passe o mouse ✨']],
  cyber: [['heading', 'Título do card', 'IDEIAS EM ÓRBITA'], ['text', 'Mensagem', 'Um espaço para descobrir.'], ['signature', 'Rodapé', 'CRIAR · EXPLORAR · APRENDER'], ['prompt', 'Convite', 'Passe o mouse ✨']],
};
const escapeText = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
export function compileTemplate(id, values = {}) {
  const template = blockTemplates[id];
  if (!template) throw new Error('Escolha um template.');
  const fields = Object.fromEntries(templateFields[id].map(([key,,fallback]) => [key, escapeText(values[key] ?? fallback)]));
  let content = template.content;
  if (id === 'notes') content = values.text ?? templateFields.notes[0][2];
  else if (id === 'checklist') {
    const items = String(values.items ?? templateFields.checklist[0][2]).split('\n').filter(item => item.trim()).slice(0, 30);
    content = `<h3>Um passo por vez</h3>${items.map(item => `<label><input type="checkbox"> <span>${escapeText(item)}</span></label>`).join('')}<style>h3{color:#6750a4}label{padding:10px;background:#f3effa;border-radius:12px}</style>`;
  } else if (id === 'quote') {
    content = `<blockquote>${fields.quote}</blockquote><details><summary>${fields.label}</summary><p>${fields.text}</p></details><style>blockquote{margin:0 0 20px;padding:20px;border-left:4px solid #538872;background:#edf6f0;border-radius:12px}summary{cursor:pointer;color:#35654d}</style>`;
  } else {
    content = content.replace(/<h2>[\s\S]*?<\/h2>/, () => `<h2>${fields.heading}</h2>`)
      .replace('Um espaço para descobrir.', () => fields.text)
      .replace(/(<span class="signature">)[\s\S]*?(<\/span>)/, (_, a, b) => a + fields.signature + b)
      .replace('Passe o mouse ✨', () => fields.prompt);
  }
  return { type:template.type, content, css:template.css || '', templateId:id, templateValues:values };
}
