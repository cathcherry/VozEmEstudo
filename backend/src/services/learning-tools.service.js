import * as repository from '../repositories/learning-tools.repository.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { AppError } from '../domain/errors.js';
import { learningId,validateAnnotation,validateNoteQuery,validateCalendarEvent,validateCalendarQuery,validateShare,validateSharePage,validatePublicToken } from '../validators/learning-tools.validator.js';
export function buildLearningToolsService(store=repository,owned=getOwnedMaterial){return {
  notes:(user,query)=>store.listNotes(user,validateNoteQuery(query)),
  saveNote:(user,body)=>store.saveNote(user,validateAnnotation(body)),
  calendar:(user,query)=>store.calendarFeed(user,validateCalendarQuery(query)),
  saveEvent:(user,body)=>store.saveCalendar(user,validateCalendarEvent(body)),
  async createShare(user,id,body){const materialId=learningId(id);const data=validateShare(body);await owned(user,materialId);return store.createShare(user,materialId,data);},
  async shares(user,id,query){const materialId=learningId(id);const page=validateSharePage(query);await owned(user,materialId);return store.listShares(user,materialId,page.offset);},
  revoke:(user,id,shareId)=>store.revokeShare(user,learningId(id),learningId(shareId)),
  async publicShare(body){const token=validatePublicToken(body);const data=await store.resolveShare(token);if(!data)throw new AppError('SHARE_UNAVAILABLE','Link indisponível, expirado ou revogado.',404);return data;},
};}
export const learningToolsService=buildLearningToolsService();
