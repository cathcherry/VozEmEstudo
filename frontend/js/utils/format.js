export function formatDuration(ms) {
  if (!Number.isFinite(Number(ms))) return '—';
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}min` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatTimestamp(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDate(value) {
  return value ? new Intl.DateTimeFormat((globalThis.VOZ_LOCALE || 'pt-BR'), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
