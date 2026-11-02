import { getSupabase } from './supabase-browser.js';
import { safeDestination } from '../utils/auth-redirect.js';
import { getAvatar } from '../utils/avatars.js';

export async function signIn(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: new URL('./auth-callback.html', location.href).href },
  });
  if (error) throw error;
  return data;
}

export async function requestPasswordReset(email) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('./recuperar-senha.html', location.href).href,
  });
  if (error) throw error;
}

export async function updatePassword(password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signInWithProvider(provider, next) {
  if (!['google', 'github'].includes(provider)) throw new Error('Provedor de acesso inválido.');
  const supabase = await getSupabase();
  try {
    sessionStorage.setItem('voz-auth-next', safeDestination(next));
  } catch {
    /* Storage can be unavailable; the callback uses its safe default destination. */
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: new URL('./auth-callback.html', location.href).href,
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function updateDisplayName(displayName) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
  if (error) throw error;
  return data.user;
}

export async function updateProfile(profile) {
  const supabase = await getSupabase();
  const data = {};
  for (const [key, limit] of Object.entries({
    display_name: 80,
    institution: 100,
    course: 100,
    study_goal: 160,
    bio: 280,
  }))
    data[key] = String(profile[key] || '')
      .trim()
      .slice(0, limit);
  if (!data.display_name) throw new Error('Informe o nome que deseja exibir.');
  data.mascot_avatar = getAvatar(profile.mascot_avatar).id;
  const { data: result, error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
  return result.user;
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `./login.html?next=${next}`;
    throw new Error('AUTH_REQUIRED');
  }
  return session;
}
