let cachedConfig;

export async function getPublicConfig({ refresh = false } = {}) {
  if (cachedConfig && !refresh) return cachedConfig;
  const response = await fetch('/api/config');
  if (!response.ok)
    throw new Error('Não foi possível carregar a configuração pública da aplicação.');
  cachedConfig = await response.json();
  return cachedConfig;
}
