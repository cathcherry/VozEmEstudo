// Served in place of the SDK adapter ONLY by the isolated presentation server.
const userId = 'presentation-local-user';
const profileKey = 'voz-presentation-profile';
function getUser() {
  let metadata = {};
  try {
    metadata = JSON.parse(localStorage.getItem(profileKey) || '{}');
  } catch {
    /* Use defaults. */
  }
  return {
    id: userId,
    email: 'apresentacao@example.test',
    created_at: '2026-10-13T12:00:00Z',
    app_metadata: { providers: ['demo local'] },
    user_metadata: { display_name: 'Estudante', ...metadata },
  };
}
const session = () => ({ user: getUser(), access_token: 'presentation-local' });
export async function getSupabase() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: localStorage.getItem('voz-presentation-signed-out') ? null : session() },
      }),
      getUser: async () => ({ data: { user: getUser() } }),
      signInWithPassword: async () => {
        localStorage.removeItem('voz-presentation-signed-out');
        return { data: { session: session() } };
      },
      signOut: async () => {
        localStorage.setItem('voz-presentation-signed-out', '1');
        return {};
      },
      signUp: async () => ({
        error: new Error(
          'O modo apresentação já possui uma conta fictícia. Use Entrar na demonstração.',
        ),
      }),
      signInWithOAuth: async () => ({
        error: new Error('Google e GitHub exigem o ambiente integrado. Use a demonstração local.'),
      }),
      updateUser: async ({ data }) => {
        localStorage.setItem(profileKey, JSON.stringify(data));
        return { data: { user: getUser() } };
      },
    },
    storage: {
      from: () => ({
        upload: async (path, file) => {
          const response = await fetch('/presentation/upload?path=' + encodeURIComponent(path), {
            method: 'POST',
            body: file,
            headers: {
              Authorization: 'Bearer presentation-local',
              'Content-Type': file.type || 'application/octet-stream',
            },
          });
          return response.ok ? {} : { error: new Error((await response.json()).error.message) };
        },
        remove: async (paths) => {
          for (const path of paths)
            await fetch('/presentation/upload?path=' + encodeURIComponent(path), {
              method: 'DELETE',
              headers: { Authorization: 'Bearer presentation-local' },
            });
          return {};
        },
      }),
    },
  };
}
