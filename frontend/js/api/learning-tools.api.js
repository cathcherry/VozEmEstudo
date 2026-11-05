import { apiFetch } from './http.js';
const query=(options)=>new URLSearchParams(Object.entries(options).filter(([,v])=>v!==undefined&&v!==null));
export const listAnnotations=(options={})=>apiFetch(`/api/annotations?${query(options)}`);
export const saveAnnotation=(body)=>apiFetch('/api/annotations',{method:'PUT',body:JSON.stringify(body)});
export const listCalendar=(options)=>apiFetch(`/api/calendar?${query(options)}`);
export const saveCalendarEvent=(body)=>apiFetch('/api/calendar',{method:'PUT',body:JSON.stringify(body)});
export const createMaterialShare=(id,body)=>apiFetch(`/api/sharing/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify(body)});
export const listMaterialShares=(id,offset=0)=>apiFetch(`/api/sharing/${encodeURIComponent(id)}?offset=${offset}`);
export const revokeMaterialShare=(id,shareId)=>apiFetch(`/api/sharing/${encodeURIComponent(id)}/${encodeURIComponent(shareId)}`,{method:'DELETE'});
