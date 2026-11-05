import * as repository from '../repositories/study.repository.js';
import { studyId,validateProgress,validateProgressQuery,validateSession,validateTick,validateStudySettings } from '../validators/study.validator.js';

export function buildStudyService(store=repository) {
  return {
    list: (userId,query) => store.listProgress(userId,validateProgressQuery(query).offset),
    save: (userId,id,body) => store.saveProgress(userId,studyId(id),validateProgress(body)),
    start: (userId,body) => store.startSession(userId,validateSession(body)),
    tick: (userId,id,body) => store.tickSession(userId,studyId(id),validateTick(body)),
    settings: (userId,body) => store.saveSettings(userId,validateStudySettings(body)),
    overview: (userId) => store.overview(userId),
  };
}
export const studyService=buildStudyService();
