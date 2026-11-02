const pages = new Set([
  'painel.html',
  'nova-transcricao.html',
  'historico.html',
  'material.html',
  'responder.html',
  'conta.html',
  'aparencia.html',
  'leitura.html',
  'ajuda.html',
  'gabarito.html',
]);
export function safeDestination(next, origin = location.origin) {
  if (next) {
    try {
      const url = new URL(next, origin);
      if (url.origin === origin && pages.has(url.pathname.split('/').pop()))
        return url.pathname + url.search + url.hash;
    } catch {
      /* Malformed destinations fall back to the dashboard. */
    }
  }
  return './painel.html';
}
export function requestedDestination() {
  return safeDestination(new URLSearchParams(location.search).get('next'));
}
