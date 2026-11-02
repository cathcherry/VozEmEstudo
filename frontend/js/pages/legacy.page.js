const params = new URLSearchParams(location.search);
const material = params.get('material');
location.replace(material ? `./responder.html?material=${encodeURIComponent(material)}` : './historico.html');
