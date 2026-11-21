import * as repository from '../repositories/study.repository.js';
import { buildStudyHistory, queryStart } from '../domain/study-history.js';
import { studyId,validateHistoryQuery,validateProgress,validateProgressQuery,validateSession,validateTick,validateStudySettings } from '../validators/study.validator.js';

export function buildStudyService(store=repository) {
  return {
    list: (userId,query) => store.listProgress(userId,validateProgressQuery(query).offset),
    save: (userId,id,body) => store.saveProgress(userId,studyId(id),validateProgress(body)),
    start: (userId,body) => store.startSession(userId,validateSession(body)),
    tick: (userId,id,body) => store.tickSession(userId,studyId(id),validateTick(body)),
    settings: (userId,body) => store.saveSettings(userId,validateStudySettings(body)),
    overview: (userId) => store.overview(userId),
    async history(userId,query,now=new Date()) {
      const {days}=validateHistoryQuery(query);
      const settings=await store.getSettings(userId);
      const sessions=await store.listSessionsSince(userId,queryStart(days,now));
      return buildStudyHistory(sessions,{days,timeZone:settings.timezone,goalMinutes:settings.goalMinutes,now});
    },
  };
}
export const studyService=buildStudyService();
