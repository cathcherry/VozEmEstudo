import '../utils/preferences.js';
import { getSupabase } from '../api/supabase-browser.js';
import { safeDestination } from '../utils/auth-redirect.js';
const message = document.querySelector('[data-auth-message]');
try {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  if (params.has('error') || hash.has('error'))
    throw new Error(
      'O acesso foi cancelado ou não pôde ser autorizado. Você pode tentar novamente.',
    );
  const supabase = await getSupabase();
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    history.replaceState(null, '', location.pathname);
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw (
      error ||
      new Error('Não foi possível concluir o acesso. Inicie o login novamente no mesmo navegador.')
    );
  let next;
  try {
    next = sessionStorage.getItem('voz-auth-next');
    sessionStorage.removeItem('voz-auth-next');
  } catch {
    /* Use the safe dashboard destination when session storage is unavailable. */
  }
  location.replace(safeDestination(next));
} catch (error) {
  message.textContent = error.message || 'Não foi possível concluir o acesso.';
  message.dataset.state = 'error';
  document.querySelector('[data-callback-title]').textContent = 'Vamos tentar de novo?';
  document.querySelector('.loading-indicator').hidden = true;
  document.querySelector('[data-callback-retry]').hidden = false;
}
