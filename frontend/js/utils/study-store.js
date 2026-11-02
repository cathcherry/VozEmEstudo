// Personal study history: scoped to the authenticated account in this browser.
// Processing completion is deliberately separate from study/review completion.
let owner = '';
const memory = new Map();
export function setStudyUser(userId) { owner = String(userId || ''); }
const key = () => owner ? `voz-study-v1:${owner}` : '';
function read() {
  if (!key()) return {};
  if(memory.has(key())) return memory.get(key());
  try { const value=JSON.parse(localStorage.getItem(key()) || '{}'); return value && typeof value==='object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
function write(value) {
  if (!key()) return false;
  memory.set(key(), value);
  try { localStorage.setItem(key(), JSON.stringify(value)); return true; } catch { return false; }
}
export function normalizeTags(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : String(value || '').split(','))
    .map((s) => String(s).trim().replace(/\s+/g, ' ').slice(0, 48))
    .filter((s) => { const n = s.toLocaleLowerCase('pt-BR'); if (!s || seen.has(n)) return false; seen.add(n); return true; }).slice(0, 12);
}
export function studyFor(id) {
  const state = read();
  const item = Object.hasOwn(state, id) ? state[id] : {};
  return { visits: 0, tags: [], position: 0, duration: 0, intervals: [], answers: {}, completed: false, ...item };
}
export function updateStudy(id, patch) {
  if (!owner || !id || ['__proto__', 'constructor', 'prototype'].includes(id)) return false;
  const state = read();
  state[id] = { ...studyFor(id), ...patch };
  return write(state);
}
export function visitMaterial(id) {
  const old = studyFor(id), now = Date.now();
  return updateStudy(id, { openedAt: now, visits: old.visits + (now - (old.openedAt || 0) > 300000 ? 1 : 0) });
}
export function saveTags(id, value) { return updateStudy(id, { tags: normalizeTags(value) }); }
export function completeReview(id, completed) { return updateStudy(id, { completed: Boolean(completed), reviewedAt: completed ? Date.now() : null }); }
export function recordAnswer(id, questionId, correct) {
  const old = studyFor(id);
  return updateStudy(id, { answers: { ...old.answers, [questionId]: { correct: Boolean(correct), at: Date.now() } } });
}
export function mergeIntervals(intervals, start, end, duration) {
  const items = [...intervals, [Math.max(0, start), Math.min(duration, end)]].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a,b) => a[0]-b[0]);
  const result = [];
  for (const pair of items) {
    const previous = result.at(-1);
    if (previous && pair[0] <= previous[1] + .15) previous[1] = Math.max(previous[1], pair[1]);
    else result.push([...pair]);
  }
  return result.slice(-300);
}
export function listeningPercent(id) {
  const s = studyFor(id);
  if (!(s.duration > 0)) return 0;
  const listened = s.intervals.reduce((sum, pair) => sum + Math.max(0, pair[1]-pair[0]), 0);
  return Math.min(100, Math.round(listened / s.duration * 100));
}
export function trackPlayback(player, id) {
  let last = null, intervals = studyFor(id).intervals, lastSave = 0, played = false;
  const media = player.media;
  function save(markPlayed = false) {
    const patch = { position: media.currentTime || 0, duration: player.duration || media.duration || 0, intervals };
    if (markPlayed && played) patch.playedAt = Date.now();
    updateStudy(id, patch); lastSave = Date.now();
  }
  const seek = () => { last = null; };
  const time = (allowPaused = false) => {
    const now = Date.now(), current = media.currentTime;
    if ((!media.paused || allowPaused === true) && !media.seeking && played) {
      if (last) {
        const delta = current-last.position, wall = (now-last.at)/1000;
        if (delta > 0 && delta < Math.max(1, wall*media.playbackRate+1) && wall < 5) intervals = mergeIntervals(intervals,last.position,current,player.duration);
      }
      last = { position: current, at: now };
      if (now-lastSave > 2000) save(true);
    }
  };
  const pause = () => { time(true); save(true); last = null; };
  const play = () => { played = true; last = { position: media.currentTime, at: Date.now() }; save(true); };
  const restore = () => { const saved = studyFor(id); if (saved.position > 0 && saved.position < player.duration - .2) player.seekTo(saved.position, false); };
  media.addEventListener('timeupdate', time);
  media.addEventListener('play', play);
  media.addEventListener('pause', pause);
  media.addEventListener('ended', pause);
  media.addEventListener('seeking', seek);
  media.addEventListener('loadedmetadata', restore, { once: true });
  if (media.readyState >= 1) restore();
  const pageHide = () => save(!media.paused);
  window.addEventListener('pagehide', pageHide);
  return () => { time(true); save(); media.removeEventListener('timeupdate',time); media.removeEventListener('play',play); media.removeEventListener('pause',pause); media.removeEventListener('ended',pause); media.removeEventListener('seeking',seek); media.removeEventListener('loadedmetadata',restore); window.removeEventListener('pagehide',pageHide); };
}
export function metadataTags(material) {
  const audio = Array.isArray(material.audio_files) ? material.audio_files[0] : material.audio_files || material.audio;
  return normalizeTags([material.subject || 'Sem disciplina', ...(studyFor(material.id).tags || []), ...(audio?.extension ? [audio.extension.toUpperCase()] : [])]);
}

window.addEventListener('storage', event => { if(event.key) memory.delete(event.key); else memory.clear(); });
