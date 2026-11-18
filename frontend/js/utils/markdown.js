// A deliberately small Markdown renderer. All source text enters through text nodes;
// raw HTML, images and executable URLs are never interpreted.
export function renderMarkdown(target, text = '') {
  target.replaceChildren();
  function inline(node, value) {
    const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
    for (const part of parts) {
      const tag =
        part.startsWith('**') && part.endsWith('**')
          ? 'strong'
          : part.startsWith('`') && part.endsWith('`')
            ? 'code'
            : part.startsWith('*') && part.endsWith('*')
              ? 'em'
              : null;
      if (!tag) node.append(document.createTextNode(part));
      else {
        const el = document.createElement(tag);
        el.textContent = part.slice(tag === 'strong' ? 2 : 1, tag === 'strong' ? -2 : -1);
        node.append(el);
      }
    }
  }
  let list = null,
    paragraph = null,
    code = null;
  for (const line of String(text).split('\n')) {
    if (/^\s*```/.test(line)) {
      if (code) code = null;
      else {
        code = document.createElement('pre');
        target.append(code);
      }
      list = paragraph = null;
      continue;
    }
    if (code) {
      code.append(document.createTextNode(line + '\n'));
      continue;
    }
    if (!line.trim()) {
      list = paragraph = null;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/),
      item = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (heading) {
      const el = document.createElement('h' + Math.min(6, heading[1].length + 2));
      inline(el, heading[2]);
      target.append(el);
      list = paragraph = null;
    } else if (item) {
      const tag = /^\d/.test(item[1]) ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        target.append(list);
      }
      const el = document.createElement('li');
      inline(el, item[2]);
      list.append(el);
      paragraph = null;
    } else {
      list = null;
      if (!paragraph) {
        paragraph = document.createElement('p');
        target.append(paragraph);
      } else paragraph.append(document.createTextNode(' '));
      inline(paragraph, line);
    }
  }
}
