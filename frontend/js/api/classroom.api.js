import { apiFetch } from './http.js';

// Private classrooms. Every call is authenticated; the server checks membership and role.
const base = (classId) => `/api/classrooms/${encodeURIComponent(classId)}`;
const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const listClassrooms = () => apiFetch('/api/classrooms');
export const createClassroom = (body) => apiFetch('/api/classrooms', json('POST', body));
export const getClassroom = (classId) => apiFetch(base(classId));
export const updateClassroom = (classId, body) => apiFetch(base(classId), json('PATCH', body));
export const joinClassroom = (body) => apiFetch('/api/classrooms/join', json('POST', body));
export const leaveClassroom = (classId) => apiFetch(`${base(classId)}/leave`, { method: 'POST' });

export const listMembers = (classId) => apiFetch(`${base(classId)}/members`);
export const setMemberRole = (classId, userId, role) =>
  apiFetch(`${base(classId)}/members/${encodeURIComponent(userId)}`, json('PATCH', { role }));
export const removeMember = (classId, userId) =>
  apiFetch(`${base(classId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

export const listInvites = (classId) => apiFetch(`${base(classId)}/invites`);
export const createInvite = (classId, body) =>
  apiFetch(`${base(classId)}/invites`, json('POST', body));
export const revokeInvite = (classId, inviteId) =>
  apiFetch(`${base(classId)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });

export const listLessons = (classId) => apiFetch(`${base(classId)}/lessons`);
export const getLesson = (classId, lessonId) =>
  apiFetch(`${base(classId)}/lessons/${encodeURIComponent(lessonId)}`);
export const publishLesson = (classId, body) =>
  apiFetch(`${base(classId)}/lessons`, json('POST', body));
export const unpublishLesson = (classId, lessonId) =>
  apiFetch(`${base(classId)}/lessons/${encodeURIComponent(lessonId)}`, { method: 'DELETE' });

export const listSubmissions = (classId) => apiFetch(`${base(classId)}/submissions`);
export const getSubmission = (classId, submissionId) =>
  apiFetch(`${base(classId)}/submissions/${encodeURIComponent(submissionId)}`);
export const submitRecording = (classId, body) =>
  apiFetch(`${base(classId)}/submissions`, json('POST', body));
export const moveSubmission = (classId, submissionId, body) =>
  apiFetch(
    `${base(classId)}/submissions/${encodeURIComponent(submissionId)}/transitions`,
    json('POST', body),
  );

// Shared flashcard sets: content only (front/back/style), with authorship; never review history.
export const listSharedSets = (classId) => apiFetch(`${base(classId)}/flashcard-sets`);
export const getSharedSet = (classId, sharedId) =>
  apiFetch(`${base(classId)}/flashcard-sets/${encodeURIComponent(sharedId)}`);
export const shareSet = (classId, body) =>
  apiFetch(`${base(classId)}/flashcard-sets`, json('POST', body));
export const revokeSharedSet = (classId, sharedId) =>
  apiFetch(`${base(classId)}/flashcard-sets/${encodeURIComponent(sharedId)}`, { method: 'DELETE' });

export const listResources = (classId) => apiFetch(`${base(classId)}/resources`);
export const addResource = (classId, body) =>
  apiFetch(`${base(classId)}/resources`, json('POST', body));
export const removeResource = (classId, resourceId) =>
  apiFetch(`${base(classId)}/resources/${encodeURIComponent(resourceId)}`, { method: 'DELETE' });

// Invitation codes are generated here (about 60 random bits) and only their hash is stored.
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateInviteCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // Rejection sampling: only bytes below 248 (8 × 31) keep every character equally likely.
  let chars = '';
  while (chars.length < 12)
    for (const byte of random(16))
      if (byte < 248 && chars.length < 12) chars += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
/** The code from a pasted link (…#convite=CODE) or a typed code. */
export function inviteCodeFrom(text) {
  const value = String(text || '').trim();
  const match = value.match(/convite=([A-Za-z0-9-]+)/);
  return (match ? match[1] : value).toUpperCase().replace(/[\s-]/g, '');
}
export const inviteLink = (code, origin = location.origin) =>
  `${origin}/turmas.html#convite=${code}`;
