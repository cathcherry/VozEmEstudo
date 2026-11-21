import { apiFetch } from './http.js';
export const listStudyProgress=(offset=0) => apiFetch(`/api/study/progress?offset=${offset}`);
export const saveStudyProgress=(id,body) => apiFetch(`/api/study/progress/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(body),keepalive:true});
export const getStudyOverview=() => apiFetch('/api/study/overview');
export const saveStudySettings=(body) => apiFetch('/api/study/settings',{method:'PUT',body:JSON.stringify(body)});
export const startStudySession=(body) => apiFetch('/api/study/sessions',{method:'POST',body:JSON.stringify(body)});
export const tickStudySession=(id,body) => apiFetch(`/api/study/sessions/${encodeURIComponent(id)}/tick`,{method:'POST',body:JSON.stringify(body),keepalive:true});
export const getStudyHistory=(days=84) => apiFetch(`/api/study/history?days=${days}`);
